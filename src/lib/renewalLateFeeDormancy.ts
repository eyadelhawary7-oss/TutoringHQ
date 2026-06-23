/**
 * Daily late-fee tiers + dormancy (Cairo calendar), used by process-renewals cron.
 * Config keys in platform_config (jsonb numbers): late_fee_grace_days, late_fee_tier1_trigger_day,
 * late_fee_tier1_percent, late_fee_tier2_percent, dormancy_trigger_day.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor';
import { getPeriodMultiplier, isPaygCenter } from '@/lib/billingEngine';
import { sendChqRenewalOverdueTemplate, sendDormancyNotice } from '@/lib/centerNotify';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';

const SYSTEM_AUDIT_USER_ID = '00000000-0000-0000-0000-000000000000';

export type LateFeeDormancyConfig = {
  graceDays: number;
  tier1Day: number;
  tier2Day: number;
  dormancyDay: number;
  /** Late fee as % of base balance, e.g. 5 = 5% (from platform_config integer). */
  tier1Percent: number;
  tier2Percent: number;
};

function parseConfigNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  return fallback;
}

/** Integer percent 0–100; if legacy jsonb stored 0.05, treat as 5%. */
function parseConfigPercent(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    if (v > 0 && v <= 1) return Math.min(100, Math.round(v * 100));
    return Math.min(100, Math.round(v));
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= 0) {
      if (n > 0 && n <= 1) return Math.min(100, Math.round(n * 100));
      return Math.min(100, Math.round(n));
    }
  }
  return fallback;
}

export async function loadLateFeeDormancyConfig(supabase: SupabaseClient): Promise<LateFeeDormancyConfig> {
  const keys = [
    'late_fee_grace_days',
    'late_fee_tier1_trigger_day',
    'late_fee_tier2_trigger_day',
    'dormancy_trigger_day',
    'late_fee_tier1_percent',
    'late_fee_tier2_percent',
  ] as const;
  const { data: rows } = await supabase.from('platform_config').select('key, value').in('key', [...keys]);
  const map = new Map<string, unknown>();
  for (const r of rows ?? []) {
    const row = r as { key: string; value: unknown };
    map.set(row.key, row.value);
  }
  return {
    graceDays: parseConfigNum(map.get('late_fee_grace_days'), 3),
    tier1Day: parseConfigNum(map.get('late_fee_tier1_trigger_day'), 4),
    tier2Day: parseConfigNum(map.get('late_fee_tier2_trigger_day'), 9),
    dormancyDay: parseConfigNum(map.get('dormancy_trigger_day'), 30),
    tier1Percent: parseConfigPercent(map.get('late_fee_tier1_percent'), 5),
    tier2Percent: parseConfigPercent(map.get('late_fee_tier2_percent'), 10),
  };
}

/** Calendar days after due date (due = 0 on due day; 1 = first day late). */
export function daysOverdueYmd(dueYmd: string, todayYmd: string): number {
  const due = new Date(`${dueYmd.slice(0, 10)}T12:00:00.000Z`);
  const today = new Date(`${todayYmd.slice(0, 10)}T12:00:00.000Z`);
  return Math.floor((today.getTime() - due.getTime()) / 86400000);
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + days);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function centerCode(c: { center_code?: string | null; referral_code?: string | null; id: string }): string {
  const raw = (c.center_code || c.referral_code || '').trim();
  if (raw) return raw.replace(/\s+/g, '');
  return 'UNK';
}

function billingPeriodKey(sub: string | null | undefined): 'monthly' | 'quarterly' | 'annual' {
  const p = (sub ?? 'quarterly').toLowerCase();
  if (p === 'monthly') return 'monthly';
  if (p === 'annual' || p === 'yearly') return 'annual';
  return 'quarterly';
}

function baseSubscriptionAmount(c: {
  billing_amount?: number | string | null;
  all_in_price?: number | string | null;
  subscription_billing_period?: string | null;
  billing_period?: string | null;
}): number {
  const ba = Number(c.billing_amount ?? 0);
  if (ba > 0) return Math.round(ba * 100) / 100;
  const allIn = Number(c.all_in_price ?? 0);
  const mult = getPeriodMultiplier(billingPeriodKey(c.subscription_billing_period ?? c.billing_period));
  const fromAllIn = allIn * mult;
  return Math.round(fromAllIn * 100) / 100;
}

