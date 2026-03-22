'use client';

import { useEffect, useState } from 'react';

export function SwUpdateBanner() {
  const [show, setShow] = useState(false);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) return;
      setReg(r);
      r.addEventListener('updatefound', () => {
        const newSw = r.installing;
        if (!newSw) return;
        newSw.addEventListener('statechange', () => {
          if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
            setShow(true);
          }
        });
      });
    });
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-[calc(56px+env(safe-area-inset-bottom,0px)+8px)] inset-x-0 flex justify-center px-4 z-[9997] md:bottom-4 no-print">
      <div className="card p-4 flex items-center gap-3 shadow-lg max-w-sm w-full">
        <div className="w-8 h-8 rounded-lg bg-[rgba(13,148,136,0.12)] flex items-center justify-center shrink-0">
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="var(--color-brand-500)"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-.07-5.96" />
          </svg>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] flex-1">تحديث جديد متاح</p>
        <button
          type="button"
          onClick={() => {
            reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          }}
          className="btn btn-primary text-xs py-1.5 px-3"
        >
          تحديث
        </button>
        <button
          type="button"
          onClick={() => setShow(false)}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          aria-label="إغلاق"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
