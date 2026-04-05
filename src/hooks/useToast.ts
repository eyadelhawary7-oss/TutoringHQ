'use client';

import { useToast as useToastFromProvider } from '@/components/ui/ToastProvider';

/**
 * Returns the toast API (`toast.success`, `toast.error`, …) for one-line usage.
 * For `dismiss` / `show`, use `useToast` from `@/components/ui/ToastProvider`.
 */
export function useToast() {
  const { toast } = useToastFromProvider();
  return toast;
}
