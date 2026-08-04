/**
 * The Valify guard: a placeholder is NOT a credential.
 *
 * This is the test that protects the whole feature's honesty. If
 * `isValifyConfigured()` ever returns true for the literal string
 * "placeholder", every downstream refusal turns into an attempt, and an attempt
 * against a provider we have no contract with is where a fake success comes
 * from.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  VALIFY_ENV_KEYS,
  isPlaceholderValue,
  readValifyEnvSnapshot,
} from '@/lib/valifyConfig';
import {
  ValifyNotConfiguredError,
  assertValifyConfigured,
  getValifyConfigStatus,
  getValifyHealth,
  isValifyConfigured,
  refusalMessage,
} from '@/lib/valifyGuardLogic';

const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

function setRealCredentials(): void {
  process.env.VALIFY_API_KEY = 'vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30';
  process.env.VALIFY_BASE_URL = 'https://verify.valifysolutions.com';
  process.env.VALIFY_WEBHOOK_SECRET = 'whsec_2b9e4a7c1f8d3e6a5c0b9d2f4e7a1c83';
}

describe('isPlaceholderValue', () => {
  it('treats absent, null and blank as placeholders', () => {
    expect(isPlaceholderValue(undefined)).toBe(true);
    expect(isPlaceholderValue(null)).toBe(true);
    expect(isPlaceholderValue('')).toBe(true);
    expect(isPlaceholderValue('   ')).toBe(true);
  });

  it('treats every token .env.example actually ships as a placeholder', () => {
    // These are the literal values in .env.example today. If any of them ever
    // reads as configured, copying the example forward half-enables the feature.
    for (const v of ['placeholder', 'your-key-here', 'https://example.com']) {
      expect(isPlaceholderValue(v)).toBe(true);
    }
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(isPlaceholderValue('  PLACEHOLDER  ')).toBe(true);
    expect(isPlaceholderValue('Your-Key-Here')).toBe(true);
  });

  it('accepts values that look like real credentials', () => {
    expect(isPlaceholderValue('vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30')).toBe(false);
    expect(isPlaceholderValue('https://verify.valifysolutions.com')).toBe(false);
  });
});

describe('the guard, with the config in the state it actually ships in', () => {
  it('reports NOT configured when every key is absent', () => {
    expect(isValifyConfigured()).toBe(false);
    const status = getValifyConfigStatus();
    expect(status.configured).toBe(false);
    expect(status.cause).toBe('valify_not_configured');
    expect(status.missing).toEqual([
      'VALIFY_API_KEY',
      'VALIFY_BASE_URL',
      'VALIFY_WEBHOOK_SECRET',
    ]);
  });

  it('THE CENTRAL CASE: reports NOT configured when every key holds "placeholder"', () => {
    // This is literally what .env.example ships and what a copied-forward
    // deploy would have. A naive `if (process.env.VALIFY_API_KEY)` passes here.
    for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';

    // Values ARE present...
    const snapshot = readValifyEnvSnapshot();
    for (const k of VALIFY_ENV_KEYS) expect(snapshot[k]).toBe('placeholder');

    // ...and the guard still refuses.
    expect(isValifyConfigured()).toBe(false);
    expect(getValifyConfigStatus().cause).toBe('valify_not_configured');
    expect(getValifyConfigStatus().missing).toHaveLength(3);
  });

  it('refuses when even ONE required key is still a placeholder', () => {
    setRealCredentials();
    process.env.VALIFY_WEBHOOK_SECRET = 'placeholder';

    expect(isValifyConfigured()).toBe(false);
    expect(getValifyConfigStatus().missing).toEqual(['VALIFY_WEBHOOK_SECRET']);
  });

  it('does NOT block on the optional flow id', () => {
    setRealCredentials();
    // VALIFY_FLOW_ID left unset — Valify falls back to the account default.
    expect(isValifyConfigured()).toBe(true);
    const status = getValifyConfigStatus();
    expect(status.missing).toEqual([]);
    expect(status.optionalMissing).toEqual(['VALIFY_FLOW_ID']);
  });

  it('reports configured only when all three required credentials are real', () => {
    setRealCredentials();
    process.env.VALIFY_FLOW_ID = '3f2a9c14-5b8e-4d71-9a03-6c2e8b4f1d75';
    expect(isValifyConfigured()).toBe(true);
    expect(getValifyConfigStatus().cause).toBeNull();
  });
});

describe('assertValifyConfigured', () => {
  it('throws a NAMED error listing the missing keys', () => {
    for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';

    let thrown: unknown;
    try {
      assertValifyConfigured();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ValifyNotConfiguredError);
    const err = thrown as ValifyNotConfiguredError;
    expect(err.cause_code).toBe('valify_not_configured');
    expect(err.missing).toContain('VALIFY_API_KEY');
    expect(err.message).toContain('VALIFY_API_KEY');
  });

  it('has NO production/build escape hatch — it refuses in every environment', () => {
    // paymobGuardLogic returns early during next build and outside production.
    // This guard must not, or local dev becomes a place where a green
    // checkmark can appear with no integration behind it.
    for (const env of ['development', 'preview', 'production']) {
      process.env.VERCEL_ENV = env;
      process.env.NEXT_PHASE = 'phase-production-build';
      expect(() => assertValifyConfigured()).toThrow(ValifyNotConfiguredError);
    }
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PHASE;
  });

  it('does not throw once real credentials are set', () => {
    setRealCredentials();
    expect(() => assertValifyConfigured()).not.toThrow();
  });
});

describe('operator + user surfaces never claim success while unconfigured', () => {
  it('health reports mode "unconfigured" and names the keys', () => {
    for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';
    const health = getValifyHealth();
    expect(health.mode).toBe('unconfigured');
    expect(health.cause).toBe('valify_not_configured');
    expect(health.missing).toContain('VALIFY_WEBHOOK_SECRET');
    expect(health.note).toMatch(/NOT contracted/i);
  });

  it('every cause has non-empty copy in BOTH locales', () => {
    for (const cause of ['valify_not_configured', 'verification_schema_not_applied'] as const) {
      const m = refusalMessage(cause);
      expect(m.en.length).toBeGreaterThan(20);
      expect(m.ar.length).toBeGreaterThan(20);
      // Arabic must actually be Arabic, not an English string copied across.
      expect(m.ar).toMatch(/[؀-ۿ]/);
    }
  });

  it('the refusal copy tells the user they were not rejected', () => {
    // The specific product failure VERIFICATION-SPEC §9.1 warns about: a state
    // that reads as rejection when it is not.
    const m = refusalMessage('valify_not_configured');
    expect(m.en).toMatch(/Nothing you did failed/i);
  });
});
