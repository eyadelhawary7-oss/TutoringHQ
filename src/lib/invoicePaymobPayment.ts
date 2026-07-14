import type { SupabaseClient } from '@supabase/supabase-js';
import { todayISO } from '@/lib/parentPack';
import { computeNextPaymentDue } from '@/lib/subscriptionAnchor';
import { centerRenewalPeriodMonths } from '@/lib/centerRenewal';
import { getAnnualChargeRounded, normalizeBillingPeriod } from '@/lib/pricing';
import { getIntervalConfig } from '@/lib/pricingConfig';
import { sendChqPaymentConfirmedTemplate, sendChqPaymentFailedTemplate } from '@/lib/centerNotify';
import { autoSuspendAtFromDue } from '@/lib/billingSchedule';
import { applyPaymentToInvoice, readAppliedTxns, remainingBalance } from '@/lib/invoiceBalance';
import { cairoDateKey, cairoYmdPlusDays, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { logBillingEvent, invoiceOwner } from '@/lib/billingAudit';
import * as Sentry from '@sentry/nextjs';
import {
  resolveScheduledCenterDowngrade,
  applyScheduledCenterDowngrade,
} from '@/lib/scheduledDowngrade';

// Non-subscription invoice types that legitimately reach the tail of
// finalizeInvoicePaymentSuccess. Settling one marks the invoice paid but must
// NOT advance the billing cycle or reactivate a suspended center (C2). Any type
// NOT in this set and not handled by an explicit branch above is unexpected and
// gets a Sentry warning so it can be given its own branch.
const KNOWN_NON_SUBSCRIPTION_TYPES: ReadonlySet<string> = new Set([
  'announcement_cap',
  'announcement_settlement',
  'setup_fee',
  'whatsapp_addon',
  'payment_proof',
]);

const QUARTERLY_LABEL_AR = 'ربع سنوي';
const MONTHLY_LABEL_AR = 'شهري';
const ANNUAL_LABEL_AR = 'سنوي';

async function handlePlanUpgradeInvoicePaid(
  supabaseAdmin: SupabaseClient,
  inv: { id: string; center_id: string; total_amount: number | string | null },
  paymobTransactionId: string,
): Promise<void> {
  const { data: pr } = await supabaseAdmin
    .from('plan_requests')
    .select('id, requested_plan')
    .eq('center_id', inv.center_id)
    .eq('status', 'pending_payment')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pr?.requested_plan) {
    console.error('[invoicePaymob] plan upgrade paid but no pending_payment request', inv.center_id);
    return;
  }

  const rp = pr.requested_plan as string;
  const { data: priceRow } = await supabaseAdmin
    .from('pricing_plans')
    .select('all_in_price')
    .eq('id', rp)
    .maybeSingle();

  const newAmt = Number((priceRow as { all_in_price?: number | null } | null)?.all_in_price);
  if (!Number.isFinite(newAmt) || newAmt <= 0) {
    console.error('[invoicePaymob] plan upgrade paid but invalid all_in_price', rp);
    return;
  }

  await supabaseAdmin
    .from('centers')
    .update({
      plan: rp,
      billing_amount: newAmt,
      all_in_price: newAmt,
      billing_status: 'paid',
    })
    .eq('id', inv.center_id);

  await supabaseAdmin
    .from('plan_requests')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', pr.id);

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('name, phone, billing_amount')
    .eq('id', inv.center_id)
    .maybeSingle();

  const c = center as { name?: string; phone?: string | null; billing_amount?: number | null } | null;
  try {
    await sendChqPaymentConfirmedTemplate(supabaseAdmin, {
      name: c?.name ?? ',',
      phone: c?.phone ?? null,
      billingPeriodLabel: QUARTERLY_LABEL_AR,
      billingAmountStr: String(c?.billing_amount ?? newAmt),
    });
  } catch (waErr) {
    console.error('[invoicePaymob] WA send error:', waErr);
  }
}

