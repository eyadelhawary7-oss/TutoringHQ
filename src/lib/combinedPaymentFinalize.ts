import type { SupabaseClient } from '@supabase/supabase-js';
import { todayISO } from '@/lib/parentPack';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import {
  anchorYmdFromCenter,
  autoSuspendAtFromDue,
  billingStepMonths,
  nextAnchorDueStrictlyAfter,
} from '@/lib/billingSchedule';
import { grantReferralReward } from '@/lib/teacherReferral';

export type CombinedSessionMetadata = {
  newPlan?: string;
  newBillingPeriod?: string;
  previousPlan?: string;
  previousBillingPeriod?: string;
  daysRemaining?: number;
  dailyRateDifference?: number;
  amountCharged?: number;
  switchCredit?: number;
  billingAnchorYmd?: string;
  /** Monthly→annual interval switch: resets the renewal clock to a fresh 12-month term. */
  intervalSwitchToAnnual?: boolean;
  freshTermEndYmd?: string | null;
};

function asMeta(raw: unknown): CombinedSessionMetadata {
  return raw && typeof raw === 'object' ? (raw as CombinedSessionMetadata) : {};
}

async function markSessionFailed(supabase: SupabaseClient, sessionId: string): Promise<void> {
  await supabase.from('combined_payment_sessions').update({ status: 'failed' }).eq('id', sessionId);
}

async function logFinalizeFailure(
  supabase: SupabaseClient,
  err: unknown,
  context: Record<string, unknown>,
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[combinedPayment]', msg, context);
  try {
    await supabase.from('cron_log').insert({
      cron_name: 'combined_payment_finalize',
      status: 'failure',
      error_message: msg.slice(0, 2000),
      metadata: context,
    });
  } catch (e) {
    console.error('[combinedPayment] cron_log insert failed', e);
  }
}

export async function reactivateCenterFromSession(
  supabase: SupabaseClient,
  centerId: string,
): Promise<void> {
  const { data: center } = await supabase
    .from('centers')
    .select(
      'next_payment_due, subscription_start_date, billing_cycle_start, approved_at, subscription_billing_period, billing_period',
    )
    .eq('id', centerId)
    .maybeSingle();

  const c = center as {
    next_payment_due?: string | null;
    subscription_start_date?: string | null;
    billing_cycle_start?: string | null;
    approved_at?: string | null;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
  } | null;

  if (!c) return;

  const today = todayISO();
  const anchor = anchorYmdFromCenter(c);
  const step = billingStepMonths(c.subscription_billing_period ?? c.billing_period);
  const existingDue = c.next_payment_due?.slice(0, 10);
  const nextDue =
    existingDue && existingDue > today
      ? existingDue
      : nextAnchorDueStrictlyAfter(anchor, step, today);

  const { error } = await supabase
    .from('centers')
    .update({
      status: 'active',
      subscription_status: 'active',
      billing_status: 'active',
      next_payment_due: nextDue,
      suspended_at: null,
      reactivation_tier: null,
      reactivation_fee_amount: 0,
      auto_suspend_at: autoSuspendAtFromDue(nextDue),
    })
    .eq('id', centerId);

  if (error) throw new Error(`reactivateCenterFromSession: ${error.message}`);
}

/**
 * Paymob success: finalize pending combined_payment_sessions row (upgrade / reactivation).
 * Pass session row id (not Paymob order id). Returns true if handled or idempotent skip; false on failure.
 */
