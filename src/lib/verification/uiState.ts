/**
 * Turning ONE `EffectiveVerification` into what each surface renders.
 *
 * This module holds NO state and reads NO environment. It is a pure mapping from
 * the state machine's answer to a view description, so every surface in the app
 * makes the same call and cannot disagree with any other. The React components in
 * `src/components/verification/` render these descriptions and decide nothing
 * themselves.
 *
 * ============================================================================
 * THE STATE MACHINE IS `src/lib/verificationState.ts`. THIS MODULE IS A VIEW.
 * ============================================================================
 * There was briefly a second one — `src/lib/verification/state.ts`, six statuses,
 * written in parallel against `verification_status` columns on `centers` and
 * `teacher_profiles`. It is DELETED. Its own header instructed the handover
 * ("If Territory A lands a richer state machine, take theirs and delete this")
 * and this is that deletion. The deciding reason was not tidiness: B's shape
 * required a `national_id` column on `public.centers`, and RLS grants a ROW and
 * cannot withhold a COLUMN — the only SELECT policy on that table is
 * `centers_select_own USING (id = get_auth_center_id())` (re-verified live
 * 4 Aug 2026), so any authenticated owner would have read their own number
 * straight out of PostgREST, and four existing `select('*')` call sites would
 * have started carrying it. A's `verification_records` table with column-level
 * REVOKE keeps the number off every read path instead.
 *
 * ----------------------------------------------------------------------------
 * SIX OUTCOMES, FIVE STATES
 * ----------------------------------------------------------------------------
 * The six things VERIFICATION-SPEC §9.1 says can happen on return from Valify are
 * OUTCOMES, not states. Three of them (`abandoned`, `expired`, `provider_error`)
 * leave the provider exactly where they started, so they land in `unverified` and
 * are distinguished by `last_outcome`. This module is where that distinction
 * becomes visible to a user: `verificationOutcomeNoteKey()` returns the sentence
 * that says "your link expired" beside a badge that correctly reads
 * "Not verified". Nothing was lost in dropping the extra statuses; the
 * distinction moved from the type to the field that carries it.
 *
 * Two audiences, deliberately separated:
 *
 *   PROVIDERS (centre owners, teachers) get ONE honest unavailable message.
 *   "Identity verification is not switched on yet" is the whole truth they need;
 *   which env var is missing is not their problem and naming it would leak our
 *   deployment state into a tenant-facing screen.
 *
 *   ADMIN gets the NAMED CAUSE, because an internal operator seeing
 *   "not available" with no reason cannot fix anything, and a vendor row that
 *   says "Connected" when nothing is connected is the exact lie this phase exists
 *   to remove.
 *
 * All keys are relative to the `verification` namespace in `messages/en.json` /
 * `messages/ar.json`.
 */

import type { ValifyUnconfiguredCause } from '@/lib/valifyGuardLogic';
import type { EffectiveVerification, VerificationOutcome } from '@/lib/verificationState';

/**
 * Visual tone. Mapped to colour by the component, never here — a lib module that
 * emits Tailwind classes is a lib module that has to know about RTL.
 */
export type VerificationTone = 'verified' | 'pending' | 'attention' | 'neutral' | 'unavailable';

export type VerificationBadgeView = {
  tone: VerificationTone;
  /** i18n key under `verification`. */
  labelKey: string;
  /**
   * False when the badge must not render at all. Never false today — see the
   * note on `verificationBadgeView`.
   */
  show: boolean;
};

/**
 * The badge as a provider sees it.
 *
 * NOTE ON THE UNCONFIGURED CASE: the badge still renders, reading "Verification
 * unavailable". It is NOT hidden. Hiding it would leave the old behaviour — a
 * surface that simply omits any trust signal — which reads to the user as "fine,
 * nothing to see", and that is how a missing integration silently becomes
 * invisible. The user is told plainly that we cannot tell them.
 */
export function verificationBadgeView(v: EffectiveVerification): VerificationBadgeView {
  switch (v.state) {
    case 'unconfigured':
      return { tone: 'unavailable', labelKey: 'badge.unavailable', show: true };
    case 'verified':
      // Belt and braces. `resolveEffectiveState` cannot produce state 'verified'
      // with isVerified false, but a badge is the one place where being wrong is
      // unrecoverable, so it keys on the boolean too.
      return v.isVerified
        ? { tone: 'verified', labelKey: 'badge.verified', show: true }
        : { tone: 'unavailable', labelKey: 'badge.unavailable', show: true };
    case 'pending':
      return { tone: 'pending', labelKey: 'badge.pending', show: true };
    case 'rejected':
      return { tone: 'attention', labelKey: 'badge.rejected', show: true };
    case 'unverified':
    default:
      // `expired` and `provider_error` both live here. They are not the user's
      // fault and not a rejection, so the badge stays neutral and the note (see
      // below) carries the detail.
      return { tone: 'neutral', labelKey: 'badge.unverified', show: true };
  }
}

/**
 * The sentence that explains what happened last, when there is one worth saying.
 *
 * This is what replaces B's `expired` and `provider_error` statuses. Returns null
 * when the state already says everything: a `verified` provider does not need to
 * be told their check passed, and a `pending` one does not need history.
 */