/**
 * Centre subscription invoice paid. The invoice mark-paid, the renewal_history
 * insert and the centers billing extension are committed together by
 * finalize_subscription_invoice_paid (one transaction) — a partial failure can
 * no longer leave the centre paid-but-not-extended. The WhatsApp confirmation is
 * sent only AFTER the atomic finalize succeeds.
 *
 * Returns 'completed' (this call finalized it), 'already_paid' (a concurrent
 * finalize won the race — no side-effects re-applied) or null (failure; the
 * invoice stays unpaid and the caller retries).
 */
async function handleSubscriptionInvoicePaid(
  supabaseAdmin: SupabaseClient,
  inv: { id: string; center_id: string; total_amount: number | string | null },
  paymobTransactionId: string,
  amountReceived: number,
  metadata: Record<string, unknown>,
): Promise<'completed' | 'already_paid' | null> {
  const { data: center } = await supabaseAdmin
    .from('centers')
    .select(
      'billing_status, status, subscription_status, next_payment_due, subscription_start_date, billing_cycle_start, approved_at, name, phone, billing_amount, billing_period, all_in_price, scheduled_plan, scheduled_billing_period',
    )
    .eq('id', inv.center_id)
    .maybeSingle();

  const c = center as {
    billing_status?: string | null;
    status?: string | null;
    subscription_status?: string | null;
    next_payment_due?: string | null;
    subscription_start_date?: string | null;
    billing_cycle_start?: string | null;
    approved_at?: string | null;
    name?: string | null;
    phone?: string | null;
    billing_amount?: number | null;
    billing_period?: string | null;
    all_in_price?: number | null;
    scheduled_plan?: string | null;
    scheduled_billing_period?: string | null;
  } | null;

  if (!c) return null;

  const wasSuspendedBilling = c.billing_status === 'suspended';
  // Period-aware renewal clock: annual advances the due date +12 months, monthly
  // advances +1 month (the standard non-annual cadence — the quarterly clock is
  // retired). centerRenewalPeriodMonths encodes the mapping.
  const isAnnual = normalizeBillingPeriod(c.billing_period) === 'annual';
  const newDue = computeNextPaymentDue(
    {
      next_payment_due: c.next_payment_due ?? null,
      subscription_start_date: c.subscription_start_date,
      billing_cycle_start: c.billing_cycle_start,
      approved_at: c.approved_at,
    },
    centerRenewalPeriodMonths(c.billing_period),
  );
  // Single-day lock: auto_suspend_at = next Cairo midnight after the new due date.
  const autoSus = autoSuspendAtFromDue(newDue);
  const totalAmt = Number(inv.total_amount ?? 0);
  const today = todayISO();

  const { data: res, error: rpcErr } = await supabaseAdmin.rpc('finalize_subscription_invoice_paid', {
    p_invoice_id: inv.id,
    p_center_id: inv.center_id,
    p_amount_received: amountReceived,
    p_txn_id: paymobTransactionId,
    p_metadata: metadata,
    p_total_amount: totalAmt,
    p_renewal_date: today,
    p_next_payment_due: newDue,
    p_auto_suspend_at: autoSus,
    p_last_payment_date: today,
    p_was_suspended: wasSuspendedBilling,
  });
  if (rpcErr) {
    console.error('[invoicePaymob] finalize_subscription_invoice_paid', rpcErr);
    return null;
  }
  const status = typeof res === 'string' ? res : String(res ?? '');

  // G1/G5: a scheduled downgrade LANDS exactly here — the renewal just rolled the
  // period, so the center flips to the lower plan now (never sooner) and the schedule
  // clears. The just-paid renewal invoice already billed the scheduled (lower) amount.
  // No credit, ever (G3/G4). Skipped on an idempotent already_paid replay.
  if (status !== 'already_paid' && c.scheduled_plan) {
    const sched = await resolveScheduledCenterDowngrade(
      supabaseAdmin,
      c.scheduled_plan,
      c.scheduled_billing_period,
    );
    if (sched) await applyScheduledCenterDowngrade(supabaseAdmin, inv.center_id, sched);
  }

  // Exactly-once paid confirmation. finalize_subscription_invoice_paid performs
  // the mark-paid transition atomically and returns 'already_paid' to every
  // caller that did NOT win that transition (concurrent webhook + status-poll, or
  // a retry). Sending the WhatsApp confirmation ONLY on the winning ('completed')
  // call ties the send to the single DB state-change — so exactly one confirm is
  // sent per invoice, backed by the atomic finalize rather than a soft time-window
  // dedupe. (Matches how auditInvoicePaid is gated in the sibling handlers below.)
  if (status !== 'already_paid') {
    try {
      // Annual renewals confirm with the annual label + annual base amount (monthly
      // × 10). Non-annual is monthly now (quarterly retired): the monthly label +
      // the stored monthly amount.
      let billingPeriodLabel = MONTHLY_LABEL_AR;
      let billingAmountStr = String(c.billing_amount ?? totalAmt);
      if (isAnnual) {
        const { annualMultiplier } = await getIntervalConfig();
        billingPeriodLabel = ANNUAL_LABEL_AR;
        billingAmountStr = String(getAnnualChargeRounded(Number(c.all_in_price ?? 0), annualMultiplier));
      }
      await sendChqPaymentConfirmedTemplate(supabaseAdmin, {
        name: c.name ?? ',',
        phone: c.phone ?? null,
        billingPeriodLabel,
        billingAmountStr,
      });
    } catch (waErr) {
      console.error('[invoicePaymob] WA send error:', waErr);
    }
  }

  return status === 'already_paid' ? 'already_paid' : 'completed';
}

