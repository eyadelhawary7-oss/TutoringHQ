'use client';

import { useToastContext } from '@/contexts/ToastContext';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'bg-green-50 border-green-200 text-green-800 [&>svg]:text-green-600',
  error: 'bg-red-50 border-red-200 text-red-800 [&>svg]:text-red-600',
  warning: 'bg-amber-50 border-amber-200 text-amber-800 [&>svg]:text-amber-600',
  info: 'bg-blue-50 border-blue-200 text-blue-800 [&>svg]:text-blue-600',
};

export default function ToastContainer() {
  const { toasts, dismiss } = useToastContext();

  return (
    <div
      className="fixed z-[9999] flex flex-col gap-2 p-4 min-w-[280px] max-w-[calc(100vw-2rem)]"
      style={{
        insetInlineStart: 16,
        insetBlockStart: 16,
      }}
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg toast-slide-in ${STYLES[t.type]}`}
            role="alert"
          >
            <Icon className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="flex-1 text-sm font-medium">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 p-1 rounded hover:bg-black/5 -m-1"
              aria-label="Dismiss"
            >
              <span className="text-lg leading-none">&times;</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
