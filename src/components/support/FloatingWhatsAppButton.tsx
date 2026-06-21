'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { usePathname } from '@/i18n/routing';
import { useLayout } from '@/contexts/LayoutContext';
import { SITE, supportWhatsAppLink } from '@/config/site';

/** localStorage flag so a dismissed button stays collapsed across reloads. */
const DISMISS_KEY = 'chq-support-fab-dismissed';

function stripLocale(path: string): string {
  return path.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

/** Brand WhatsApp glyph, reused by the full button and the minimized handle. */
function WhatsAppGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-1.207zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

/**
 * Fixed floating WhatsApp support button shown across the public marketing
 * pages and the main authenticated app. The deep-link number and greeting come
 * exclusively from `src/config/site.ts` — never hardcode them here.
 *
 * Dismissible: tapping the X collapses it to a tiny low-profile handle pinned to
 * the same corner; tapping the handle restores the full button. The dismissed
 * state persists in localStorage so it stays collapsed across reloads, and
 * restoring clears it.
 *
 * Hidden entirely on the owner/operator admin screens (/admin, /ceo,
 * /ceo-dashboard), the QR-scanning surfaces (/attendance, /scan, /scanner) and
 * while the scanner kiosk is locked, so it never covers those UIs. On mobile it
 * sits above the bottom tab bar (logical `end` side per RTL rules).
 */
export default function FloatingWhatsAppButton() {
  const t = useTranslations('supportFab');
  const pathname = usePathname();
  const { scannerKioskLocked } = useLayout();

  // Read persisted dismissal after mount. Rendering nothing until mounted keeps
  // SSR and the first client render in sync (localStorage is client-only).
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const cleanPath = stripLocale(pathname);
  const isScanSurface =
    cleanPath === '/attendance' ||
    cleanPath.startsWith('/attendance/') ||
    cleanPath === '/scan' ||
    cleanPath.startsWith('/scan/') ||
    cleanPath === '/scanner' ||
    cleanPath.startsWith('/scanner/');
  const isAdminSurface =
    cleanPath === '/admin' ||
    cleanPath.startsWith('/admin/') ||
    cleanPath === '/ceo' ||
    cleanPath.startsWith('/ceo/') ||
    cleanPath === '/ceo-dashboard' ||
    cleanPath.startsWith('/ceo-dashboard/');

  if (!mounted) return null;
  if (isScanSurface || scannerKioskLocked || isAdminSurface) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore storage errors */
    }
  };

  const restore = () => {
    setDismissed(false);
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore storage errors */
    }
  };

  // Collapsed: a tiny half-pill handle flush to the screen edge.
  if (dismissed) {
    return (
      <button
        type="button"
        onClick={restore}
        aria-label={t('reopen')}
        title={t('reopen')}
        className="fixed end-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] md:bottom-6 z-40 flex h-9 w-7 items-center justify-center rounded-s-full bg-[#25D366]/90 text-white shadow-md transition-colors hover:bg-[#25D366] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 print:hidden"
      >
        <WhatsAppGlyph size={16} />
      </button>
    );
  }

  return (
    <div className="fixed end-4 md:end-6 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] md:bottom-6 z-40 print:hidden">
      <a
        href={supportWhatsAppLink()}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('ariaLabel')}
        title={t('ariaLabel')}
        data-support-whatsapp={SITE.supportWhatsAppIntl}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
      >
        <WhatsAppGlyph size={28} />
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        title={t('dismiss')}
        className="absolute -top-1.5 -end-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] shadow transition-colors hover:bg-[var(--color-surface-0)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
