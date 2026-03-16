'use client';

import { useToastContext } from '@/contexts/ToastContext';

export function useToast() {
  return useToastContext().toast;
}
