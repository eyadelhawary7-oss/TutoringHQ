'use client';

import type { ReactNode } from 'react';
import type { MicroState } from '@/hooks/useMicroInteraction';

type Props = {
  children: ReactNode;
  state?: MicroState;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  disabled?: boolean;
  successIcon?: ReactNode;
  loadingText?: string;
};

export function LoadingButton({
  children,
  state = 'idle',
  onClick,
  type = 'button',
  className = '',
  disabled = false,
  successIcon,
  loadingText,
}: Props) {
  const isLoading = state === 'loading';
  const isSuccess = state === 'success';
  const isError = state === 'error';

  const stateClass = isLoading ? 'is-loading' : isSuccess ? 'is-success' : isError ? 'is-error' : '';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`btn ${stateClass} ${className}`.trim()}
      aria-busy={isLoading}
      aria-label={isLoading && loadingText ? loadingText : undefined}
    >
      {isSuccess && successIcon ? successIcon : children}
    </button>
  );
}