async function logAudit(
  supabase: SupabaseClient,
  centerId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      center_id: centerId,
      user_id: SYSTEM_AUDIT_USER_ID,
      action,
      entity_type: 'center',
      details,
    });
  } catch (e) {
    console.error('[renewalLateFeeDormancy] audit_log:', e);
  }
}

type LateFeeMeta = {
  cycle_anchor: string;
  late_fee_rate: number;
  late_fee_amount: number;
  days_overdue: number;
  tier: 1 | 2;
  grace_period_end?: string;
  processing_fee?: number;
};

async function fetchPendingLateFeesForCycle(
  supabase: SupabaseClient,
  centerId: string,
  cycleAnchor: string,
): Promise<{ id: string; metadata: Record<string, unknown> | null }[]> {
  const { data } = await supabase
    .from('invoices')
    .select('id, metadata, status')
    .eq('center_id', centerId)
    .eq('invoice_type', 'late_payment_fee')
    .eq('status', 'pending');

  const list = (data ?? []) as { id: string; metadata: Record<string, unknown> | null; status: string }[];
  return list.filter((row) => {
    const anchor = row.metadata && String((row.metadata as LateFeeMeta).cycle_anchor ?? '');
    return anchor === cycleAnchor;
  });
}

async function voidLateFees(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  await supabase.from('invoices').update({ status: 'cancelled', updated_at: now }).in('id', ids);
}

export type LateFeeDormancyRunResult = {
  scanned: number;
  dormantMarked: number;
  lateFeeTier1: number;
  lateFeeTier2: number;
  skippedPayg: number;
  skippedZeroBase: number;
  errors: string[];
};

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

