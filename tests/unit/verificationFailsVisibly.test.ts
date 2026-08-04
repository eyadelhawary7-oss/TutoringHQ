import { describe, it, expect } from 'vitest';
import {
  readVerificationConfig,
  requireVerificationConfig,
  isPlaceholderValue,
  VerificationNotConfiguredError,
  VERIFICATION_CONFIG_ENV_KEYS,
} from '@/lib/verification/config';
import {
  resolveVerificationState,
  isVerified,
  VERIFICATION_STATUSES,
  type VerificationState,
} from '@/lib/verification/state';
import {
  verificationBadgeView,
  verifyCtaView,
  digitalCollectionView,
  adminVerificationView,
} from '@/lib/verification/uiState';
import enMessages from '../../messages/en.json';
import arMessages from '../../messages/ar.json';

/**
 * THE FAILURE PATH IS THE POINT OF THIS FILE.
 *
 * Valify does not exist as an integration. Online collection is not live. The
 * verification columns are not in the live schema (re-verified 4 Aug 2026:
 * `centers` has 128 columns and none of them is `verification_status`).
 *
 * So the state these tests care most about is the unconfigured one, and what
 * they assert is that NOTHING claims success in it. A green checkmark backed by
 * no integration is the worst outcome this feature can produce; every test
 * below exists to make that outcome impossible to ship.
 */

const REAL_ENV = {
  VALIFY_BASE_URL: 'https://verify.valifysolutions.com',
  VALIFY_API_KEY: 'vk_live_abc123',
  VALIFY_FLOW_ID: '0f3c1a52-1111-2222-3333-444455556666',
  VALIFY_WEBHOOK_SECRET: 's3cr3t-webhook-signing-key',
};

const PLACEHOLDER_ENV = {
  VALIFY_BASE_URL: 'placeholder',
  VALIFY_API_KEY: 'placeholder',
  VALIFY_FLOW_ID: 'placeholder',
  VALIFY_WEBHOOK_SECRET: 'placeholder',
};

describe('the one config point', () => {
  it('reports not-configured when the env is empty, naming every missing key', () => {
    const result = readVerificationConfig({});
    expect(result.configured).toBe(false);
    if (result.configured) throw new Error('unreachable');
    expect(result.cause).toBe('missing_credentials');
    expect(result.missing).toEqual([...VERIFICATION_CONFIG_ENV_KEYS]);
  });

  it('treats the .env.example placeholder values as NOT configured', () => {
    // This is the case a truthy-string check would get wrong, and getting it
    // wrong hands the user a verified badge backed by nothing.
    const result = readVerificationConfig(PLACEHOLDER_ENV);
    expect(result.configured).toBe(false);
    if (result.configured) throw new Error('unreachable');
    expect(result.cause).toBe('placeholder_credentials');
    expect(result.placeholder).toEqual([...VERIFICATION_CONFIG_ENV_KEYS]);
  });

  it('reports not-configured when even ONE key is still a placeholder', () => {
    const result = readVerificationConfig({ ...REAL_ENV, VALIFY_WEBHOOK_SECRET: 'placeholder' });
    expect(result.configured).toBe(false);
    if (result.configured) throw new Error('unreachable');
    // The webhook secret is the trust anchor; a partial config must not pass.
    expect(result.placeholder).toEqual(['VALIFY_WEBHOOK_SECRET']);
  });

  it('reports not-configured when a key is whitespace only', () => {
    expect(readVerificationConfig({ ...REAL_ENV, VALIFY_API_KEY: '   ' }).configured).toBe(false);
  });

  it('recognises the placeholder dialects that actually ship in .env.example', () => {
    for (const v of ['placeholder', 'your-key-here', 'PLACEHOLDER', ' TODO ', 'https://example.com', '<your-url>', '']) {
      expect(isPlaceholderValue(v), `${JSON.stringify(v)} should be a placeholder`).toBe(true);
    }
    expect(isPlaceholderValue('vk_live_abc123')).toBe(false);
    expect(isPlaceholderValue('https://verify.valifysolutions.com')).toBe(false);
  });

  it('reports configured only when all four keys hold real values', () => {
    const result = readVerificationConfig(REAL_ENV);
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error('unreachable');
    expect(result.apiKey).toBe('vk_live_abc123');
    // Trailing slashes stripped so client URL joins cannot double up.
    expect(readVerificationConfig({ ...REAL_ENV, VALIFY_BASE_URL: 'https://v.co/' }).configured).toBe(true);
  });
});

