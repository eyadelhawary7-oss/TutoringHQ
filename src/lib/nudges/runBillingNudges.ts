// Orchestrator for one nudge pass — pure control flow over an injected adapter,
// so it is unit-testable with an in-memory fake. One pass: enumerate due owners
// (centers + teachers), evaluate their due steps, claim each step idempotently in
// the ledger, and hand the WhatsApp send to the resilient outbox. The pass never
// throws on a single owner's failure, and never blocks on WhatsApp — the in-app
// banner is computed independently and is unaffected by anything here.

import { evaluateDueNudges, cairoYmdDiff, PREBILL_T1_DAYS, PREBILL_T3_DAYS } from './evaluate';
import { templateForStep, nudgeWhatsappEnabled } from './config';
import { buildNudgeWaPayload } from './messages';
import type { NudgeStep, OwnerNudgeState, OwnerRef } from './types';

export interface NudgeWaJob {
  ownerType: OwnerRef['ownerType'];
  ownerId: string;
  nudgeId: string;
  step: NudgeStep;
  toPhone: string;
  templateName: string;
  params: string[];
}

export interface NudgeRunDeps {
  /** Today's Cairo calendar date (YYYY-MM-DD). */
  todayCairo: string;
  /** WhatsApp channel master switch (config.nudgeWhatsappEnabled() in prod). */
  whatsappEnabled?: boolean;
  /** Owners whose billing window is active (built from live billing data). */
  listOwnerStates(todayCairo: string): Promise<OwnerNudgeState[]>;
  /**
   * Ensure a payable invoice exists for a pre-billing reminder (teachers whose
   * invoice is otherwise only minted at midnight). Returns the patched invoice
   * fields, or null if it could not be created.
   */
  ensurePrebillInvoice(
    state: OwnerNudgeState,
  ): Promise<{ invoiceId: string; amountDue: number } | null>;
  /** Insert the ledger row; returns its id if newly claimed, null if it existed. */
  claimNudge(input: {
    owner: OwnerRef;
    cycleKey: string;
    step: NudgeStep;
    invoiceId: string | null;
  }): Promise<string | null>;
  /** Resolve the owner's WhatsApp phone (digits), or null. */
  resolvePhone(owner: OwnerRef): Promise<string | null>;
  /** Meta template approval gate (wa_meta_templates.status === 'APPROVED'). */
  isTemplateApproved(templateName: string): Promise<boolean>;
  /** Enqueue the send on the resilient outbox (reuses process-outbox + DLQ). */
  enqueueWhatsapp(job: NudgeWaJob): Promise<void>;
  /** Record the WhatsApp channel result on the ledger row. */
  setNudgeWhatsapp(
    nudgeId: string,
    status: 'queued' | 'disabled' | 'skipped' | 'failed',
    templateName: string | null,
    error: string | null,
  ): Promise<void>;
  /** Route a hard failure of the enqueue itself to the dead-letter table. */
  deadLetter(job: NudgeWaJob, error: string): Promise<void>;
}

export interface NudgeRunSummary {
  owners: number;
  claimed: number;
  queued: number;
  disabled: number;
  skipped: number;
  failed: number;
  errors: number;
}

function inPrebillWindow(daysUntil: number): boolean {
  return daysUntil >= PREBILL_T1_DAYS && daysUntil <= PREBILL_T3_DAYS;
}

export async function runBillingNudges(deps: NudgeRunDeps): Promise<NudgeRunSummary> {
  const summary: NudgeRunSummary = {
    owners: 0,
    claimed: 0,
    queued: 0,
    disabled: 0,
    skipped: 0,
    failed: 0,
    errors: 0,
  };
  const whatsappEnabled = deps.whatsappEnabled ?? nudgeWhatsappEnabled();

  const states = await deps.listOwnerStates(deps.todayCairo);
  summary.owners = states.length;

  for (const original of states) {
    let state = original;
    try {
      // Teacher pre-billing: mint the invoice early so the T-3/T-1 reminder has a
      // payable target (centers already have one from T-7). No-op for centers.
      if (
        state.owner.ownerType === 'teacher' &&
        state.manualPayExpected &&
        !state.paid &&
        !state.hasOpenInvoice &&
        state.billingDayCairo &&
        inPrebillWindow(cairoYmdDiff(deps.todayCairo, state.billingDayCairo))
      ) {
        const ensured = await deps.ensurePrebillInvoice(state);
        if (ensured) {
          state = {
            ...state,
            hasOpenInvoice: true,
            invoiceId: ensured.invoiceId,
            amountDue: ensured.amountDue,
          };
        }
      }

      const steps = evaluateDueNudges(state, deps.todayCairo);
      for (const step of steps) {
        const cycleKey = stepCycleKey(step, state);
        if (!cycleKey) continue;

        const nudgeId = await deps.claimNudge({
          owner: state.owner,
          cycleKey,
          step,
          invoiceId: state.invoiceId,
        });
        if (!nudgeId) continue; // already sent this step for this cycle — idempotent
        summary.claimed += 1;

        const templateName = templateForStep(step);

        // WhatsApp gated off, no template, or not yet Meta-approved → banner only.
        if (!whatsappEnabled || !templateName || !(await deps.isTemplateApproved(templateName))) {
          await deps.setNudgeWhatsapp(nudgeId, 'disabled', templateName, null);
          summary.disabled += 1;
          continue;
        }

        const phone = await deps.resolvePhone(state.owner);
        const payload = buildNudgeWaPayload(step, state, deps.todayCairo);
        if (!phone || !payload) {
          await deps.setNudgeWhatsapp(nudgeId, 'skipped', templateName, phone ? null : 'no_phone');
          summary.skipped += 1;
          continue;
        }

        const job: NudgeWaJob = {
          ownerType: state.owner.ownerType,
          ownerId: state.owner.ownerId,
          nudgeId,
          step,
          toPhone: phone,
          templateName: payload.templateName,
          params: payload.params,
        };

        try {
          await deps.enqueueWhatsapp(job);
          await deps.setNudgeWhatsapp(nudgeId, 'queued', templateName, null);
          summary.queued += 1;
        } catch (enqErr) {
          // Enqueue itself failed → dead-letter and keep going. Banner unaffected.
          const msg = enqErr instanceof Error ? enqErr.message : String(enqErr);
          await deps.deadLetter(job, msg);
          await deps.setNudgeWhatsapp(nudgeId, 'failed', templateName, msg);
          summary.failed += 1;
        }
      }
    } catch (ownerErr) {
      // One owner blowing up must not abort the whole pass.
      summary.errors += 1;
      console.error(
        `[billing-nudges] owner ${state.owner.ownerType}:${state.owner.ownerId}`,
        ownerErr,
      );
    }
  }

  return summary;
}

/** Cycle key for the ledger: billing period for cycle steps, card-month for expiry. */
export function stepCycleKey(step: NudgeStep, state: OwnerNudgeState): string | null {
  if (step === 'card_expiry_t30' || step === 'card_expiry_t7') {
    const card = state.savedCard;
    if (!card) return null;
    return `card:${card.expYear}-${String(card.expMonth).padStart(2, '0')}`;
  }
  return state.cycleKey;
}
