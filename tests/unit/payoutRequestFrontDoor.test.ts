/**
 * The FRONT DOOR of payout System 1 — src/lib/collectionPayout/requestPayout.ts.
 *
 * These tests exist because the gap they cover was invisible to every other
 * test in the suite. `createPayoutRequest` was fully unit-tested and had ZERO
 * callers; the approve and release routes were fully unit-tested and worked a
 * queue that could never receive an entry. Each piece passed on its own. The
 * PIPELINE did not exist.
 *
 * So the emphasis here is twofold:
 *   1. NEGATIVE — with the config point holding placeholders and the ledger
 *      unmigrated, the front door refuses with a NAMED cause and never fakes a
 *      success. It never returns a payout id, and never a green path.
 *   2. STRUCTURAL — the front door is actually CONNECTED. The module-graph
 *      assertion at the bottom fails if a future refactor detaches the route
 *      from the engine again, which is the only way this class of defect gets
 *      caught before a human notices the queue is empty.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PAYOUT_SOURCES,
  REQUEST_RAIL,
  evaluatePayoutRequestEligibility,
  isPayoutSource,
  statusForRequestRefusal,
  submitPayoutRequest,
  validateAmountMinor,
} from '@/lib/collectionPayout/requestPayout';
import { ENV_KEYS, PLATFORM_CONFIG_KEYS, type EnvRecord } from '@/lib/collectionPayout/config';
import type { Principal } from '@/lib/collectionPayout/verificationGate';
import enMessages from '../../messages/en.json';
import arMessages from '../../messages/ar.json';

const REPO_ROOT = resolve(__dirname, '../..');

const PLACEHOLDER_ENV: EnvRecord = {
  [ENV_KEYS.railBaseUrl]: 'placeholder',
  [ENV_KEYS.railClientId]: 'placeholder',
  [ENV_KEYS.railClientSecret]: 'placeholder',
  [ENV_KEYS.railUsername]: 'placeholder',
  [ENV_KEYS.railPassword]: 'placeholder',
  [ENV_KEYS.railCallbackHmacSecret]: 'placeholder',
};

/** platform_config exactly as it is LIVE today (verified 2026-08-04). */
const LIVE_ROWS = [
  { key: PLATFORM_CONFIG_KEYS.collectionEnabled, value: false },
  {
    key: PLATFORM_CONFIG_KEYS.lessonCommission,
    value: { vat_pct: 0.14, teacher_pct: 0, customer_pct: 0, processing_flat: 0 },
  },
];

/** The config rows a FULLY configured deployment would carry. */
const CONFIGURED_ROWS = [
  { key: PLATFORM_CONFIG_KEYS.collectionEnabled, value: true },
  {
    key: PLATFORM_CONFIG_KEYS.lessonCommission,
    value: { vat_pct: 0.14, teacher_pct: 0.1, customer_pct: 0.015, processing_flat: 1.5 },
  },
  { key: PLATFORM_CONFIG_KEYS.delegateCapMinor, value: 1_000_000 },
  { key: PLATFORM_CONFIG_KEYS.delegateWindowCapMinor, value: 5_000_000 },
  { key: PLATFORM_CONFIG_KEYS.releasesHalted, value: false },
];

const REAL_ENV: EnvRecord = {
  [ENV_KEYS.railBaseUrl]: 'https://payouts.example.test/api/secure/',
  [ENV_KEYS.railClientId]: 'cid-live',
  [ENV_KEYS.railClientSecret]: 'csecret-live',
  [ENV_KEYS.railUsername]: 'user-live',
  [ENV_KEYS.railPassword]: 'pass-live',
  [ENV_KEYS.railCallbackHmacSecret]: 'hmac-live',
};

/**
 * Supabase stub. `configRows` decides the config point; every RPC 404s the way
 * an unapplied migration does, and `verification_records` reads do too.
 */