describe('requireVerificationConfig refuses loudly with a named cause', () => {
  it('throws rather than returning a degraded object when unset', () => {
    expect(() => requireVerificationConfig({})).toThrow(VerificationNotConfiguredError);
  });

  it('throws when the values are placeholders', () => {
    expect(() => requireVerificationConfig(PLACEHOLDER_ENV)).toThrow(VerificationNotConfiguredError);
  });

  it('carries a stable machine-readable code and the offending keys', () => {
    try {
      requireVerificationConfig({ ...REAL_ENV, VALIFY_API_KEY: undefined });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VerificationNotConfiguredError);
      const e = err as VerificationNotConfiguredError;
      expect(e.code).toBe('verification_not_configured');
      expect(e.causeCode).toBe('missing_credentials');
      expect(e.missing).toContain('VALIFY_API_KEY');
      // The message must be diagnosable from one log line, not "something failed".
      expect(e.message).toContain('VALIFY_API_KEY');
      expect(e.message).toContain('not configured');
    }
  });

  it('returns the credentials when they are real', () => {
    expect(requireVerificationConfig(REAL_ENV).flowId).toBe(REAL_ENV.VALIFY_FLOW_ID);
  });
});

describe('the state machine never fabricates a pass', () => {
  it('reports unavailable with a named cause when credentials are missing', () => {
    const state = resolveVerificationState({
      config: readVerificationConfig({}),
      stateSourceAvailable: true,
      row: { verification_status: 'verified', verified_at: '2026-07-12T00:00:00Z', valify_transaction_id: 'VF-1' },
    });
    // THE CENTRAL ASSERTION OF THIS BRANCH. A row saying "verified" is not
    // enough: with no live integration no webhook could have written it, so it
    // is test data, a manual edit or a default. We refuse to render it.
    expect(state.available).toBe(false);
    if (state.available) throw new Error('unreachable');
    expect(state.cause).toBe('provider_not_configured');
    expect(isVerified(state)).toBe(false);
  });

  it('distinguishes placeholder credentials from absent ones', () => {
    const state = resolveVerificationState({
      config: readVerificationConfig(PLACEHOLDER_ENV),
      stateSourceAvailable: true,
      row: null,
    });
    expect(state.available).toBe(false);
    if (state.available) throw new Error('unreachable');
    expect(state.cause).toBe('provider_placeholder_credentials');
  });

  it('reports state_source_missing when the migration is unapplied', () => {
    const state = resolveVerificationState({
      config: readVerificationConfig(REAL_ENV),
      stateSourceAvailable: false,
      row: null,
    });
    expect(state.available).toBe(false);
    if (state.available) throw new Error('unreachable');
    expect(state.cause).toBe('state_source_missing');
    // Names the file an operator has to apply, not just "unavailable".
    expect(state.detail).toContain('20260804140000_verification_state_columns.sql');
    expect(isVerified(state)).toBe(false);
  });

  it('checks config BEFORE the row, so an unconfigured deploy can never read as verified', () => {
    // Both broken: the config cause must win, because it is the one that makes
    // the row untrustworthy in the first place.
    const state = resolveVerificationState({
      config: readVerificationConfig({}),
      stateSourceAvailable: false,
      row: null,
    });
    if (state.available) throw new Error('unreachable');
    expect(state.cause).toBe('provider_not_configured');
  });

  it('maps a subject with no row to unverified, not to an outage', () => {
    const state = resolveVerificationState({
      config: readVerificationConfig(REAL_ENV),
      stateSourceAvailable: true,
      row: null,
    });
    expect(state).toEqual({ available: true, status: 'unverified', verifiedAt: null, providerRef: null });
  });

  it('maps an unrecognised status to provider_error, never quietly to unverified', () => {
    const state = resolveVerificationState({
      config: readVerificationConfig(REAL_ENV),
      stateSourceAvailable: true,
      row: { verification_status: 'manual_review', verified_at: null, valify_transaction_id: 'VF-9' },
    });
    if (!state.available) throw new Error('unreachable');
    expect(state.status).toBe('provider_error');
    expect(isVerified(state)).toBe(false);
  });

  it('drops a verified_at that does not belong to a pass', () => {
    const state = resolveVerificationState({
      config: readVerificationConfig(REAL_ENV),
      stateSourceAvailable: true,
      row: { verification_status: 'failed', verified_at: '2026-07-12T00:00:00Z', valify_transaction_id: null },
    });
    if (!state.available) throw new Error('unreachable');
    // Otherwise a surface renders "Not verified · verified 12/07/2025".
    expect(state.verifiedAt).toBeNull();
  });

  it('reports verified ONLY for a real pass with real credentials and a live source', () => {
    const state = resolveVerificationState({
      config: readVerificationConfig(REAL_ENV),
      stateSourceAvailable: true,
      row: { verification_status: 'verified', verified_at: '2026-07-12T00:00:00Z', valify_transaction_id: 'VF-1' },
    });
    expect(isVerified(state)).toBe(true);
  });

  it('isVerified is false for every status except verified, and for every unavailable cause', () => {
    for (const status of VERIFICATION_STATUSES) {
      const state = resolveVerificationState({
        config: readVerificationConfig(REAL_ENV),
        stateSourceAvailable: true,
        row: {
          verification_status: status,
          verified_at: status === 'verified' ? '2026-07-12T00:00:00Z' : null,
          valify_transaction_id: null,
        },
      });
      expect(isVerified(state), status).toBe(status === 'verified');
    }
    for (const cause of ['provider_not_configured', 'provider_placeholder_credentials', 'state_source_missing'] as const) {
      expect(isVerified({ available: false, cause, detail: '' })).toBe(false);
    }
  });
});