async function handlePackBillingInvoicePaid(
  supabaseAdmin: SupabaseClient,
  inv: { center_id: string },
  _paymobTransactionId: string,
): Promise<void> {
  const { error: cErr } = await supabaseAdmin
    .from('centers')
    .update({
      pack_request_status: 'approved',
      parent_pack_enabled: true,
      pack_disabled_at: null,
    })
    .eq('id', inv.center_id);
  if (cErr) {
    console.error('[invoicePaymob] pack_billing center reinstate', cErr);
  }
}

/**
 * Mark invoice paid and extend center billing (subscription / plan upgrade / legacy).
 *
 * Underpayment-aware (Phase 5): when `opts.amountPaidEgp` is supplied (the amount
 * actually confirmed received in THIS transaction, e.g. from the Paymob webhook),
 * a payment that does not cover the full total is held as credit toward the SAME
 * invoice — the invoice stays unpaid (account stays locked), `amount_received` is
 * incremented, and only the remaining difference is left due. The invoice is
 * marked paid and the account unlocked ONLY once the cumulative received reaches
 * the total. When `amountPaidEgp` is omitted (MIT card charge / poll fallback,
 * which always charge the full amount), the payment is treated as covering the
 * full remaining balance — preserving prior behaviour.
 *
 * Idempotent at two layers: a transaction id already credited (tracked in
 * metadata.applied_txns) is never counted twice, and an already-paid invoice is a
 * no-op. Returns `settled` so callers (the status poll) can distinguish a
 * completing payment from a partial one.
 */
/**
 * Money-track conversion: a subscription's FIRST real payment creates/reprices the
 * owner's commission rows, flips T1 eligible, and resumes any paused clock. All three
 * are idempotent, so firing on every settle (webhook + autocharge + summer + teacher
 * finalizer) never double-creates or re-triggers. Wrapped so a commission-bookkeeping
 * failure can NEVER block the payment finalize (money-safety).
 */
async function runOwnerConversion(
  supabaseAdmin: SupabaseClient,
  ownerType: 'center' | 'teacher',
  ownerId: string,
): Promise<void> {
  try {
    const { createCommissionsForOwner, triggerT1EligibleForOwner, resumeCommissionClocks } = await import(
      '@/lib/commissions'
    );
    await createCommissionsForOwner(ownerType, ownerId);
    await triggerT1EligibleForOwner(ownerType, ownerId);
    if (ownerType === 'center') await resumeCommissionClocks(ownerId);
  } catch (e) {
    console.error('[finalizeInvoicePaymentSuccess] owner conversion (non-blocking)', ownerType, ownerId, e);
  }
}