export async function runLateFeeAndDormancyScan(
  supabase: SupabaseClient,
  todayCairoYmd: string,
): Promise<LateFeeDormancyRunResult> {
  const cfg = await loadLateFeeDormancyConfig(supabase);
  // Flat processing fee (Section 5) added to each combined late-fee invoice — a
  // separate line on top of (subscription + late fee). NEVER part of the base the
  // late-fee percentage is computed on.
  const feeCfg = await getProcessingFeeConfig();
  const processingFee = resolveProcessingFeeAmount(feeCfg);
  const result: LateFeeDormancyRunResult = {
    scanned: 0,
    dormantMarked: 0,
    lateFeeTier1: 0,
    lateFeeTier2: 0,
    skippedPayg: 0,
    skippedZeroBase: 0,
    errors: [],
  };

  const { data: centers, error: qErr } = await supabase
    .from('centers')
    .select(
      'id, name, phone, status, center_code, referral_code, next_payment_due, billing_amount, all_in_price, subscription_billing_period, billing_period, billing_type, pricing_type, subscription_status',
    )
    .in('status', ['active', 'suspended'])
    .not('next_payment_due', 'is', null)
    .lt('next_payment_due', todayCairoYmd);

  if (qErr) {
    result.errors.push(qErr.message);
    return result;
  }

  for (const raw of centers ?? []) {
    const c = raw as {
      id: string;
      name: string | null;
      phone: string | null;
      status: string;
      center_code?: string | null;
      referral_code?: string | null;
      next_payment_due: string;
      billing_amount?: number | string | null;
      all_in_price?: number | string | null;
      subscription_billing_period?: string | null;
      billing_period?: string | null;
      billing_type?: string | null;
      pricing_type?: string | null;
      subscription_status?: string | null;
    };

    if (isPaygCenter(c)) {
      result.skippedPayg++;
      continue;
    }
    const subSt = String(c.subscription_status ?? 'active');
    if (subSt === 'cancelled') continue;

    const npd = String(c.next_payment_due).slice(0, 10);
    const daysLate = daysOverdueYmd(npd, todayCairoYmd);
    if (daysLate < 1) continue;

    result.scanned++;

    const base = baseSubscriptionAmount(c);
    if (base <= 0) {
      result.skippedZeroBase++;
      continue;
    }

    const code = centerCode(c);
    const cycleKey = npd.slice(0, 7);
    const invNo = `LATE-${code}-${cycleKey}`;
    const periodMonths = getPeriodMultiplier(
      billingPeriodKey(c.subscription_billing_period ?? c.billing_period),
    );
    const periodEnd = addMonthsToDateStr(npd, periodMonths);

    try {
      if (daysLate >= cfg.dormancyDay) {
        const { error: upErr } = await supabase
          .from('centers')
          .update({
            status: 'dormant',
            dormancy_date: todayCairoYmd,
            subscription_status: 'suspended',
            billing_status: 'suspended',
          })
          .eq('id', c.id)
          .in('status', ['active', 'suspended']);

        if (upErr) {
          result.errors.push(`${c.id} dormant: ${upErr.message}`);
          continue;
        }

        const pendingLate = await fetchPendingLateFeesForCycle(supabase, c.id, npd);
        await voidLateFees(
          supabase,
          pendingLate.map((x) => x.id),
        );

        await logAudit(supabase, c.id, 'center_marked_dormant', {
          next_payment_due: npd,
          days_overdue: daysLate,
          today: todayCairoYmd,
        });

        await sendDormancyNotice(supabase, c.id);

        result.dormantMarked++;
        continue;
      }

      if (daysLate >= cfg.tier2Day) {
        const pending = await fetchPendingLateFeesForCycle(supabase, c.id, npd);
        const tier2Exists = pending.some((row) => Number((row.metadata as LateFeeMeta)?.tier) === 2);
        if (tier2Exists) continue;

        const tier1Ids = pending
          .filter((row) => Number((row.metadata as LateFeeMeta)?.tier) === 1)
          .map((row) => row.id);
        await voidLateFees(supabase, tier1Ids);

        const rate = cfg.tier2Percent / 100;
        const feeAmt = Math.round(base * rate * 100) / 100;
        const total = Math.round((base + feeAmt + processingFee) * 100) / 100;

        const invNoTier2 = `${invNo}-10`;

        const { error: insErr } = await supabase.from('invoices').insert({
          center_id: c.id,
          invoice_number: invNoTier2,
          invoice_type: 'late_payment_fee',
          base_amount: base,
          total_amount: total,
          billing_period_start: npd,
          billing_period_end: periodEnd,
          due_date: todayCairoYmd,
          status: 'pending',
          discount_amount: 0,
          metadata: {
            cycle_anchor: npd,
            late_fee_rate: rate,
            late_fee_amount: feeAmt,
            days_overdue: daysLate,
            tier: 2,
            grace_period_end: addDaysToYmd(npd, cfg.graceDays),
            processing_fee: processingFee,
          } as LateFeeMeta,
        });

        if (insErr) {
          if (!/unique|duplicate/i.test(insErr.message)) {
            result.errors.push(`${c.id} late tier2: ${insErr.message}`);
          }
          continue;
        }

        await sendChqRenewalOverdueTemplate(supabase, {
          name: c.name ?? ',',
          phone: c.phone,
          daysLate: String(daysLate),
          amountStr: String(total),
        });

        result.lateFeeTier2++;
        continue;
      }

      if (daysLate >= cfg.tier1Day) {
        const pending = await fetchPendingLateFeesForCycle(supabase, c.id, npd);
        const hasAny = pending.length > 0;
        if (hasAny) continue;

        const rate = cfg.tier1Percent / 100;
        const feeAmt = Math.round(base * rate * 100) / 100;
        const total = Math.round((base + feeAmt + processingFee) * 100) / 100;

        const { error: insErr } = await supabase.from('invoices').insert({
          center_id: c.id,
          invoice_number: invNo,
          invoice_type: 'late_payment_fee',
          base_amount: base,
          total_amount: total,
          billing_period_start: npd,
          billing_period_end: periodEnd,
          due_date: todayCairoYmd,
          status: 'pending',
          discount_amount: 0,
          metadata: {
            cycle_anchor: npd,
            late_fee_rate: rate,
            late_fee_amount: feeAmt,
            days_overdue: daysLate,
            tier: 1,
            grace_period_end: addDaysToYmd(npd, cfg.graceDays),
            processing_fee: processingFee,
          } as LateFeeMeta,
        });

        if (insErr) {
          if (!/unique|duplicate/i.test(insErr.message)) {
            result.errors.push(`${c.id} late tier1: ${insErr.message}`);
          }
          continue;
        }

        await sendChqRenewalOverdueTemplate(supabase, {
          name: c.name ?? ',',
          phone: c.phone,
          daysLate: String(daysLate),
          amountStr: String(total),
        });

        result.lateFeeTier1++;
        continue;
      }

      if (daysLate <= cfg.graceDays) {
        /* grace - no invoice, no suspend from this block */
      }
    } catch (e) {
      result.errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
