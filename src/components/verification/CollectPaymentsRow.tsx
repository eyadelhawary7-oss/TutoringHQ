'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from 'next-intl';
import type { VerificationState } from '@/lib/verification/state';
import { digitalCollectionView, verifyCtaView } from '@/lib/verification/uiState';

/**
 * `Merged-Teacher-Setup` §01 — the "Collect payments for me" row, screen 12 of
 * the twelve verified screens.
 *
 * The design gives this row two states:
 *   unverified → "Verify your ID to turn this on", with a **Verify ›** affordance
 *   verified   → "On. We invoice parents and process your payout every Thursday."
 *                with the switch thrown
 *
 * A third state exists in reality and in no design: the feature is not wired up
 * at all. That state renders here as a DISABLED row with a plain reason. It is
 * not hidden, and the switch is never drawn in the "on" position by anything
 * other than a real verified state.
 *
 * The section rename this row implies — "Payment details" becoming "Payout
 * details" with account holder, bank and IBAN — is NOT done here. Those fields
 * do not exist (`teacher_profiles` has 24 columns and no IBAN, no account
 * holder, no `payout_name_matches`; re-verified live 4 Aug 2026), and the payout
 * screens are `Merged-Teacher-Money` / `Merged-Verification-Payouts`, both
 * PROTECTED. The self-collect note stays, because it is currently true.
 */
export default function CollectPaymentsRow({ state }: { state: VerificationState }) {
  const t = useTranslations('verification');
  const locale = useLocale();
  const Chevron = locale === 'ar' ? ChevronLeft : ChevronRight;

  const collection = digitalCollectionView(state);
  const cta = verifyCtaView(state);

  const subtitle = collection.on
    ? t('settingsRow.subtitleOn')
    : !state.available
      ? t('settingsRow.subtitleUnavailable')
      : t('settingsRow.subtitleUnverified');

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">
            {t('settingsRow.title')}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {subtitle}
          </p>
        </div>

        {collection.on ? (
          // Reached only when a real webhook has recorded a pass. There is no
          // other way to make this switch read "on".
          <span
            className="inline-flex h-6 w-11 shrink-0 items-center rounded-pill bg-[var(--color-accent-deep)] p-0.5"
            role="img"
            aria-label={t('settingsRow.subtitleOn')}
          >
            <span className="ms-auto h-5 w-5 rounded-pill bg-white" />
          </span>
        ) : (
          <button
            type="button"
            disabled={!cta.enabled}
            className="btn-press chq-focus inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--color-accent-deep)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)] disabled:opacity-60"
          >
            {t('cta.verifyMyId')}
            <Chevron className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {/* When the control is disabled, the reason sits directly under it. A
          greyed control with no explanation is indistinguishable from a bug. */}
      {!collection.on && cta.reasonKey && (
        <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {t(cta.reasonKey)}
        </p>
      )}
    </section>
  );
}