export async function finalizeInvoicePaymentSuccess(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
  paymobTransactionId: string,
  opts?: { amountPaidEgp?: number },
): Promise<{ invoiceId: string; settled: boolean } | null> {
  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('id, owner_type, center_id, teacher_id, status, invoice_type, total_amount, amount_received, metadata')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  if (!inv) return null;

  const row = inv as {
    id: string;
    owner_type: string | null;
    center_id: string | null;
    teacher_id: string | null;
    status: string;
    invoice_type: string | null;
    total_amount: number | string | null;
    amount_received: number | string | null;
    metadata: Record<string, unknown> | null;
  };

  if (row.status === 'paid') {
    return { invoiceId: row.id, settled: true };
  }

  const total = Number(row.total_amount ?? 0);
  const received = Number(row.amount_received ?? 0);
  const appliedTxns = readAppliedTxns(row.metadata);
  // No explicit amount → MIT charge / poll fallback paid the full remaining.
  const amountPaid =
    opts?.amountPaidEgp != null && Number.isFinite(opts.amountPaidEgp)
      ? Number(opts.amountPaidEgp)
      : remainingBalance(total, received);

  const application = applyPaymentToInvoice({
    total,
    received,
    appliedTxns,
    txnId: paymobTransactionId,
    amountPaid,
  });

  // Duplicate transaction (e.g. webhook re-delivered) — nothing to do.
  if (application.alreadyApplied) {
    return { invoiceId: row.id, settled: application.settled };
  }

  const mergedMetadata = { ...(row.metadata ?? {}), applied_txns: application.appliedTxns };

  // Partial payment: hold the amount as credit toward THIS invoice. The invoice
  // stays unpaid, no second processing fee is ever added (the fee lives inside
  // total_amount), and the account stays locked until the remainder is paid.
  if (!application.settled) {
    const { error: partialErr } = await supabaseAdmin
      .from('invoices')
      .update({
        amount_received: application.newReceived,
        paymob_transaction_id: paymobTransactionId,
        metadata: mergedMetadata,
      })
      .eq('id', row.id)
      .neq('status', 'paid');
    if (partialErr) {
      console.error('[finalizeInvoicePaymentSuccess] partial credit', partialErr);
      return null;
    }
    const partialOwner = invoiceOwner(row);
    if (partialOwner) {
      await logBillingEvent(supabaseAdmin, 'invoice_payment_applied', partialOwner, {
        invoiceId: row.id,
        amountReceived: application.newReceived,
        amountApplied: amountPaid,
        transactionId: paymobTransactionId,
        settled: false,
      });
    }
    return { invoiceId: row.id, settled: false };
  }

  const paidColumns = {
    status: 'paid' as const,
    amount_received: application.newReceived,
    payment_method: 'paymob',
    payment_reference: paymobTransactionId,
    paymob_transaction_id: paymobTransactionId,
    paid_at: new Date().toISOString(),
    metadata: mergedMetadata,
  };

  // Append-only audit: the invoice is now paid (centers AND teachers). The
  // money-critical "payment applied + invoice marked paid" event the webhook,
  // cron and on-demand pay all funnel through. Emitted only on a fresh finalize,
  // never on an idempotent already-paid race.
  const paidOwner = invoiceOwner(row);
  const auditInvoicePaid = async () => {
    if (paidOwner) {
      await logBillingEvent(supabaseAdmin, 'invoice_paid', paidOwner, {
        invoiceId: row.id,
        amount: application.newReceived,
        invoiceType: row.invoice_type,
        transactionId: paymobTransactionId,
      });
    }
  };

  // Teacher invoices (owner_type='teacher'): mark paid AND advance the
  // subscription one month in ONE transaction (finalize_teacher_invoice_paid),
  // restoring private-engine access. Previously the invoice mark-paid and the
  // teacher_subscriptions advance were separate writes — a failure between them
  // left the teacher paid but without restored access, never retried.
  if (row.owner_type === 'teacher') {
    // Scale OVERAGE invoice: mark paid and advance the monthly overage tick ONLY.
    // It must never advance the base subscription period (the cycles are separate),
    // so it goes through a plain mark-paid, NOT finalize_teacher_invoice_paid.
    if (row.invoice_type === 'teacher_overage') {
      const { error: ovErr } = await supabaseAdmin.from('invoices').update(paidColumns).eq('id', row.id);
      if (ovErr) {
        console.error('[finalizeInvoicePaymentSuccess] overage invoice', ovErr);
        return null;
      }
      if (row.teacher_id) {
        const tomorrowTick = startOfUtcInstantForCairoCalendarDay(
          cairoYmdPlusDays(cairoDateKey(new Date()), 30),
        ).toISOString();
        await supabaseAdmin
          .from('teacher_subscriptions')
          .update({ overage_next_at: tomorrowTick })
          .eq('teacher_id', row.teacher_id);
      }
      await auditInvoicePaid();
      return { invoiceId: row.id, settled: true };
    }
    if (!row.teacher_id) {
      const { error: tInvErr } = await supabaseAdmin.from('invoices').update(paidColumns).eq('id', row.id);
      if (tInvErr) {
        console.error('[finalizeInvoicePaymentSuccess] teacher invoice', tInvErr);
        return null;
      }
      await auditInvoicePaid();
      return { invoiceId: row.id, settled: true };
    }
    const todayCairo = cairoDateKey(new Date());
    const periodStart = new Date().toISOString();
    // Annual subscriptions advance a full year; monthly advance 30 days. Reading
    // billing_interval keeps monthly behavior byte-identical (no annual rows yet).
    const { data: tSub } = await supabaseAdmin
      .from('teacher_subscriptions')
      .select('billing_interval, plan_key, overage_next_at')
      .eq('teacher_id', row.teacher_id)
      .maybeSingle();
    const subInfo = tSub as
      | { billing_interval?: string; plan_key?: string; overage_next_at?: string | null }
      | null;
    const periodDays = subInfo?.billing_interval === 'annual' ? 365 : 30;
    const periodEnd = startOfUtcInstantForCairoCalendarDay(
      cairoYmdPlusDays(todayCairo, periodDays),
    ).toISOString();
    const { data: tRes, error: tErr } = await supabaseAdmin.rpc('finalize_teacher_invoice_paid', {
      p_invoice_id: row.id,
      p_teacher_id: row.teacher_id,
      p_amount_received: application.newReceived,
      p_txn_id: paymobTransactionId,
      p_metadata: mergedMetadata,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    });
    if (tErr) {
      console.error('[finalizeInvoicePaymentSuccess] finalize_teacher_invoice_paid', tErr);
      return null;
    }
    // Scale: start the monthly overage tick on first paid base if not already set.
    // The tick runs every 30 days regardless of the base cadence (monthly or annual).
    if (subInfo?.plan_key === 'teacher_scale' && !subInfo.overage_next_at) {
      const firstTick = startOfUtcInstantForCairoCalendarDay(
        cairoYmdPlusDays(todayCairo, 30),
      ).toISOString();
      await supabaseAdmin
        .from('teacher_subscriptions')
        .update({ overage_next_at: firstTick })
        .eq('teacher_id', row.teacher_id);
    }
    if ((typeof tRes === 'string' ? tRes : String(tRes ?? '')) !== 'already_paid') {
      await auditInvoicePaid();
      // Teacher acquisition commission converts on her first paid subscription invoice.
      await runOwnerConversion(supabaseAdmin, 'teacher', row.teacher_id);
    }
    return { invoiceId: row.id, settled: true };
  }

  // From here the invoice is center-owned, so center_id is present.
  const centerRow = { id: row.id, center_id: String(row.center_id), total_amount: row.total_amount };

  // Centre subscription invoice: mark paid + renewal_history + centers billing in
  // ONE transaction (finalize_subscription_invoice_paid).
  if (row.invoice_type === 'subscription') {
    const subStatus = await handleSubscriptionInvoicePaid(
      supabaseAdmin,
      centerRow,
      paymobTransactionId,
      application.newReceived,
      mergedMetadata,
    );
    if (subStatus === null) return null;
    if (subStatus !== 'already_paid') {
      await auditInvoicePaid();
      // Center acquisition commission converts on the first paid subscription invoice.
      await runOwnerConversion(supabaseAdmin, 'center', centerRow.center_id);
    }
    return { invoiceId: row.id, settled: true };
  }

  // ---- Remaining invoice types: mark the invoice paid (standalone), audit, then
  // apply the type-specific side-effect. Each side-effect here is a single centre
  // write, independently idempotent on replay. ----
  const { error: invErr } = await supabaseAdmin.from('invoices').update(paidColumns).eq('id', row.id);
  if (invErr) {
    console.error('[finalizeInvoicePaymentSuccess] invoice', invErr);
    return null;
  }
  await auditInvoicePaid();

  if (row.invoice_type === 'plan_upgrade_difference') {
    await handlePlanUpgradeInvoicePaid(supabaseAdmin, centerRow, paymobTransactionId);
    return { invoiceId: row.id, settled: true };
  }

  if (row.invoice_type === 'pack_billing') {
    await handlePackBillingInvoicePaid(supabaseAdmin, centerRow, paymobTransactionId);
    return { invoiceId: row.id, settled: true };
  }

  if (row.invoice_type === 'late_payment_fee' || row.invoice_type === 'late_fee') {
    const paidDay = cairoDateKey(new Date()); // L9: Cairo calendar day, not UTC
    const { error: cErr } = await supabaseAdmin
      .from('centers')
      .update({
        billing_status: 'paid',
        last_payment_date: paidDay,
      })
      .eq('id', centerRow.center_id);
    if (cErr) {
      console.error('[finalizeInvoicePaymentSuccess] late_payment_fee center', cErr);
    }
    return { invoiceId: row.id, settled: true };
  }

  if (row.invoice_type === 'reactivation_fee') {
    const paidDay = cairoDateKey(new Date()); // L9: Cairo calendar day, not UTC
    const { error: cErr } = await supabaseAdmin
      .from('centers')
      .update({
        status: 'active',
        reactivation_date: paidDay,
        dormancy_date: null,
        billing_status: 'paid',
        subscription_status: 'active',
        last_payment_date: paidDay,
      })
      .eq('id', centerRow.center_id);
    if (cErr) {
      console.error('[finalizeInvoicePaymentSuccess] reactivation_fee center', cErr);
    }
    return { invoiceId: row.id, settled: true };
  }

  // Any invoice type reaching this point is NON-subscription
  // (announcement_cap, announcement_settlement, setup_fee, whatsapp_addon,
  // payment_proof, …). Every type that legitimately drives the billing cycle —
  // `subscription`, `signup_first_payment`, and the legacy `reactivation_fee` —
  // is handled by an explicit branch above and returns before here.
  //
  // The old fallback advanced `next_payment_due` by a full period AND flipped a
  // suspended center back to active for ANY unhandled type. That let a locked
  // center pay a small `announcement_settlement` and unlock a whole subscription
  // cycle for free (C2). Non-subscription invoices must NOT touch the center's
  // billing cadence or suspension state — the invoice was already marked paid
  // above (line ~478), which is the only correct side effect. Any genuinely new
  // subscription-cycle type must get its own explicit branch, not ride this
  // path.
  if (row.invoice_type && !KNOWN_NON_SUBSCRIPTION_TYPES.has(row.invoice_type)) {
    // A type we neither handle above nor recognize as non-subscription reached
    // the tail — surface it so it gets an explicit branch rather than silently
    // (and safely) settling with no cadence effect.
    Sentry.captureMessage(
      `finalizeInvoicePaymentSuccess: unhandled invoice_type '${row.invoice_type}' settled without cycle side-effect`,
      { level: 'warning' },
    );
  }

  return { invoiceId: row.id, settled: true };
}

