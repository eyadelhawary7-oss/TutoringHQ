'use client';

import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';

/**
 * Shared slide-over shell for the schedule sheets: full-width bottom sheet on
 * mobile, inline-end panel on md+ (logical positioning, so it mirrors in RTL).
 */
export default function SheetShell({
  open,
  title,
  subtitle,
  closeLabel,
  onClose,
  children,
  footer,
  scrollContainerRef,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional ref to the scrollable body, so callers can drive scroll-to-anchor. */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] md:inset-x-auto md:inset-y-0 md:end-0 md:max-h-none md:w-[420px] md:rounded-none md:border-y-0 md:border-e-0 md:border-s"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-lg p-2 transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <X className="h-5 w-5 text-[var(--color-text-secondary)]" aria-hidden />
          </button>
        </div>
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer && (
          <div className="border-t border-[var(--color-border-subtle)] px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