function fakeSupabase(opts: {
  configRows?: Array<{ key: string; value: unknown }>;
  /** `centers.instapay_number` for the destination read. */
  instapayNumber?: string | null;
} = {}) {
  const configRows = opts.configRows ?? LIVE_ROWS;
  return {
    from(table: string) {
      if (table === 'platform_config') {
        return { select: () => ({ in: () => Promise.resolve({ data: configRows, error: null }) }) };
      }
      if (table === 'centers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { instapay_number: opts.instapayNumber ?? null },
                  error: null,
                }),
            }),
          }),
        };
      }
      // verification_records / verification_attempts — absent from the schema.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: { code: '42P01', message: 'relation "verification_records" does not exist' },
                }),
            }),
            maybeSingle: () =>
              Promise.resolve({
                data: null,
                error: { code: '42P01', message: 'relation "verification_records" does not exist' },
              }),
          }),
        }),
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

function withEnv<T>(env: EnvRecord, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.values(ENV_KEYS)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.values(ENV_KEYS)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const OWNER: Principal = {
  kind: 'center',
  centerId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

// ── Input validation ────────────────────────────────────────────────────────

describe('the amount is piastres, whole, and above zero', () => {
  it('accepts a positive safe integer', () => {
    const r = validateAmountMinor(100_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amountMinor).toBe(100_000);
  });

  it.each([0, -1, -100_000, 10.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2])(
    'refuses %p with a named cause and no rounding',
    (bad) => {
      const r = validateAmountMinor(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.cause).toBe('payout_request_invalid');
        expect(r.messageKey).toBe('collectionPayout.request.amountInvalid');
      }
    },
  );

  it.each([null, undefined, '', 'abc', {}, []])('refuses the non-number %p', (bad) => {
    expect(validateAmountMinor(bad).ok).toBe(false);
  });
});

describe('the source is a closed allow-list', () => {
  it('accepts exactly the two System-1 balances', () => {
    expect([...PAYOUT_SOURCES]).toEqual(['referral_earnings', 'credit_balance']);
    for (const s of PAYOUT_SOURCES) expect(isPayoutSource(s)).toBe(true);
  });

  it.each(['tuition', 'TUITION_HELD', '', null, undefined, 1, {}])('refuses %p', (bad) => {
    expect(isPayoutSource(bad)).toBe(false);
  });

  it('does not accept a System-2 tuition source — §9 is out of scope', () => {
    expect(isPayoutSource('tuition_held')).toBe(false);
  });
});

describe('the rail is derived, never chosen by the requester', () => {
  it('is always the automated rail — attack A6', () => {
    expect(REQUEST_RAIL).toBe('paymob_payouts');
  });

  it('has no input path: PayoutRequestInput carries no rail field', () => {
    const src = readFileSync(
      resolve(REPO_ROOT, 'src/lib/collectionPayout/requestPayout.ts'),
      'utf8',
    );
    const iface = src.slice(
      src.indexOf('export interface PayoutRequestInput'),
      src.indexOf('export function validateAmountMinor'),
    );
    expect(iface).not.toMatch(/^\s*rail\b/m);
  });

  it('the route never reads a rail from the request body', () => {
    const route = readFileSync(
      resolve(REPO_ROOT, 'src/app/api/payouts/request/route.ts'),
      'utf8',
    );
    expect(route).not.toMatch(/body\.rail/);
  });
});

// ── The refusal path, which is the ONLY path today ──────────────────────────

describe('the front door refuses, with a named cause, and never fakes success', () => {
  it('refuses on the config point before reading verification or a destination', async () => {
    const r = await withEnv(PLACEHOLDER_ENV, () =>
      evaluatePayoutRequestEligibility(fakeSupabase(), OWNER, 100_000),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe('collection_payout_not_configured');
      expect(r.detail.configPoint).toBe('src/lib/collectionPayout/config.ts');
      expect(Array.isArray(r.detail.unsetKeys)).toBe(true);
      expect((r.detail.unsetKeys as string[]).length).toBeGreaterThan(0);
    }
  });

  it('submitPayoutRequest returns the same refusal and no payout id', async () => {
    const r = await withEnv(PLACEHOLDER_ENV, () =>
      submitPayoutRequest(fakeSupabase(), {
        principal: OWNER,
        amountMinor: 100_000,
        source: 'referral_earnings',
        stepUpVerified: true,
        idempotencyKey: 'front-door-test-key',
      }),
    );
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('payoutId');
  });

  it('a valid step-up does NOT rescue an unconfigured deployment', async () => {
    const r = await withEnv(PLACEHOLDER_ENV, () =>
      submitPayoutRequest(fakeSupabase(), {
        principal: OWNER,
        amountMinor: 1,
        source: 'credit_balance',
        stepUpVerified: true,
        idempotencyKey: 'front-door-test-key',
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('collection_payout_not_configured');
  });

  it('refuses a teacher principal — System 2 is out of scope (§9)', async () => {
    const r = await evaluatePayoutRequestEligibility(
      fakeSupabase(),
      { kind: 'teacher', centerId: null, userId: OWNER.userId },
      100_000,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('payout_request_invalid');
  });

  it('refuses a centre principal with no centerId rather than falling back to the userId', async () => {
    const r = await evaluatePayoutRequestEligibility(
      fakeSupabase(),
      { kind: 'center', centerId: null, userId: OWNER.userId },
      100_000,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('payout_request_invalid');
  });
});

describe('with the config point FILLED, verification is the next honest refusal', () => {
  it('refuses on verification, not on the balance and not on the ledger', async () => {
    const r = await withEnv(REAL_ENV, () =>
      evaluatePayoutRequestEligibility(
        fakeSupabase({ configRows: CONFIGURED_ROWS, instapayNumber: '+201000000000' }),
        OWNER,
        100_000,
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe('principal_not_verified');
      // The COARSE field must blame the DEPLOYMENT, not the owner. The Valify
      // credentials are absent and the identity tables are absent; which of the
      // two is reported depends on the order the guard evaluates them, and
      // either is a deployment fault. What must never happen is the coarse
      // `principal_not_verified`, which would tell an owner they failed an
      // identity check that no code path could have run.
      expect(r.detail.error).toBe('verification_unavailable');
      expect([
        'verification_state_not_in_schema',
        'verification_provider_not_configured',
      ]).toContain(r.detail.cause);
    }
  });
});

describe('an UNSOURCED balance never becomes "insufficient funds"', () => {
  it('does not blame the owner for an unapplied migration', async () => {
    // Config filled, so gate 1 passes; verification then refuses. The point of
    // this test is the ORDER: `insufficient_available` must not be reachable
    // while `getAvailableBalanceMinor` is returning an UNSOURCED zero.
    const r = await withEnv(REAL_ENV, () =>
      evaluatePayoutRequestEligibility(
        fakeSupabase({ configRows: CONFIGURED_ROWS, instapayNumber: '+201000000000' }),
        OWNER,
        999_999_999,
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).not.toBe('insufficient_available');
  });
});

describe('step-up auth is required, and is the LAST gate', () => {
  it('is not asked for while the deployment cannot honour the request', async () => {
    const r = await withEnv(PLACEHOLDER_ENV, () =>
      submitPayoutRequest(fakeSupabase(), {
        principal: OWNER,
        amountMinor: 100_000,
        source: 'referral_earnings',
        stepUpVerified: false,
        idempotencyKey: 'front-door-test-key',
      }),
    );
    expect(r.ok).toBe(false);
    // The honest answer first: a PIN prompt for an impossible action is the
    // fake-success failure in a politer voice.
    if (!r.ok) expect(r.cause).toBe('collection_payout_not_configured');
  });
});

// ── HTTP mapping ────────────────────────────────────────────────────────────

describe('refusals map to statuses that mean what they say', () => {
  it('never maps a refusal to 2xx', () => {
    const causes = [
      'not_owner',
      'payout_request_invalid',
      'collection_payout_not_configured',
      'principal_not_verified',
      'payout_destination_missing',
      'insufficient_available',
      'step_up_auth_required',
      'ledger_not_migrated',
      'engine_error',
    ] as const;
    for (const c of causes) {
      const s = statusForRequestRefusal(c);
      expect(s).toBeGreaterThanOrEqual(400);
    }
  });

  it('a system that is not ready is 409, not 500 — the request was fine', () => {
    expect(statusForRequestRefusal('collection_payout_not_configured')).toBe(409);
    expect(statusForRequestRefusal('ledger_not_migrated')).toBe(409);
    expect(statusForRequestRefusal('principal_not_verified')).toBe(409);
  });

  it('authorisation failures are 403 and malformed input is 400', () => {
    expect(statusForRequestRefusal('not_owner')).toBe(403);
    expect(statusForRequestRefusal('step_up_auth_required')).toBe(403);
    expect(statusForRequestRefusal('payout_request_invalid')).toBe(400);
  });
});

// ── Every messageKey this module emits exists in BOTH locales ───────────────

describe('every refusal is legible in both locales', () => {
  const KEYS = [
    'collectionPayout.request.ownerOnly',
    'collectionPayout.request.amountInvalid',
    'collectionPayout.request.sourceInvalid',
    'collectionPayout.request.principalInvalid',
    'collectionPayout.request.payoutDestinationMissing',
    'collectionPayout.request.insufficientAvailable',
    'collectionPayout.request.stepUpRequired',
    'collectionPayout.request.stepUpFailed',
    'collectionPayout.cause.collection_payout_not_configured',
    'collectionPayout.cause.ledger_not_migrated',
    'collectionPayout.payout.awaitingApproval',
  ];

  function lookup(messages: unknown, key: string): unknown {
    return key
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
        messages,
      );
  }

  it.each(KEYS)('%s resolves in en and ar', (key) => {
    expect(typeof lookup(enMessages, key)).toBe('string');
    expect(typeof lookup(arMessages, key)).toBe('string');
  });
});

// ── THE STRUCTURAL TEST. This is the one that would have caught the gap. ────

describe('the front door is actually CONNECTED to the engine', () => {
  const routePath = resolve(REPO_ROOT, 'src/app/api/payouts/request/route.ts');
  const route = readFileSync(routePath, 'utf8');
  const lib = readFileSync(resolve(REPO_ROOT, 'src/lib/collectionPayout/requestPayout.ts'), 'utf8');

  it('exports a POST handler', () => {
    expect(route).toMatch(/export async function POST\s*\(/);
  });

  it('reaches payout_request_create through the engine', () => {
    expect(lib).toMatch(/createPayoutRequest\s*\(/);
    const engine = readFileSync(
      resolve(REPO_ROOT, 'src/lib/collectionPayout/payoutEngine.ts'),
      'utf8',
    );
    expect(engine).toMatch(/rpc\(\s*'payout_request_create'/);
  });

  it('validates CSRF and derives center_id from the session, never from the body', () => {
    expect(route).toMatch(/validateCSRFRequest\(/);
    expect(route).toMatch(/requireCenterAuth\(/);
    expect(route).toMatch(/centerId:\s*auth\.centerId/);
    expect(route).not.toMatch(/body\.center_?[Ii]d/);
  });

  it('is owner-gated and does not fall back to the delegable staff permission', () => {
    expect(route).toMatch(/auth\.role\s*!==\s*'owner'/);
    expect(route).not.toMatch(/can_request_referral_payouts["']?\s*\]/);
  });

  it('is NOT under /api/admin — request and release authority stay disjoint (§7.1)', () => {
    expect(routePath).not.toMatch(/\/api\/admin\//);
  });

  it('passes an idempotency key that does not vary between two clicks', () => {
    // A key containing a timestamp or a random value would defeat the ONLY
    // deduplication in the whole path (§6: the provider offers none).
    expect(route).toMatch(/idempotencyKey/);
    const derived = route.slice(route.indexOf('const idempotencyKey'));
    expect(derived).not.toMatch(/Date\.now\(\)|randomUUID|Math\.random/);
  });
});
