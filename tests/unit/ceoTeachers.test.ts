/**
 * Read-only owner teacher-side visibility data layer.
 *
 * Covers the pure aggregation helpers plus the two Supabase-backed reads:
 *  - MRR counts only billable statuses (active/past_due) and excludes test teachers.
 *  - The combined dashboard total equals center MRR + teacher MRR.
 *  - getCeoTeacherData shapes each tab from the live column set, derives the
 *    referral graph, flags current vs private attachments, and sums credit buckets.
 *
 * Gating (requireSuperAdminApi) is exercised in admin-auth.test.ts; these tests
 * assume the gate has already passed and a service-role client is in hand.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTeacherMrr,
  summarizeTeacherSubs,
  isBillableTeacherStatus,
  teacherMonthlyGross,
  getCeoTeacherData,
  getTeacherDashboardCombined,
} from '@/lib/ceoTeachers';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Minimal chainable Supabase mock ──────────────────────────────────────────
// Supports .select() / .in() / .not() and resolves (thenable) to { data } keyed
// by table name. Filters are no-ops; the canned data is already scoped per test.
function mockSupabase(tables: Record<string, unknown[]>): SupabaseClient {
  const make = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      in: () => builder,
      not: () => builder,
      then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };
  return { from: (table: string) => make(table) } as unknown as SupabaseClient;
}

describe('teacherMonthlyGross', () => {
  it('prefers snapshotted price_gross when positive', () => {
    expect(teacherMonthlyGross('teacher_standard', 350)).toBe(350);
  });
  it('falls back to the tier default when price_gross is missing/zero', () => {
    expect(teacherMonthlyGross('teacher_standard', null)).toBe(499);
    expect(teacherMonthlyGross('teacher_pro', 0)).toBe(999);
    expect(teacherMonthlyGross('teacher_scale', 0)).toBe(2499);
  });
  it('returns 0 for an unknown tier with no price', () => {
    expect(teacherMonthlyGross('teacher_999', null)).toBe(0);
  });
});

describe('isBillableTeacherStatus', () => {
  it('counts active and past_due, not trial/suspended/cancelled', () => {
    expect(isBillableTeacherStatus('active')).toBe(true);
    expect(isBillableTeacherStatus('past_due')).toBe(true);
    expect(isBillableTeacherStatus('trialing')).toBe(false);
    expect(isBillableTeacherStatus('suspended')).toBe(false);
    expect(isBillableTeacherStatus('cancelled')).toBe(false);
    expect(isBillableTeacherStatus(null)).toBe(false);
  });
});

describe('computeTeacherMrr', () => {
  it('sums only billable subscriptions', () => {
    const mrr = computeTeacherMrr([
      { plan_key: 'teacher_pro', status: 'active', price_gross: 999 },
      { plan_key: 'teacher_standard', status: 'trialing', price_gross: 499 },
      { plan_key: 'teacher_standard', status: 'past_due', price_gross: 499 },
      { plan_key: 'teacher_standard', status: 'cancelled', price_gross: 499 },
    ]);
    expect(mrr).toBe(999 + 499);
  });
  it('is zero for an empty set', () => {
    expect(computeTeacherMrr([])).toBe(0);
  });
});

describe('summarizeTeacherSubs', () => {
  it('breaks down counts by status', () => {
    const s = summarizeTeacherSubs([
      { status: 'active' },
      { status: 'active' },
      { status: 'trialing' },
      { status: 'past_due' },
      { status: 'cancelled' },
      { status: null },
    ]);
    expect(s).toEqual({
      total: 6,
      trialing: 1,
      active: 2,
      past_due: 1,
      suspended: 0,
      cancelled: 1,
    });
  });
});

// ── Shared fixture ───────────────────────────────────────────────────────────
function fixture() {
  return {
    teacher_profiles: [
      {
        user_id: 't1',
        display_name: 'Ahmed',
        referral_code: 'AHMED7X',
        is_test: false,
        subject: 'Math',
        plan_key: 'teacher_pro',
        created_at: '2026-01-01T00:00:00Z',
        blast_credits_subscription: 100,
        blast_credits_purchased: 50,
        referred_by_teacher_id: null,
      },
      {
        user_id: 't2',
        display_name: 'Sara',
        referral_code: 'SARA22',
        is_test: false,
        subject: 'Physics',
        plan_key: 'teacher_standard',
        created_at: '2026-02-01T00:00:00Z',
        blast_credits_subscription: 0,
        blast_credits_purchased: 0,
        referred_by_teacher_id: 't1',
      },
      {
        user_id: 't3',
        display_name: 'TestTeacher',
        referral_code: 'TEST1',
        is_test: true,
        subject: null,
        plan_key: 'teacher_standard',
        created_at: '2026-03-01T00:00:00Z',
        blast_credits_subscription: 0,
        blast_credits_purchased: 0,
        referred_by_teacher_id: null,
      },
    ],
    teacher_subscriptions: [
      {
        teacher_id: 't1',
        plan_key: 'teacher_pro',
        status: 'active',
        trial_ends_at: '2026-01-15T00:00:00Z',
        current_period_end: '2026-07-01T00:00:00Z',
        next_billing_at: '2026-07-01T00:00:00Z',
        free_months_credit: 1,
        price_gross: 999,
        referral_rewarded_at: '2026-06-01T00:00:00Z',
      },
      {
        teacher_id: 't2',
        plan_key: 'teacher_standard',
        status: 'trialing',
        trial_ends_at: '2026-06-20T00:00:00Z',
        current_period_end: '2026-06-20T00:00:00Z',
        next_billing_at: '2026-06-20T00:00:00Z',
        free_months_credit: 0,
        price_gross: 499,
        referral_rewarded_at: null,
      },
      {
        teacher_id: 't3',
        plan_key: 'teacher_standard',
        status: 'active',
        trial_ends_at: null,
        current_period_end: '2026-07-01T00:00:00Z',
        next_billing_at: '2026-07-01T00:00:00Z',
        free_months_credit: 0,
        price_gross: 499,
        referral_rewarded_at: null,
      },
    ],
    student_groups: [
      {
        id: 'g1',
        name: 'Center Group',
        teacher_id: 't1',
        center_id: 'c1',
        kind: 'center',
        center_cut_egp: 20,
        fee_per_class: 100,
        subject: 'Math',
        status: 'active',
      },
      {
        id: 'g2',
        name: 'Private Group',
        teacher_id: 't1',
        center_id: null,
        kind: 'private',
        center_cut_egp: 0,
        fee_per_class: 150,
        subject: 'Math',
        status: 'active',
      },
    ],
    users: [
      { id: 't1', phone: '+201000000001', name: 'Ahmed U' },
      { id: 't2', phone: '+201000000002', name: 'Sara U' },
      { id: 't3', phone: '+201000000003', name: 'Test U' },
    ],
    centers: [{ id: 'c1', name: 'Center One' }],
  };
}

describe('getCeoTeacherData', () => {
  it('shapes all five tabs and excludes test teachers from MRR', async () => {
    const data = await getCeoTeacherData(mockSupabase(fixture()));

    // MRR: only billable, non-test → t1 active (999). t2 trialing, t3 test.
    expect(data.teacher_mrr).toBe(999);

    // Summary across ALL subs (incl. test): active=2 (t1,t3), trialing=1 (t2).
    expect(data.subscriptions_summary).toEqual({
      total: 3,
      trialing: 1,
      active: 2,
      past_due: 0,
      suspended: 0,
      cancelled: 0,
    });

    // Subscriptions tab carries identity + test flag.
    expect(data.subscriptions).toHaveLength(3);
    const t1Sub = data.subscriptions.find((s) => s.teacher_id === 't1');
    expect(t1Sub?.display_name).toBe('Ahmed');
    expect(t1Sub?.referral_code).toBe('AHMED7X');
    expect(t1Sub?.phone).toBe('+201000000001');
    expect(t1Sub?.is_test).toBe(false);

    // Referral graph: t2 referred by t1; not yet converted (referee sub not rewarded).
    expect(data.referrals).toHaveLength(1);
    const ref = data.referrals[0];
    expect(ref.referee_id).toBe('t2');
    expect(ref.referrer_id).toBe('t1');
    expect(ref.referrer_name).toBe('Ahmed');
    expect(ref.referrer_code).toBe('AHMED7X');
    expect(ref.converted).toBe(false);

    // Teachers tab: all three, joined to subscription status.
    expect(data.teachers).toHaveLength(3);
    expect(data.teachers.find((x) => x.teacher_id === 't1')?.status).toBe('active');

    // Attachments: g1 is a current center attachment with its cut; g2 is private.
    expect(data.attachments).toHaveLength(2);
    const g1 = data.attachments.find((a) => a.group_id === 'g1');
    expect(g1?.current).toBe(true);
    expect(g1?.center_name).toBe('Center One');
    expect(g1?.center_cut_egp).toBe(20);
    const g2 = data.attachments.find((a) => a.group_id === 'g2');
    expect(g2?.current).toBe(false);

    // Credits: both buckets summed; highest total first.
    expect(data.credits[0].teacher_id).toBe('t1');
    expect(data.credits[0].subscription_credits).toBe(100);
    expect(data.credits[0].purchased_credits).toBe(50);
    expect(data.credits[0].total_credits).toBe(150);
  });

  it('returns honest empty structures when there is no teacher data', async () => {
    const data = await getCeoTeacherData(
      mockSupabase({
        teacher_profiles: [],
        teacher_subscriptions: [],
        student_groups: [],
        users: [],
        centers: [],
      }),
    );
    expect(data.subscriptions).toEqual([]);
    expect(data.referrals).toEqual([]);
    expect(data.teachers).toEqual([]);
    expect(data.attachments).toEqual([]);
    expect(data.credits).toEqual([]);
    expect(data.teacher_mrr).toBe(0);
    expect(data.subscriptions_summary.total).toBe(0);
  });
});

describe('getTeacherDashboardCombined', () => {
  it('combined total = center MRR + teacher MRR, excluding test teachers', async () => {
    const combined = await getTeacherDashboardCombined(mockSupabase(fixture()), 1000);
    // Teacher MRR: t1 active (999). t2 trial, t3 test → excluded.
    expect(combined.teacher_mrr).toBe(999);
    expect(combined.center_mrr).toBe(1000);
    expect(combined.combined_mrr).toBe(1999);
    expect(combined.teacher_active_subs).toBe(1); // t1 only (t3 is test)
    expect(combined.teacher_trials).toBe(1); // t2
    expect(combined.total_teachers).toBe(2); // t1, t2 (t3 is test)
  });

  it('handles a zero center MRR and no teachers', async () => {
    const combined = await getTeacherDashboardCombined(
      mockSupabase({ teacher_subscriptions: [], teacher_profiles: [] }),
      0,
    );
    expect(combined.combined_mrr).toBe(0);
    expect(combined.total_teachers).toBe(0);
  });
});
