'use client';

import { useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { PopupConfig } from '@/lib/pricingConfig';

const SESSION_KEY = 'promo_popup_dismissed';

interface PublicConfigResponse {
  popup?: PopupConfig;
}

interface PromoPopupProps {
  locale: string;
}

export default function PromoPopup({ locale }: PromoPopupProps) {
  const t = useTranslations('promoPopup');
  const [config, setConfig] = useState<PopupConfig | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRTL = locale === 'ar';

  useEffect(() => {
    // Skip if already dismissed this session.
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return;
    } catch {
      // sessionStorage unavailable; proceed.
    }

    void fetch('/api/pricing/public-config')
      .then((r) => r.json() as Promise<PublicConfigResponse>)
      .then((data) => {
        const popup = data.popup;
        if (!popup?.enabled) return;
        setConfig(popup);
        const delay = Math.max(0, (popup.delaySeconds ?? 3)) * 1000;
        timerRef.current = setTimeout(() => {
          // Re-check dismissal in case the user dismissed via another tab.
          try {
            if (sessionStorage.getItem(SESSION_KEY) === '1') return;
          } catch {
            // ignore
          }
          setVisible(true);
        }, delay);
      })
      .catch(() => {
        // Silently ignore fetch failures.
      });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // ignore
    }
  };

  const copyCode = async () => {
    if (!config?.promoCode) return;
    try {
      await navigator.clipboard.writeText(config.promoCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable.
    }
  };

  if (!visible || !config) return null;

  const title = isRTL ? config.titleAr : config.titleEn;
  const body = isRTL ? config.bodyAr : config.bodyEn;
  const ctaText = isRTL ? config.ctaTextAr : config.ctaTextEn;
  const hasCode = Boolean(config.promoCode);
  const hasCta = Boolean(ctaText && config.ctaUrl);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || t('ariaLabel')}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={dismiss}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-700/60 bg-[#0f172a] p-6 shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('closeAria')}
          className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        {/* Title */}
        {title ? (
          <h2 className="me-6 text-base font-bold leading-snug text-white">{title}</h2>
        ) : null}

        {/* Body */}
        {body ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
        ) : null}

        {/* Promo code box */}
        {hasCode ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-teal-700/50 bg-teal-950/40 px-4 py-3">
            <span className="font-mono text-lg font-bold tracking-widest text-teal-300">
              {config.promoCode}
            </span>
            <button
              type="button"
              onClick={() => void copyCode()}
              className="shrink-0 rounded-lg border border-teal-800/60 bg-teal-900/40 px-3 py-1 text-xs font-semibold text-teal-400 transition-colors hover:bg-teal-800/60 hover:text-teal-200"
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
        ) : null}

        {/* CTA button */}
        {hasCta ? (
          <a
            href={config.ctaUrl}
            onClick={dismiss}
            className="mt-4 block w-full rounded-xl bg-teal-600 px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-teal-500"
          >
            {ctaText}
          </a>
        ) : null}
      </div>
    </div>
  );
}
