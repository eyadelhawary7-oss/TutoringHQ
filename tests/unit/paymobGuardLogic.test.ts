import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  assertPaymobProductionOrThrow,
  paymobCredentialsLookSandbox,
} from '@/lib/paymobGuardLogic';

describe('paymobGuardLogic', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects sandbox-shaped api key', () => {
    vi.stubEnv('PAYMOB_API_KEY', 'sandbox_short');
    vi.stubEnv('PAYMOB_INTEGRATION_ID', '123456');
    expect(paymobCredentialsLookSandbox()).toBe(true);
  });

  it('throws in production when credentials look sandbox', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PAYMOB_API_KEY', 'short');
    vi.stubEnv('PAYMOB_INTEGRATION_ID', '123456789');
    expect(() => assertPaymobProductionOrThrow()).toThrow(/PAYMOB_PRODUCTION_GUARD: refusing to boot/);
  });

  it('does not throw on Vercel preview', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PAYMOB_API_KEY', 'short');
    expect(() => assertPaymobProductionOrThrow()).not.toThrow();
  });
});
