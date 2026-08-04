/**
 * THE FAILURE PATH IS THE POINT OF THIS FILE.
 *
 * Eyad, 4 August 2026: "Build the complete flow against ONE clearly named
 * config point with placeholder values, failing visibly." and "Fail visibly,
 * never fake success."
 *
 * So the assertions here are mostly negative: with the config point unset or
 * holding a placeholder, NOTHING may report `configured: true`, every refusal
 * must carry a NAMED cause, and no surface may claim success. A green
 * checkmark backed by no integration is the worst possible outcome of this
 * work, and these tests exist to make that outcome fail CI.
 */

import { describe, it, expect } from 'vitest';
import {
  COLLECTION_PAYOUT_CONFIG_POINT,
  ENV_KEYS,
  PLATFORM_CONFIG_KEYS,
  isPlaceholderValue,
  loadCollectionPayoutConfig,
  parseCapMinor,
  parseRateCard,
  readCallbackHmacSecret,
  readRailEnv,
  refusalBody,
  type ConfigCause,
  type EnvRecord,
} from '@/lib/collectionPayout/config';

// ── A minimal stand-in for the platform_config read. ────────────────────────
function fakeSupabase(rows: { key: string; value: unknown }[] | { error: string }) {
  return {
    from() {
      return {
        select() {
          return {
            in() {
              if ('error' in rows) {
                return Promise.resolve({ data: null, error: { message: rows.error } });
              }
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** The env exactly as .env.example ships it: every key a placeholder. */
const PLACEHOLDER_ENV: EnvRecord = {
  [ENV_KEYS.railBaseUrl]: 'placeholder',
  [ENV_KEYS.railClientId]: 'placeholder',
  [ENV_KEYS.railClientSecret]: 'placeholder',
  [ENV_KEYS.railUsername]: 'placeholder',
  [ENV_KEYS.railPassword]: 'placeholder',
  [ENV_KEYS.railCallbackHmacSecret]: 'placeholder',
};

/** A fully-filled env, for the contrast cases. */
const FILLED_ENV: EnvRecord = {
  [ENV_KEYS.railBaseUrl]: 'https://payouts.paymobsolutions.com/api/secure/',
  [ENV_KEYS.railClientId]: 'cid-real-value',
  [ENV_KEYS.railClientSecret]: 'csecret-real-value',
  [ENV_KEYS.railUsername]: 'chq-payouts',
  [ENV_KEYS.railPassword]: 's3cret-real-value',
  [ENV_KEYS.railCallbackHmacSecret]: 'hmac-real-value',
};

/** platform_config exactly as it is LIVE today (verified 2026-08-04). */
const LIVE_PLATFORM_CONFIG = [
  { key: PLATFORM_CONFIG_KEYS.collectionEnabled, value: false },
  {
    key: PLATFORM_CONFIG_KEYS.lessonCommission,
    value: { vat_pct: 0.14, teacher_pct: 0, customer_pct: 0, processing_flat: 0 },
  },
  // payout_delegate_cap_minor, payout_delegate_window_cap_minor and
  // payout_releases_halted have NO ROW live. Their absence is the point.
];

/** A hypothetical fully-configured platform_config. */
const READY_PLATFORM_CONFIG = [
  { key: PLATFORM_CONFIG_KEYS.collectionEnabled, value: true },
  {
    key: PLATFORM_CONFIG_KEYS.lessonCommission,
    value: { vat_pct: 0.14, teacher_pct: 0.1, customer_pct: 0.015, processing_flat: 1.5 },
  },
  { key: PLATFORM_CONFIG_KEYS.delegateCapMinor, value: 1_000_000 },
  { key: PLATFORM_CONFIG_KEYS.delegateWindowCapMinor, value: 1_000_000 },
  { key: PLATFORM_CONFIG_KEYS.releasesHalted, value: false },
];

describe('placeholder detection', () => {
  it('treats every shape .env.example actually uses as unconfigured', () => {
    for (const v of [
      undefined,
      null,
      '',
      '   ',
      'placeholder',
      'PLACEHOLDER',
      'PLACEHOLDER_NOT_CONFIGURED',
      'your-key-here',
      'changeme',
      'TODO',
      'tbd',
      'not-configured',
      'replace_me',
      'https://example.com',
    ]) {
      expect(isPlaceholderValue(v as string | undefined)).toBe(true);
    }
  });

  it('does not swallow a real credential that merely looks odd', () => {
    for (const v of ['x', 'sk_live_9', 'https://payouts.paymobsolutions.com/api/secure/']) {
      expect(isPlaceholderValue(v)).toBe(false);
    }
  });
});

describe('readRailEnv — the env half of the config point', () => {
  it('reports every placeholder key by name, so the refusal is actionable', () => {
    const r = readRailEnv(PLACEHOLDER_ENV);
    expect(r.present).toBe(false);
    // The HMAC key is checked separately (readCallbackHmacSecret), so the five
    // disbursement credentials are what `missing` covers.
    expect(r.missing).toEqual([
      ENV_KEYS.railBaseUrl,
      ENV_KEYS.railClientId,
      ENV_KEYS.railClientSecret,
      ENV_KEYS.railUsername,
      ENV_KEYS.railPassword,
    ]);
  });

  it('is not satisfied by a PARTIALLY filled config', () => {
    const partial = { ...FILLED_ENV, [ENV_KEYS.railPassword]: 'placeholder' };
    const r = readRailEnv(partial);
    expect(r.present).toBe(false);
    expect(r.missing).toEqual([ENV_KEYS.railPassword]);
  });

  it('an entirely EMPTY env is unconfigured, not defaulted', () => {
    const r = readRailEnv({});
    expect(r.present).toBe(false);
    expect(r.missing).toHaveLength(5);
  });
});

describe('readCallbackHmacSecret — attack A1 defence', () => {
  it('refuses a placeholder secret, so every callback is rejected', () => {
    expect(readCallbackHmacSecret(PLACEHOLDER_ENV).present).toBe(false);
    expect(readCallbackHmacSecret({}).present).toBe(false);
  });

  it('only returns a secret when one is genuinely set', () => {
    const r = readCallbackHmacSecret(FILLED_ENV);
    expect(r.present).toBe(true);
    if (r.present) expect(r.secret).toBe('hmac-real-value');
  });
});

describe('parseRateCard — a zeroed rate card is UNCONFIGURED, not free', () => {
  it('rejects the live all-zero lesson_commission row', () => {
    // Verified live 2026-08-04: this is the exact stored value.
    expect(
      parseRateCard({ vat_pct: 0.14, teacher_pct: 0, customer_pct: 0, processing_flat: 0 }),
    ).toBeNull();
  });

  it('rejects absent, malformed and out-of-range shapes', () => {
    expect(parseRateCard(null)).toBeNull();
    expect(parseRateCard(undefined)).toBeNull();
    expect(parseRateCard('0.1')).toBeNull();
    expect(parseRateCard({ teacher_pct: 1.5, vat_pct: 0.14 })).toBeNull();
    expect(parseRateCard({ teacher_pct: -0.1, vat_pct: 0.14 })).toBeNull();
    expect(parseRateCard({ teacher_pct: 0.1, vat_pct: 0 })).toBeNull();
  });

  it('accepts a real rate card and pins the LOCKED B1 markup terms', () => {
    const rc = parseRateCard({
      vat_pct: 0.14,
      teacher_pct: 0.1,
      customer_pct: 0.015,
      processing_flat: 1.5,
    });
    expect(rc).not.toBeNull();
    expect(rc?.collectionFeeRate).toBe(0.1);
    // B1 is ONE rate card. The markup terms are constants, not config, so the
    // two cannot drift.
    expect(rc?.markupRate).toBe(0.075);
    expect(rc?.markupFlatEgp).toBe(7.5);
    expect(rc?.parentFeeRate).toBe(0.015);
    expect(rc?.parentFeeFlatEgp).toBe(1.5);
    expect(rc?.vatRate).toBe(0.14);
  });
});

describe('parseCapMinor — the unit is in the name for a reason', () => {
  it('rejects everything that is not a positive integer of piastres', () => {
    for (const v of [null, undefined, 'null', 0, -1, 1.5, NaN, Infinity, '10000abc']) {
      expect(parseCapMinor(v)).toBeNull();
    }
  });

  it('accepts 10,000 EGP expressed as 1,000,000 piastres', () => {
    expect(parseCapMinor(1_000_000)).toBe(1_000_000);
  });
});

describe('loadCollectionPayoutConfig — the whole surface, as it is TODAY', () => {
  it('refuses with every named cause under the real live conditions', async () => {
    const cfg = await loadCollectionPayoutConfig(
      fakeSupabase(LIVE_PLATFORM_CONFIG),
      PLACEHOLDER_ENV,
    );

    expect(cfg.configured).toBe(false);
    if (cfg.configured) throw new Error('unreachable');

    const causes = cfg.problems.map((p) => p.cause).sort();
    const expected: ConfigCause[] = [
      'collection_switch_off',
      'delegate_cap_unset',
      'rail_callback_hmac_placeholder',
      'rail_credentials_placeholder',
      'rate_card_unset',
      'releases_halted',
    ];
    expect(causes).toEqual(expected.sort());

    // Sub-readiness is false on BOTH axes — a caller cannot read "collection is
    // off" as implying the payout rail is fine.
    expect(cfg.collectionReady).toBe(false);
    expect(cfg.payoutReady).toBe(false);
  });

  it('every problem carries an i18n key and the keys that would clear it', async () => {
    const cfg = await loadCollectionPayoutConfig(
      fakeSupabase(LIVE_PLATFORM_CONFIG),
      PLACEHOLDER_ENV,
    );
    if (cfg.configured) throw new Error('unreachable');
    for (const p of cfg.problems) {
      expect(p.messageKey).toBe(`collectionPayout.cause.${p.cause}`);
      expect(p.keys.length).toBeGreaterThan(0);
    }
  });

  it('the refusal body names the config point and never claims success', async () => {
    const cfg = await loadCollectionPayoutConfig(
      fakeSupabase(LIVE_PLATFORM_CONFIG),
      PLACEHOLDER_ENV,
    );
    if (cfg.configured) throw new Error('unreachable');
    const body = refusalBody(cfg);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('collection_payout_not_configured');
    expect(body.configPoint).toBe(COLLECTION_PAYOUT_CONFIG_POINT);
    expect(body.configPoint).toBe('src/lib/collectionPayout/config.ts');
    expect(body.causes.length).toBeGreaterThan(0);
    expect(body.unsetKeys).toContain(ENV_KEYS.railClientId);
    expect(body.unsetKeys).toContain(PLATFORM_CONFIG_KEYS.collectionEnabled);
    // No success-shaped field may exist on a refusal.
    expect(body).not.toHaveProperty('rail');
    expect(body).not.toHaveProperty('rateCard');
  });

  it('an UNREADABLE platform_config fails closed, it does not default', async () => {
    const cfg = await loadCollectionPayoutConfig(
      fakeSupabase({ error: 'permission denied' }),
      FILLED_ENV,
    );
    expect(cfg.configured).toBe(false);
    if (cfg.configured) throw new Error('unreachable');
    expect(cfg.problems.map((p) => p.cause)).toContain('config_unreadable');
  });

  it('the kill switch fails CLOSED: a MISSING row halts releases', async () => {
    // Everything else ready, but payout_releases_halted has no row.
    const rows = READY_PLATFORM_CONFIG.filter(
      (r) => r.key !== PLATFORM_CONFIG_KEYS.releasesHalted,
    );
    const cfg = await loadCollectionPayoutConfig(fakeSupabase(rows), FILLED_ENV);
    expect(cfg.configured).toBe(false);
    if (cfg.configured) throw new Error('unreachable');
    expect(cfg.problems.map((p) => p.cause)).toEqual(['releases_halted']);
  });

  it('the collection switch fails CLOSED: only literal boolean true counts', async () => {
    for (const bad of ['true', 1, 'yes', null]) {
      const rows = READY_PLATFORM_CONFIG.map((r) =>
        r.key === PLATFORM_CONFIG_KEYS.collectionEnabled ? { ...r, value: bad } : r,
      );
      const cfg = await loadCollectionPayoutConfig(fakeSupabase(rows), FILLED_ENV);
      expect(cfg.configured).toBe(false);
      if (cfg.configured) throw new Error('unreachable');
      expect(cfg.problems.map((p) => p.cause)).toContain('collection_switch_off');
    }
  });

  it('a NULL delegate cap (as the migration seeds it) blocks delegated approval', async () => {
    const rows = READY_PLATFORM_CONFIG.map((r) =>
      r.key === PLATFORM_CONFIG_KEYS.delegateCapMinor ? { ...r, value: null } : r,
    );
    const cfg = await loadCollectionPayoutConfig(fakeSupabase(rows), FILLED_ENV);
    expect(cfg.configured).toBe(false);
    if (cfg.configured) throw new Error('unreachable');
    expect(cfg.problems.map((p) => p.cause)).toContain('delegate_cap_unset');
  });

  it('reports configured ONLY when every single axis is genuinely filled', async () => {
    const cfg = await loadCollectionPayoutConfig(
      fakeSupabase(READY_PLATFORM_CONFIG),
      FILLED_ENV,
    );
    expect(cfg.configured).toBe(true);
    if (!cfg.configured) throw new Error('unreachable');
    expect(cfg.rail.clientId).toBe('cid-real-value');
    expect(cfg.rateCard.collectionFeeRate).toBe(0.1);
    expect(cfg.delegateCapMinor).toBe(1_000_000);
    expect(cfg.releasesHalted).toBe(false);
  });
});