export async function finalizeInvoicePaymentFailure(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
): Promise<void> {
  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('id, owner_type, center_id, teacher_id, status')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();
  const row = inv as Record<string, unknown> | null;

  await supabaseAdmin
    .from('invoices')
    .update({ status: 'failed' })
    .eq('paymob_order_id', paymobOrderId)
    .neq('status', 'paid');

  // Append-only audit (centers AND teachers); skip if it was already paid.
  if (row && row.status !== 'paid') {
    const owner = invoiceOwner(row);
    if (owner) {
      await logBillingEvent(supabaseAdmin, 'invoice_payment_failed', owner, {
        invoiceId: String(row.id),
      });
    }
  }
}

/**
 * After Paymob failure webhook: notify center for subscription invoices only (Session E).
 */
export async function notifySubscriptionInvoicePaymentFailed(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
  templateEnabled: boolean,
): Promise<void> {
  if (!templateEnabled || !paymobOrderId) return;

  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('invoice_type, center_id, total_amount')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  const row = inv as {
    invoice_type?: string | null;
    center_id?: string;
    total_amount?: number | string | null;
  } | null;
  if (!row?.center_id || row.invoice_type !== 'subscription') return;

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('name, phone')
    .eq('id', row.center_id)
    .maybeSingle();

  const c = center as { name?: string; phone?: string | null } | null;
  try {
    await sendChqPaymentFailedTemplate(supabaseAdmin, templateEnabled, {
      name: c?.name ?? ',',
      phone: c?.phone ?? null,
      amountStr: String(row.total_amount ?? ''),
    });
  } catch (waErr) {
    console.error('[invoicePaymob] WA send error:', waErr);
  }
}

