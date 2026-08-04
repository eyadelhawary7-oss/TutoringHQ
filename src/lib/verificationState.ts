/**
 * The identity-verification state machine.
 *
 * Pure and typed. No I/O, no env reads, no database. It decides what a state
 * is, who may move it, and what each state permits — nothing else. That makes it
 * exhaustively testable and makes every gate in the feature answerable by one
 * function rather than by scattered booleans.
 *
 * ============================================================================
 * `unconfigured` IS A FIRST-CLASS STATE.
 * ============================================================================
 * It is not an error, not an exception, not `null`. It is what every provider is
 * in today, and it is DIFFERENT FROM `unverified` in the way that matters most:
 *
 *   unverified   — we can verify you, you have not done it yet. Your move.
 *   unconfigured — we cannot verify anyone. Not your move. Nothing is wrong
 *                  with your account and nothing you do will change it.
 *
 * Collapsing the two is the specific failure this feature must avoid. A provider
 * shown "Not verified · Verify now" against a provider that does not exist will
 * press the button, get an error, and reasonably conclude they were rejected.
 * design/VERIFICATION-SPEC.md §9.1 makes the same point about `pending`: a state
 * that reads as rejection when it is not is a product defect, not a copy nit.
 *
 * `unconfigured` outranks every stored state. If a row somehow says `verified`
 * while the guard says unconfigured, the effective state is `unconfigured` and
 * NOTHING is unlocked — see `resolveEffectiveState()`. That is the rule that
 * makes "a green checkmark backed by no integration" unreachable rather than
 * merely unlikely.
 *
 * ----------------------------------------------------------------------------
 * The five states, and how the SIX return states in VERIFICATION-SPEC §9.1 map
 * ----------------------------------------------------------------------------
 * The spec enumerates six things that can happen when a user comes back from
 * Valify. They are OUTCOMES, not states — three of them leave the provider
 * exactly where they started, and giving each its own stored state would invent
 * distinctions the schema then has to carry forever.
 *
 *   spec return state   -> stored state    reason
 *   Verified            -> verified        webhook confirmed a pass
 *   Pending             -> pending         user returned before the webhook
 *   Failed              -> rejected        webhook reported a fail
 *   Abandoned           -> unverified      left Valify; nothing happened
 *   Expired             -> unverified      link expired unused; nothing happened
 *   Provider error      -> unverified      not the user's fault; retry later
 *
 * The three that collapse to `unverified` are distinguished by
 * `VerificationRecord.last_outcome`, so the UI can say "the link expired" without
 * the state machine growing three terminal-looking states that all mean "try
 * again".
 */

import type { ValifyUnconfiguredCause } from '@/lib/valifyGuardLogic';

