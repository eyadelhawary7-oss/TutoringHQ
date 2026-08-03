'use client';

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * One action inside the sheet.
 *
 * `managerOnly` renders the design's `.mgr` tag. It is a LABEL, not a gate —
 * the caller is still responsible for the permission check. Tagging an action
 * the current user cannot perform, and letting them tap it, would be worse than
 * not tagging it, so callers should filter first and tag second.
 */
export interface SheetAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /**
   * The design's `.act .al .s` — the second line under the label.
   *
   * Optional at the type level, but §04 draws one on every action and on a
   * DESTRUCTIVE action this is where the consequence lives. "Remove from
   * center" is a bare verb; "Remove from center / Ends enrollment" is the same
   * action with the thing it does attached. Write the consequence, not a
   * restatement of the label.
   *
   * Only ever a value that has a live source. §04 also draws "Adjust cut ·
   * Currently 30%" — there is no percentage in this product's data model
   * (`student_groups.teacher_split_pct` is NULL on every row and read by
   * nothing; the real field is `center_cut_egp`, in pounds), so a caller
   * wanting that subtitle passes a formatted EGP figure and copy that says EGP.
   * Do not put a number here that nothing computed.
   */
  description?: string;
  /**
   * Renders the trailing chevron — this action leaves the sheet for another
   * screen. §04's "Open student" row. The glyph swaps by locale rather than
   * being CSS-mirrored, because a mirrored ChevronRight still points right in a
   * screenshot.
   */
  navigates?: boolean;
  /** Renders the brass Manager tag. Presentational — does not gate anything. */
  managerOnly?: boolean;
  /** Destructive actions take `--color-danger`. */
  destructive?: boolean;
  /**
   * The design draws no disabled action. Kept regardless: this is how a
   * plan-limited or permission-blocked action stays visible-but-inert. The
   * alternative is hiding it, which is how a paid feature loses its only
   * entry point and the center never learns the feature exists.
   */
  disabled?: boolean;
}

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  /** The design's `.sheet-h` — what this sheet is acting on. */
  title: string;
  subtitle?: string;
  actions: SheetAction[];
}

/**
 * The bottom action sheet, to `Merged-Design-Patterns` §04.
 *
 *   .scrim  { inset 0; rgba(20,24,22,.42) }
 *   .sheet  { bottom; radius 24 24 0 0; padding 8 16 24 }
 *   .grab   { 38×4; radius pill; #E2DDD1 }
 *   .act    { row; gap 12; padding 12 4; border-top #F2EEE5 }
 *   .act .ai { 40×40; radius 12; #F2EEE5 on #0E6B61 }
 *   .act.danger .ai { #F0ECE2 on #9C3322 }
 *   .act .al .t { 15px/600 }   .act .al .s { 12px; #80827A; margin-top 4 }
 *   .mgr    { 11px/700 uppercase; #9A6B1F on #F4EBD7; radius 4 }
 *   .chev   { 18px; #A09A8E }
 *
 * The header is 17px, not the design's 16px. There is no 16 step on the scale
 * (text-md is 15, text-lg is 17) and §2 of the token spec closes the scale, so
 * this rounds UP deliberately: the sheet header is a section heading, and at 15
 * it would be the same size as the actions under it — which is exactly the
 * collapse the 15/600 action label fixes. A 16px token for one call site is not
 * worth reopening the scale.
 *
 * §04's rule is "one sheet, one gesture": the same sheet opens from every row,
 * and only its contents change to fit what the row is. A student offers payment
 * and parent contact, a session offers attendance and reschedule. That is why
 * this takes `actions` rather than knowing about rows — the row decides, the
 * sheet only presents.
 *
 * Closes on Escape and on scrim tap. Focus moves to the sheet on open and the
 * body scroll locks, because a sheet that leaves the list scrollable behind it
 * reads as a popover rather than a mode.
 */
export default function ActionSheet({ open, onClose, title, subtitle, actions }: ActionSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('patterns');
  const locale = useLocale();
  const isRtl = locale === 'ar' || locale.startsWith('ar-');
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div
        className="absolute inset-0 bg-[rgba(20,24,22,0.42)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 rounded-t-xl bg-[var(--color-panel)] px-4 pb-6 pt-2 shadow-[0_-8px_30px_rgba(28,33,30,0.18)] outline-none"
      >
        <div className="mx-auto mb-3 mt-1 h-1 w-[38px] rounded-pill bg-[var(--color-line)]" aria-hidden />
        <div className="flex flex-col gap-1 px-1 pb-2">
          <p className="text-lg font-semibold text-[var(--color-ink)]">{title}</p>
          {subtitle && <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>}
        </div>
        <ul>
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={a.disabled}
                  onClick={() => {
                    a.onSelect();
                    onClose();
                  }}
                  className={`flex w-full min-h-[44px] items-center gap-3 border-t border-[var(--color-tile)] px-1 py-3 text-start disabled:opacity-50 btn-press chq-focus ${
                    a.destructive ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-body)]'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
                      a.destructive
                        ? 'bg-[var(--color-hairline)] text-[var(--color-danger)]'
                        : 'bg-[var(--color-tile)] text-[var(--color-accent)]'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-md font-semibold">
                      {a.label}
                      {a.managerOnly && (
                        <span className="rounded-xs bg-[var(--color-sand)] px-2 py-1 text-xs font-bold uppercase tracking-wider text-[var(--color-brass)]">
                          {t('manager')}
                        </span>
                      )}
                    </span>
                    {a.description && (
                      <span className="mt-1 block text-sm text-[var(--color-muted)]">
                        {a.description}
                      </span>
                    )}
                  </span>
                  {a.navigates && (
                    <Chevron className="h-[18px] w-[18px] shrink-0 text-[var(--color-faint)]" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
