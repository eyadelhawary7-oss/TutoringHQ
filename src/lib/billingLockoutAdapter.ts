// src/lib/billingLockoutAdapter.ts
//
// Supabase adapter for the single-day lockout tick (Job 3, Part 2). Wires the pure
// scheduler (billingLockout.ts) to live data and the existing, verified primitives:
//   - retries   -> chargeSavedCard (the Phase 1 saved-card engine; inert until
//                  PAYMOB_RECURRING_INTEGRATION_ID is real).
//   - nudges     -> sendTemplateMessage (self-gates: no-op until the templates are
//                  Meta-approved AND WhatsApp sending is enabled).
//   - lock       -> records the lock event only. The centre paywall is enforced
//                  LIVE by centerIsLockedNow / isCenterLockedForEnforcement (gated
//                  by the interlock), and the teacher free-tier drop is enforced
//                  live by teacher_private_access; neither needs a bulk write here.
//
// Idempotency for the one-shot phases (invoice_nudge / reminder2 / lock) is the
// unique index on billing_lockout_events; a same-day re-run inserts nothing new.
//
// The cron confirms the lockout policy is ACTIVE before this adapter is ever built,
// so none of these methods re-check the interlock.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { cairoDateKey, getCurrentCairoClock } from '@/lib/cairo/day';
import { chargeSavedCard } from '@/lib/savedCard/autoCharge';
import { createSupabaseSavedCardStore } from '@/lib/savedCard/store';
import { paymobRecurringClient } from '@/lib/savedCard/paymobRecurring';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import {
  getChargeFromQuarterlyAllIn,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import type {
  LockoutTickAdapter,
  DueLockoutCenter,
  LockoutCenterState,
} from '@/lib/billingLockout';

// WhatsApp template names (see .claude/skills/tutoringhq-product-reference). They
// are not Meta-approved yet, so every send below is a safe no-op today.
const TEMPLATE_FIRST_NUDGE = 'chq_nudge_due_today';
const TEMPLATE_SECOND_REMINDER = 'chq_fee_reminder';
const TEMPLATE_LOCKED = 'chq_nudge_locked';

type CenterRow = {
  id: string;
  plan: string | null;
  billing_period: string | null;
  billing_status: string | null;
  next_payment_due: string | null;
  all_in_price: number | null;
  is_early_adopter: boolean | null;
  early_adopter_price: number | null;
};

/** The plain per-cycle charge for a centre, mirroring billing/initiate-payment. */
function centerChargeEgp(center: CenterRow): number {
  const plan = center.plan || 'starter';
  const planKey = (plan in PLANS ? plan : 'starter') as PlanKey;
  const period = normalizeBillingPeriod(center.billing_period);
  const qBase =
    center.is_early_adopter && typeof center.early_adopter_price === 'number'
      ? center.early_adopter_price
      : center.all_in_price != null
        ? Number(center.all_in_price)
        : PLANS[planKey].quarterlyAllIn;
  return getChargeFromQuarterlyAllIn(qBase, period as BillingPeriod, planKey);
}

async function ledgerState(
  admin: SupabaseClient,
  centerId: string,
  cairoDay: string,
  unpaid: boolean,
): Promise<LockoutCenterState> {
  const { data } = await admin
    .from('billing_lockout_events')
    .select('event_type, succeeded')
    .eq('center_id', centerId)
    .eq('cairo_day', cairoDay);
  const rows = (data ?? []) as { event_type: string; succeeded: boolean | null }[];
  return {
    unpaid,
    attemptsMade: rows.filter((r) => r.event_type === 'retry').length,
    hadSuccessfulRetry: rows.some((r) => r.event_type === 'retry' && r.succeeded === true),
    done: {
      invoiceNudge: rows.some((r) => r.event_type === 'invoice_nudge'),
      reminder2: rows.some((r) => r.event_type === 'reminder2'),
      lock: rows.some((r) => r.event_type === 'lock'),
    },
  };
}

async function ownerPhone(admin: SupabaseClient, centerId: string): Promise<string | null> {
  const { data } = await admin
    .from('users')
    .select('phone')
    .eq('center_id', centerId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  return (data as { phone?: string | null } | null)?.phone ?? null;
}

/** Record a ledger event, swallowing the unique-index conflict (already fired today). */
async function recordEvent(
  admin: SupabaseClient,
  centerId: string,
  cairoDay: string,
  eventType: string,
  extra: { attempt_index?: number; succeeded?: boolean } = {},
): Promise<void> {
  await admin.from('billing_lockout_events').insert({
    center_id: centerId,
    cairo_day: cairoDay,
    event_type: eventType,
    attempt_index: extra.attempt_index ?? null,
    succeeded: extra.succeeded ?? null,
  });
}

export function createSupabaseLockoutAdapter(
  admin: SupabaseClient = getSupabaseAdmin(),
): LockoutTickAdapter {
  const store = createSupabaseSavedCardStore(admin);

  return {
    todayCairo: () => cairoDateKey(),
    nowMinsCairo: () => {
      const { hour, minute } = getCurrentCairoClock();
      return hour * 60 + minute;
    },

    async listDueCenters(todayCairo: string): Promise<DueLockoutCenter[]> {
      // Billing day == today Cairo and not paid. next_payment_due is a date column;
      // compare to the Cairo calendar day.
      const { data } = await admin
        .from('centers')
        .select(
          'id, plan, billing_period, billing_status, next_payment_due, all_in_price, is_early_adopter, early_adopter_price',
        )
        .neq('billing_status', 'paid')
        .eq('next_payment_due', todayCairo);
      const rows = (data ?? []) as CenterRow[];

      const out: DueLockoutCenter[] = [];
      for (const c of rows) {
        const unpaid = String(c.billing_status ?? '') !== 'paid';
        const state = await ledgerState(admin, c.id, todayCairo, unpaid);
        out.push({
          centerId: c.id,
          billingDayCairo: todayCairo,
          state,
          amountEgp: centerChargeEgp(c),
          ownerPhone: await ownerPhone(admin, c.id),
          periodKey: todayCairo.slice(0, 7),
        });
      }
      return out;
    },

    async applyRetry(center, attemptIndex): Promise<{ succeeded: boolean }> {
      const result = await chargeSavedCard(
        {
          owner: { ownerType: 'center', ownerId: center.centerId },
          amount: center.amountEgp ?? 0,
          billingPeriod: `${center.periodKey ?? center.billingDayCairo}:a${attemptIndex}`,
        },
        { store, paymob: paymobRecurringClient },
      );
      const succeeded = result.ok === true && result.status === 'charged';
      await recordEvent(admin, center.centerId, center.billingDayCairo, 'retry', {
        attempt_index: attemptIndex,
        succeeded,
      });
      return { succeeded };
    },

    async applyInvoiceNudge(center): Promise<void> {
      // The invoice itself is created by the existing renewal machinery; the lockout
      // sends the accompanying "due today" nudge. Record first (idempotent), so a
      // WhatsApp failure never causes a duplicate send on the next tick.
      await recordEvent(admin, center.centerId, center.billingDayCairo, 'invoice_nudge');
      if (center.ownerPhone) {
        await sendTemplateMessage(center.centerId, center.ownerPhone, TEMPLATE_FIRST_NUDGE);
      }
    },

    async applyReminder2(center): Promise<void> {
      await recordEvent(admin, center.centerId, center.billingDayCairo, 'reminder2');
      if (center.ownerPhone) {
        await sendTemplateMessage(center.centerId, center.ownerPhone, TEMPLATE_SECOND_REMINDER);
      }
    },

    async applyLock(center): Promise<void> {
      // Access is enforced live: the centre paywall by centerIsLockedNow /
      // isCenterLockedForEnforcement (interlock-gated), the teacher free-tier drop by
      // teacher_private_access. This records the lock for idempotency/audit and sends
      // the "locked" nudge. No bulk status write, no amount change.
      await recordEvent(admin, center.centerId, center.billingDayCairo, 'lock');
      if (center.ownerPhone) {
        await sendTemplateMessage(center.centerId, center.ownerPhone, TEMPLATE_LOCKED);
      }
    },
  };
}
