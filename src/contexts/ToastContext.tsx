'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  exiting: boolean;
};

type ToastContextValue = {
  toasts: Toast[];
  toast: (message: string, variant?: ToastVariant, duration?: number) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'bg-[var(--color-success)] text-white',
  error: 'bg-[var(--color-danger)] text-white',
  warning: 'bg-[var(--color-warning)] text-white',
  info: 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)] border border-[var(--color-border-default)]',
};

const PROGRESS_COLORS: Record<ToastVariant, string> = {
  success: 'rgba(255,255,255,0.4)',
  error: 'rgba(255,255,255,0.4)',
  warning: 'rgba(255,255,255,0.4)',
  info: 'var(--color-brand-500)',
};

function ToastItem({
  toast: t,
  onDismiss,
  enterClass,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  enterClass: 'toast-enter-top' | 'toast-enter-bottom';
}) {
  return (
    <div role="alert" aria-live="polite" onClick={() => onDismiss(t.id)} className={`relative overflow-hidden rounded-[var(--radius-card)] shadow-lg px-4 py-3 min-w-[260px] max-w-[360px] cursor-pointer select-none ${VARIANT_STYLES[t.variant]} ${t.exiting ? 'toast-exit' : enterClass}`}>
      <p className="text-sm font-medium pe-4">{t.message}</p>
      <div
        className="toast-progress-bar"
        style={{
          animationDuration: `${t.duration}ms`,
          background: PROGRESS_COLORS[t.variant],
        }}
      />
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const mainTimer = timersRef.current.get(id);
    if (mainTimer) {
      clearTimeout(mainTimer);
      timersRef.current.delete(id);
    }

    const prevExit = timersRef.current.get(`${id}-exit`);
    if (prevExit) clearTimeout(prevExit);

    setToasts((prev) => prev.map((toastItem) => (toastItem.id === id ? { ...toastItem, exiting: true } : toastItem)));

    const exitTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((toastItem) => toastItem.id !== id));
      timersRef.current.delete(`${id}-exit`);
    }, 200);
    timersRef.current.set(`${id}-exit`, exitTimer);
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = 'info', duration = 3500) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts((prev) => {
        const next = [...prev, { id, message, variant, duration, exiting: false }];
        return next.slice(-3);
      });
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}

      {/* Outer wrappers must stay pointer-events-none so fixed layers do not steal clicks from sidebar / nav (toasts use pointer-events-auto on items only). */}
      <div className="fixed bottom-[calc(56px_+_env(safe-area-inset-bottom,0px)_+_8px)] inset-x-0 flex flex-col-reverse items-center gap-2 px-4 z-[9998] lg:hidden pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-sm">
            <ToastItem toast={t} onDismiss={dismiss} enterClass="toast-enter-bottom" />
          </div>
        ))}
      </div>

      <div className="fixed top-4 end-4 flex flex-col items-end gap-2 z-[9998] hidden lg:flex pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} enterClass="toast-enter-top" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/** @deprecated Prefer `useToast` from this module — alias for the same hook */
export const useToastContext = useToast;
