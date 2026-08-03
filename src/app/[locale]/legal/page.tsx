import type { ReactNode } from 'react';
import { getLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import LegalChrome from './LegalChrome';
import {
  DOC_ORDER,
  DOC_VERSION,
  LEGAL_CHROME,
  LEGAL_DOCS,
  isArabic,
  pick,
  type LegalSlug,
} from './legalContent';

/**
 * `Merged-Public-Legal` §01, frames 1-2 — the legal index.
 *
 * This route 404'd. `/legal` was already in `publicRoutes` (`src/proxy.ts`) and
 * already in `AppShell`'s shell-less list, so nothing was blocking it — the page
 * simply did not exist, which is also why the data-rights form had no entry
 * point anywhere on the public site.
 */

export const metadata = { title: 'Legal - TutoringHQ' };

/** The design's own 20px stroked glyphs, one per document. */
const DOC_ICON: Record<LegalSlug, ReactNode> = {
  privacy: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  terms: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  cookie: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="15" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  dpa: <path d="M12 3l8 4v5c0 4-3 7-8 9-5-2-8-5-8-9V7z" />,
};

export default async function LegalIndexPage() {
  const locale = await getLocale();
  const isAr = isArabic(locale);

  // "Version 2.0 · 22 Jun 2026". Both halves go through the shared helpers, so
  // AR renders ٢٫٠ and ٢٢ يونيو ٢٠٢٦ without a hand-built string.
  const versionNumber = formatNumber(DOC_VERSION.version, locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const shortDate = formatDate(DOC_VERSION.date, locale, 'short');
  const versionMeta = `${pick({ en: 'Version', ar: 'النسخة' }, isAr)} ${versionNumber} · ${shortDate}`;

  return (
    <>
      <LegalChrome
        locale={locale}
        backHref="/"
        backLabel={isAr ? 'الرجوع للرئيسية' : 'Back to home'}
        title={pick(LEGAL_CHROME.indexTitle, isAr)}
        subtitle={pick(LEGAL_CHROME.indexSubtitle, isAr)}
        showGlobe
      />

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <p className="mx-1 mb-3 mt-1 text-xs leading-[1.55] text-[var(--color-mid)]">
          {pick(LEGAL_CHROME.indexIntro, isAr)}
        </p>

        {DOC_ORDER.map((slug) => {
          const doc = LEGAL_DOCS[slug];
          const meta = doc.meta.en ? pick(doc.meta, isAr) : versionMeta;
          return (
            <Link
              key={slug}
              href={`/legal/${slug}`}
              className="chq-focus mb-2 flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 transition-colors hover:bg-[var(--color-tile)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  {DOC_ICON[slug]}
                </svg>
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-[var(--color-ink)]">
                  {pick(doc.title, isAr)}
                </span>
                {/* Design `.dmeta` is the mono face; in-product `font-mono` maps to
                    Plex + tabular-nums (globals.css), the system's numeral pairing. */}
                <span className="font-mono mt-1 block text-[11px] text-[var(--color-muted)]">
                  {meta}
                </span>
              </span>

              <svg
                viewBox="0 0 24 24"
                className="h-[18px] w-[18px] shrink-0 text-[var(--color-canvas)]"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={isAr ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
              </svg>
            </Link>
          );
        })}

        <div className="mt-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-sand)] p-4">
          <p className="text-[13px] font-bold text-[var(--color-brass)]">
            {pick(LEGAL_CHROME.askTitle, isAr)}
          </p>
          <p className="mt-1 text-[11px] leading-[1.5] text-[var(--color-brass)]">
            {pick(LEGAL_CHROME.askBody, isAr)}
          </p>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-[var(--color-line)] bg-[var(--color-paper)] px-4 pb-6 pt-3">
        <Link
          href="/legal/privacy-request"
          className="chq-focus block w-full rounded-xl bg-[var(--color-accent)] p-4 text-center text-[15px] font-bold text-[var(--color-panel)] transition-opacity hover:opacity-90"
        >
          {pick(LEGAL_CHROME.openForm, isAr)}
        </Link>
      </div>
    </>
  );
}
