'use client';

import { useMemo } from 'react';
import { useToast as useToastFromContext } from '@/contexts/ToastContext';

/**
 * Shorthand: `toast.success('…')` etc. For full API (`dismiss`, raw `toast(msg, variant)`)
 * import `useToast` from `@/contexts/ToastContext`.
 */
export function useToast() {
  const { toast: push } = useToastFromContext();
  return useMemo(
    () => ({
      success: (message: string, duration?: number) => push(message, 'success', duration),
      error: (message: string, duration?: number) => push(message, 'error', duration),
      warning: (message: string, duration?: number) => push(message, 'warning', duration),
      info: (message: string, duration?: number) => push(message, 'info', duration),
    }),
    [push]
  );
}