describe('no surface claims success when the config is a placeholder', () => {
  // The exact state every live surface renders today.
  const unconfigured: VerificationState = resolveVerificationState({
    config: readVerificationConfig(PLACEHOLDER_ENV),
    stateSourceAvailable: false,
    row: null,
  });

  it('the badge says unavailable and is NOT hidden', () => {
    const view = verificationBadgeView(unconfigured);
    expect(view.tone).toBe('unavailable');
    expect(view.labelKey).toBe('badge.unavailable');
    // Hiding it would leave the old silent behaviour, which reads as "fine".
    expect(view.show).toBe(true);
  });

  it('the badge never reads verified in any unavailable state', () => {
    for (const cause of ['provider_not_configured', 'provider_placeholder_credentials', 'state_source_missing'] as const) {
      const view = verificationBadgeView({ available: false, cause, detail: '' });
      expect(view.labelKey).not.toBe('badge.verified');
      expect(view.tone).not.toBe('verified');
    }
  });

  it('the Verify CTA is DISABLED with a readable reason, not hidden', () => {
    const view = verifyCtaView(unconfigured);
    expect(view.enabled).toBe(false);
    expect(view.reasonKey).toBe('cta.reason.unavailable');
    expect(view.alreadyVerified).toBe(false);
  });

  it('the CTA is enabled only from a retryable entry point on a live feature', () => {
    const live = (status: (typeof VERIFICATION_STATUSES)[number]) =>
      verifyCtaView({ available: true, status, verifiedAt: null, providerRef: null });
    expect(live('unverified').enabled).toBe(true);
    expect(live('failed').enabled).toBe(true);
    expect(live('expired').enabled).toBe(true);
    // A second redirect mid-flight costs another Valify charge.
    expect(live('pending').enabled).toBe(false);
    expect(live('provider_error').enabled).toBe(false);
    expect(live('verified').alreadyVerified).toBe(true);
  });

  it('every disabled CTA carries a reason key — a greyed control is never unexplained', () => {
    for (const status of VERIFICATION_STATUSES) {
      const view = verifyCtaView({ available: true, status, verifiedAt: null, providerRef: null });
      if (!view.enabled && !view.alreadyVerified) expect(view.reasonKey).not.toBeNull();
    }
    expect(verifyCtaView(unconfigured).reasonKey).not.toBeNull();
  });

  it('digital collection is OFF with a reason, and is on for nothing but a real pass', () => {
    expect(digitalCollectionView(unconfigured)).toEqual({
      on: false,
      reasonKey: 'collection.reason.unavailable',
    });
    for (const status of VERIFICATION_STATUSES) {
      const view = digitalCollectionView({ available: true, status, verifiedAt: null, providerRef: null });
      expect(view.on, status).toBe(status === 'verified');
      if (!view.on) expect(view.reasonKey, status).not.toBeNull();
    }
  });

  it('admin sees "not configured" with the NAMED cause and its filters gated', () => {
    const view = adminVerificationView(unconfigured);
    expect(view.labelKey).toBe('admin.status.notConfigured');
    expect(view.causeKey).toBe('admin.cause.providerPlaceholder');
    expect(view.gated).toBe(true);
  });

  it('admin gets a different named cause per failure, so it is actionable', () => {
    expect(adminVerificationView({ available: false, cause: 'provider_not_configured', detail: '' }).causeKey)
      .toBe('admin.cause.providerNotConfigured');
    expect(adminVerificationView({ available: false, cause: 'state_source_missing', detail: '' }).causeKey)
      .toBe('admin.cause.stateSourceMissing');
  });

  it('providers are NOT told which env var is missing — that is a deployment detail', () => {
    // Tenant-facing copy must not leak our config state.
    const providerCopy = [
      verifyCtaView(unconfigured).reasonKey,
      verificationBadgeView(unconfigured).labelKey,
      digitalCollectionView(unconfigured).reasonKey,
    ];
    for (const key of providerCopy) {
      expect(key).not.toBeNull();
      expect(key).not.toContain('admin.');
    }
  });
});

