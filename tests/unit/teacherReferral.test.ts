import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  teacherReferralPrefix,
  generateTeacherReferralCodeCandidate,
  createUniqueTeacherReferralCode,
  resolveTeacherReferralCode,
  grantReferralReward,
} from '@/lib/teacherReferral';

// --- pure generation -------------------------------------------------------

describe('teacher referral code generation', () => {
  it('derives the uppercased first-name prefix, capped at 6 chars', () => {
    expect(teacherReferralPrefix('Ahmed Aly')).toBe('AHMED');
    expect(teacherReferralPrefix('mohammed hassan')).toBe('MOHAMM');
    expect(teacherReferralPrefix('  Sara  ')).toBe('SARA');
  });

  it('falls back to TEACHER for Arabic-only or empty names', () => {
    expect(teacherReferralPrefix('أحمد علي')).toBe('TEACHER');
    expect(teacherReferralPrefix('')).toBe('TEACHER');
    expect(teacherReferralPrefix('   ')).toBe('TEACHER');
    expect(teacherReferralPrefix(null)).toBe('TEACHER');
  });

  it('produces a name-based uppercase candidate with a random suffix', () => {
    expect(generateTeacherReferralCodeCandidate('Ahmed Aly')).toMatch(/^AHMED[A-Z0-9]{2,}$/);
    expect(generateTeacherReferralCodeCandidate('أحمد')).toMatch(/^TEACHER[A-Z0-9]{2,}$/);
  });

  it('createUniqueTeacherReferralCode returns a unique code, retrying on collision', async () => {
    let calls = 0;
    const fake = {
      from: () => ({
        select: () => ({
          eq: () => ({
            // First 3 candidates "exist"; the 4th is free.
            maybeSingle: async () => {
              calls += 1;
              return calls <= 3
                ? { data: { user_id: 'someone' }, error: null }
                : { data: null, error: null };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const code = await createUniqueTeacherReferralCode(fake, 'Ahmed Aly');
    expect(code).toMatch(/^AHMED[A-Z0-9]{2,}$/);
    expect(calls).toBe(4);
  });
});

// --- resolution ------------------------------------------------------------

function resolverClient(byCode: Record<string, { user_id: string }>): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: (_col: string, val: unknown) => ({
          maybeSingle: async () => ({ data: byCode[String(val)] ?? null, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('resolveTeacherReferralCode', () => {
  it('returns null for empty / non-string input without touching the DB', async () => {
    const client = resolverClient({});
    expect(await resolveTeacherReferralCode(client, '')).toBeNull();
    expect(await resolveTeacherReferralCode(client, '   ')).toBeNull();
    expect(await resolveTeacherReferralCode(client, undefined)).toBeNull();
    expect(await resolveTeacherReferralCode(client, 42)).toBeNull();
  });

  it('returns null for an unknown code (silently ignored, mirrors center)', async () => {
    expect(await resolveTeacherReferralCode(resolverClient({}), 'NOPE9999')).toBeNull();
  });

  it('resolves a known code case-insensitively to the referrer user_id', async () => {
    const client = resolverClient({ AHMED7X: { user_id: 'u-referrer' } });
    expect(await resolveTeacherReferralCode(client, 'ahmed7x')).toBe('u-referrer');
    expect(await resolveTeacherReferralCode(client, '  AHMED7X ')).toBe('u-referrer');
  });
});

// --- grant -----------------------------------------------------------------
//
// Tiny in-memory engine modelling the two tables grantReferralReward touches.
// Mirrors the project's thenable-builder mock convention so `await update().eq()`
// (referrer, plain) and `await update().eq().is().select()` (referee,
// conditional) both work against the same store.

type Sub = {
  id: string;
  teacher_id: string;
  free_months_credit: number;
  referral_rewarded_at: string | null;
};

let profilesByUser: Record<string, { referred_by_teacher_id: string | null }>;
let subs: Sub[];
let auditInserts: Record<string, unknown>[];

const findSubByTeacher = (tid: unknown) => subs.find((s) => s.teacher_id === tid);
const findSubById = (id: unknown) => subs.find((s) => s.id === id);

function grantClient(): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const b = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return b;
          },
          maybeSingle: async () => {
            if (table === 'teacher_profiles') {
              const row = profilesByUser[String(filters.user_id)];
              return { data: row ?? null, error: null };
            }
            if (table === 'teacher_subscriptions') {
              const sub = findSubByTeacher(filters.teacher_id);
              return { data: sub ? { ...sub } : null, error: null };
            }
            return { data: null, error: null };
          },
        };
        return b;
      },
      update: (payload: Record<string, unknown>) => ({
        eq: (_col: string, idVal: unknown) => ({
          // Referee path: conditional on the marker still being null.
          is: (_isCol: string, isVal: unknown) => ({
            select: async () => {
              const sub = findSubById(idVal);
              if (sub && sub.referral_rewarded_at === isVal) {
                sub.free_months_credit = payload.free_months_credit as number;
                sub.referral_rewarded_at = payload.referral_rewarded_at as string;
                return { data: [{ id: sub.id }], error: null };
              }
              return { data: [], error: null };
            },
          }),
          // Referrer path: plain awaited update().eq().
          then: (
            onFulfilled: (v: { error: null }) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) => {
            const sub = findSubById(idVal);
            if (sub) sub.free_months_credit = payload.free_months_credit as number;
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          },
        }),
      }),
      insert: async (payload: Record<string, unknown>) => {
        if (table === 'audit_log') auditInserts.push(payload);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
}

describe('grantReferralReward', () => {
  beforeEach(() => {
    profilesByUser = {};
    subs = [];
    auditInserts = [];
  });

  it('no referee id -> no grant', async () => {
    const r = await grantReferralReward(grantClient(), null);
    expect(r).toEqual({ granted: false, reason: 'no_referee' });
  });

  it('referee not referred -> no grant', async () => {
    profilesByUser = { referee: { referred_by_teacher_id: null } };
    subs = [{ id: 's1', teacher_id: 'referee', free_months_credit: 0, referral_rewarded_at: null }];
    const r = await grantReferralReward(grantClient(), 'referee');
    expect(r.reason).toBe('not_referred');
    expect(subs[0].free_months_credit).toBe(0);
  });

  it('self-referral -> no grant', async () => {
    profilesByUser = { referee: { referred_by_teacher_id: 'referee' } };
    subs = [{ id: 's1', teacher_id: 'referee', free_months_credit: 0, referral_rewarded_at: null }];
    const r = await grantReferralReward(grantClient(), 'referee');
    expect(r.reason).toBe('self_referral');
    expect(subs[0].free_months_credit).toBe(0);
  });

  it('no referee subscription row -> no grant', async () => {
    profilesByUser = { referee: { referred_by_teacher_id: 'referrer' } };
    subs = [];
    const r = await grantReferralReward(grantClient(), 'referee');
    expect(r.reason).toBe('no_subscription');
  });

  it('first paid charge -> +1 to BOTH, marker set, audited', async () => {
    profilesByUser = { referee: { referred_by_teacher_id: 'referrer' } };
    subs = [
      { id: 's-ref', teacher_id: 'referee', free_months_credit: 0, referral_rewarded_at: null },
      { id: 's-rer', teacher_id: 'referrer', free_months_credit: 2, referral_rewarded_at: null },
    ];

    const r = await grantReferralReward(grantClient(), 'referee');

    expect(r).toMatchObject({ granted: true, reason: 'granted', referrerId: 'referrer', referrerCredited: true });
    expect(findSubByTeacher('referee')!.free_months_credit).toBe(1);
    expect(findSubByTeacher('referee')!.referral_rewarded_at).not.toBeNull();
    expect(findSubByTeacher('referrer')!.free_months_credit).toBe(3);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].action).toBe('teacher_referral_rewarded');
  });

  it('second charge -> idempotent, no re-grant (marker holds)', async () => {
    profilesByUser = { referee: { referred_by_teacher_id: 'referrer' } };
    subs = [
      { id: 's-ref', teacher_id: 'referee', free_months_credit: 0, referral_rewarded_at: null },
      { id: 's-rer', teacher_id: 'referrer', free_months_credit: 0, referral_rewarded_at: null },
    ];
    const client = grantClient();

    const first = await grantReferralReward(client, 'referee');
    expect(first.granted).toBe(true);
    expect(findSubByTeacher('referee')!.free_months_credit).toBe(1);
    expect(findSubByTeacher('referrer')!.free_months_credit).toBe(1);

    // Re-delivered webhook / later charge: marker already set.
    const second = await grantReferralReward(client, 'referee');
    expect(second).toEqual({ granted: false, reason: 'already_rewarded' });
    // No double credit.
    expect(findSubByTeacher('referee')!.free_months_credit).toBe(1);
    expect(findSubByTeacher('referrer')!.free_months_credit).toBe(1);
  });

  it('pre-set marker -> already_rewarded, nothing changes', async () => {
    profilesByUser = { referee: { referred_by_teacher_id: 'referrer' } };
    subs = [
      { id: 's-ref', teacher_id: 'referee', free_months_credit: 5, referral_rewarded_at: '2026-01-01T00:00:00Z' },
      { id: 's-rer', teacher_id: 'referrer', free_months_credit: 5, referral_rewarded_at: null },
    ];
    const r = await grantReferralReward(grantClient(), 'referee');
    expect(r).toEqual({ granted: false, reason: 'already_rewarded' });
    expect(findSubByTeacher('referee')!.free_months_credit).toBe(5);
    expect(findSubByTeacher('referrer')!.free_months_credit).toBe(5);
  });

  it('referrer has no subscription row -> referee still rewarded, referrerCredited false', async () => {
    profilesByUser = { referee: { referred_by_teacher_id: 'referrer' } };
    subs = [{ id: 's-ref', teacher_id: 'referee', free_months_credit: 0, referral_rewarded_at: null }];

    const r = await grantReferralReward(grantClient(), 'referee');

    expect(r).toMatchObject({ granted: true, referrerCredited: false });
    expect(findSubByTeacher('referee')!.free_months_credit).toBe(1);
    expect(findSubByTeacher('referee')!.referral_rewarded_at).not.toBeNull();
  });
});
