// Single config place for the nudge WhatsApp templates — the Paymob-config
// pattern. When a template is approved by Meta (status flips to APPROVED in
// wa_meta_templates, synced from Meta), the WhatsApp channel turns on with no
// code change beyond the env kill-switch below. The in-app banner is ALWAYS on
// and never depends on any of this.

import type { NudgeStep } from './types';

/**
 * Meta template names this feature needs, in the UTILITY category (NOT
 * Marketing — Marketing-category billing messages risk silent non-delivery).
 * Submit these to Meta; see docs/WA_TEMPLATES.md for the bodies + variables.
 */
export const NUDGE_TEMPLATES = {
  /** Pre-billing reminder (T-3 and T-1; the day-count is a variable). */
  prebill: 'chq_nudge_prebill',
  /** Payment due today / one-day grace before lock. */
  due_today: 'chq_nudge_due_today',
  /** Account locked (center summary screen) / free-tier (teacher) — pay to restore. */
  locked: 'chq_nudge_locked',
  /** Saved card expires before next billing — update it (T-30 and T-7). */
  card_expiry: 'chq_nudge_card_expiry',
} as const;

/** Resolve the Meta template name for a step (null if the step has no template). */
export function templateForStep(step: NudgeStep): string | null {
  switch (step) {
    case 'prebill_t3':
    case 'prebill_t1':
      return NUDGE_TEMPLATES.prebill;
    case 'due_today':
      return NUDGE_TEMPLATES.due_today;
    case 'locked':
      return NUDGE_TEMPLATES.locked;
    case 'card_expiry_t30':
    case 'card_expiry_t7':
      return NUDGE_TEMPLATES.card_expiry;
    default:
      return null;
  }
}

/**
 * Master WhatsApp kill-switch for the nudge engine. Defaults OFF: until WhatsApp
 * is in live mode AND each template is Meta-approved, the WhatsApp half stays
 * silent (records 'disabled') while the in-app banner works fully. Flip
 * NUDGE_WHATSAPP_ENABLED=true on Vercel once live + templates approved.
 */
export function nudgeWhatsappEnabled(): boolean {
  return process.env.NUDGE_WHATSAPP_ENABLED === 'true';
}