describe('every key these views emit exists in BOTH message files', () => {
  function lookup(messages: Record<string, unknown>, dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], messages);
  }

  // Collect every key any view can produce, across every reachable state.
  const states: VerificationState[] = [
    ...(['provider_not_configured', 'provider_placeholder_credentials', 'state_source_missing'] as const).map(
      (cause): VerificationState => ({ available: false, cause, detail: '' }),
    ),
    ...VERIFICATION_STATUSES.map(
      (status): VerificationState => ({ available: true, status, verifiedAt: null, providerRef: null }),
    ),
  ];

  const keys = new Set<string>([
    'cta.whatYoullNeed',
    'cta.verifyToSwitchOn',
    'collectForYou.title',
    'collectForYou.body',
    'collectForYou.subline',
    'settingsRow.title',
    'settingsRow.subtitleUnverified',
    'settingsRow.subtitleUnavailable',
    'settingsRow.subtitleOn',
    'admin.filterUnverifiedDisabled',
  ]);
  for (const state of states) {
    keys.add(verificationBadgeView(state).labelKey);
    const cta = verifyCtaView(state);
    keys.add(cta.labelKey);
    if (cta.reasonKey) keys.add(cta.reasonKey);
    const collection = digitalCollectionView(state);
    if (collection.reasonKey) keys.add(collection.reasonKey);
    const admin = adminVerificationView(state);
    keys.add(admin.labelKey);
    if (admin.causeKey) keys.add(admin.causeKey);
  }

  it.each([...keys])('verification.%s resolves in en and ar', (key) => {
    const en = lookup(enMessages as unknown as Record<string, unknown>, `verification.${key}`);
    const ar = lookup(arMessages as unknown as Record<string, unknown>, `verification.${key}`);
    expect(typeof en, `en missing verification.${key}`).toBe('string');
    expect(typeof ar, `ar missing verification.${key}`).toBe('string');
    expect((en as string).length).toBeGreaterThan(0);
    expect((ar as string).length).toBeGreaterThan(0);
  });

  it('the verification namespace is key-identical across en and ar', () => {
    const flatten = (obj: unknown, prefix = ''): string[] =>
      typeof obj === 'object' && obj !== null
        ? Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
        : [prefix];
    const en = flatten((enMessages as Record<string, unknown>).verification).sort();
    const ar = flatten((arMessages as Record<string, unknown>).verification).sort();
    expect(en).toEqual(ar);
    expect(en.length).toBeGreaterThan(0);
  });
});
