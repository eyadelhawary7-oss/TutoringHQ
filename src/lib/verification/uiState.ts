/**
 * Territory B — turning one `VerificationState` into what each surface renders.
 *
 * This module holds NO state and reads NO environment. It is a pure mapping
 * from the state machine's answer to a view description, so every surface in
 * the app makes the same call and cannot disagree with any other. The React
 * components in `src/components/verification/` render these descriptions and
 * decide nothing themselves.
 *
 * Two audiences, deliberately separated:
 *
 *   PROVIDERS (centre owners, teachers) get ONE honest unavailable message.
 *   "Identity verification is not switched on yet" is the whole truth they
 *   need; which env var is missing is not their problem and naming it would
 *   leak our deployment state into a tenant-facing screen.
 *
 *   ADMIN gets the NAMED CAUSE, because an internal operator seeing
 *   "not available" with no reason cannot fix anything, and a vendor row that
 *   says "Connected" when nothing is connected is the exact lie this phase
 *   exists to remove.
 *
 * All keys are relative to the `verification` namespace in
 * `messages/en.json` / `messages/ar.json`.
 */

import type { VerificationState, VerificationUnavailableCause } from './state';

/**
 * Visual tone. Mapped to colour by the component, never here — a lib module
 * that emits Tailwind classes is a lib module that has to know about RTL.
 */
export type VerificationTone = 'verified' | 'pending' | 'attention' | 'neutral' | 'unavailable';

export type VerificationBadgeView = {
  tone: VerificationTone;
  /** i18n key under `verification`. */
  labelKey: string;
  /**
   * False when the badge must not render at all. Only ever false for a plain
   * `unverified` provider on a surface that already says so in prose — never
   * false because we are hiding a problem.
   */
  show: boolean;
};

/**
 * The badge as a provider sees it.
 *
 * NOTE ON THE UNAVAILABLE CASE: the badge still renders, reading
 * "Verification unavailable". It is NOT hidden. Hiding it would leave the old
 * behaviour — a surface that simply omits any trust signal — which reads to the
 * user as "fine, nothing to see", and that is how a missing integration
 * silently becomes invisible. The user is told plainly that we cannot tell them.
 */
export function verificationBadgeView(state: VerificationState): VerificationBadgeView {
  if (!state.available) {
    return { tone: 'unavailable', labelKey: 'badge.unavailable', show: true };
  }
  switch (state.status) {
    case 'verified':
      return { tone: 'verified', labelKey: 'badge.verified', show: true };
    case 'pending':
      return { tone: 'pending', labelKey: 'badge.pending', show: true };
    case 'failed':
      return { tone: 'attention', labelKey: 'badge.failed', show: true };
    case 'expired':
      return { tone: 'attention', labelKey: 'badge.expired', show: true };
    case 'provider_error':
      return { tone: 'attention', labelKey: 'badge.providerError', show: true };
    case 'unverified':
    default:
      return { tone: 'neutral', labelKey: 'badge.unverified', show: true };
  }
}

export type VerificationCtaView = {
  /**
   * When false the control renders DISABLED with `reasonKey` beside it — never
   * hidden. Hiding a control is how a feature silently disappears and how a
   * user is left unable to tell "not for me" from "broken".
   */
  enabled: boolean;
  labelKey: string;
  /** null exactly when `enabled` is true. */
  reasonKey: string | null;
  /** True once the provider has passed; the caller shows the verified state instead. */
  alreadyVerified: boolean;
};

/**
 * "Verify my ID" / "Verify to switch on", as a provider sees it.
 *
 * Enabled in exactly one situation: the feature is live AND the provider has
 * somewhere to go (unverified, failed, expired — all retryable entry points).
 * `pending` disables, because a second redirect while a check is in flight
 * costs another Valify charge and confuses the webhook ordering.
 */
export function verifyCtaView(state: VerificationState): VerificationCtaView {
  if (!state.available) {
    return {
      enabled: false,
      labelKey: 'cta.verifyMyId',
      reasonKey: 'cta.reason.unavailable',
      alreadyVerified: false,
    };
  }
  switch (state.status) {
    case 'verified':
      return { enabled: false, labelKey: 'cta.verifyMyId', reasonKey: null, alreadyVerified: true };
    case 'pending':
      return {
        enabled: false,
        labelKey: 'cta.verifyMyId',
        reasonKey: 'cta.reason.pending',
        alreadyVerified: false,
      };
    case 'provider_error':
      return {
        enabled: false,
        labelKey: 'cta.verifyMyId',
        reasonKey: 'cta.reason.providerError',
        alreadyVerified: false,
      };
    case 'failed':
    case 'expired':
    case 'unverified':
    default:
      return { enabled: true, labelKey: 'cta.verifyMyId', reasonKey: null, alreadyVerified: false };
  }
}

/**
 * Whether the "we collect for you" / online-collection block may present itself
 * as ON. Gated by VERIFICATION-SPEC §6: online collection, withdrawals and
 * teacher auto-collect all sit behind a passed check.
 *
 * `on` is true only for an available, verified subject. Everything else gets
 * the honest self-collect frame with a reason.
 */
export function digitalCollectionView(state: VerificationState): {
  on: boolean;
  reasonKey: string | null;
} {
  if (!state.available) return { on: false, reasonKey: 'collection.reason.unavailable' };
  if (state.status === 'verified') return { on: true, reasonKey: null };
  if (state.status === 'pending') return { on: false, reasonKey: 'collection.reason.pending' };
  return { on: false, reasonKey: 'collection.reason.unverified' };
}

/**
 * Admin-facing view. Carries the NAMED CAUSE so an internal operator can act.
 *
 * `design/Merged-Admin-Platform.html` draws the Valify vendor row as
 * "Connected" with a green dot, unconditionally. That frame is a design-side
 * fabrication: nothing is connected. This function is what replaces it, and the
 * row it feeds reads "Not configured" until the credentials are real.
 */
export type AdminVerificationView = {
  tone: VerificationTone;
  /** i18n key under `verification`. */
  labelKey: string;
  /** Named cause, admin-only. null when the feature is live. */
  causeKey: string | null;
  /** True when admin filters/chips that need the column must be disabled. */
  gated: boolean;
};

const ADMIN_CAUSE_KEYS: Record<VerificationUnavailableCause, string> = {
  provider_not_configured: 'admin.cause.providerNotConfigured',
  provider_placeholder_credentials: 'admin.cause.providerPlaceholder',
  state_source_missing: 'admin.cause.stateSourceMissing',
};

export function adminVerificationView(state: VerificationState): AdminVerificationView {
  if (!state.available) {
    return {
      tone: 'unavailable',
      labelKey: 'admin.status.notConfigured',
      causeKey: ADMIN_CAUSE_KEYS[state.cause],
      gated: true,
    };
  }
  const badge = verificationBadgeView(state);
  return { tone: badge.tone, labelKey: badge.labelKey, causeKey: null, gated: false };
}
