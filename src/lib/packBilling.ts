import type { SupabaseClient } from '@supabase/supabase-js';

/** EGP minimums per plan for Parent Pack monthly / partial invoices (Session D). */
export const PACK_PLAN_MINIMUMS: Record<string, number> = {
  nano: 1000,
  starter: 2000,
  pro: 5000,
  business: 8000,
  enterprise: 10000,
};

export function getPackPlanMinimumEgp(
  plan: string,
  packCustomInvoiceMinimum: number | null | undefined,
): number {
  if (plan === 'top_centers' && packCustomInvoiceMinimum != null && packCustomInvoiceMinimum > 0) {
    return Number(packCustomInvoiceMinimum);
  }
  const tier = plan === ['pro', '_plus'].join('') ? 'business' : plan;
  return PACK_PLAN_MINIMUMS[tier] ?? PACK_PLAN_MINIMUMS.starter;
}

function parseBillingPeriodYm(ym: string): { y: number; m: number } | null {
  const parts = ym.split('-');
  if (parts.length !== 2) return null;
  const y = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return { y, m };
}

/** First instant of calendar month (UTC). */
export function billingMonthStartUtcIso(ym: string): string | null {
  const p = parseBillingPeriodYm(ym);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, 1, 0, 0, 0, 0)).toISOString();
}

/** Last instant of calendar month (UTC): last day 23:59:59.999Z. */
export function billingMonthEndUtcIso(ym: string): string | null {
  const p = parseBillingPeriodYm(ym);
  if (!p) return null;
  const lastDay = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  return new Date(Date.UTC(p.y, p.m - 1, lastDay, 23, 59, 59, 999)).toISOString();
}

/**
 * Distinct parent_phone count for the billing month (YYYY-MM): opted in on or before month end (UTC),
 * and still active at any point in the month (opted out after month start or never).
 */
export async function computeRollingParentCount(
  supabase: SupabaseClient,
  centerId: string,
  billingPeriod: string,
): Promise<number> {
  const startIso = billingMonthStartUtcIso(billingPeriod);
  const endIso = billingMonthEndUtcIso(billingPeriod);
  if (!startIso || !endIso) return 0;

  const { data, error } = await supabase
    .from('parent_pack_monthly_counts')
    .select('parent_phone, opted_out_at')
    .eq('center_id', centerId)
    .eq('billing_period', billingPeriod)
    .lte('opted_in_at', endIso);

  if (error) {
    console.error('[packBilling] computeRollingParentCount', centerId, billingPeriod, error);
    return 0;
  }

  const startMs = new Date(startIso).getTime();
  const phones = new Set<string>();
  for (const row of data ?? []) {
    const r = row as { parent_phone?: string; opted_out_at?: string | null };
    const oo = r.opted_out_at;
    if (oo != null && new Date(oo).getTime() <= startMs) continue;
    const p = r.parent_phone;
    if (p) phones.add(p);
  }
  return phones.size;
}

export function billingPeriodArabicMonthYear(ym: string): string {
  const p = parseBillingPeriodYm(ym);
  if (!p) return ym;
  const d = new Date(Date.UTC(p.y, p.m - 1, 15));
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Cairo calendar YYYY-MM-DD parts (for proration). */
export function cairoYmdParts(): { y: number; m: number; d: number; ym: string } {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  return { y, m, d, ym: `${y}-${String(m).padStart(2, '0')}` };
}

/** Days in month for Cairo calendar month `m` (1–12) and year `y`. */
export function daysInCairoMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