/**
 * Paymob marks settled transactions with is_voided / is_refunded in the HMAC payload (chargeback / reversal).
 */
export async function finalizeInvoiceChargeback(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
  paymobTransactionId: string,
): Promise<void> {
  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('id, owner_type, center_id, teacher_id, status, total_amount')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  const row = inv as {
    id: string;
    owner_type?: string | null;
    center_id: string;
    teacher_id?: string | null;
    status: string;
    total_amount?: number | string;
  } | null;
  if (!row || row.status !== 'paid') return;

  await supabaseAdmin.from('invoices').update({ status: 'chargeback' }).eq('id', row.id);

  // Append-only audit (centers AND teachers): money reversed by the issuer.
  const cbOwner = invoiceOwner(row);
  if (cbOwner) {
    await logBillingEvent(supabaseAdmin, 'invoice_chargeback', cbOwner, {
      invoiceId: row.id,
      amount: row.total_amount ?? null,
      transactionId: paymobTransactionId,
    });

    // Reverse commission on a GENUINE chargeback (this path only — never on a
    // cancellation/blacklist). Owner-aware + full-tier (T1, T2, loyalty). Non-blocking:
    // a bookkeeping failure must never break the money reversal above.
    try {
      const { clawbackCommissionsForOwner } = await import('@/lib/commissions');
      await clawbackCommissionsForOwner(
        cbOwner.ownerType,
        cbOwner.ownerId,
        `chargeback: paymob txn ${paymobTransactionId}`,
      );
    } catch (e) {
      console.error('[finalizeInvoiceChargeback] commission clawback (non-blocking)', e);
    }
  }
  // Teacher chargeback has no center-suspension side effect; the audit + status
  // flip above still apply. Center side effects below run only for center owners.
  if (!row.center_id) return;

  await supabaseAdmin
    .from('centers')
    .update({
      status: 'suspended',
      billing_status: 'suspended',
      subscription_status: 'suspended',
    })
    .eq('id', row.center_id);

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('name')
    .eq('id', row.center_id)
    .maybeSingle();

  const name = (center as { name?: string } | null)?.name ?? ',';
  const ceoRaw = process.env.CEO_PHONE;
  if (!ceoRaw) return;

  const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
  const digits = ceoRaw.replace(/\D/g, '');
  if (!digits) return;

  const text = `Chargeback: ${name}, amount ${row.total_amount ?? ','} EGP, Paymob txn ${paymobTransactionId}`;
  await sendWhatsAppMessage(digits, text);
}
