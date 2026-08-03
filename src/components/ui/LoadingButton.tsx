'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import { SuccessCheck } from './SuccessCheck';

/**
 * `Merged-Design-Patterns` §02, "an action in flight":
 *
 *   "The button keeps its own label rather than turning into the word Loading,
 *    it dims rather than disappearing, and it stays the same size so nothing
 *    under it moves."
 *
 * There is deliberately NO `loadingText` prop. This component used to have one
 * and both of its call sites passed the literal word "Loading", which is the
 * exact failure the rule names — the person loses sight of what they pressed at
 * the moment they most need it, and on a payments screen that is the difference
 * between waiting and pressing again. The label is invariant across all four
 * states; only the glyph and the dimming change.
 */
interface LoadingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  state?: 'idle' | 'loading' | 'success' | 'error';
  successText?: string;
  errorText?: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

const VARIANT_CLASSES: Record<string, string> = {
  primary: 'bg-teal-600 hover:bg-teal-700 text-white',
  secondary:
    'bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text-primary)]',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  ghost:
    'bg-transparent hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
};

export function LoadingButton({
  state = 'idle',
  successText,
  errorText,
  children,
  variant = 'primary',
  className = '',
  disabled,
  ...props
}: LoadingButtonProps) {
  const isLoading = state === 'loading';
  const isSuccess = state === 'success';
  const isError = state === 'error';

  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      className={[
        'btn-press chq-focus',
        'inline-flex items-center justify-center gap-2',
        'px-4 py-2 rounded-lg font-medium text-sm',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed',
        // §02: dims rather than disappearing. .inflight is opacity .72; the
        // idle-disabled case keeps the heavier 60 it already had.
        isLoading ? 'opacity-[0.72]' : 'disabled:opacity-60',
        VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.primary,
        className,
      ].join(' ')}
    >
      {isLoading && (
        <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {isSuccess && <SuccessCheck size={18} color="currentColor" />}
      {isSuccess ? (successText ?? children) : isError ? (errorText ?? children) : children}
    </button>
  );
}
