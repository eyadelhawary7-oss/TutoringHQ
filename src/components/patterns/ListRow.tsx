'use client';

import { ChevronLeft, ChevronRight, MoreVertical } from 'lucide-react';
import { useLocale } from 'next-intl';

interface ListRowProps {
  /** Initials or a short mark for the design's `.av` tile. Omit for a row with no avatar. */
  avatar?: string;
  title: string;
  meta?: React.ReactNode;
  /** Right-hand badge — a status pill, an amount, anything short. */
  badge?: React.ReactNode;
  /** Row tap. Omit for a non-interactive row. */
  onOpen?: () => void;
  /** Opens the shared ActionSheet. When omitted the three-dot is not rendered. */
  onActions?: () => void;
  actionsLabel?: string;
  /** Renders the chevron affordance. Off when the row only has a sheet. */
  chevron?: boolean;
}

/**
 * The list row, to `Merged-Design-Patterns` §03 / §04.
 *
 *   .lrow { #FFFDF8; 1px #E2DDD1; radius 12; padding 12 16; gap 12 }
 *   .av   { 40×40; radius 12; #DFEEEB on #0A514A; 13px/600 }
 *   .nm   { 15px / 600 }
 *   .mt   { 12px; #80827A }
 *   .kb   { #A09A8E }
 *
 * §03 is the row itself; §04 is the sheet it opens. They are one pattern split
 * across two sheets in the design, so they are one component pair here.
 *
 * The chevron flips with the locale rather than being mirrored by CSS. A
 * `ChevronRight` under `dir=rtl` still points right — transform-based mirroring
 * is what the design means by "directional icons flip with the language", and
 * swapping the glyph is the only version of that which survives a screenshot.
 */
export default function ListRow({
  avatar,
  title,
  meta,
  badge,
  onOpen,
  onActions,
  actionsLabel,
  chevron = true,
}: ListRowProps) {
  const locale = useLocale();
  const isRtl = locale === 'ar' || locale.startsWith('ar-');
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 shadow-sm">
      {avatar && (
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-mint)] text-base font-semibold text-[var(--color-accent-deep)]"
          aria-hidden
        >
          {avatar}
        </span>
      )}

      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-start min-h-[44px] btn-press chq-focus"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-md font-semibold text-[var(--color-ink)]">{title}</span>
            {meta && <span className="mt-1 block text-sm text-[var(--color-muted)]">{meta}</span>}
          </span>
          {chevron && <Chevron className="h-3 w-3 shrink-0 text-[var(--color-faint)]" aria-hidden />}
        </button>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-semibold text-[var(--color-ink)]">{title}</p>
          {meta && <p className="mt-1 text-sm text-[var(--color-muted)]">{meta}</p>}
        </div>
      )}

      {badge}

      {onActions && (
        <button
          type="button"
          onClick={onActions}
          aria-label={actionsLabel ?? 'Actions'}
          className="flex h-11 w-11 min-h-[44px] shrink-0 items-center justify-center rounded-md text-[var(--color-ink-body)] hover:bg-[var(--color-tile)] btn-press chq-focus"
        >
          <MoreVertical className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}
