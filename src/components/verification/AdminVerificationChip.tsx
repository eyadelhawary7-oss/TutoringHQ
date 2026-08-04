'use client';

import { useTranslations } from 'next-intl';
import { BadgeCheck, Clock, ShieldAlert, ShieldOff, Shield } from 'lucide-react';
import type { VerificationState } from '@/lib/verification/state';
import { adminVerificationView, type VerificationTone } from '@/lib/verification/uiState';

/**
 * Admin-facing verification chip. Unlike the provider-facing badge, this one
 * carries the NAMED CAUSE, because an internal operator who sees "unavailable"
 * with no reason cannot fix anything.
 *
 * Replaces two design fabrications:
 *  - `Merged-Admin-Accounts` §01 draws a "Verified" chip plus
 *    "National ID on file · Valify · 2 9805 15 01 02345" on every frame. There
 *    is no verification column on `centers` and no ID is or will be rendered
 *    (VERIFICATION-SPEC §9.2 item 3, §9.7: none of the twelve verified screens
 *    needs the number, and admin has less reason to see it than the owner).
 *  - `Merged-Admin-Platform` §02 draws the Valify vendor row as "Connected"
 *    with a green dot. Nothing is connected.
 *
 * The chip never renders a National ID and has no prop that could carry one.
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

export default function AdminVerificationChip({
  state,
  /**
   * `chip` — the pill alone, for a chip row.
   * `cause` — the named cause as a sentence, for once-per-screen explanation.
   * Split because a chip row wants brevity and an operator wants the reason,
   * and repeating a paragraph on every chip is unreadable.
   */
  variant = 'chip',
  className = '',
}: {
  state: VerificationState;
  variant?: 'chip' | 'cause';
  className?: string;
}) {
  const t = useTranslations('verification');
  const view = adminVerificationView(state);
  const Icon = TONE_ICON[view.tone];

  if (variant === 'cause') {
    if (!view.causeKey) return null;
    return (
      <p className={`text-xs leading-relaxed text-[var(--color-text-muted)] ${className}`}>
        {t(view.causeKey)}
      </p>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[view.tone]} ${className}`}
      title={view.causeKey ? t(view.causeKey) : undefined}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {t(view.labelKey)}
    </span>
  );
}
