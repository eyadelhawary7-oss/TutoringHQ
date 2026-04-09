import type { SupabaseClient } from '@supabase/supabase-js';

export function calculateReactivationFee(
  activeMonthsCount: number,
  avgMonthlyPrice: number,
): { baseFee: number; discountRate: number; finalFee: number } {
  let discountRate = 0;
  if (activeMonthsCount >= 24) discountRate = 0.35;
  else if (activeMonthsCount >= 12) discountRate = 0.25;
  else if (activeMonthsCount >= 6) discountRate = 0.15;

  const baseFee = avgMonthlyPrice;
  const finalFee = Math.max(1999, Math.round(baseFee * (1 - discountRate)));
  return { baseFee, discountRate, finalFee };
}

/** Sum of subscription invoice totals for avg monthly = sum / active_months_count (caller divides). */
export async function sumSubscriptionInvoiceTotals(
  supabase: SupabaseClient,
  centerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('invoices')
    .select('total_amount')
    .eq('center_id', centerId)
    .in('invoice_type', ['subscription', 'base_subscription']);

  if (error) {
    console.error('[sumSubscriptionInvoiceTotals]', error);
    return 0;
  }

  let sum = 0;
  for (const r of data ?? []) {
    sum += Number((r as { total_amount?: number | string | null }).total_amount ?? 0);
  }
  return sum;
}
