import { getLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import LegalChrome from './LegalChrome';
import { renderInline } from './richText';
import {
  DOC_ORDER,
  DOC_VERSION,
  LEGAL_CHROME,
  LEGAL_DOCS,
  VERSION_LINE,
  isArabic,
  pick,
  type LegalSlug,
} from './legalContent';

/**
 * `Merged-Public-Legal` §01, frames 3-10 — the shared reader for all four
 * documents: sticky `.rhead` with the version line, an `On this page` contents
 * card, numbered sections, and a `Back to all documents` footer.
 *
 * Now a server component. It was a client component only to read `useLocale()`;
 * nothing here is interactive, so `getLocale()` does the same job without
 * shipping the whole legal corpus to the browser as a client bundle.
 *
 * Three things the old version did that were bugs rather than choices:
 *  - Every section rendered `[{placeholder.en} / {placeholder.ar}]`, printing
 *    both languages concatenated in *both* locales, because that one line
 *    bypassed the `L()` locale helper defined directly above it.
 *  - The heading numbered sections with Western digits and a full stop in both
 *    locales; Arabic now gets ١ · via `formatNumber`, as the design draws.
 *  - Two stacked `[Pending]` lines stood in for a version line.
 */

export default async function LegalDoc({
  slug,
  processingFeeAmount = 0,
}: {
  slug: LegalSlug;
  /**
   * F1: the flat per-invoice processing fee, resolved server-side by
   * `legal/terms/page.tsx` from the same `getProcessingFeeConfig()` /
   * `resolveProcessingFeeAmount()` pair the retired `/terms` route used.
   * Rendered only when `> 0`, matching the invoice and checkout gate.
   */
  processingFeeAmount?: number;
}) {
  const locale = await getLocale();
  const isAr = isArabic(locale);
  const doc = LEGAL_DOCS[slug];
  const index = DOC_ORDER.indexOf(slug);

  const versionLine = doc.versionLineOverride
    ? `${pick(doc.versionLineOverride, isAr)} · ${formatDate(DOC_VERSION.date, locale, 'long')}`
    : `${pick(VERSION_LINE.versionLabel, isAr)} ${formatNumber(DOC_VERSION.version, locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} · ${pick(VERSION_LINE.updatedLabel, isAr)} ${formatDate(DOC_VERSION.date, locale, 'long')}`;

  const feeParagraph =
    slug === 'terms' && processingFeeAmount > 0
      ? {
          en: `A flat processing fee of ${formatCurrency(processingFeeAmount, 'en')} is added to each Paymob-charged subscription invoice, and is shown at checkout and on every invoice. VAT is included in the displayed totals.`,
          ar: `بيتضاف رسم معالجة ثابت قدره ${formatCurrency(processingFeeAmount, 'ar')} على كل فاتورة اشتراك بتتحصّل من خلال Paymob، وبيظهر في الدفع وعلى كل فاتورة. الضريبة داخلة في الإجماليات المعروضة.`,
        }
      : null;

  return (
    <>
      <LegalChrome
        locale={locale}
        backHref="/legal"
        backLabel={pick(LEGAL_CHROME.backToAll, isAr)}
        title={pick(LEGAL_CHROME.indexTitle, isAr)}
        subtitle={`${formatNumber(index + 1, locale)} ${pick(LEGAL_CHROME.ofDocuments, isAr)}`}
        showGlobe
      />

      <div className="flex-shrink-0 border-b border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
        <h2 className="text-[15px] font-bold text-[var(--color-ink)]">{pick(doc.title, isAr)}</h2>
        {/* Design `.rver` is the mono face; `font-mono` here is Plex + tabular-nums. */}
        <p className="font-mono mt-1 text-[11px] text-[var(--color-muted)]">
          {versionLine}
          {pick(LEGAL_CHROME.pendingReview, isAr)}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <nav
          aria-label={pick(LEGAL_CHROME.onThisPage, isAr)}
          className="mb-3 mt-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-tile)] px-4 py-3"
        >
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">
            {pick(LEGAL_CHROME.onThisPage, isAr)}
          </p>
          {doc.sections.map((section, i) => (
            <a
              key={i}
              href={`#s${i + 1}`}
              className="chq-focus block border-b border-[var(--color-hairline)] py-1 text-xs text-[var(--color-accent-deep)] last:border-b-0"
            >
              {formatNumber(i + 1, locale)} · {pick(section.title, isAr)}
            </a>
          ))}
        </nav>

        {doc.sections.map((section, i) => (
          <section key={i} id={`s${i + 1}`}>
            <h3 className="mx-1 mb-1 mt-4 text-[13px] font-bold text-[var(--color-ink)]">
              {formatNumber(i + 1, locale)} · {pick(section.title, isAr)}
            </h3>

            {section.blocks.length === 0 ? (
              // F3: the design lists this section but drafts no prose for it.
              // One explicit, visually distinct line — never invented copy.
              <p className="mx-1 mb-2 text-xs italic leading-[1.65] text-[var(--color-faint)]">
                {pick(LEGAL_CHROME.pendingDraft, isAr)}
              </p>
            ) : (
              section.blocks.map((block, j) =>
                block.kind === 'li' ? (
                  <p
                    key={j}
                    className="relative mx-1 mb-1 ps-4 text-xs leading-[1.6] text-[var(--color-ink-body)] before:absolute before:top-2 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-accent)] before:content-[''] before:[inset-inline-start:2px]"
                  >
                    {renderInline(pick(block, isAr), isAr)}
                  </p>
                ) : (
                  <p
                    key={j}
                    className="mx-1 mb-2 text-xs leading-[1.65] text-[var(--color-ink-body)]"
                  >
                    {renderInline(pick(block, isAr), isAr)}
                  </p>
                ),
              )
            )}

            {feeParagraph && i === 1 ? (
              <p className="mx-1 mb-2 text-xs leading-[1.65] text-[var(--color-ink-body)]">
                {renderInline(pick(feeParagraph, isAr), isAr)}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <div className="flex-shrink-0 border-t border-[var(--color-line)] bg-[var(--color-paper)] px-4 pb-6 pt-3">
        <Link
          href="/legal"
          className="chq-focus block w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-center text-[15px] font-bold text-[var(--color-ink-body)] transition-colors hover:bg-[var(--color-tile)]"
        >
          {pick(LEGAL_CHROME.backToAll, isAr)}
        </Link>
      </div>
    </>
  );
}
