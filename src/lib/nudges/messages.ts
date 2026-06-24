// Builds the positional WhatsApp template variables for each nudge step. Arabic
// (EGY) is the canonical send locale (matches the rest of centerNotify). Amounts
// and links are formatted here so the cron and the outbox handler agree on the
// exact payload. See docs/WA_TEMPLATES.md for the template bodies.

import { formatNumber } from '@/lib/formatNumber';
import { templateForStep } from './config';
import { cairoYmdDiff } from './evaluate';
import { payUrl, updateCardUrl } from './payLinks';
import type { NudgeStep, OwnerNudgeState } from './types';

export interface NudgeWaPayload {
  templateName: string;
  /** Positional body params ({{1}}, {{2}}, …) in order. */
  params: string[];
}

function amountStr(amount: number): string {
  return formatNumber(Number(amount) || 0, 'ar');
}

/**
 * Resolve the WhatsApp payload for a step, or null when the step has no template.
 * `locale` selects the pay-link locale (the message body itself is Arabic).
 */
export function buildNudgeWaPayload(
  step: NudgeStep,
  state: OwnerNudgeState,
  todayCairo: string,
  locale = 'ar',
): NudgeWaPayload | null {
  const templateName = templateForStep(step);
  if (!templateName) return null;
  const name = state.displayName?.trim() || '';
  const { ownerType } = state.owner;

  switch (step) {
    case 'prebill_t3':
    case 'prebill_t1': {
      const days = state.billingDayCairo
        ? Math.max(0, cairoYmdDiff(todayCairo, state.billingDayCairo))
        : step === 'prebill_t3'
          ? 3
          : 1;
      return {
        templateName,
        params: [name, amountStr(state.amountDue), formatNumber(days, 'ar'), payUrl(ownerType, locale)],
      };
    }
    case 'due_today':
    case 'locked':
      return {
        templateName,
        params: [name, amountStr(state.amountDue), payUrl(ownerType, locale)],
      };
    case 'card_expiry_t30':
    case 'card_expiry_t7': {
      const card = state.savedCard;
      const mm = card ? String(card.expMonth).padStart(2, '0') : '';
      const yy = card ? String(card.expYear).slice(-2) : '';
      return {
        templateName,
        params: [name, card?.last4 ?? '', `${mm}/${yy}`, updateCardUrl(ownerType, locale)],
      };
    }
    default:
      return null;
  }
}
