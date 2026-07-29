'use client';

import { MoreVertical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface InlineAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

interface ExpandableRowProps {
  avatar?: string;
  title: string;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  /**
   * The three actions reached for most. §06 is explicit that this is THREE —
   * the point is that the common case never leaves the list. Anything beyond
   * three belongs behind More, or the row is doing too much.
   */
  inlineActions: InlineAction[];
  /** The More chip and the three-dot both open the same shared ActionSheet. */
  onMore: () => void;
  moreLabel: string;
}

/**
 * The expand-in-place row, to `Merged-Design-Patterns` §06.
 *
 *   .expcard { #FFFDF8; 1px #0E6B61; radius 16; ring 2px rgba(14,107,97,.14) }
 *   .exphead { row; gap 12 }
 *   .expacts { row; gap 8 }
 *   .chip    { flex 1; column; gap 4; padding 12 4; 1px #E2DDD1; radius 12; 11px/600 }
 *
 * §06 merges §03 and §04 rather than replacing them: tapping expands to the top
 * three actions inline, the More chip opens the full sheet, and the three-dot
 * still jumps straight to that sheet. All three routes are kept here — dropping
 * the three-dot would make the sheet reachable only through an expand, which is
 * an extra tap for someone who already knows what they want.
 *
 * The expanded state is an accent border plus a soft ring, not a fill. On a
 * list where one row is open, a filled row reads as selected-and-disabled; a
 * ring reads as focused.
 */
export default function ExpandableRow({
  avatar,
  title,
  meta,
  badge,
  expanded,
  onToggle,
  inlineActions,
  onMore,
  moreLabel,
}: ExpandableRowProps) {
  if (!expanded) {
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
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          className="min-w-0 flex-1 text-start min-h-[44px] btn-press chq-focus"
        >
          <span className="block truncate text-md font-semibold text-[var(--color-ink)]">{title}</span>
          {meta && <span className="mt-1 block text-sm text-[var(--color-muted)]">{meta}</span>}
        </button>
        {badge}
        <button
          type="button"
          onClick={onMore}
          aria-label={moreLabel}
          className="flex h-11 w-11 min-h-[44px] shrink-0 items-center justify-center rounded-md text-[var(--color-ink-body)] hover:bg-[var(--color-tile)] btn-press chq-focus"
        >
          <MoreVertical className="h-5 w-5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-accent)] bg-[var(--color-panel)] p-4 shadow-[0_0_0_2px_rgba(14,107,97,0.14)]">
      <div className="flex items-center gap-3">
        {avatar && (
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-mint)] text-base font-semibold text-[var(--color-accent-deep)]"
            aria-hidden
          >
            {avatar}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded
          className="min-w-0 flex-1 text-start min-h-[44px] btn-press chq-focus"
        >
          <span className="block truncate text-md font-semibold text-[var(--color-ink)]">{title}</span>
          {meta && <span className="mt-1 block text-sm text-[var(--color-muted)]">{meta}</span>}
        </button>
        {badge}
      </div>

      <div className="flex gap-2">
        {inlineActions.slice(0, 3).map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.id}
              type="button"
              onClick={a.onSelect}
              disabled={a.disabled}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-1 py-3 text-xs font-semibold text-[var(--color-ink-body)] disabled:opacity-50 btn-press chq-focus"
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate">{a.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-1 py-3 text-xs font-semibold text-[var(--color-ink-body)] btn-press chq-focus"
        >
          <MoreVertical className="h-5 w-5" aria-hidden />
          <span className="max-w-full truncate">{moreLabel}</span>
        </button>
      </div>
    </div>
  );
}
