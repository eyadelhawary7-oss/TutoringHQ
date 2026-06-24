/**
 * Active-months counter for centers (Cairo calendar), used by the process-renewals cron.
 *
 * The 5% late-fee tiers and the day-30 dormancy scan that used to live here were
 * REMOVED with the switch to the single-day lock billing model
 * (see src/lib/billingLifecycle.ts): there is no late fee and no reactivation fee.
 * An unpaid center keeps full access for its billing day and locks at the next
 * Cairo midnight via centers.auto_suspend_at (set to that midnight), enforced in
 * src/proxy.ts and the suspend step of subscriptionBillingCron.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** On Cairo calendar day 1, bump active_months_count for every center with status active. */
export async function incrementActiveMonthsOnFirstOfMonth(
  supabase: SupabaseClient,
  todayCairoYmd: string,
): Promise<number> {
  if (todayCairoYmd.slice(8, 10) !== '01') return 0;

  const { data: rows, error: fetchErr } = await supabase
    .from('centers')
    .select('id, active_months_count')
    .eq('status', 'active');

  if (fetchErr || !rows?.length) {
    if (fetchErr) console.error('[incrementActiveMonthsOnFirstOfMonth]', fetchErr);
    return 0;
  }

  let n = 0;
  for (const row of rows) {
    const r = row as { id: string; active_months_count?: number | null };
    const next = Number(r.active_months_count ?? 0) + 1;
    const { error } = await supabase.from('centers').update({ active_months_count: next }).eq('id', r.id);
    if (!error) n++;
    else console.error('[incrementActiveMonthsOnFirstOfMonth] update', r.id, error);
  }
  return n;
}
