'use client';

import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

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
  /** Renders the brass MANAGER tag. Presentational — does not gate anything. */
  managerOnly?: boolean;
  /** Destructive actions take `--color-danger`. */
  destructive?: boolean;
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
 *   .mgr    { 11px/700 uppercase; #9A6B1F on #F4EBD7; radius 4 }
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
          <p className="text-md font-semibold text-[var(--color-ink)]">{title}</p>
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
                  className={`flex w-full min-h-[44px] items-center gap-3 border-t border-[var(--color-hairline)] px-1 py-3 text-start disabled:opacity-50 btn-press chq-focus ${
                    a.destructive ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-body)]'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="flex-1 text-base font-medium">{a.label}</span>
                  {a.managerOnly && (
                    <span className="rounded-xs bg-[var(--color-sand)] px-2 py-1 text-xs font-bold uppercase tracking-wider text-[var(--color-brass)]">
                      MGR
                    </span>
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
