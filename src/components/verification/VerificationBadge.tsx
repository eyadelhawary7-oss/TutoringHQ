'use client';

import { useTranslations } from 'next-intl';
import { BadgeCheck, Clock, ShieldAlert, ShieldOff, Shield } from 'lucide-react';
import type { VerificationState } from '@/lib/verification/state';
import { verificationBadgeView, type VerificationTone } from '@/lib/verification/uiState';

/**
 * The one identity-verification badge. Every surface that shows verification
 * status renders THIS component — centre home, teacher home, teacher settings,
 * admin account detail. None of them draws its own pill and none of them
 * decides its own label.
 *
 * The design (`Merged-Center-Home` §01 `.vbadge`, `Merged-Teacher-Home` §01
 * `.vchip`, `Merged-Teacher-Setup` §01, `Merged-Admin-Accounts` §01) draws
 * "Verified" in every frame it appears in, with no unverified twin — 5 of 5
 * frames in `Merged-Center-Attendance` §01, per
 * `design/BUILD-AFTER-REDESIGN.md:801`. That is a design-side fabrication. This
 * component renders whichever state is true, and today that is
 * "Verification unavailable", because the Valify credentials are placeholders
 * and the schema has no verification columns.
 *
 * Logical CSS only (`ms-`/`me-`/`gap`), so it mirrors correctly in RTL.
 */

const TONE_CLASS: Record<VerificationTone, string> = {
  verified: 'border-[var(--color-accent)]/25 bg-[var(--color-mint)] text-[var(--color-accent-deep)]',
  pending: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  attention: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  neutral: 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
  unavailable:
    'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]',
};

const TONE_ICON: Record<VerificationTone, typeof Shield> = {
  verified: BadgeCheck,
  pending: Clock,
  attention: ShieldAlert,
  neutral: Shield,
  unavailable: ShieldOff,
};

export default function VerificationBadge({
  state,
  className = '',
}: {
  state: VerificationState;
  className?: string;
}) {
  const t = useTranslations('verification');
  const view = verificationBadgeView(state);
  if (!view.show) return null;

  const Icon = TONE_ICON[view.tone];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill border px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[view.tone]} ${className}`}
      // The unavailable state is the one a reader is most likely to
      // misinterpret, so it carries the full explanation as its accessible
      // name rather than relying on a nearby paragraph.
      title={view.tone === 'unavailable' ? t('cta.reason.unavailable') : undefined}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {t(view.labelKey)}
    </span>
  );
}
