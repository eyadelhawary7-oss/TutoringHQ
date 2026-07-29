'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-banner-dismissed';

export function PWAInstallBanner() {
  const t = useTranslations('pwa');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(DISMISS_KEY);
    if (stored) {
      setDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShow(false);
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
    setDismissed(true);
  }

  if (!show || dismissed) return null;

  return (
    <div
      className="chq-slide-up fixed bottom-20 sm:bottom-4 start-4 end-4 sm:start-auto sm:end-4 sm:w-80 z-50 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t('installTitle')}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('installSubtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] btn-press chq-focus rounded-lg p-1 shrink-0"
          aria-label={t('dismissAria')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={handleInstall}
          className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-2 text-sm font-medium btn-press chq-focus transition-colors"
        >
          {t('install')}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="px-4 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-xl py-2 text-sm btn-press chq-focus transition-colors"
        >
          {t('later')}
        </button>
      </div>
    </div>
  );
}
