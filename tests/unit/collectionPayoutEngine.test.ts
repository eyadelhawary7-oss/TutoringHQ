/**
 * The engine's refusal paths, the verification gate, the caps, the ageing, and
 * the B1 money math.
 *
 * Again the emphasis is negative: with the config point holding placeholders
 * and the ledger unmigrated, every entry point must refuse with a named cause
 * and NO surface may claim success.
 */

import { describe, it, expect } from 'vitest';
import {
  approvePayout,
  createPayoutRequest,
  getAvailableBalanceMinor,
  isNotMigrated,
  precheckCaps,
  releasePayout,
} from '@/lib/collectionPayout/payoutEngine';
import { ENV_KEYS, PLATFORM_CONFIG_KEYS, type EnvRecord } from '@/lib/collectionPayout/config';
import {
  resolvePrincipalVerification,
  isVerified,
  verificationRefusalBody,
} from '@/lib/collectionPayout/verificationGate';
import { evaluateCaps, resolveApproverTier, rollingWindowStart } from '@/lib/collectionPayout/payoutCaps';
import {
  AWAITING_APPROVAL_STATES,
  OPEN_PAYOUT_STATES,
  PAYOUT_STATES,
  TERMINAL_PAYOUT_STATES,
  checkTransition,
  isOpen,
  isTerminal,
} from '@/lib/collectionPayout/payoutStates';
import { bandForAge, cairoAgeInDays, describeWaiting } from '@/lib/collectionPayout/payoutAging';
import {
  computeCollectionSplitMinor,
  parentFacingQuote,
  providerFacingQuote,
  unsourcedSplit,
} from '@/lib/collectionPayout/collectionMath';
import { egpToMinor, minorToEgp, sumMinor, vatInsideMinor } from '@/lib/collectionPayout/money';

const PLACEHOLDER_ENV: EnvRecord = {
  [ENV_KEYS.railBaseUrl]: 'placeholder',
  [ENV_KEYS.railClientId]: 'placeholder',
  [ENV_KEYS.railClientSecret]: 'placeholder',
  [ENV_KEYS.railUsername]: 'placeholder',
  [ENV_KEYS.railPassword]: 'placeholder',
  [ENV_KEYS.railCallbackHmacSecret]: 'placeholder',
};

/** platform_config as it is LIVE today (verified 2026-08-04). */
const LIVE_ROWS = [
  { key: PLATFORM_CONFIG_KEYS.collectionEnabled, value: false },
  {
    key: PLATFORM_CONFIG_KEYS.lessonCommission,
    value: { vat_pct: 0.14, teacher_pct: 0, customer_pct: 0, processing_flat: 0 },
  },
];

/** Supabase stub: platform_config reads succeed, every RPC 404s like an unapplied migration. */
function unmigratedSupabase() {
  return {
    from() {
      return {
        select() {
          return { in: () => Promise.resolve({ data: LIVE_ROWS, error: null }) };
        },
      };
    },
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
      });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Some tests need process.env to hold placeholders; the engine reads
