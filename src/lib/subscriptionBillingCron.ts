/**
 * Subscription billing cron steps (Items 1–4) - run at start of process-renewals.
 * Dates use Cairo calendar via todayISO() to align with next_payment_due storage.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { pauseCommissionClocks } from '@/lib/commissions';
import { todayISO } from '@/lib/parentPack';
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor';
import { sendChqRenewalOverdueTemplate } from '@/lib/centerNotify';
import { getProcessingFeeConfig, getIntervalConfig } from '@/lib/pricingConfig';
import { applyProcessingFee, buildInvoiceTaxSnapshot } from '@/lib/processingFee';
import { logBillingEvent } from '@/lib/billingAudit';
import { resolveScheduledCenterPlanChange } from '@/lib/scheduledPlanChange';
import { centerRenewalBaseAmount, centerRenewalPeriodMonths } from '@/lib/centerRenewal';
import { requireTopCentersAllInPrice } from '@/lib/pricing/topCentersPrice';
import { createAction } from '@/lib/ceo';
import * as Sentry from '@sentry/nextjs';

// RETIRED: the legacy day+3 / day+7 overdue WhatsApp reminders below. The unified
// billing-nudges engine (src/lib/nudges) is now the single source of center +
// teacher dunning (pre-billing, due-today/grace, post-lock). Invoice creation and
// auto-suspend in this cron are unaffected — only the reminder SENDS are gated off.
const LEGACY_CENTER_OVERDUE_REMINDERS = false;

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
  // Flat processing fee (Section 5) added to each subscription renewal invoice.
  const feeCfg = await getProcessingFeeConfig();
  // Annual centers renew at monthly × annualMultiplier (=10) over a 12-month clock.
  // Read once per run; only consulted for billing_period='annual' centers.
  const { annualMultiplier } = await getIntervalConfig();

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

  // B-H3: create the renewal invoice for any center due on OR BEFORE today+7 that
  // has no invoice yet for that period — not only the ones due EXACTLY today+7.
  // The old `.eq(next_payment_due, in7)` was a one-shot window: a single missed
  // cron day (deploy/outage) meant the invoice was never created, so the center
  // got locked with nothing payable on /pay. `.lte` + the per-period existence
  // check below (billing_period_start) make creation idempotent and self-healing.
  const { data: dueIn7, error: q7err } = await supabase
    .from('centers')
    .select(
      'id, name, phone, next_payment_due, billing_amount, billing_period, all_in_price, plan, center_code, referral_code, status, billing_type, pricing_type, scheduled_plan, scheduled_billing_period',
    )
    .lte('next_payment_due', in7)
    .in('status', ['active', 'pending_cancellation'])
    .not('status', 'in', '(cancelled,rejected)')
    .not('subscription_status', 'in', '(cancelled)')
    .not('next_payment_due', 'is', null);

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
        billing_period?: string | null;
        all_in_price?: number | null;
        plan?: string | null;
        center_code?: string | null;
        referral_code?: string | null;
        scheduled_plan?: string | null;
        scheduled_billing_period?: string | null;
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

      // A scheduled plan change lands at this renewal: bill the NEW plan's amount
      // for the upcoming period — direction-agnostic, so this also covers a
      // day-zero upgrade whose renewal invoice the cron creates before the
      // request ever reaches it. The plan fields flip when this invoice is paid
      // (handleSubscriptionInvoicePaid), so access stays on the current plan
      // until then (G5).
      const sched = await resolveScheduledCenterPlanChange(
        supabase,
        c.scheduled_plan,
        c.scheduled_billing_period,
      );

      // B-H4: top_centers is custom-priced from centers.all_in_price (the source
      // of truth). Without this guard a top_centers center with a NULL/invalid
      // all_in_price renews for `getAnnualChargeRounded(0) = 0` (+ the flat fee) —
      // a silent 0 EGP invoice. Mirror the pack-billing guard: skip the center and
      // enqueue a red CEO action rather than bill nothing. A scheduled downgrade
      // already resolves a concrete per-month base, so it is exempt.
      if (!sched && c.plan === 'top_centers') {
        try {
          requireTopCentersAllInPrice(c.all_in_price, 'subscriptionBillingCron.renewal');
        } catch {
          try {
            await createAction(supabase, {
              type: 'billing_blocked',
              priority: 'red',
              center_id: c.id,
              title: `Renewal skipped, ${c.name}`,
              subtitle: JSON.stringify({
                centerId: c.id,
                reason: 'top_centers plan missing all_in_price',
                nextPaymentDue: npd,
              }),
              revenue_at_risk: 0,
              auto_generated: true,
            });
          } catch (e) {
            console.error('[subscriptionBillingCron] ceo_action_queue billing_blocked:', e);
          }
          console.warn(
            `[subscriptionBillingCron] Skipping top_centers ${c.id}`,
            ', all_in_price is null or 0',
          );
          continue;
        }
      }
      // Period-aware renewal: annual bills monthly × 10 over a 12-month clock;
      // monthly bills the stored monthly amount over a 1-month clock (the standard
      // non-annual cadence — the quarterly clock is retired). A scheduled plan
      // change supplies its own period-aware amount/period/per-month base
      // (resolveScheduledCenterPlanChange), whichever direction it goes.
      const effectivePeriod = sched ? sched.billingPeriod : c.billing_period;
      const ba = centerRenewalBaseAmount({
        billingPeriod: effectivePeriod,
        allInPerMonth: sched ? sched.allIn : c.all_in_price,
        storedBillingAmount: sched ? sched.billingAmount : c.billing_amount,
        annualMultiplier,
      });
      const { fee, total } = applyProcessingFee(ba, feeCfg);
      const billingEnd = addMonthsToDateStr(npd, centerRenewalPeriodMonths(effectivePeriod));
      const code = centerCodeForInvoice(c);
      const yyyymm = npd.slice(0, 7);
      const invoiceNumber = `INV-${code}-${yyyymm}`;

      const { error: invErr } = await supabase.from('invoices').insert({
        center_id: c.id,
        invoice_number: invoiceNumber,
        invoice_type: 'subscription',
        status: 'pending',
        total_amount: total,
        base_amount: ba,
        ...buildInvoiceTaxSnapshot({ total, fee }),
        billing_period_start: npd,
        billing_period_end: billingEnd,
        due_date: npd,
        metadata: { processing_fee: fee },
      });
      if (invErr) {
        console.error('[subscriptionBillingCron] invoice insert:', invErr);
        continue;
      }

      await logBillingEvent(supabase, 'invoice_created', { ownerType: 'center', ownerId: c.id }, {
        invoiceNumber,
        invoiceType: 'subscription',
        total,
        dueDate: npd,
      });

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
    .not('next_payment_due', 'is', null);

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

      const waRes = LEGACY_CENTER_OVERDUE_REMINDERS
        ? await sendChqRenewalOverdueTemplate(supabase, {
            name: c.name,
            phone: c.phone,
            daysLate: '3',
            amountStr: String(c.billing_amount ?? 0),
          })
        : { success: false };
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
    .not('next_payment_due', 'is', null);

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

      const waRes = LEGACY_CENTER_OVERDUE_REMINDERS
        ? await sendChqRenewalOverdueTemplate(supabase, {
            name: c.name,
            phone: c.phone,
            daysLate: '7',
            amountStr: String(c.billing_amount ?? 0),
          })
        : { success: false };
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

  // B-H2: suspend on the single-day lock model, keyed off next_payment_due — NOT
  // the stored auto_suspend_at. auto_suspend_at is a DATE column and
  // lockAtFromBillingDay writes it as the 00:00-Cairo instant of due+1, whose
  // UTC date part truncates to the due DAY. The old `auto_suspend_at == today`
  // window therefore locked centers a day EARLY (mid-morning of their due day,
  // when they should keep full access until the next Cairo midnight) AND, being
  // an exact same-day match, never caught up a row whose day was missed.
  //
  // A center is locked once the Cairo day is strictly AFTER its billing day
  // (resolveBillingAccess: locked when todayCairo > billingDay). So suspend every
  // still-active row whose next_payment_due is before today (Cairo) and is unpaid.
  // `.lt` (not an exact match) self-heals missed cron days. `today` is Cairo
  // (todayISO), aligned with the next_payment_due DATE storage.
  // PR A interlock (minimal, inline). While the saved-card recurring credential is
  // not a real value, merchant-initiated auto-charge cannot run (the engine is inert),
  // so a center that missed its charge has had no automated way to pay. Suspending it
  // then is exactly the "paywall while auto-charge is inert" outage the billing lockout
  // interlock exists to prevent, so skip the auto-suspend entirely in that state.
  //
  // Semantics must match PR B's shared module: unset, empty, or the literal
  // "placeholder" all mean NOT configured; any other non-empty value reads as
  // configured (presence check only, not proof the credential can actually charge).
  //
  // TEMPORARY: PR B introduces billingLockoutPolicy.recurringAutochargeConfigured().
  // Replace this inline check with that import once B lands. Do NOT grow a second
  // policy module here.
  const recurringRaw = process.env.PAYMOB_RECURRING_INTEGRATION_ID;
  const recurringNorm = recurringRaw == null ? '' : recurringRaw.trim().toLowerCase();
  const recurringConfigured = recurringNorm !== '' && recurringNorm !== 'placeholder';

  if (!recurringConfigured) {
    console.warn(
      '[subscriptionBillingCron] auto-suspend SKIPPED: PAYMOB_RECURRING_INTEGRATION_ID ' +
        'is unset/empty/placeholder, so saved-card auto-charge cannot run. Suspending ' +
        'unpaid centers now would paywall them while the charge engine is inert. ' +
        'No center suspended.',
    );
    Sentry.withScope((scope) => {
      scope.setTag('cron', 'subscription-billing-cron');
      scope.setTag('step', 'auto_suspend_interlock');
      scope.setTag('reason', 'autocharge_not_configured');
      scope.setLevel('warning');
      Sentry.captureMessage(
        'subscriptionBillingCron auto-suspend suppressed by the auto-charge interlock: ' +
          'PAYMOB_RECURRING_INTEGRATION_ID is still a placeholder, so nothing can charge a ' +
          'saved card. No center was suspended. Set the real recurring credential to ' +
          're-enable nonpayment suspension.',
      );
    });
  } else {
    const { data: suspendRows, error: susErr } = await supabase
      .from('centers')
      .update({
        status: 'suspended',
        billing_status: 'suspended',
        subscription_status: 'suspended',
      })
      .lt('next_payment_due', today)
      .not('next_payment_due', 'is', null)
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
