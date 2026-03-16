'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: {
    success: (message: string, duration?: number) => void;
    error: (message: string, duration?: number) => void;
    warning: (message: string, duration?: number) => void;
    info: (message: string, duration?: number) => void;
  };
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const toast: Toast = { id, type, message, duration };
    setToasts((prev) => [...prev, toast]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useMemo(
    () => ({
      success: (message: string, duration?: number) => addToast('success', message, duration),
      error: (message: string, duration?: number) => addToast('error', message, duration),
      warning: (message: string, duration?: number) => addToast('warning', message, duration),
      info: (message: string, duration?: number) => addToast('info', message, duration),
    }),
    [addToast]
  );

  const value = useMemo(
    () => ({ toasts, toast, dismiss }),
    [toasts, toast, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