// process.env directly through loadCollectionPayoutConfig's default.
function withPlaceholderEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [, k] of Object.entries(ENV_KEYS)) {
    saved[k] = process.env[k];
    process.env[k] = PLACEHOLDER_ENV[k];
  }
  try {
    return fn();
  } finally {
    for (const [, k] of Object.entries(ENV_KEYS)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('isNotMigrated — the proposal-not-applied signal', () => {
  it('recognises every code Postgres and PostgREST use for a missing object', () => {
    for (const code of ['42883', '42P01', 'PGRST202', 'PGRST205']) {
      expect(isNotMigrated({ code, message: '' })).toBe(true);
    }
    expect(isNotMigrated({ message: 'relation "center_payouts" does not exist' })).toBe(true);
    expect(isNotMigrated({ message: 'Could not find the function public.payout_approve' })).toBe(true);
  });

  it('does not misread an ordinary failure as "not migrated"', () => {
    expect(isNotMigrated({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isNotMigrated(null)).toBe(false);
  });
});

describe('the engine refuses, with a named cause, and never fakes success', () => {
  it('createPayoutRequest refuses on the config point before touching the database', async () => {
    const result = await withPlaceholderEnv(() =>
      createPayoutRequest(unmigratedSupabase(), {
        centerId: '00000000-0000-0000-0000-0000000000aa',
        requestedGrossMinor: 100_000,
        source: 'referral_earnings',
        rail: 'manual_instapay',
        requestedByUserId: '00000000-0000-0000-0000-0000000000bb',
        idempotencyKey: 'test-create-1',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.cause).toBe('collection_payout_not_configured');
    expect(result.messageKey).toBe('collectionPayout.cause.collection_payout_not_configured');
    expect(result.detail.configPoint).toBe('src/lib/collectionPayout/config.ts');
    expect(result).not.toHaveProperty('payoutId');
  });

  it('approvePayout refuses on the config point, even for a CEO with step-up done', async () => {
    const result = await withPlaceholderEnv(() =>
      approvePayout(unmigratedSupabase(), {
        payoutId: '00000000-0000-0000-0000-0000000000cc',
        approver: {
          adminUserId: '00000000-0000-0000-0000-0000000000dd',
          adminRole: 'super_admin',
          permissionKeys: [],
          envPhoneSuperAdmin: false,
        },
        stepUpVerified: true,
        isResend: false,
        idempotencyKey: 'test-approve-1',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.cause).toBe('collection_payout_not_configured');
  });

  it('releasePayout refuses and says released:false — it never marks anything paid', async () => {
    const result = await withPlaceholderEnv(() =>
      releasePayout(unmigratedSupabase(), {
        payoutId: '00000000-0000-0000-0000-0000000000cc',
        releasedByAdminUserId: '00000000-0000-0000-0000-0000000000dd',
        idempotencyKey: 'test-release-1',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.cause).toBe('rail_cannot_release');
    expect(String(result.detail.note)).toContain('rather than marking the payout paid');
  });

  it('the available balance reads ZERO and says the zero means UNKNOWN', async () => {
    const b = await getAvailableBalanceMinor(
      unmigratedSupabase(),
      '00000000-0000-0000-0000-0000000000aa',
    );
    expect(b.availableMinor).toBe(0);
    // The crucial assertion: a fabricated balance is the failure this prevents.
    expect(b.sourced).toBe(false);
    expect(b.reasonKey).toBe('collectionPayout.balance.notSourced');
    expect(b.reasonDetail).toContain('unknown, not because it is empty');
  });
});

describe('the verification gate', () => {
  const principal = {
    kind: 'center' as const,
    centerId: '00000000-0000-0000-0000-0000000000aa',
    userId: '00000000-0000-0000-0000-0000000000bb',
  };

  it('refuses because the state has NO LIVE SOURCE, and names that specifically', async () => {
    const r = await resolvePrincipalVerification(unmigratedSupabase(), principal);
    expect(r.verified).toBe(false);
    expect(isVerified(r)).toBe(false);
    if (r.verified) throw new Error('unreachable');
    expect(r.cause).toBe('verification_state_not_in_schema');
    expect(r.messageKey).toBe('collectionPayout.verification.stateNotInSchema');
    // Blocked on an ENGINEERING action, not a user action. Telling a centre
    // owner to "try again" when no code path can ever succeed is fake success
    // in a politer voice.
    expect(r.blockedOn).toContain('Territory A');
  });

  it('the refusal body is legible and carries no personal data', async () => {
    const r = await resolvePrincipalVerification(unmigratedSupabase(), principal);
    if (r.verified) throw new Error('unreachable');
    const body = verificationRefusalBody(r);
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/national|nid|\d{14}/i);
  });
});

describe('approver resolution — the disjoint-domain and S10 rules', () => {
  it('refuses env-phone-only authority with its OWN cause, not a generic 403', () => {
    const r = resolveApproverTier({
      adminUserId: null,
      adminRole: null,
      permissionKeys: [],
      envPhoneSuperAdmin: true,
    });
    expect(r.tier).toBe('none');
    if (r.tier !== 'none') throw new Error('unreachable');
    expect(r.cause).toBe('env_phone_authority_refused');
  });

  it('refuses a caller with no admin_users row at all', () => {
    const r = resolveApproverTier({
      adminUserId: null,
      adminRole: null,
      permissionKeys: [],
      envPhoneSuperAdmin: false,
    });
    expect(r.tier).toBe('none');
    if (r.tier !== 'none') throw new Error('unreachable');
    expect(r.cause).toBe('no_admin_user_row');
  });

  it('a super_admin DB row is the CEO tier, with authority source db_row', () => {
    const r = resolveApproverTier({
      adminUserId: 'a1',
      adminRole: 'super_admin',
      permissionKeys: [],
      envPhoneSuperAdmin: false,
    });
    expect(r.tier).toBe('ceo');
    if (r.tier === 'none') throw new Error('unreachable');
    expect(r.authoritySource).toBe('db_row');
  });

  it('can_approve_payouts on a non-super_admin is the delegate tier', () => {
    const r = resolveApproverTier({
      adminUserId: 'a2',
      adminRole: 'accountant',
      permissionKeys: ['can_approve_payouts'],
      envPhoneSuperAdmin: false,
    });
    expect(r.tier).toBe('delegate');
  });

  it('can_request_referral_payouts does NOT confer release authority', () => {
    // Decision 1 keeps request and release apart. Collapsing them reintroduces
    // self-approval by the payee.
    const r = resolveApproverTier({
      adminUserId: 'a3',
      adminRole: 'accountant',
      permissionKeys: ['can_request_referral_payouts'],
      envPhoneSuperAdmin: false,
    });
    expect(r.tier).toBe('none');
  });
});

describe('the caps — §7.2, each assertion is a documented evasion', () => {
  const CAP = 1_000_000; // 10,000 EGP in piastres
  const base = {
    perPayoutCapMinor: CAP,
    windowCapMinor: CAP,
    windowApprovedMinor: 0,
    isResend: false,
  };

  it('the CEO approves any amount and is always final', () => {
    const d = evaluateCaps({ ...base, tier: 'ceo', requestedGrossMinor: 50_000_000 });
    expect(d.permitted).toBe(true);
  });

  it('a delegate is blocked AT the cap, not merely above it', () => {
    const d = evaluateCaps({ ...base, tier: 'delegate', requestedGrossMinor: CAP });
    expect(d.permitted).toBe(false);
    if (d.permitted) throw new Error('unreachable');
    expect(d.cause).toBe('over_per_payout_cap');
    expect(d.escalation).toBe('ceo_only');
  });

  it('a delegate may approve just under the cap', () => {
    const d = evaluateCaps({ ...base, tier: 'delegate', requestedGrossMinor: CAP - 1 });
    expect(d.permitted).toBe(true);
  });

  it('the rolling window INCLUDES the payout being approved — the off-by-one permits 19,999', () => {
    // 9,999.99 already approved this week; another 9,999.99 would total 19,999.98.
    const d = evaluateCaps({
      ...base,
      tier: 'delegate',
      requestedGrossMinor: 999_999,
      windowApprovedMinor: 999_999,
    });
    expect(d.permitted).toBe(false);
    if (d.permitted) throw new Error('unreachable');
    expect(d.cause).toBe('over_rolling_window_cap');
  });

  it('the 9,999 × 3 sequential-splitting attack is blocked on the SECOND approval', () => {
    // 30,000 owed. First 9,999 passes.
    const first = evaluateCaps({ ...base, tier: 'delegate', requestedGrossMinor: 999_900 });
    expect(first.permitted).toBe(true);
    // Second, inside the same 7-day window, would total 19,998 > 10,000.
    const second = evaluateCaps({
      ...base,
      tier: 'delegate',
      requestedGrossMinor: 999_900,
      windowApprovedMinor: 999_900,
    });
    expect(second.permitted).toBe(false);
  });

  it('a resend is CEO-only at any amount, even far below the cap', () => {
    const d = evaluateCaps({
      ...base,
      tier: 'delegate',
      requestedGrossMinor: 100,
      isResend: true,
    });
    expect(d.permitted).toBe(false);
    if (d.permitted) throw new Error('unreachable');
    expect(d.cause).toBe('resend_requires_ceo');
  });

  it('a non-approver is refused before any arithmetic runs', () => {
    const d = evaluateCaps({ ...base, tier: 'none', requestedGrossMinor: 1 });
    expect(d.permitted).toBe(false);
    if (d.permitted) throw new Error('unreachable');
    expect(d.cause).toBe('not_an_approver');
  });

  it('the compared amount is the REQUESTED GROSS, recorded on every decision', () => {
    const d = evaluateCaps({ ...base, tier: 'ceo', requestedGrossMinor: 1_054_631 });
    // 10,546.31 EGP — the exact figure §7.2 says the permissive net_minor
    // reading would have let through a 10,000 cap.
    expect(d.amountComparedMinor).toBe(1_054_631);
  });

  it('the rolling window is 7 days back from NOW, not a calendar week', () => {
    const now = new Date('2026-08-04T12:00:00Z');
    expect(rollingWindowStart(now).toISOString()).toBe('2026-07-28T12:00:00.000Z');
  });

  it('precheckCaps routes an env-phone super-admin to the not_an_approver refusal', () => {
    const d = precheckCaps({
      approver: {
        adminUserId: null,
        adminRole: null,
        permissionKeys: [],
        envPhoneSuperAdmin: true,
      },
      requestedGrossMinor: 1000,
      perPayoutCapMinor: CAP,
      windowCapMinor: CAP,
      windowApprovedMinor: 0,
      isResend: false,
    });
    expect(d.permitted).toBe(false);
  });
});

describe('payout states', () => {
  it('terminal is enumerated so an added state defaults to BLOCKING', () => {
    expect([...TERMINAL_PAYOUT_STATES].sort()).toEqual(['failed', 'returned', 'settled']);
    for (const s of PAYOUT_STATES) {
      expect(isOpen(s)).toBe(!isTerminal(s));
    }
  });

  it('settled_pending_bank is OPEN — omitting it frees the slot while funds fly', () => {
    expect(OPEN_PAYOUT_STATES).toContain('settled_pending_bank');
    expect(isTerminal('settled_pending_bank')).toBe(false);
  });

  it('indeterminate is open and never terminal', () => {
    expect(isTerminal('indeterminate')).toBe(false);
  });

  it('an idempotent re-call of the same state is allowed, not an error', () => {
    expect(checkTransition('approved', 'approved').allowed).toBe(true);
  });

  it('indeterminate cannot jump straight back onto the wire', () => {
    const t = checkTransition('indeterminate', 'submitting');
    expect(t.allowed).toBe(false);
  });

  it('a settled payout cannot be re-approved or re-submitted', () => {
    expect(checkTransition('settled', 'approved').allowed).toBe(false);
    expect(checkTransition('settled', 'submitting').allowed).toBe(false);
  });

  it('failed and returned are dead ends', () => {
    for (const to of PAYOUT_STATES) {
      if (to === 'failed') continue;
      expect(checkTransition('failed', to).allowed).toBe(false);
    }
  });

  it('only "requested" is the awaiting-a-human state', () => {
    expect([...AWAITING_APPROVAL_STATES]).toEqual(['requested']);
  });
});

describe('ageing — visible, and with no expiry, ever', () => {
  const now = new Date('2026-08-04T09:00:00Z');

  it('counts whole Cairo days and never goes negative', () => {
    expect(cairoAgeInDays(new Date('2026-08-04T08:00:00Z'), now)).toBe(0);
    expect(cairoAgeInDays(new Date('2026-08-01T08:00:00Z'), now)).toBe(3);
    expect(cairoAgeInDays(new Date('2026-09-01T08:00:00Z'), now)).toBe(0);
  });

  it('bands escalate but change no behaviour', () => {
    expect(bandForAge(0)).toBe('fresh');
    expect(bandForAge(3)).toBe('ageing');
    expect(bandForAge(7)).toBe('stale');
    expect(bandForAge(21)).toBe('long_wait');
    expect(bandForAge(400)).toBe('long_wait');
  });

  it('a long-waiting request still says NEVER EXPIRES and NO FALLBACK APPROVER', () => {
    const w = describeWaiting(new Date('2026-01-01T00:00:00Z'), now);
    expect(w.ageDays).toBeGreaterThan(200);
    expect(w.band).toBe('long_wait');
    expect(w.neverExpires).toBe(true);
    expect(w.statusKey).toBe('collectionPayout.payout.awaitingApproval');
    expect(w.noFallbackApproverKey).toBe('collectionPayout.payout.noFallbackApprover');
  });

  it('promises no ETA — the shape carries no date-in-the-future field', () => {
    const w = describeWaiting(new Date('2026-08-01T00:00:00Z'), now);
    expect(Object.keys(w).sort()).toEqual(
      [
        'ageDays',
        'band',
        'neverExpires',
        'noFallbackApproverKey',
        'requestedCairoDate',
        'statusKey',
      ].sort(),
    );
  });

  it('handles an unparseable timestamp without inventing an age', () => {
    const w = describeWaiting('not-a-date', now);
    expect(w.ageDays).toBe(0);
  });
});

describe('money — piastres, integers, and no silent zeros', () => {
  it('throws rather than coercing a non-finite EGP amount to zero', () => {
    expect(() => egpToMinor(NaN)).toThrow(/finite/i);
    expect(() => egpToMinor(Infinity)).toThrow();
  });

  it('round-trips the awkward decimals the B1 example produces', () => {
    expect(egpToMinor(168.75)).toBe(16_875);
    expect(egpToMinor(4.03)).toBe(403);
    expect(egpToMinor(172.78)).toBe(17_278);
    expect(minorToEgp(17_278)).toBe(172.78);
  });

  it('sums exactly, with no float drift', () => {
    expect(sumMinor([403, 403, 403])).toBe(1209);
    expect(sumMinor([])).toBe(0);
  });

  it('VAT is the slice INSIDE an inclusive amount, and base + vat is exact', () => {
    const inclusive = 11_400; // 114.00 EGP
    const vat = vatInsideMinor(inclusive, 0.14);
    expect(vat).toBe(1400);
    expect(inclusive - vat).toBe(10_000);
  });

  it('rejects a nonsense VAT rate rather than returning zero VAT', () => {
    expect(() => vatInsideMinor(10_000, 0)).toThrow();
    expect(() => vatInsideMinor(10_000, 1.4)).toThrow();
  });
});

describe('B1 collection math — the locked rate card', () => {
  const rateCard = {
    collectionFeeRate: 0.1,
    markupRate: 0.075,
    markupFlatEgp: 7.5,
    parentFeeRate: 0.015,
    parentFeeFlatEgp: 1.5,
    vatRate: 0.14,
  };

  it('reproduces the design worked example exactly (X = 150)', () => {
    const s = computeCollectionSplitMinor(egpToMinor(150), rateCard);
    expect(minorToEgp(s.providerKeepsMinor)).toBe(135);
    expect(minorToEgp(s.providerPriceMinor)).toBe(168.75);
    expect(minorToEgp(s.parentProcessingFeeMinor)).toBe(4.03);
    expect(minorToEgp(s.parentPaysMinor)).toBe(172.78);
    expect(minorToEgp(s.collectionFeeMinor)).toBe(15);
  });

  it('the provider quote NEVER carries the parent total — B1 calls that a bug', () => {
    const s = computeCollectionSplitMinor(egpToMinor(150), rateCard);
    const q = providerFacingQuote(s);
    expect(q).not.toHaveProperty('parentPaysMinor');
    expect(q).not.toHaveProperty('parentProcessingFeeMinor');
    expect(q.providerPriceMinor).toBe(16_875);
  });

  it('the parent quote NEVER carries the collection fee or the markup', () => {
    const s = computeCollectionSplitMinor(egpToMinor(150), rateCard);
    const q = parentFacingQuote(s);
    expect(q).not.toHaveProperty('collectionFeeMinor');
    expect(q).not.toHaveProperty('markupMinor');
    expect(q).not.toHaveProperty('providerFeeMinor');
  });

  it('the parent fee is NOT the flat 20 EGP centre processing fee', () => {
    // The naming collision that fails silently: 20.00 vs 4.03 on the same
    // charge, no type error, just a parent billed the wrong amount.
    const s = computeCollectionSplitMinor(egpToMinor(150), rateCard);
    expect(s.parentProcessingFeeMinor).not.toBe(egpToMinor(20));
  });

  it('refuses a zero or negative provider fee rather than quoting a zero split', () => {
    expect(() => computeCollectionSplitMinor(0, rateCard)).toThrow(/positive/);
    expect(() => computeCollectionSplitMinor(-1, rateCard)).toThrow();
  });

  it('an unsourced split is all zeros AND says so', () => {
    const u = unsourcedSplit('collectionPayout.cause.rate_card_unset');
    expect(u.sourced).toBe(false);
    expect(u.reasonKey).toBe('collectionPayout.cause.rate_card_unset');
    expect(Object.values(u.split).every((v) => v === 0)).toBe(true);
  });
});