export async function tryFinalizeCombinedPaymentSession(
  sessionId: string,
  supabase: SupabaseClient,
  source: 'webhook' | 'cron' | 'credits' = 'webhook',
  paymobTransactionId = '',
): Promise<boolean> {
  try {
    const { data: session } = await supabase
      .from('combined_payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return false;

    const row = session as {
      id: string;
      center_id: string;
      status: string;
      session_type: string;
      credit_amount: number | string | null;
      invoice_ids: string[] | null;
      paymob_order_id?: string | null;
      metadata?: unknown;
    };

    if (row.status === 'paid') return true;
    if (row.status !== 'pending') return false;

    const handled = new Set([
      'upgrade',
      'reactivation_tier1',
      'reactivation_tier2',
      'teacher_resubscribe',
      'teacher_upgrade',
    ]);
    if (!handled.has(row.session_type)) return false;

    const paymobOrderId = String(row.paymob_order_id ?? '');
    const st = row.session_type as string;

    const { data: lockResult, error: lockError } = await supabase.rpc('try_finalize_payment_session', {
      p_session_id: row.id,
      p_finalized_by: source,
    });
    if (lockError) {
      console.error('[combinedPayment] try_finalize_payment_session', lockError);
      return false;
    }
    if (!lockResult) {
      return true;
    }

    const meta = asMeta(row.metadata);
    let newPlan: string | undefined;
    let newBp: BillingPeriod | undefined;
    let pk: PlanKey | null = null;
    let allIn = 0;

    if (st === 'upgrade') {
      newPlan = meta.newPlan;
      const newPeriodRaw = meta.newBillingPeriod;
      if (!newPlan || !newPeriodRaw) {
        await markSessionFailed(supabase, row.id);
        return false;
      }
      // Quarterly is retired — a stale pre-fix session could still carry it in
      // its metadata; coerce so the centers write below can't violate the CHECKs.
      const sessionBp = normalizeBillingPeriod(newPeriodRaw) as BillingPeriod;
      newBp = sessionBp === 'annual' ? 'annual' : 'monthly';
      pk = isPlanKey(newPlan) ? newPlan : null;
      if (!pk) {
        await markSessionFailed(supabase, row.id);
        return false;
      }

      const { data: priceRow, error: priceErr } = await supabase
        .from('pricing_plans')
        .select('all_in_price, plan_key')
        .eq('plan_key', newPlan)
        .eq('is_active', true)
        .maybeSingle();

      if (priceErr) {
        await markSessionFailed(supabase, row.id);
        await logFinalizeFailure(supabase, priceErr, { sessionId: row.id, phase: 'pricing' });
        return false;
      }

      allIn = Number((priceRow as { all_in_price?: number } | null)?.all_in_price ?? 0);
      if (!Number.isFinite(allIn) || allIn <= 0) {
        await markSessionFailed(supabase, row.id);
        return false;
      }
    }

    // Fix C: the wallet credit is NO LONGER spent here. It is consumed
    // atomically with the session being marked paid, in
    // finalize_combined_session_paid (the final step below). That way a failure
    // in any of the non-money mutations that follow cannot leave the credit
    // consumed against a session that never finalized (the old "stuck with
    // credit gone" failure mode).
    const creditToSpend = Number(row.credit_amount ?? 0);

    if (st === 'upgrade' && newBp && pk && newPlan) {
      const billingAmount = getChargeFromQuarterlyAllIn(allIn, newBp, pk);

      // Fix C idempotency: if a prior attempt already applied this upgrade
      // (center mutated + upgrade_log written) and then failed at the final
      // money step, do NOT re-apply it on retry — that would double-count the
      // upgrade and duplicate the log row. Re-detect via the upgrade_log row
      // keyed by this Paymob order.
      let upgradeAlreadyApplied = false;
      if (paymobOrderId) {
        const { data: priorLog } = await supabase
          .from('upgrade_log')
          .select('id')
          .eq('center_id', row.center_id)
          .eq('paymob_order_id', paymobOrderId)
          .limit(1)
          .maybeSingle();
        upgradeAlreadyApplied = !!priorLog;
      }

      if (!upgradeAlreadyApplied) {
        const { data: centerBefore, error: cbErr } = await supabase
          .from('centers')
          .select('upgrade_count_this_period, next_payment_due')
          .eq('id', row.center_id)
          .maybeSingle();

        if (cbErr) {
          await markSessionFailed(supabase, row.id);
          await logFinalizeFailure(supabase, cbErr, { sessionId: row.id, phase: 'center_before' });
          return false;
        }

        const prevCount = Number(
          (centerBefore as { upgrade_count_this_period?: number } | null)?.upgrade_count_this_period ?? 0,
        );
        const anchorYmd =
          meta.billingAnchorYmd ??
          (centerBefore as { next_payment_due?: string | null } | null)?.next_payment_due?.slice(0, 10) ??
          todayISO();

        // Monthly→annual starts a FRESH 12-month term, so it resets next_payment_due
        // (rule 2 / G7 exception). A tier upgrade keeps the existing renewal date (G7),
        // so next_payment_due is left untouched in that case.
        //
        // DRAIN-ONLY: /api/billing/upgrade no longer mints sessions carrying
        // `intervalSwitchToAnnual` — interval changes moved to checkout, so this
        // branch exists purely to finalize sessions created BEFORE that change and
        // still pending. Do not add new writers. Remove once no pending
        // combined_payment_sessions row has metadata.intervalSwitchToAnnual = true.
        const intervalSwitchToAnnual = meta.intervalSwitchToAnnual === true;
        const centerUpdate: Record<string, unknown> = {
          plan: newPlan,
          // Each column keeps its own vocabulary: subscription_billing_period
          // CHECK allows {monthly, yearly}; billing_period allows {monthly, annual}.
          subscription_billing_period: newBp === 'annual' ? 'yearly' : 'monthly',
          billing_period: newBp,
          all_in_price: allIn,
          billing_amount: billingAmount,
          billing_status: 'paid',
          upgrade_count_this_period: prevCount + 1,
        };
        if (intervalSwitchToAnnual && typeof meta.freshTermEndYmd === 'string') {
          centerUpdate.next_payment_due = meta.freshTermEndYmd;
        }
        const { error: centerErr } = await supabase
          .from('centers')
          .update(centerUpdate)
          .eq('id', row.center_id);

        if (centerErr) {
          await markSessionFailed(supabase, row.id);
          await logFinalizeFailure(supabase, centerErr, { sessionId: row.id, phase: 'center_update' });
          return false;
        }

        const invIds = Array.isArray(row.invoice_ids) ? row.invoice_ids : [];
        for (const invId of invIds) {
          const { error: invErr } = await supabase
            .from('invoices')
            .update({
              status: 'paid',
              payment_method: 'paymob',
              payment_reference: paymobTransactionId,
              paymob_transaction_id: paymobTransactionId,
              paid_at: new Date().toISOString(),
            })
            .eq('id', invId)
            .eq('center_id', row.center_id);
          if (invErr) {
            await markSessionFailed(supabase, row.id);
            await logFinalizeFailure(supabase, invErr, { sessionId: row.id, phase: 'invoice_paid', invId });
            return false;
          }
        }

        const { error: logErr } = await supabase.from('upgrade_log').insert({
          center_id: row.center_id,
          previous_plan: meta.previousPlan ?? ',',
          new_plan: newPlan,
          previous_period: meta.previousBillingPeriod ?? 'quarterly',
          new_period: newBp,
          days_remaining: Math.max(0, Math.floor(Number(meta.daysRemaining ?? 0))),
          daily_rate_difference: Number(meta.dailyRateDifference ?? 0),
          amount_charged: Number(meta.amountCharged ?? 0),
          paymob_order_id: paymobOrderId || null,
          billing_anchor_unchanged: anchorYmd,
          upgrade_count_this_cycle: prevCount + 1,
        });
        if (logErr) {
          await markSessionFailed(supabase, row.id);
          await logFinalizeFailure(supabase, logErr, { sessionId: row.id, phase: 'upgrade_log' });
          return false;
        }
      }
    }

    if (st === 'reactivation_tier1' || st === 'reactivation_tier2') {
      try {
        await reactivateCenterFromSession(supabase, row.center_id);
      } catch (reactErr) {
        await markSessionFailed(supabase, row.id);
        await logFinalizeFailure(supabase, reactErr, { sessionId: row.id, phase: 'reactivate' });
        return false;
      }
    }

    // Teacher resubscribe (isolated from the center paths above): these
    // sessions carry no center_id; the teacher id rides in metadata because
    // combined_payment_sessions has no teacher_id column. Status moves through
    // apply_teacher_subscription_transition (the lifecycle guard blocks direct
    // status UPDATEs); the period/payment columns are plain updates.
    if (st === 'teacher_resubscribe') {
      const rawMeta =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const teacherId = typeof rawMeta.teacher_id === 'string' ? rawMeta.teacher_id : null;
      if (!teacherId) {
        await markSessionFailed(supabase, row.id);
        await logFinalizeFailure(
          supabase,
          new Error('teacher_resubscribe session has no metadata.teacher_id'),
          { sessionId: row.id, phase: 'teacher_resub_meta' },
        );
        return false;
      }

      const { data: subRow, error: subErr } = await supabase
        .from('teacher_subscriptions')
        .select('id, status')
        .eq('teacher_id', teacherId)
        .maybeSingle();
      if (subErr || !subRow) {
        await markSessionFailed(supabase, row.id);
        await logFinalizeFailure(
          supabase,
          subErr ?? new Error('teacher_subscriptions row not found'),
          { sessionId: row.id, phase: 'teacher_resub_sub_lookup', teacherId },
        );
        return false;
      }
      const sub = subRow as { id: string; status: string };

      if (sub.status !== 'active') {
        const { error: trErr } = await supabase.rpc('apply_teacher_subscription_transition', {
          p_subscription_id: sub.id,
          p_new_status: 'active',
          p_actor_id: teacherId,
        });
        if (trErr) {
          await markSessionFailed(supabase, row.id);
          await logFinalizeFailure(supabase, trErr, {
            sessionId: row.id,
            phase: 'teacher_resub_transition',
            teacherId,
          });
          return false;
        }
      }

      // Annual term covers 12 months; monthly covers one. The interval rides in
      // the session metadata (set by the resubscribe checkout) and is persisted
      // on the subscription so the recurring engine renews on the same cadence.
      const billingInterval = rawMeta.billing_interval === 'annual' ? 'annual' : 'monthly';
      const periodDays = billingInterval === 'annual' ? 365 : 30;
      const nowIso = new Date().toISOString();
      const periodEndIso = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString();
      const { error: periodErr } = await supabase
        .from('teacher_subscriptions')
        .update({
          billing_interval: billingInterval,
          current_period_start: nowIso,
          current_period_end: periodEndIso,
          next_billing_at: periodEndIso,
          last_payment_at: nowIso,
          grace_until: null,
          dunning_attempts: 0,
        })
        .eq('id', sub.id);
      if (periodErr) {
        await markSessionFailed(supabase, row.id);
        await logFinalizeFailure(supabase, periodErr, {
          sessionId: row.id,
          phase: 'teacher_resub_period',
          teacherId,
        });
        return false;
      }

      const { error: auditErr } = await supabase.from('audit_log').insert({
        action: 'teacher_subscription_reactivated',
        entity_type: 'teacher_subscription',
        entity_id: sub.id,
        user_id: teacherId,
        center_id: null,
        details: {
          session_id: row.id,
          paymob_order_id: paymobOrderId || null,
          paymob_transaction_id: paymobTransactionId || null,
        },
      });
      if (auditErr) {
        // The reactivation itself succeeded - log, do not fail the finalize.
        await logFinalizeFailure(supabase, auditErr, {
          sessionId: row.id,
          phase: 'teacher_resub_audit',
          teacherId,
        });
      }

      // ITEM 4 referral grant: this is a cleared charge. grantReferralReward is
      // idempotent (the referral_rewarded_at marker fires it at most once per
      // referee, ever), so re-delivered webhooks / later charges never re-grant.
      // Non-fatal: the payment already succeeded.
      try {
        await grantReferralReward(supabase, teacherId);
      } catch (rewardErr) {
        await logFinalizeFailure(supabase, rewardErr, {
          sessionId: row.id,
          phase: 'teacher_resub_referral_reward',
          teacherId,
        });
      }
    }

    // Teacher upgrade (Standard -> Pro). Like teacher_resubscribe, these
    // sessions carry no center_id; the teacher id rides in metadata. The
    // money/status transition is owned entirely by upgrade_teacher_to_pro (a
    // SECURITY DEFINER RPC, idempotent on replay) - no direct table writes here.
    if (st === 'teacher_upgrade') {
      const rawMeta =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const teacherId = typeof rawMeta.teacher_id === 'string' ? rawMeta.teacher_id : null;
      if (!teacherId) {
        await markSessionFailed(supabase, row.id);
        await logFinalizeFailure(
          supabase,
          new Error('teacher_upgrade session has no metadata.teacher_id'),
          { sessionId: row.id, phase: 'teacher_upgrade_meta' },
        );
        return false;
      }

      const { error: upErr } = await supabase.rpc('upgrade_teacher_to_pro', {
        p_user_id: teacherId,
      });
      if (upErr) {
        await markSessionFailed(supabase, row.id);
        await logFinalizeFailure(supabase, upErr, {
          sessionId: row.id,
          phase: 'teacher_upgrade_rpc',
          teacherId,
        });
        return false;
      }

      // Trialing→Pro paid the FULL Pro price, so it starts a fresh paid Pro month.
      // An ACTIVE upgrade paid only the prorated difference and KEEPS its renewal
      // date (G7) — the RPC no longer resets the period, so there is nothing to do.
      if (rawMeta.freshProPeriod === true) {
        const nowIso = new Date().toISOString();
        const periodEndIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const { error: periodErr } = await supabase
          .from('teacher_subscriptions')
          .update({
            current_period_start: nowIso,
            current_period_end: periodEndIso,
            next_billing_at: periodEndIso,
          })
          .eq('teacher_id', teacherId);
        if (periodErr) {
          await logFinalizeFailure(supabase, periodErr, {
            sessionId: row.id,
            phase: 'teacher_upgrade_fresh_period',
            teacherId,
          });
        }
      }

      const { error: auditErr } = await supabase.from('audit_log').insert({
        action: 'teacher_upgrade_session_finalized',
        entity_type: 'teacher_subscription',
        entity_id: null,
        user_id: teacherId,
        center_id: null,
        details: {
          session_id: row.id,
          paymob_order_id: paymobOrderId || null,
          paymob_transaction_id: paymobTransactionId || null,
        },
      });
      if (auditErr) {
        // The upgrade itself succeeded (RPC also audits) - log, do not fail.
        await logFinalizeFailure(supabase, auditErr, {
          sessionId: row.id,
          phase: 'teacher_upgrade_audit',
          teacherId,
        });
      }

      // ITEM 4 referral grant: a cleared charge. Idempotent via the
      // referral_rewarded_at marker (at most once per referee). Non-fatal.
      try {
        await grantReferralReward(supabase, teacherId);
      } catch (rewardErr) {
        await logFinalizeFailure(supabase, rewardErr, {
          sessionId: row.id,
          phase: 'teacher_upgrade_referral_reward',
          teacherId,
        });
      }
    }

    // Fix C: final atomic money step — spend the wallet credit (if any) AND mark
    // the session paid + finalized in ONE transaction. If the credit spend
    // raises (e.g. insufficient credit), the DB rolls it all back: no credit
    // consumed, status unchanged, finalized_at still NULL, so the stuck-payment
    // cron can recover it. This is the ONLY place finalized_at is ever set.
    const { data: finalizeResult, error: finalizeErr } = await supabase.rpc(
      'finalize_combined_session_paid',
      {
        p_session_id: row.id,
        p_credit_amount: creditToSpend,
        p_finalized_by: source,
      },
    );

    if (finalizeErr) {
      await markSessionFailed(supabase, row.id);
      await logFinalizeFailure(supabase, finalizeErr, { sessionId: row.id, phase: 'finalize_atomic' });
      return false;
    }

    const finalizeStatus =
      typeof finalizeResult === 'string' ? finalizeResult : String(finalizeResult ?? '');
    if (finalizeStatus !== 'completed' && finalizeStatus !== 'already_done') {
      await markSessionFailed(supabase, row.id);
      await logFinalizeFailure(
        supabase,
        new Error(`finalize_combined_session_paid returned ${finalizeStatus}`),
        { sessionId: row.id, phase: 'finalize_atomic_status' },
      );
      return false;
    }

    return true;
  } catch (e) {
    await logFinalizeFailure(supabase, e, { sessionId });
    return false;
  }
}
