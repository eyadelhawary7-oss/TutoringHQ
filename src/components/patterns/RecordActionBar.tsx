'use client';

import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface RecordActionBarProps {
  primaryLabel: string;
  primaryIcon?: LucideIcon;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** Up to two icon buttons beside the primary. More than that belongs in the sheet. */
  secondary?: { id: string; icon: LucideIcon; label: string; onSelect: () => void }[];
  /** Opens the same shared ActionSheet the row's three-dot opens. */
  onMore: () => void;
  moreLabel?: string;
}

/**
 * The pinned action bar on a record page, to `Merged-Design-Patterns` §05.
 *
 *   .actionbar   { border-top #E2DDD1; #FFFDF8; padding 12 16; gap 8 }
 *   .btn-primary { flex 1; height 50; #0E6B61; radius 12; 15px/600 }
 *   .iconbtn     { 50×50; radius 12; #FFFDF8; 1px #E2DDD1 }
 *
 * §05's point is that there are **two ways to the same actions**: the quick
 * menu from the list row, and this bar on the record page — whose More button
 * opens *the same sheet*. That is why `onMore` exists and why callers should
 * pass the identical `SheetAction[]` they gave the row. Building a second,
 * different menu here is the drift the shared-primitive rule exists to stop.
 *
 * `sticky bottom-0` rather than `fixed`: the app already reserves bottom space
 * for the tab bar via env(safe-area-inset-bottom), and a fixed bar would sit
 * on top of it.
 */
export default function RecordActionBar({
  primaryLabel,
  primaryIcon: PrimaryIcon,
  onPrimary,
  primaryDisabled,
  secondary = [],
  onMore,
  moreLabel,
}: RecordActionBarProps) {
  return (
    <div className="sticky bottom-0 flex items-center gap-2 border-t border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] text-md font-semibold text-[var(--color-panel)] shadow-[0_2px_10px_rgba(14,107,97,0.28)] hover:bg-[var(--color-accent-deep)] disabled:opacity-50 btn-press chq-focus"
      >
        {PrimaryIcon && <PrimaryIcon className="h-5 w-5" aria-hidden />}
        {primaryLabel}
      </button>

      {secondary.slice(0, 2).map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            type="button"
            onClick={s.onSelect}
            aria-label={s.label}
            className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-ink-body)] hover:bg-[var(--color-tile)] btn-press chq-focus"
          >
            <Icon className="h-5 w-5" aria-hidden />
          </button>
        );
      })}

      <button
        type="button"
        onClick={onMore}
        aria-label={moreLabel ?? 'More'}
        className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-ink-body)] hover:bg-[var(--color-tile)] btn-press chq-focus"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
