'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';

const DISMISS_KEY = 'pwa-install-dismissed';

function isMobileAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export default function PwaInstallBanner() {
  const locale = useLocale();
  const [deferredPrompt, setDeferredPrompt] = useState<{ prompt: () => Promise<{ outcome: string }> } | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  const isRTL = locale === 'ar';
  const title = isRTL ? 'ثبّت CenterHQ على هاتفك' : 'Install CenterHQ on your phone';
  const subtitle = isRTL ? 'وصول سريع وعمل بدون إنترنت' : 'Quick access and offline support';
  const installLabel = isRTL ? 'تثبيت' : 'Install';

  useEffect(() => {
    if (isStandalone()) return;
    const stored = localStorage.getItem(DISMISS_KEY);
    if (stored === 'true') return;

    setDismissed(false);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as unknown as { prompt: () => Promise<{ outcome: string }> });
      if (isMobileAndroid()) setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      setVisible(false);
      setDeferredPrompt(null);
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      setVisible(false);
      localStorage.setItem(DISMISS_KEY, 'true');
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, 'true');
  };

  if (!visible || dismissed) return null;

  return (
    <div
      className="fixed bottom-0 start-0 end-0 z-50 p-4 pb-8 md:pb-4"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
    >
      <div className={`bg-[var(--color-surface-1)] rounded-t-xl border-t border-[var(--color-border-subtle)] shadow-lg p-4 flex items-center justify-between gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
        <div className={`flex items-center gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <div className="w-12 h-12 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-lg">CH</span>
          </div>
          <div className={isRTL ? 'text-right' : 'text-left'}>
            <p className="font-bold text-[var(--color-text-primary)] text-sm">{title}</p>
            <p className="text-xs text-[var(--color-text-secondary)]">{subtitle}</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 shrink-0 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <button
            onClick={handleInstall}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {installLabel}
          </button>
          <button
            onClick={handleDismiss}
            className="p-2 text-slate-400 hover:text-[var(--color-text-secondary)] rounded-lg transition-colors"
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
