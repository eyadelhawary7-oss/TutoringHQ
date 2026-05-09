/**
 * PAYG month-end billing (last Cairo calendar day) + apply scheduled PAYG switches.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { todayISO, dateInNDays } from '@/lib/parentPack';
import { calculatePaygBill, isLastDayOfMonthCairo } from '@/lib/paygBilling';
import { isPaygCenter } from '@/lib/billingEngine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function ymdAddDays(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function lastDayOfMonthYmd(y: number, month1to12: number): string {
  const last = new Date(y, month1to12, 0).getDate();
  return `${y}-${String(month1to12).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function lastDayOfNextMonthFromYmd(ymd: string): string {
  const [y, m] = ymd.split('-').map((x) => parseInt(x, 10));
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return lastDayOfMonthYmd(nextY, nextM);
}

function centerCodeForPayg(c: { center_code?: string | null; referral_code?: string | null; id: string }): string {
  const raw = (c.center_code || c.referral_code || '').trim();
  if (raw) return raw.replace(/\s+/g, '');
  return 'UNK';
}

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'payg-billing';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  if (!isLastDayOfMonthCairo()) {
    const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const t = ymdAddDays(s, 1);
    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'payg-billing',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[payg-billing] cron_health_log:', healthLogErr);
    }
    return NextResponse.json({
      skipped: 'not last day of month',
      cairoToday: s,
      cairoTomorrow: t,
    });
  }

  const today = todayISO();
  const billingMonth = today.slice(0, 7);
  const periodStart = `${billingMonth}-01`;
  const periodEnd = today;
  const tomorrow = ymdAddDays(today, 1);

  try {
    const { data: paygCenters, error: fetchErr } = await supabase
      .from('centers')
      .select(
        `id, name, center_code, referral_code, billing_type, pricing_type,
        subscription_status, billing_status, plan, all_in_price`,
      )
      .eq('subscription_status', 'active')
      .in('status', ['active', 'pending_cancellation']);

    if (fetchErr) {
      throw new Error(fetchErr.message);
    }

    const list = (paygCenters ?? []).filter((row) =>
      isPaygCenter(row as { billing_type?: string | null; pricing_type?: string | null }),
    );

    let billed = 0;
    let skipped = 0;
    let errors = 0;

    for (const center of list) {
      const c = center as {
        id: string;
        name?: string;
        center_code?: string | null;
        referral_code?: string | null;
        plan?: string | null;
        all_in_price?: number | null;
      };
      try {
        const { count: activeStudentCount, error: cntErr } = await supabase
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('center_id', c.id)
          .eq('is_active', true);

        if (cntErr) {
          console.error('[payg-billing] student count', c.id, cntErr);
          errors += 1;
          continue;
        }

        const studentCount = Number(activeStudentCount ?? 0);

        if (studentCount === 0) {
          skipped += 1;
          continue;
        }

        const { cappedAmount, tier, rawAmount, isCapped, capAmount } = calculatePaygBill(studentCount);
        const code = centerCodeForPayg(c);
        const invoiceNumber = `PAYG-${code}-${billingMonth}`;

        const { data: existing } = await supabase
          .from('invoices')
          .select('id')
          .eq('invoice_number', invoiceNumber)
          .maybeSingle();

        if (existing) {
          skipped += 1;
          continue;
        }

        const dueYmd = dateInNDays(7);

        const { error: invErr } = await supabase.from('invoices').insert({
          center_id: c.id,
          invoice_number: invoiceNumber,
          invoice_type: 'subscription',
          base_amount: cappedAmount,
          total_amount: cappedAmount,
          billing_period_start: periodStart,
          billing_period_end: periodEnd,
          due_date: dueYmd,
          status: 'pending',
          metadata: {
            payg_rate: tier.ratePerStudent,
            student_count: studentCount,
            tier_plan: tier.plan,
            raw_amount: rawAmount,
            is_capped: isCapped,
            cap_amount: capAmount,
            billing_month: billingMonth,
          },
        });

        if (invErr) {
          console.error('[payg-billing] invoice', c.id, invErr);
          errors += 1;
          continue;
        }

        const nextPaymentDue = lastDayOfNextMonthFromYmd(today);
        const autoSuspendAt = ymdAddDays(nextPaymentDue, 6);

        const { error: upErr } = await supabase
          .from('centers')
          .update({
            billing_amount: cappedAmount,
            billing_status: 'due_soon',
            next_payment_due: nextPaymentDue,
            auto_suspend_at: `${autoSuspendAt}T00:00:00.000Z`,
            plan: tier.plan,
          })
          .eq('id', c.id);

        if (upErr) {
          console.error('[payg-billing] center update', c.id, upErr);
          errors += 1;
          continue;
        }

        billed += 1;
      } catch (err) {
        console.error(`[payg-billing] Error for ${c.id}:`, err);
        errors += 1;
      }
    }

    const { data: pendingSwitches, error: swErr } = await supabase
      .from('centers')
      .select('id, payg_pending_switch, payg_pending_target_period, billing_period, subscription_billing_period')
      .not('payg_pending_switch', 'is', null)
      .eq('payg_switch_effective_date', tomorrow);

    if (swErr) {
      console.error('[payg-billing] pending switches', swErr);
    }

    let switchesProcessed = 0;
    for (const row of pendingSwitches ?? []) {
      const sw = row as {
        id: string;
        payg_pending_switch?: string | null;
        payg_pending_target_period?: string | null;
      };
      if (sw.payg_pending_switch === 'to_payg') {
        const { error } = await supabase
          .from('centers')
          .update({
            billing_type: 'payg',
            pricing_type: 'payg',
            payg_pending_switch: null,
            payg_switch_effective_date: null,
            payg_pending_target_period: null,
          })
          .eq('id', sw.id);
        if (!error) switchesProcessed += 1;
      } else if (sw.payg_pending_switch === 'from_payg') {
        const period = (sw.payg_pending_target_period || 'quarterly').toLowerCase();
        const { error } = await supabase
          .from('centers')
          .update({
            billing_type: 'fixed',
            pricing_type: 'fixed',
            subscription_billing_period: period,
            billing_period: period,
            payg_pending_switch: null,
            payg_switch_effective_date: null,
            payg_pending_target_period: null,
          })
          .eq('id', sw.id);
        if (!error) switchesProcessed += 1;
      }
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: billed,
      metadata: {
        billingMonth,
        billed,
        skipped,
        errors,
        switchesProcessed,
        pendingSwitchRows: pendingSwitches?.length ?? 0,
      },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'payg-billing',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[payg-billing] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({
      success: true,
      billed,
      skipped,
      errors,
      switchesProcessed,
      billingMonth,
    });
  } catch (error) {
    console.error(`[${CRON_NAME}]`, error);
    try {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown',
      });
    } catch (logErr) {
      console.error(`[${CRON_NAME}] cron_log`, logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