/** The five states. `unconfigured` is one of them, first-class. */
export const VERIFICATION_STATES = [
  'unconfigured',
  'unverified',
  'pending',
  'verified',
  'rejected',
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 * States that can be PERSISTED. `unconfigured` cannot: it is a property of the
 * deployment, not of the provider, so writing it to a provider's row would
 * outlive the reason for it. It is computed at read time by
 * `resolveEffectiveState()`.
 */
export const PERSISTED_VERIFICATION_STATES = [
  'unverified',
  'pending',
  'verified',
  'rejected',
] as const;

export type PersistedVerificationState = (typeof PERSISTED_VERIFICATION_STATES)[number];

export function isPersistedVerificationState(v: unknown): v is PersistedVerificationState {
  return (
    typeof v === 'string' &&
    (PERSISTED_VERIFICATION_STATES as readonly string[]).includes(v)
  );
}

/**
 * The finer-grained thing that last happened, kept alongside the state so the
 * three "nothing happened" outcomes stay distinguishable without extra states.
 */
export const VERIFICATION_OUTCOMES = [
  'passed',
  'failed',
  'abandoned',
  'expired',
  'provider_error',
] as const;

export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

/** Outcome → the state it lands the provider in. Total over the outcome union. */
const OUTCOME_TO_STATE: Record<VerificationOutcome, PersistedVerificationState> = {
  passed: 'verified',
  failed: 'rejected',
  abandoned: 'unverified',
  expired: 'unverified',
  provider_error: 'unverified',
};

export function stateForOutcome(outcome: VerificationOutcome): PersistedVerificationState {
  return OUTCOME_TO_STATE[outcome];
}

/**
 * Who may cause a transition.
 *
 * `provider` is Valify, and it reaches us ONLY through the HMAC-verified
 * webhook. This is the load-bearing distinction in the whole feature: the
 * redirect return is a `user` actor and a `user` may NEVER cause `verified`
 * (see `TRANSITIONS`). VERIFICATION-SPEC §2 flags the alternative as the
 * security boundary of the feature — "if verified state is settable from
 * whatever comes back on the redirect, hitting the success URL makes you
 * verified". The type system now forbids that.
 *
 * `admin` exists so an override is representable, but it is granted NO
 * transition to `verified` — see `TRANSITIONS`. VERIFICATION-SPEC §3 records
 * that no admin approve/reject/override control exists in any design and that
 * open question 6 (is there a manual-review route?) is unanswered. Until Eyad
 * answers it, admin may only reset a stuck provider back to `unverified` so they
 * can retry.
 */
export type VerificationActor = 'user' | 'provider' | 'admin' | 'system';

export interface VerificationTransition {
  from: PersistedVerificationState;
  to: PersistedVerificationState;
  by: VerificationActor;
  /** Why this edge exists, for the audit trail and for whoever reads this next. */
  reason: string;
}

/**
 * Every legal edge. Anything not listed is illegal and
 * `canTransition()` refuses it.
 */
export const TRANSITIONS: readonly VerificationTransition[] = [
  {
    from: 'unverified',
    to: 'pending',
    by: 'user',
    reason: 'Provider started the hosted Valify flow; a session token was issued.',
  },
  {
    from: 'rejected',
    to: 'pending',
    by: 'user',
    reason: 'Provider retried after a failed check.',
  },
  {
    from: 'pending',
    to: 'verified',
    by: 'provider',
    reason: 'HMAC-verified Valify webhook reported a pass. The ONLY route to verified.',
  },
  {
    from: 'pending',
    to: 'rejected',
    by: 'provider',
    reason: 'HMAC-verified Valify webhook reported a fail.',
  },
  {
    from: 'pending',
    to: 'unverified',
    by: 'system',
    reason: 'Session expired or was abandoned; the provider is back where they started.',
  },
  {
    from: 'pending',
    to: 'unverified',
    by: 'admin',
    reason: 'Admin released a session stuck in pending so the provider can retry.',
  },
  {
    from: 'rejected',
    to: 'unverified',
    by: 'admin',
    reason: 'Admin cleared a failed check so the provider can retry. NOT an approval.',
  },
  {
    from: 'verified',
    to: 'unverified',
    by: 'admin',
    reason:
      'Admin revoked verification (fraud, owner change, provider request). Payouts re-lock immediately.',
  },
];

export interface TransitionDecision {
  allowed: boolean;
  /** Stable identifier for a refusal. Never a bare false. */
  code:
    | 'ok'
    | 'no_such_transition'
    | 'actor_not_permitted'
    | 'already_in_state'
    | 'verified_requires_provider_webhook';
  message: string;
}

/**
 * May `actor` move a provider from `from` to `to`?
 *
 * Returns a decision with a named code rather than a boolean, so every refusal
 * is loggable and legible at the call site.
 */
export function canTransition(
  from: PersistedVerificationState,
  to: PersistedVerificationState,
  actor: VerificationActor,
): TransitionDecision {
  if (from === to) {
    return {
      allowed: false,
      code: 'already_in_state',
      message: `Already ${from}; no transition to apply.`,
    };
  }

  // Called out explicitly, ahead of the generic lookup, because this is the one
  // rule whose violation is a security incident rather than a bug. A generic
  // "no such transition" would be a true but unhelpful thing to find in a log.
  if (to === 'verified' && actor !== 'provider') {
    return {
      allowed: false,
      code: 'verified_requires_provider_webhook',
      message:
        'Only an HMAC-verified Valify webhook can set verified. The redirect return, the user and admin cannot.',
    };
  }

  const edge = TRANSITIONS.find((t) => t.from === from && t.to === to && t.by === actor);
  if (edge) return { allowed: true, code: 'ok', message: edge.reason };

  const edgeExistsForAnotherActor = TRANSITIONS.some((t) => t.from === from && t.to === to);
  if (edgeExistsForAnotherActor) {
    const permitted = TRANSITIONS.filter((t) => t.from === from && t.to === to).map((t) => t.by);
    return {
      allowed: false,
      code: 'actor_not_permitted',
      message: `${from} → ${to} exists but only for: ${permitted.join(', ')}. Actor was ${actor}.`,
    };
  }

  return {
    allowed: false,
    code: 'no_such_transition',
    message: `No transition ${from} → ${to} for any actor.`,
  };
}

/** What a provider's stored row holds. Mirrors the proposed table exactly. */
export interface VerificationRecord {
  state: PersistedVerificationState;
  /** Set only when state is `verified`. Null otherwise. */
  verified_at: string | null;
  /** Set only when state is `verified`. Null otherwise. Never rendered in any UI. */
  legal_name: string | null;
  /** Set only when state is `verified`. Null otherwise. Never rendered in any UI. */
  national_id: string | null;
  last_outcome: VerificationOutcome | null;
}

/**
 * What the caller actually gets: the state after the guard has had its say,
 * plus everything a surface needs to render honestly.
 */
export interface EffectiveVerification {
  state: VerificationState;
  /** Present only when state is `unconfigured`. */
  cause: ValifyUnconfiguredCause | null;
  /**
   * True only when identity has genuinely been confirmed by the provider AND
   * the provider integration is live. The ONE boolean a badge may key on.
   */
  isVerified: boolean;
  /** True when the provider can usefully press "Verify". */
  canStartVerification: boolean;
  verified_at: string | null;
  last_outcome: VerificationOutcome | null;
}

/**
 * Fold the stored record and the guard verdict into the state a surface renders.
 *
 * `guardCause` non-null wins over EVERYTHING. A stored `verified` with the
 * provider unconfigured resolves to `unconfigured` with `isVerified: false`.
 * There is no argument list to this function that returns `isVerified: true`
 * while the guard is unhappy.
 *
 * `record === null` with the guard happy means "no row yet", which is
 * `unverified` — the provider has simply never started. That is the correct
 * reading of a missing row and it is why the proposed table has no
 * backfill: absence already means the right thing.
 */
export function resolveEffectiveState(
  record: VerificationRecord | null,
  guardCause: ValifyUnconfiguredCause | null,
): EffectiveVerification {
  if (guardCause !== null) {
    return {
      state: 'unconfigured',
      cause: guardCause,
      isVerified: false,
      canStartVerification: false,
      verified_at: null,
      last_outcome: record?.last_outcome ?? null,
    };
  }

  const state: PersistedVerificationState = record?.state ?? 'unverified';

  return {
    state,
    cause: null,
    isVerified: state === 'verified',
    canStartVerification: state === 'unverified' || state === 'rejected',
    verified_at: state === 'verified' ? (record?.verified_at ?? null) : null,
    last_outcome: record?.last_outcome ?? null,
  };
}

/**
 * What each state unlocks (design/VERIFICATION-SPEC.md §6).
 *
 * Only `verified` unlocks anything, and `unconfigured` unlocks strictly nothing.
 * Referral ACCRUAL and spending referral earnings as credit are absent from this
 * table on purpose — §6 records both as ungated in every state, so they are not
 * this gate's business and must not start flowing through it.
 */
export interface VerificationCapabilities {
  /** Parents pay in the app. §6: gated. */
  onlineCollection: boolean;
  /** Cash out collected tuition and referral earnings. §6: gated. */
  withdrawals: boolean;
  /** Teacher auto-collect. §6: gated. */
  automatedFeeCollection: boolean;
}

const NOTHING: VerificationCapabilities = {
  onlineCollection: false,
  withdrawals: false,
  automatedFeeCollection: false,
};

export function capabilitiesFor(state: VerificationState): VerificationCapabilities {
  if (state !== 'verified') return { ...NOTHING };
  return {
    onlineCollection: true,
    withdrawals: true,
    automatedFeeCollection: true,
  };
}
