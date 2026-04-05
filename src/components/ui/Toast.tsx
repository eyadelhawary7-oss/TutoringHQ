'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const COLORS: Record<ToastType, { bar: string; icon: string; bg: string; border: string }> = {
  success: { bar: '#0D9488', icon: '#0D9488', bg: '#0F172A', border: '#0D948840' },
  error: { bar: '#EF4444', icon: '#EF4444', bg: '#0F172A', border: '#EF444440' },
  warning: { bar: '#F59E0B', icon: '#F59E0B', bg: '#0F172A', border: '#F59E0B40' },
  info: { bar: '#64748B', icon: '#94A3B8', bg: '#0F172A', border: '#64748B40' },
};

export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const t = useTranslations('toasts');
  const progressRef = useRef<HTMLDivElement>(null);
  const duration = toast.duration ?? 4000;
  const c = COLORS[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    const el = progressRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.style.transition = `width ${duration}ms linear`;
        el.style.width = '0%';
      });
    }
    return () => clearTimeout(timer);
  }, [toast.id, duration, onDismiss]);

  return (
    <div
      className="chq-slide-up pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl shadow-2xl"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{ color: c.icon, background: `${c.icon}15` }}
        >
          {ICONS[toast.type]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100">{toast.title}</p>
          {toast.description ? (
            <p className="mt-0.5 text-xs text-slate-400">{toast.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="btn-press shrink-0 text-slate-500 transition-colors hover:text-slate-300"
          aria-label={t('dismiss')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="h-0.5 w-full" style={{ background: `${c.bar}30` }}>
        <div ref={progressRef} className="h-full" style={{ width: '100%', background: c.bar }} />
      </div>
    </div>
  );
}
