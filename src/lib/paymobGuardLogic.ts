/**
 * Paymob production guard + health display: shared rules for API key / integration shape.
 */

/** True on Vercel production, or on non-Vercel hosts when NODE_ENV is production. */
export function isProductionDeployEnv(): boolean {
  if (process.env.VERCEL_ENV === 'production') return true;
  if (process.env.VERCEL === '1' || process.env.VERCEL === 'true') return false;
  return process.env.NODE_ENV === 'production';
}

/** True when credentials look like sandbox / test keys (must not ship on production). */
export function paymobCredentialsLookSandbox(): boolean {
  const key = process.env.PAYMOB_API_KEY ?? '';
  const iid = String(process.env.PAYMOB_INTEGRATION_ID ?? '').trim();
  if (key.toLowerCase().includes('sandbox')) return true;
  if (key.length > 0 && key.length < 30) return true;
  if (iid.length > 0 && iid.length < 6) return true;
  return false;
}

export function assertPaymobProductionOrThrow(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (!isProductionDeployEnv()) return;
  if (!paymobCredentialsLookSandbox()) return;
  throw new Error('PAYMOB_PRODUCTION_GUARD: refusing to boot — set live keys in Vercel env.');
}

/** Health UI: mirrors guard inputs (sandbox-shaped keys → sandbox). */
export function getPaymobHealthMode(): 'live' | 'sandbox' {
  return paymobCredentialsLookSandbox() ? 'sandbox' : 'live';
}
