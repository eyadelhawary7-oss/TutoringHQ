// Pure decision core for the unified nudge engine. No I/O — fully unit-testable.
// Given an owner's billing state + today's Cairo calendar date, it answers:
//   - which nudge STEPS are due right now (for the WhatsApp scheduler), and
//   - which single banner to show (for the live in-app surface).
//
// All date math is on Cairo calendar dates (YYYY-MM-DD). The day difference uses
// UTC midnights of the calendar dates, so it is DST-agnostic by construction.

import { parseCairoYmd } from '@/lib/cairo/day';
import type { BannerNudge, NudgeStep, OwnerNudgeState } from './types';
import { payPath, updateCardPath } from './payLinks';

export const PREBILL_T3_DAYS = 3;
export const PREBILL_T1_DAYS = 1;
export const CARD_EXPIRY_T30_DAYS = 30;
export const CARD_EXPIRY_T7_DAYS = 7;

/** Signed calendar-day difference toYmd − fromYmd (positive = toYmd is later). */
export function cairoYmdDiff(fromYmd: string, toYmd: string): number {
  const a = parseCairoYmd(fromYmd);
  const b = parseCairoYmd(toYmd);
  const aMs = Date.UTC(a.y, a.m - 1, a.d);
  const bMs = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((bMs - aMs) / 86400000);
}

/** Cairo YYYY-MM-DD of the last day of a given (1-based) month. */
export function lastDayOfMonthYmd(year: number, month1: number): string {
  // Day 0 of the next month === last day of this month.
  const dt = new Date(Date.UTC(year, month1, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** 'YYYY-MM' billing-period key derived from a billing day, for ledger idempotency. */
export function cycleKeyFromBillingDay(billingDayCairo: string | null): string | null {
  if (!billingDayCairo) return null;
  return billingDayCairo.slice(0, 7);
}

/**
 * Card-expiry steps. Only warns when the active saved card will expire BEFORE the
 * next billing date (otherwise the next charge is unaffected). T-30 fires in the
 * (7, 30] day window; T-7 fires in [0, 7].
 */
export function evaluateCardExpiry(state: OwnerNudgeState, todayCairo: string): NudgeStep[] {
  const card = state.savedCard;
  if (!card || card.status !== 'active') return [];
  if (!state.billingDayCairo) return [];

  const cardExpiresYmd = lastDayOfMonthYmd(card.expYear, card.expMonth);
  // Usable through the next charge → nothing to warn about yet.
  if (cairoYmdDiff(cardExpiresYmd, state.billingDayCairo) <= 0) return [];

  const daysUntilExpiry = cairoYmdDiff(todayCairo, cardExpiresYmd);
  const out: NudgeStep[] = [];
  if (daysUntilExpiry > CARD_EXPIRY_T7_DAYS && daysUntilExpiry <= CARD_EXPIRY_T30_DAYS) {
    out.push('card_expiry_t30');
  }
  if (daysUntilExpiry >= 0 && daysUntilExpiry <= CARD_EXPIRY_T7_DAYS) {
    out.push('card_expiry_t7');
  }
  return out;
}

/**
 * Every nudge step DUE for this owner today. The ledger then enforces
 * "send each step at most once per cycle". A satisfied invoice (paid) yields no
 * billing-cycle steps — the sequence stops the instant the invoice clears.
 */
export function evaluateDueNudges(state: OwnerNudgeState, todayCairo: string): NudgeStep[] {
  const steps: NudgeStep[] = [];

  // Card-expiry is independent of the pay cycle (depends only on the saved card).
  steps.push(...evaluateCardExpiry(state, todayCairo));

  // Billing-cycle nudges require an unpaid cycle with a known billing day.
  if (state.billingDayCairo && !state.paid) {
    const daysUntil = cairoYmdDiff(todayCairo, state.billingDayCairo);

    // Pre-billing reminders: manual-pay owners only, and only once the payable
    // invoice exists (centers have it from T-7; teachers are pre-created at T-3).
    if (state.manualPayExpected && state.hasOpenInvoice) {
      if (daysUntil === PREBILL_T3_DAYS) steps.push('prebill_t3');
      if (daysUntil === PREBILL_T1_DAYS) steps.push('prebill_t1');
    }

    // Billing day, still unpaid → due-today / one-day-grace touch. Applies to BOTH
    // manual-pay owners and card owners whose auto-charge just failed.
    if (daysUntil === 0 && state.hasOpenInvoice) steps.push('due_today');

    // After the billing day, still unpaid → locked. Fired once (ledger-guarded).
    if (daysUntil < 0) steps.push('locked');
  }

  return steps;
}

/**
 * The single banner to render live for this owner right now (highest priority
 * wins). Computed from billing state only — never reads the ledger, so it shows
 * regardless of WhatsApp state. Priority: locked > due-today > pre-bill >
 * card-expiry. Returns null when nothing is active.
 */
export function selectBannerNudge(
  state: OwnerNudgeState,
  todayCairo: string,
  locale: string,
): BannerNudge | null {
  const { ownerType } = state.owner;

  if (state.billingDayCairo && !state.paid) {
    const daysUntil = cairoYmdDiff(todayCairo, state.billingDayCairo);

    if (daysUntil < 0) {
      return {
        kind: 'locked',
        ownerType,
        amountDue: state.amountDue,
        billingDayCairo: state.billingDayCairo,
        daysUntil: null,
        cardLast4: null,
        cardExpiry: null,
        ctaHref: payPath(ownerType, locale),
      };
    }
    if (daysUntil === 0 && state.hasOpenInvoice) {
      return {
        kind: 'due_today',
        ownerType,
        amountDue: state.amountDue,
        billingDayCairo: state.billingDayCairo,
        daysUntil: 0,
        cardLast4: null,
        cardExpiry: null,
        ctaHref: payPath(ownerType, locale),
      };
    }
    // Pre-billing window: show continuously from T-3 through T-1 for manual-pay.
    if (
      state.manualPayExpected &&
      state.hasOpenInvoice &&
      daysUntil >= PREBILL_T1_DAYS &&
      daysUntil <= PREBILL_T3_DAYS
    ) {
      return {
        kind: 'prebill',
        ownerType,
        amountDue: state.amountDue,
        billingDayCairo: state.billingDayCairo,
        daysUntil,
        cardLast4: null,
        cardExpiry: null,
        ctaHref: payPath(ownerType, locale),
      };
    }
  }

  // Card-expiry banner (lower priority than an active pay cycle).
  const cardSteps = evaluateCardExpiry(state, todayCairo);
  if (cardSteps.length > 0 && state.savedCard) {
    const mm = String(state.savedCard.expMonth).padStart(2, '0');
    const yy = String(state.savedCard.expYear).slice(-2);
    return {
      kind: 'card_expiry',
      ownerType,
      amountDue: state.amountDue,
      billingDayCairo: state.billingDayCairo,
      daysUntil: null,
      cardLast4: state.savedCard.last4,
      cardExpiry: `${mm}/${yy}`,
      ctaHref: updateCardPath(ownerType, locale),
    };
  }

  return null;
}
