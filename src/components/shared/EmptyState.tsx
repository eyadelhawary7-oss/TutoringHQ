'use client';

import type { LucideIcon } from 'lucide-react';

export type EmptyStateTone = 'accent' | 'quiet';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /**
   * The design's `.es-act`. The default shape is `EmptyStateAction` — a single
   * full-width primary with at most one ghost under it. This stays a node
   * because a handful of screens legitimately need something else in the slot,
   * but a bespoke button here is a divergence, not a customisation.
   */
  action?: React.ReactNode;
  /**
   * The design's `.es-alt` — the quieter line under the primary action naming
   * the alternative route. Every empty state in `Merged-Design-Patterns` §01
   * carries one, because the pattern is that an empty screen always offers a
   * second way forward, not just a button.
   */
  alt?: React.ReactNode;
  /**
   * `.es-ic` vs `.es-ic.quiet`. Accent (mint tile, deep-teal glyph) is the
   * default and is what a state the center is expected to ACT on gets. Quiet
   * (tile fill, muted glyph) is for a state that is merely not-yet-populated
   * and carries no action — §01 draws Insight and Card orders that way, and
   * pairs quiet with no primary button.
   */
  tone?: EmptyStateTone;
}

/**
 * The empty state, to `Merged-Design-Patterns` §01.
 *
 *   .es      { flex 1; centred column; padding 24 24 32 }
 *   .es-ic   { 64×64; radius 16; #DFEEEB on #0A514A; glyph 29px @ 1.9 }
 *   .es-ic.quiet { #F2EEE5 on #80827A }
 *   .es-h    { 17px / 700 }
 *   .es-t    { 13px; #5D635C; line-height 1.6; max-width 31ch }
 *   .es-act  { width 100%; margin-top 24 }
 *   .es-alt  { 11px; #80827A; margin-top 12; max-width 32ch }
 *
 * `flex-1` is what the design specifies — the empty state fills the body and
 * centres in it. It is inert unless the parent is a flex column, and most
 * adopters are not, so `min-h` is the honest fallback that keeps
 * `justify-center` from being a no-op. Adopters whose wrapper IS a flex column
 * get the design's exact behaviour.
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
  tone = 'accent',
}: EmptyStateProps) {
  return (
    <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center px-6 pb-8 pt-6 text-center">
      <div
        className={`mb-4 flex h-16 w-16 shrink-0 items-center justify-center rounded-lg ${
          tone === 'quiet'
            ? 'bg-[var(--color-tile)] text-[var(--color-muted)]'
            : 'bg-[var(--color-mint)] text-[var(--color-accent-deep)]'
        }`}
        aria-hidden
      >
        <Icon className="h-[29px] w-[29px]" strokeWidth={1.9} />
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

interface GhostAction {
  label: string;
  onClick: () => void;
}

/**
 * §01's rule: "One action, never two of equal weight. A primary button and at
 * most one quiet alternative." The type enforces both halves — there is never
 * a second primary, and a state with no action at all passes no
 * `EmptyStateAction` rather than an empty one.
 *
 * A ghost with no primary is the §01 card-orders shape: an optional feature
 * that should be findable without being pushed.
 */
type EmptyStateActionProps =
  | { label: string; onClick: () => void; ghost?: GhostAction }
  | { label?: never; onClick?: never; ghost: GhostAction };

/**
 * §01 `.btn` / `.btn.ghost` — the empty state's action pair.
 *
 *   .btn       { block; w-100%; radius 12; padding 16; 15px/700; #0E6B61 on #FFFDF8 }
 *   .btn.ghost { #FFFDF8; #3A3F3A; 1px #E2DDD1; margin-top 8 }
 *
 * Deliberately NOT the global `.btn-primary` in globals.css — that is a
 * different, widely-used class at 14px/500 on `--radius-inner`, and repointing
 * it at these measures would move every button in the product.
 */
export function EmptyStateAction({ label, onClick, ghost }: EmptyStateActionProps) {
  return (
    <>
      {label && (
        <button
          type="button"
          onClick={onClick}
          className="block w-full rounded-md bg-[var(--color-accent)] p-4 text-center text-md font-bold text-[var(--color-panel)] hover:bg-[var(--color-accent-deep)] btn-press chq-focus"
        >
          {label}
        </button>
      )}
      {ghost && (
        <button
          type="button"
          onClick={ghost.onClick}
          className={`block w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-center text-md font-bold text-[var(--color-ink-body)] hover:bg-[var(--color-tile)] btn-press chq-focus ${
            label ? 'mt-2' : ''
          }`}
        >
          {ghost.label}
        </button>
      )}
    </>
  );
}
