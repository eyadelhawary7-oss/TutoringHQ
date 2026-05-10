import type { SupabaseClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 60_000;
let cachedAt = 0;
let cachedDays = 7;

/**
 * Calendar days after `next_payment_due` before suspension (`auto_suspend_at`).
 * Seeded in platform_config; defaults to 7 when missing or invalid.
 */
export async function getSubscriptionGracePeriodDays(supabase: SupabaseClient): Promise<number> {
  const now = Date.now();
  if (now - cachedAt < CACHE_TTL_MS && cachedDays > 0) {
    return cachedDays;
  }
  let n = 7;
  try {
    const { data } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'subscription_grace_period_days')
      .maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    const parsed = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) n = Math.round(parsed);
  } catch {
    n = 7;
  }
  if (!Number.isFinite(n) || n <= 0) n = 7;
  cachedAt = now;
  cachedDays = n;
  return n;
}
