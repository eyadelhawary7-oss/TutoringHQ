/**
 * Subscription billing cron steps (Items 1–4) - run at start of process-renewals.
 * Dates use Cairo calendar via todayISO() to align with next_payment_due storage.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { pauseCommissionClocks } from '@/lib/commissions';
import { todayISO } from '@/lib/parentPack';
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor';
import { sendChqRenewalOverdueTemplate } from '@/lib/centerNotify';
import { isPaygCenter } from '@/lib/billingEngine';

function calendarAddDays(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function centerCodeForInvoice(c: { center_code?: string | null; referral_code?: string | null; id: string }): string {
  const raw = (c.center_code || c.referral_code || '').trim();
  if (raw) return raw.replace(/\s+/g, '');
  return 'UNK';
}

function filterCentersWithPaymentDue<
  T extends {
    id: string;
    name?: string | null;
    next_payment_due?: string | null;
    billing_type?: string | null;
    pricing_type?: string | null;
  },
>(rows: T[] | null | undefined): { validCenters: T[]; skippedNullDue: number } {
  const raw = rows ?? [];
  const validCenters: T[] = [];
  for (const center of raw) {
    if (isPaygCenter(center)) {
      continue;
    }
    if (!center.next_payment_due) {
      console.warn(
        `[subscriptionBillingCron] Skipping center ${center.id}`,
        `(${center.name ?? ''}), next_payment_due is null`,
      );
      continue;
    }
    validCenters.push(center);
  }
  return { validCenters, skippedNullDue: raw.length - validCenters.length };
}

export type SubscriptionBillingCronResult = {
  staleBillingReset: number;
  invoicesCreated: number;
  centersDueIn7: number;
  dayPlus3Sent: number;
  dayPlus7Sent: number;
  autoSuspended: number;
};

export async function runSubscriptionBillingCron(
  supabase: SupabaseClient,
): Promise<SubscriptionBillingCronResult> {
  const cronStart = Date.now();
  let skippedNullDueTotal = 0;
  let subscriptionRowsProcessed = 0;

  const out: SubscriptionBillingCronResult = {
    staleBillingReset: 0,
    invoicesCreated: 0,
    centersDueIn7: 0,
    dayPlus3Sent: 0,
    dayPlus7Sent: 0,
    autoSuspended: 0,
  };

  const today = todayISO();

  // Centers with pending_cancellation: finalize cancel after current_period_end (Cairo YMD vs DATE column).
  const { error: periodEndCancelErr } = await supabase
    .from('centers')
    .update({
      status: 'cancelled',
      subscription_status: 'cancelled',
      billing_status: 'suspended',
    })
    .eq('status', 'pending_cancellation')
    .lt('current_period_end', today);
  if (periodEndCancelErr) {
    console.error('[subscriptionBillingCron] pending_cancellation period-end cancel:', periodEndCancelErr);
  }

  const { data: resetRows, error: resetErr } = await supabase
    .from('centers')
    .update({ billing_status: 'active' })
    .lte('next_payment_due', today)
    .eq('billing_status', 'paid')
    .in('status', ['active', 'pending_cancellation'])
    .not('status', 'in', '(cancelled,rejected)')
    .not('subscription_status', 'in', '(cancelled)')
    .select('id');

  if (resetErr) {
    console.error('[subscriptionBillingCron] stale billing reset:', resetErr);
  } else {
    out.staleBillingReset = resetRows?.length ?? 0;
  }

  const in7 = calendarAddDays(today, 7);
  const dueMinus3 = calendarAddDays(today, -3);
  const dueMinus7 = calendarAddDays(today, -7);

  const { data: dueIn7, error: q7err } = await supabase
    .from('centers')
    .select(
      'id, name, phone, next_payment_due, billing_amount, center_code, referral_code, status, billing_type, pricing_type',
    )
    .eq('next_payment_due', in7)
    .in('status', ['active', 'pending_cancellation'])
    .not('status', 'in', '(cancelled,rejected)')
    .not('subscription_status', 'in', '(cancelled)')
    .not('next_payment_due', 'is', null)
    .or('billing_type.is.null,billing_type.neq.payg')
    .or('pricing_type.is.null,pricing_type.neq.payg');

  if (q7err) {
    console.error('[subscriptionBillingCron] dueIn7:', q7err);
  } else {
    const { validCenters, skippedNullDue } = filterCentersWithPaymentDue(dueIn7);
    skippedNullDueTotal += skippedNullDue;
    out.centersDueIn7 = validCenters.length;
    subscriptionRowsProcessed += validCenters.length;
    for (const raw of validCenters) {
      const c = raw as {
        id: string;
        name: string;
        phone: string | null;
        next_payment_due: string;
        billing_amount: number | null;
        center_code?: string | null;
        referral_code?: string | null;
      };
      const npd = c.next_payment_due;

      const { data: existingInv } = await supabase
        .from('invoices')
        .select('id')
        .eq('center_id', c.id)
        .eq('invoice_type', 'subscription')
        .eq('billing_period_start', npd)
        .maybeSingle();
      if (existingInv) continue;

      const ba = Number(c.billing_amount ?? 0);
      const billingEnd = addMonthsToDateStr(npd, 3);
      const code = centerCodeForInvoice(c);
      const yyyymm = npd.slice(0, 7);
      const invoiceNumber = `INV-${code}-${yyyymm}`;

      const { error: invErr } = await supabase.from('invoices').insert({
        center_id: c.id,
        invoice_number: invoiceNumber,
        invoice_type: 'subscription',
        status: 'pending',
        total_amount: ba,
        base_amount: ba,
        billing_period_start: npd,
        billing_period_end: billingEnd,
        due_date: npd,
      });
      if (invErr) {
        console.error('[subscriptionBillingCron] invoice insert:', invErr);
        continue;
      }

      await supabase.from('renewal_reminders_sent').upsert(
        {
          center_id: c.id,
          stage: 'day_minus_7',
          sent_at: new Date().toISOString(),
          sent_month: today,
        },
        { onConflict: 'center_id,stage,sent_month', ignoreDuplicates: true },
      );

      await supabase
        .from('centers')
        .update({ renewal_reminder_sent_at: new Date().toISOString() })
        .eq('id', c.id);

      out.invoicesCreated += 1;
    }
  }

  const { data: plus3Rows, error: p3err } = await supabase
    .from('centers')
    .select('id, name, phone, next_payment_due, billing_amount, billing_status, billing_type, pricing_type')
    .eq('next_payment_due', dueMinus3)
    .in('status', ['active', 'pending_cancellation'])
    .not('status', 'in', '(cancelled,rejected)')
    .not('subscription_status', 'in', '(cancelled)')
    .neq('billing_status', 'paid')
    .not('next_payment_due', 'is', null)
    .or('billing_type.is.null,billing_type.neq.payg')
    .or('pricing_type.is.null,pricing_type.neq.payg');

  if (p3err) {
    console.error('[subscriptionBillingCron] day+3:', p3err);
  } else {
    const { validCenters, skippedNullDue } = filterCentersWithPaymentDue(plus3Rows);
    skippedNullDueTotal += skippedNullDue;
    subscriptionRowsProcessed += validCenters.length;
    for (const raw of validCenters) {
      const c = raw as {
        id: string;
        name: string;
        phone: string | null;
        next_payment_due: string;
        billing_amount: number | null;
      };
      const npd = c.next_payment_due;
      const thresholdDate = calendarAddDays(npd, -1);
      const thresholdIso = `${thresholdDate}T00:00:00.000Z`;

      const { data: dup } = await supabase
        .from('renewal_reminders_sent')
        .select('id')
        .eq('center_id', c.id)
        .eq('stage', 'day_plus_3')
        .gte('sent_at', thresholdIso)
        .limit(1)
        .maybeSingle();
      if (dup) continue;

      const waRes = await sendChqRenewalOverdueTemplate(supabase, {
        name: c.name,
        phone: c.phone,
        daysLate: '3',
        amountStr: String(c.billing_amount ?? 0),
      });
      if (!waRes.success) continue;

      await supabase.from('renewal_reminders_sent').upsert(
        {
          center_id: c.id,
          stage: 'day_plus_3',
          sent_at: new Date().toISOString(),
          sent_month: today,
        },
        { onConflict: 'center_id,stage,sent_month', ignoreDuplicates: true },
      );

      await supabase
        .from('centers')
        .update({ overdue_reminder_sent_at: new Date().toISOString() })
        .eq('id', c.id);

      out.dayPlus3Sent += 1;
    }
  }

  const { data: plus7Rows, error: p7err } = await supabase
    .from('centers')
    .select('id, name, phone, next_payment_due, billing_amount, billing_status, billing_type, pricing_type')
    .eq('next_payment_due', dueMinus7)
    .in('status', ['active', 'pending_cancellation'])
    .not('status', 'in', '(cancelled,rejected)')
    .not('subscription_status', 'in', '(cancelled)')
    .neq('billing_status', 'paid')
    .not('next_payment_due', 'is', null)
    .or('billing_type.is.null,billing_type.neq.payg')
    .or('pricing_type.is.null,pricing_type.neq.payg');

  if (p7err) {
    console.error('[subscriptionBillingCron] day+7:', p7err);
  } else {
    const { validCenters, skippedNullDue } = filterCentersWithPaymentDue(plus7Rows);
    skippedNullDueTotal += skippedNullDue;
    subscriptionRowsProcessed += validCenters.length;
    for (const raw of validCenters) {
      const c = raw as {
        id: string;
        name: string;
        phone: string | null;
        next_payment_due: string;
        billing_amount: number | null;
      };
      const npd = c.next_payment_due;
      const thresholdDate = calendarAddDays(npd, -1);
      const thresholdIso = `${thresholdDate}T00:00:00.000Z`;

      const { data: prereq } = await supabase
        .from('renewal_reminders_sent')
        .select('id')
        .eq('center_id', c.id)
        .eq('stage', 'day_plus_3')
        .gte('sent_at', thresholdIso)
        .limit(1)
        .maybeSingle();
      if (!prereq) continue;

      const { data: dup7 } = await supabase
        .from('renewal_reminders_sent')
        .select('id')
        .eq('center_id', c.id)
        .eq('stage', 'day_plus_7')
        .eq('sent_month', today)
        .maybeSingle();
      if (dup7) continue;

      const waRes = await sendChqRenewalOverdueTemplate(supabase, {
        name: c.name,
        phone: c.phone,
        daysLate: '7',
        amountStr: String(c.billing_amount ?? 0),
      });
      if (!waRes.success) continue;

      await supabase.from('renewal_reminders_sent').upsert(
        {
          center_id: c.id,
          stage: 'day_plus_7',
          sent_at: new Date().toISOString(),
          sent_month: today,
        },
        { onConflict: 'center_id,stage,sent_month', ignoreDuplicates: true },
      );

      out.dayPlus7Sent += 1;
    }
  }

  // Auto-suspend when auto_suspend_at falls on today. Grace is normally next_payment_due + N calendar days
  // (see platform_config.subscription_grace_period_days; billingSchedule.autoSuspendAtFromDue when writing centers).
  const tomorrow = calendarAddDays(today, 1);
  const { data: suspendRows, error: susErr } = await supabase
    .from('centers')
    .update({
      status: 'suspended',
      billing_status: 'suspended',
      subscription_status: 'suspended',
    })
    .gte('auto_suspend_at', `${today}T00:00:00.000Z`)
    .lt('auto_suspend_at', `${tomorrow}T00:00:00.000Z`)
    .neq('billing_status', 'paid')
    .neq('status', 'suspended')
    .not('status', 'in', '(cancelled,rejected)')
    .not('subscription_status', 'in', '(cancelled)')
    .select('id');

  if (susErr) {
    console.error('[subscriptionBillingCron] auto-suspend:', susErr);
  } else {
    out.autoSuspended = suspendRows?.length ?? 0;
    for (const row of suspendRows ?? []) {
      const center = row as { id: string };
      try {
        await pauseCommissionClocks(center.id);
      } catch (e) {
        console.error('[subscriptionBillingCron] pauseCommissionClocks', center.id, e);
      }
    }
  }

  try {
    await supabase.from('cron_log').insert({
      cron_name: 'subscription-billing-cron',
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: subscriptionRowsProcessed,
      metadata: {
        processed: subscriptionRowsProcessed,
        skipped_null_due: skippedNullDueTotal,
      },
    });
  } catch (logErr) {
    console.error('[subscriptionBillingCron] cron_log:', logErr);
  }

  return out;
}
