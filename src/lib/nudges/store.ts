// Supabase adapter wiring the pure nudge orchestrator (runBillingNudges) to live
// data. Reads the SHARED invoices table + per-owner subscription tables +
// saved_cards, exactly as the midnight billing engine does, so the two agree on
// who owes what. Service-role only (called from the cron with supabase-admin).

import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, cairoYmdPlusDays } from '@/lib/cairo/day';
import { getPaymobRecurringIntegrationId } from '@/lib/paymobConfig';
import { ensureTeacherSubscriptionInvoice } from '@/lib/teacherBilling';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';
import { resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { isTemplateApproved } from '@/lib/centerNotify';
import { lastDayOfMonthYmd, cycleKeyFromBillingDay } from './evaluate';
import { nudgeWhatsappEnabled } from './config';
import type { NudgeRunDeps, NudgeWaJob } from './runBillingNudges';
import type { OwnerNudgeState, OwnerRef, SavedCardInfo } from './types';

const OPEN_STATUSES = ['pending', 'overdue', 'failed'];
const SUBSCRIPTION_TYPES = ['subscription', 'base_subscription'];
// How far back to scan for unpaid/locked cycles (post-lock catch-up window).
const LOOKBACK_DAYS = 31;
const LOOKAHEAD_DAYS = 3;

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cardUsableForBilling(card: SavedCardInfo | null, billingDayCairo: string | null): boolean {
  if (!card || card.status !== 'active' || !billingDayCairo) return false;
  // Usable if it does NOT expire before the billing day.
  return lastDayOfMonthYmd(card.expYear, card.expMonth) >= billingDayCairo;
}

/** Active saved cards keyed by `${owner_type}:${owner_id}`. */
async function loadActiveCards(supabase: SupabaseClient): Promise<Map<string, SavedCardInfo>> {
  const map = new Map<string, SavedCardInfo>();
  const { data } = await supabase
    .from('saved_cards')
    .select('owner_type, owner_id, card_last4, exp_month, exp_year, status')
    .eq('status', 'active');
  for (const r of (data ?? []) as Row[]) {
    map.set(`${String(r.owner_type)}:${String(r.owner_id)}`, {
      last4: String(r.card_last4 ?? ''),
      expMonth: num(r.exp_month),
      expYear: num(r.exp_year),
      status: String(r.status ?? ''),
    });
  }
  return map;
}

interface CycleInvoice {
  id: string;
  status: string;
  total: number;
  received: number;
}

/** Index subscription invoices by `${ownerKey}|${billing_period_start}`. */
function indexInvoices(rows: Row[], ownerKeyOf: (r: Row) => string): Map<string, CycleInvoice> {
  const map = new Map<string, CycleInvoice>();
  for (const r of rows) {
    const bps = String(r.billing_period_start ?? '').slice(0, 10);
    const key = `${ownerKeyOf(r)}|${bps}`;
    // Prefer an open invoice if duplicates exist.
    const existing = map.get(key);
    const status = String(r.status ?? '');
    if (!existing || (OPEN_STATUSES.includes(status) && !OPEN_STATUSES.includes(existing.status))) {
      map.set(key, {
        id: String(r.id),
        status,
        total: num(r.total_amount),
        received: num(r.amount_received),
      });
    }
  }
  return map;
}

function buildState(
  owner: OwnerRef,
  displayName: string | null,
  billingDayCairo: string | null,
  cycleInvoice: CycleInvoice | null,
  card: SavedCardInfo | null,
  fallbackAmount: number,
  todayCairo: string,
): OwnerNudgeState {
  const recurringConfigured = !!getPaymobRecurringIntegrationId();
  const cardUsable = cardUsableForBilling(card, billingDayCairo);
  const manualPayExpected = !(recurringConfigured && cardUsable);

  const hasOpenInvoice = !!cycleInvoice && OPEN_STATUSES.includes(cycleInvoice.status);
  const cyclePaid =
    !!cycleInvoice &&
    (cycleInvoice.status === 'paid' || cycleInvoice.received >= cycleInvoice.total);

  // No invoice yet + already past the billing day → nothing payable to chase.
  const pastBilling = billingDayCairo != null && billingDayCairo < todayCairo;
  const paid = cyclePaid || (!cycleInvoice && pastBilling);

  const amountDue = cycleInvoice
    ? Math.max(0, Math.round((cycleInvoice.total - cycleInvoice.received) * 100) / 100)
    : fallbackAmount;

  return {
    owner,
    displayName,
    billingDayCairo,
    cycleKey: cycleKeyFromBillingDay(billingDayCairo),
    paid,
    hasOpenInvoice,
    invoiceId: cycleInvoice?.id ?? null,
    amountDue,
    manualPayExpected,
    savedCard: card,
  };
}

async function listOwnerStates(
  supabase: SupabaseClient,
  todayCairo: string,
): Promise<OwnerNudgeState[]> {
  const lo = cairoYmdPlusDays(todayCairo, -LOOKBACK_DAYS);
  const hi = cairoYmdPlusDays(todayCairo, LOOKAHEAD_DAYS);
  const cards = await loadActiveCards(supabase);
  const out: OwnerNudgeState[] = [];

  // ---- Centers -----------------------------------------------------------
  const cardCenterIds = [...cards.keys()]
    .filter((k) => k.startsWith('center:'))
    .map((k) => k.slice('center:'.length));

  const centerById = new Map<string, Row>();
  const { data: windowCenters } = await supabase
    .from('centers')
    .select('id, name, owner_name, phone, next_payment_due, billing_status')
    .eq('subscription_status', 'active')
    .not('next_payment_due', 'is', null)
    .gte('next_payment_due', lo)
    .lte('next_payment_due', hi);
  for (const r of (windowCenters ?? []) as Row[]) centerById.set(String(r.id), r);

  if (cardCenterIds.length > 0) {
    const { data: cardCenters } = await supabase
      .from('centers')
      .select('id, name, owner_name, phone, next_payment_due, billing_status')
      .in('id', cardCenterIds);
    for (const r of (cardCenters ?? []) as Row[]) centerById.set(String(r.id), r);
  }

  const centerIds = [...centerById.keys()];
  let centerInvoices = new Map<string, CycleInvoice>();
  if (centerIds.length > 0) {
    const { data: inv } = await supabase
      .from('invoices')
      .select('id, center_id, status, total_amount, amount_received, billing_period_start')
      .eq('owner_type', 'center')
      .in('center_id', centerIds)
      .in('invoice_type', SUBSCRIPTION_TYPES);
    centerInvoices = indexInvoices((inv ?? []) as Row[], (r) => String(r.center_id));
  }

  for (const r of centerById.values()) {
    const id = String(r.id);
    const billingDay = r.next_payment_due ? String(r.next_payment_due).slice(0, 10) : null;
    const card = cards.get(`center:${id}`) ?? null;
    const cycleInvoice = billingDay ? (centerInvoices.get(`${id}|${billingDay}`) ?? null) : null;
    out.push(
      buildState(
        { ownerType: 'center', ownerId: id },
        (r.name as string) || (r.owner_name as string) || null,
        billingDay,
        cycleInvoice,
        card,
        0,
        todayCairo,
      ),
    );
  }

  // ---- Teachers ----------------------------------------------------------
  // All live teacher subscriptions are scanned, then narrowed below to those in
  // the billing window OR holding an active card (for card-expiry warnings).
  const teacherById = new Map<string, Row>();
  const { data: windowTeachers } = await supabase
    .from('teacher_subscriptions')
    .select('teacher_id, next_billing_at, price_gross, status')
    .not('next_billing_at', 'is', null)
    .in('status', ['active', 'trialing', 'past_due']);
  for (const r of (windowTeachers ?? []) as Row[]) teacherById.set(String(r.teacher_id), r);

  const teacherIds = [...teacherById.keys()];
  // Names/phones for teachers (they are users rows).
  const teacherUsers = new Map<string, Row>();
  if (teacherIds.length > 0) {
    const { data: us } = await supabase
      .from('users')
      .select('id, name, phone')
      .in('id', teacherIds);
    for (const u of (us ?? []) as Row[]) teacherUsers.set(String(u.id), u);
  }

  let teacherInvoices = new Map<string, CycleInvoice>();
  if (teacherIds.length > 0) {
    const { data: inv } = await supabase
      .from('invoices')
      .select('id, teacher_id, status, total_amount, amount_received, billing_period_start')
      .eq('owner_type', 'teacher')
      .in('teacher_id', teacherIds)
      .in('invoice_type', SUBSCRIPTION_TYPES);
    teacherInvoices = indexInvoices((inv ?? []) as Row[], (r) => String(r.teacher_id));
  }

  let teacherFee = 0;
  try {
    teacherFee = resolveProcessingFeeAmount(await getProcessingFeeConfig());
  } catch {
    teacherFee = 0;
  }

  for (const r of teacherById.values()) {
    const id = String(r.teacher_id);
    const billingDay = r.next_billing_at ? cairoDateKey(new Date(String(r.next_billing_at))) : null;
    // Only keep teachers in the active billing window or holding a card.
    const inWindow = billingDay != null && billingDay >= lo && billingDay <= hi;
    const hasCard = cards.has(`teacher:${id}`);
    if (!inWindow && !hasCard) continue;

    const card = cards.get(`teacher:${id}`) ?? null;
    const cycleInvoice = billingDay ? (teacherInvoices.get(`${id}|${billingDay}`) ?? null) : null;
    const fallback = Math.round((num(r.price_gross) + teacherFee) * 100) / 100;
    const u = teacherUsers.get(id);
    out.push(
      buildState(
        { ownerType: 'teacher', ownerId: id },
        (u?.name as string) || null,
        billingDay,
        cycleInvoice,
        card,
        fallback,
        todayCairo,
      ),
    );
  }

  return out;
}

/**
 * Build a single owner's nudge state for the live banner endpoint. Mirrors the
 * bulk listOwnerStates logic for one owner so the banner and the cron agree.
 */
export async function getOwnerNudgeState(
  supabase: SupabaseClient,
  owner: OwnerRef,
  todayCairo: string = cairoDateKey(new Date()),
): Promise<OwnerNudgeState | null> {
  // Active saved card for this owner.
  const { data: cardRow } = await supabase
    .from('saved_cards')
    .select('card_last4, exp_month, exp_year, status')
    .eq('owner_type', owner.ownerType)
    .eq('owner_id', owner.ownerId)
    .eq('status', 'active')
    .maybeSingle();
  const card: SavedCardInfo | null = cardRow
    ? {
        last4: String((cardRow as Row).card_last4 ?? ''),
        expMonth: num((cardRow as Row).exp_month),
        expYear: num((cardRow as Row).exp_year),
        status: String((cardRow as Row).status ?? ''),
      }
    : null;

  if (owner.ownerType === 'center') {
    const { data: c } = await supabase
      .from('centers')
      .select('id, name, owner_name, next_payment_due, billing_status')
      .eq('id', owner.ownerId)
      .maybeSingle();
    if (!c) return null;
    const billingDay = (c as Row).next_payment_due
      ? String((c as Row).next_payment_due).slice(0, 10)
      : null;
    const cycleInvoice = await loadCycleInvoice(supabase, owner, billingDay);
    return buildState(
      owner,
      ((c as Row).name as string) || ((c as Row).owner_name as string) || null,
      billingDay,
      cycleInvoice,
      card,
      0,
      todayCairo,
    );
  }

  // Teacher
  const { data: sub } = await supabase
    .from('teacher_subscriptions')
    .select('teacher_id, next_billing_at, price_gross')
    .eq('teacher_id', owner.ownerId)
    .maybeSingle();
  if (!sub) return null;
  const billingDay = (sub as Row).next_billing_at
    ? cairoDateKey(new Date(String((sub as Row).next_billing_at)))
    : null;
  const cycleInvoice = await loadCycleInvoice(supabase, owner, billingDay);
  const { data: u } = await supabase
    .from('users')
    .select('name')
    .eq('id', owner.ownerId)
    .maybeSingle();
  let fee = 0;
  try {
    fee = resolveProcessingFeeAmount(await getProcessingFeeConfig());
  } catch {
    fee = 0;
  }
  const fallback = Math.round((num((sub as Row).price_gross) + fee) * 100) / 100;
  return buildState(
    owner,
    (u as Row | null)?.name ? String((u as Row).name) : null,
    billingDay,
    cycleInvoice,
    card,
    fallback,
    todayCairo,
  );
}

async function loadCycleInvoice(
  supabase: SupabaseClient,
  owner: OwnerRef,
  billingDay: string | null,
): Promise<CycleInvoice | null> {
  if (!billingDay) return null;
  const col = owner.ownerType === 'center' ? 'center_id' : 'teacher_id';
  const { data } = await supabase
    .from('invoices')
    .select('id, status, total_amount, amount_received, billing_period_start')
    .eq('owner_type', owner.ownerType)
    .eq(col, owner.ownerId)
    .in('invoice_type', SUBSCRIPTION_TYPES)
    .eq('billing_period_start', billingDay)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;
  const indexed = indexInvoices(rows, () => owner.ownerId);
  return indexed.get(`${owner.ownerId}|${billingDay}`) ?? null;
}

/**
 * Build the production NudgeRunDeps backed by Supabase (service-role) for one
 * cron pass. `todayCairo` defaults to the current Cairo calendar day.
 */
export function createSupabaseNudgeDeps(
  supabase: SupabaseClient,
  todayCairo: string = cairoDateKey(new Date()),
): NudgeRunDeps {
  return {
    todayCairo,
    whatsappEnabled: nudgeWhatsappEnabled(),

    listOwnerStates: (t) => listOwnerStates(supabase, t),

    async ensurePrebillInvoice(state) {
      if (state.owner.ownerType !== 'teacher' || !state.billingDayCairo) return null;
      const { data: sub } = await supabase
        .from('teacher_subscriptions')
        .select('price_gross')
        .eq('teacher_id', state.owner.ownerId)
        .maybeSingle();
      let fee = 0;
      try {
        fee = resolveProcessingFeeAmount(await getProcessingFeeConfig());
      } catch {
        fee = 0;
      }
      const ensured = await ensureTeacherSubscriptionInvoice(supabase, {
        teacherId: state.owner.ownerId,
        billingDayCairo: state.billingDayCairo,
        priceGross: num((sub as Row | null)?.price_gross),
        fee,
      });
      if (!ensured) return null;
      return { invoiceId: ensured.invoiceId, amountDue: ensured.total };
    },

    async claimNudge({ owner, cycleKey, step, invoiceId }) {
      // Insert the ledger row; UNIQUE(owner_type,owner_id,cycle_key,step) makes
      // this the idempotency gate. PostgREST returns the row only when inserted;
      // a conflicting (already-sent) row yields a 409 → null (skip).
      const { data, error } = await supabase
        .from('billing_nudges')
        .insert({
          owner_type: owner.ownerType,
          owner_id: owner.ownerId,
          cycle_key: cycleKey,
          step,
          invoice_id: invoiceId,
        })
        .select('id')
        .single();
      if (error) return null; // unique-violation (already claimed) or insert error
      return (data as Row | null)?.id ? String((data as Row).id) : null;
    },

    async resolvePhone(owner) {
      if (owner.ownerType === 'teacher') {
        const { data: u } = await supabase
          .from('users')
          .select('phone')
          .eq('id', owner.ownerId)
          .maybeSingle();
        return resolveOwnerWaPhone(supabase, owner.ownerId, (u as Row | null)?.phone as string, null);
      }
      // Center owner: first owner user of the center, fall back to centre phone.
      const { data: ownerUser } = await supabase
        .from('users')
        .select('id, phone')
        .eq('role', 'owner')
        .eq('center_id', owner.ownerId)
        .limit(1)
        .maybeSingle();
      const { data: center } = await supabase
        .from('centers')
        .select('phone')
        .eq('id', owner.ownerId)
        .maybeSingle();
      return resolveOwnerWaPhone(
        supabase,
        (ownerUser as Row | null)?.id ? String((ownerUser as Row).id) : null,
        (ownerUser as Row | null)?.phone as string,
        (center as Row | null)?.phone as string,
      );
    },

    isTemplateApproved: (name) => isTemplateApproved(name, supabase),

    async enqueueWhatsapp(job: NudgeWaJob) {
      const { error } = await supabase.from('webhook_outbox').insert({
        job_type: 'send_billing_nudge_wa',
        payload: {
          nudgeId: job.nudgeId,
          ownerType: job.ownerType,
          ownerId: job.ownerId,
          step: job.step,
          toPhone: job.toPhone,
          templateName: job.templateName,
          params: job.params,
        },
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },

    async setNudgeWhatsapp(nudgeId, status, templateName, error) {
      await supabase
        .from('billing_nudges')
        .update({
          channel_whatsapp_status: status,
          whatsapp_template: templateName,
          whatsapp_error: error,
          updated_at: new Date().toISOString(),
        })
        .eq('id', nudgeId);
    },

    async deadLetter(job: NudgeWaJob, error: string) {
      // The faithful WA-failure→dead-letter path is process-outbox (it owns a real
      // outbox row). This orchestrator path only fires if the ENQUEUE itself
      // failed, so there is no outbox row yet — create a terminal one to satisfy
      // dead_letter_queue.outbox_id (FK → webhook_outbox), then dead-letter it.
      const payload = {
        nudgeId: job.nudgeId,
        ownerType: job.ownerType,
        ownerId: job.ownerId,
        step: job.step,
        templateName: job.templateName,
      };
      const { data: ob } = await supabase
        .from('webhook_outbox')
        .insert({
          job_type: 'send_billing_nudge_wa',
          payload,
          status: 'dead',
          attempt_count: 0,
          max_attempts: 0,
          next_attempt_at: new Date().toISOString(),
          error_message: error,
        })
        .select('id')
        .single();
      const outboxId = (ob as Row | null)?.id;
      if (!outboxId) return;
      await supabase.from('dead_letter_queue').insert({
        outbox_id: outboxId,
        job_type: 'send_billing_nudge_wa',
        payload,
        error_message: error,
        attempt_count: 0,
      });
    },
  };
}
