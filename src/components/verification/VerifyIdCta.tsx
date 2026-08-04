'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { EffectiveVerification } from '@/lib/verificationState';
import { verifyCtaView } from '@/lib/verification/uiState';

/**
 * "Verify my ID" — the entry point to the Valify hosted redirect.
 *
 * DISABLED, NOT HIDDEN. When the feature is unconfigured the button renders
 * greyed with a plain sentence underneath saying why. Hiding it was the
 * tempting option and it is wrong twice over: a control that vanishes is a
 * feature that silently disappears, and a user who cannot see the control
 * cannot tell "not offered to me" from "broken". They are told.
 *
 * It never navigates while disabled, and there is no href to strip — the
 * launcher (`POST /api/verification/start`, Territory A) does not exist yet, so
 * `onStart` is optional and a disabled button has nothing to call. When
 * Territory A lands its launcher, that route ALSO fails closed on the same
 * config point, so a mis-wired enable here still cannot fake a success.
 *
 * Design copy, kept verbatim:
 *   `Merged-Teacher-Home` §01  — "Let us collect for you" / "Verify my ID" /
 *     "Verify your ID and TutoringHQ collects every student payment through the
 *      app, then pays you automatically. No more chasing parents."
 *   `Merged-Center-Attendance` §02 — "Verify to switch on" /
 *     "About 2 minutes · commercial registration or National ID · secured by Valify"
 */
export default function VerifyIdCta({
  state,
  onStart,
  labelKeyOverride,
  className = '',
}: {
  state: EffectiveVerification;
  onStart?: () => void;
  /** e.g. `cta.verifyToSwitchOn` for the centre attendance opt-in. */
  labelKeyOverride?: string;
  className?: string;
}) {
  const t = useTranslations('verification');
  const view = verifyCtaView(state);

  // A passed check has nothing to start. The caller renders the verified state.
  if (view.alreadyVerified) return null;

  const label = t(labelKeyOverride ?? view.labelKey);
  const reasonId = view.reasonKey ? 'verify-cta-reason' : undefined;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        type="button"
        disabled={!view.enabled}
        aria-describedby={reasonId}
        onClick={view.enabled ? onStart : undefined}
        className="btn-press chq-focus inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg bg-[var(--color-accent-deep)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ShieldCheck className="h-4 w-4" aria-hidden />
        {label}
        {view.enabled && <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />}
      </button>

      {view.reasonKey && (
        <p id={reasonId} className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          {t(view.reasonKey)}
        </p>
      )}

      {view.enabled && (
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">{t('cta.whatYoullNeed')}</p>
      )}
    </div>
  );
}