export function verificationOutcomeNoteKey(v: EffectiveVerification): string | null {
  if (v.state !== 'unverified' && v.state !== 'rejected') return null;
  if (v.last_outcome == null) return null;
  const keys: Record<VerificationOutcome, string | null> = {
    // A pass that left the provider unverified is not a sentence we can write
    // honestly, and it should be unreachable. Say nothing rather than guess.
    passed: null,
    failed: 'outcome.failed',
    abandoned: 'outcome.abandoned',
    expired: 'outcome.expired',
    provider_error: 'outcome.providerError',
  };
  return keys[v.last_outcome];
}

export type VerificationCtaView = {
  /**
   * When false the control renders DISABLED with `reasonKey` beside it — never
   * hidden. Hiding a control is how a feature silently disappears and how a user
   * is left unable to tell "not for me" from "broken".
   */
  enabled: boolean;
  labelKey: string;
  /** null exactly when `enabled` is true, or when the provider already passed. */
  reasonKey: string | null;
  /** True once the provider has passed; the caller shows the verified state instead. */
  alreadyVerified: boolean;
};

/**
 * "Verify my ID" / "Verify to switch on", as a provider sees it.
 *
 * Enabled in exactly one situation: the state machine says the provider can
 * usefully press it. That is `canStartVerification`, which is true for
 * `unverified` and `rejected` and false everywhere else — so a `pending` check
 * disables the button (a second redirect while one is in flight costs another
 * Valify charge and confuses webhook ordering) and an `unconfigured` deployment
 * disables it with a different reason. This function no longer decides that; it
 * reads the decision.
 */
export function verifyCtaView(v: EffectiveVerification): VerificationCtaView {
  if (v.state === 'unconfigured') {
    return {
      enabled: false,
      labelKey: 'cta.verifyMyId',
      reasonKey: 'cta.reason.unavailable',
      alreadyVerified: false,
    };
  }
  if (v.isVerified) {
    return { enabled: false, labelKey: 'cta.verifyMyId', reasonKey: null, alreadyVerified: true };
  }
  if (v.canStartVerification) {
    return { enabled: true, labelKey: 'cta.verifyMyId', reasonKey: null, alreadyVerified: false };
  }
  // The only remaining state is `pending`.
  return {
    enabled: false,
    labelKey: 'cta.verifyMyId',
    reasonKey: 'cta.reason.pending',
    alreadyVerified: false,
  };
}

/**
 * Whether the "we collect for you" / online-collection block may present itself
 * as ON. Gated by VERIFICATION-SPEC §6: online collection, withdrawals and
 * teacher auto-collect all sit behind a passed check.
 *
 * `on` is true only for a genuinely verified subject — it reads `isVerified`,
 * the one boolean `resolveEffectiveState` guarantees cannot be true while the
 * guard is unhappy. Everything else gets the honest self-collect frame with a
 * reason.
 */
export function digitalCollectionView(v: EffectiveVerification): {
  on: boolean;
  reasonKey: string | null;
} {
  if (v.state === 'unconfigured') return { on: false, reasonKey: 'collection.reason.unavailable' };
  if (v.isVerified) return { on: true, reasonKey: null };
  if (v.state === 'pending') return { on: false, reasonKey: 'collection.reason.pending' };
  return { on: false, reasonKey: 'collection.reason.unverified' };
}

/**
 * Admin-facing view. Carries the NAMED CAUSE so an internal operator can act.
 *
 * `design/Merged-Admin-Platform.html` draws the Valify vendor row as "Connected"
 * with a green dot, unconditionally. That frame is a design-side fabrication:
 * nothing is connected. This function is what replaces it, and the row it feeds
 * reads "Not configured" until the credentials are real.
 */
export type AdminVerificationView = {
  tone: VerificationTone;
  /** i18n key under `verification`. */
  labelKey: string;
  /** Named cause, admin-only. null when the feature is live. */
  causeKey: string | null;
  /** True when admin filters/chips that need the state must be disabled. */
  gated: boolean;
};

/**
 * A's two causes, exhaustively. B carried three — it split "credentials absent"
 * from "credentials still placeholders". A's guard folds those into
 * `valify_not_configured` and reports the specific keys in `missing[]` for the
 * operator surface, which is where that granularity belongs: a copy string
 * cannot name which of four env vars is wrong, and a list can.
 */
const ADMIN_CAUSE_KEYS: Record<ValifyUnconfiguredCause, string> = {
  valify_not_configured: 'admin.cause.valifyNotConfigured',
  verification_schema_not_applied: 'admin.cause.verificationSchemaNotApplied',
};

export function adminVerificationView(v: EffectiveVerification): AdminVerificationView {
  if (v.state === 'unconfigured') {
    return {
      tone: 'unavailable',
      labelKey: 'admin.status.notConfigured',
      // `cause` is non-null whenever state is `unconfigured` — that is the
      // invariant `resolveEffectiveState` maintains. The fallback exists so a
      // future state that breaks it degrades to the honest label rather than
      // rendering `undefined`.
      causeKey: v.cause ? ADMIN_CAUSE_KEYS[v.cause] : 'admin.cause.valifyNotConfigured',
      gated: true,
    };
  }
  const badge = verificationBadgeView(v);
  return { tone: badge.tone, labelKey: badge.labelKey, causeKey: null, gated: false };
}
