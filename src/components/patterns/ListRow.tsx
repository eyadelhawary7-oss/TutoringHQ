'use client';

import { MoreVertical } from 'lucide-react';

interface ListRowBaseProps {
  /** Initials or a short mark for the design's `.av` tile. Omit for a row with no avatar. */
  avatar?: string;
  title: string;
  meta?: React.ReactNode;
  /**
   * Trailing slot — the design's `.badge`. Prefer `StatusPill` from
   * `@/components/shared`, or one of the six domain badges that render the same
   * `.badge` chrome. Left as a node because three live adopters put a figure
   * here (an amount, a count) rather than a status, which is a different thing
   * from a pill and is not something StatusPill should be made to express.
   */
  badge?: React.ReactNode;
  /** Row tap. Omit for a non-interactive row. */
  onOpen?: () => void;
  /**
   * `'card'` (default) is §03/§04/§06 `.lrow` — a bordered panel with a radius.
   * `'bare'` is §05 `.mrow` — a member row INSIDE a card, which has no chrome of
   * its own and separates from its neighbour with a hairline only. A card
   * inside a card reads as two levels of nesting where there is one.
   */
  variant?: 'card' | 'bare';
}

/**
 * The three-dot and its accessible name are one thing, so the type makes them
 * one thing: pass `onActions` and `actionsLabel` is required; pass neither and
 * neither is asked for.
 *
 * `actionsLabel` deliberately has NO English fallback. The old
 * `actionsLabel ?? 'Actions'` shipped a hardcoded English string to Arabic
 * users on every row that opened a sheet, and a default is exactly what makes
 * that invisible. `common.actions` exists in both locales — pass `t('actions')`.
 *
 * Making it unconditionally required instead would have forced a label onto
 * eight call sites that render no three-dot at all, which is noise rather than
 * enforcement.
 */
type ListRowActionProps =
  | { onActions: () => void; actionsLabel: string }
  | { onActions?: undefined; actionsLabel?: never };

type ListRowProps = ListRowBaseProps & ListRowActionProps;

/**
 * The list row, to `Merged-Design-Patterns` §03 / §04 / §05 / §06.
 *
 *   .lrow { #FFFDF8; 1px #E2DDD1; radius 12; padding 12 16; gap 12 }
 *   .mrow { no chrome; padding 12 0; border-bottom 1px #ECE8DF }
 *   .av   { 40×40; radius 12; #DFEEEB on #0A514A; 13px/600 }
 *   .nm   { 15px / 600 }
 *   .mt   { 12px; #80827A }
 *   .kb   { #A09A8E }
 *
 * §03 is the row itself; §04 is the sheet it opens. They are one pattern split
 * across two sheets in the design, so they are one component pair here.
 *
 * NO CHEVRON. The design draws none on any `.lrow` in §03, §04, §05 or §06 —
 * the trailing affordance is the three-dot, and the file's only chevron is
 * inside the sheet's "Open …" row, which is `SheetAction.navigates` in
 * `ActionSheet`. The locale-flip logic that used to live here moved there with
 * it. A chevron and a three-dot on the same row promise two destinations.
 *
 * The three-dot is `--color-faint` (#A09A8E), matching `.kb`. §06 draws it
 * quieter still at #D8D3C6, but tokens.css marks that value reference-file
 * background only and explicitly not product UI, so it is not taken here.
 */
export default function ListRow({
  avatar,
  title,
  meta,
  badge,
  onOpen,
  onActions,
  actionsLabel,
  variant = 'card',
}: ListRowProps) {
  const shell =
    variant === 'bare'
      ? 'border-b border-[var(--color-paper)] py-3 last:border-b-0'
      : 'rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 shadow-sm';

  return (
    <div className={`flex items-center gap-3 ${shell}`}>
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
        </button>
      ) : (
        /* The design draws every .lrow as tappable. This branch is kept anyway:
           a schedule slot with no group assigned has nowhere to navigate to, and
           making it tappable would turn a correct no-op into a broken link. */
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
          aria-label={actionsLabel}
          className="flex h-11 w-11 min-h-[44px] shrink-0 items-center justify-center rounded-md text-[var(--color-faint)] hover:bg-[var(--color-tile)] btn-press chq-focus"
        >
          <MoreVertical className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}
