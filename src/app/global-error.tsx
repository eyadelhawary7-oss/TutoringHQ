'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          background: '#080f1a',
          color: '#f8fafc',
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 400 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(239,68,68,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}
          >
            <svg width="28" height="28" fill="none" stroke="#ef4444" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 0.5rem' }}>حدث خطأ غير متوقع</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: '1.5rem' }}>Something went wrong</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#0D9488',
              color: '#fff',
              padding: '0.625rem 1.5rem',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            حاول مجدداً
          </button>
        </div>
      </body>
    </html>
  );
}
