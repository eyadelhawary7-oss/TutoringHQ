'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ToastItem, type Toast, type ToastType } from './Toast';

export interface ToastContextValue {
  toast: {
    success: (title: string, description?: string) => void;
    error: (title: string, description?: string) => void;
    warning: (title: string, description?: string) => void;
    info: (title: string, description?: string) => void;
    show: (type: ToastType, title: string, description?: string, duration?: number) => void;
    dismiss: (id: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastRegion({ children, toasts, dismiss }: { children: ReactNode; toasts: Toast[]; dismiss: (id: string) => void }) {
  const t = useTranslations('toasts');
  return (
    <>
      {children}
      <div
        aria-live="polite"
        aria-label={t('notificationsRegion')}
        className="pointer-events-none fixed bottom-4 inset-x-0 z-[9999] flex w-full flex-col items-center gap-2 px-4 sm:bottom-auto sm:inset-x-auto sm:start-auto sm:end-4 sm:top-4 sm:w-auto sm:items-end sm:px-0"
      >
        {toasts.map((x) => (
          <ToastItem key={x.id} toast={x} onDismiss={dismiss} />
        ))}
      </div>
    </>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((type: ToastType, title: string, description?: string, duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => {
      const next = [...prev, { id, type, title, description, duration }];
      return next.slice(-3);
    });
  }, []);

  const toast = {
    success: (title: string, desc?: string) => show('success', title, desc),
    error: (title: string, desc?: string) => show('error', title, desc),
    warning: (title: string, desc?: string) => show('warning', title, desc),
    info: (title: string, desc?: string) => show('info', title, desc),
    show,
    dismiss,
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastRegion toasts={toasts} dismiss={dismiss}>
        {children}
      </ToastRegion>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
