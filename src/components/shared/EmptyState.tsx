'use client';

import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * The design's `.es-alt` — the quieter line under the primary action naming
   * the alternative route. Every empty state in `Merged-Design-Patterns` §01
   * carries one, because the pattern is that an empty screen always offers a
   * second way forward, not just a button.
   */
  alt?: React.ReactNode;
  /**
   * The design's `.es-ic.quiet` — `#F2EEE5` on `#80827A` instead of the mint
   * tile. §01's rules block makes this a real distinction, not a shade choice:
   * "Empty because it is early gets the muted icon and no button. Insight and
   * card orders are not waiting on anyone. Giving them a call to action invents
   * work." A screen that fills itself uses `quiet` and passes no `action`; a
   * screen waiting on the owner keeps the mint tile and offers the one action.
   */
  quiet?: boolean;
}

/**
 * The empty state, to `Merged-Design-Patterns` §01.
 *
 *   .es      { centred column; padding 24 24 32 }
 *   .es-ic   { 64×64; radius 16; background #DFEEEB; colour #0A514A }
 *   .es-h    { 17px / 700 }
 *   .es-t    { 13px; #5D635C; line-height 1.6; max-width 31ch }
 *   .es-act  { width 100%; margin-top 24 }
 *   .es-alt  { 11px; #80827A; margin-top 12; max-width 32ch }
 *
 * This component already existed with 11 adopters, which is exactly why it read
 * as done — but five of its six parts were wrong and `.es-alt` was missing
 * outright. The icon especially: a bare 48px muted glyph rather than a mint
 * tile, so an empty screen had nothing to anchor on.
 *
 * The `ch` measures come straight from the design and are what stop the body
 * text running the full width of a tablet. They are logical, so RTL is
 * unaffected.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  alt,
  quiet,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 pb-8 pt-6 text-center">
      <div
        className={`mb-4 flex h-16 w-16 shrink-0 items-center justify-center rounded-lg ${
          quiet
            ? 'bg-[var(--color-tile)] text-[var(--color-muted)]'
            : 'bg-[var(--color-mint)] text-[var(--color-accent-deep)]'
        }`}
        aria-hidden
      >
        <Icon className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <p className="text-lg font-bold leading-tight text-[var(--color-ink)]">{title}</p>
      {description && (
        <p className="mt-2 max-w-[31ch] text-base leading-relaxed text-[var(--color-mid)]">
          {description}
        </p>
      )}
      {action && <div className="mt-6 w-full">{action}</div>}
      {alt && (
        <p className="mt-3 max-w-[32ch] text-xs leading-normal text-[var(--color-muted)]">{alt}</p>
      )}
    </div>
  );
}
