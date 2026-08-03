'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import PublicLocaleToggle from '@/components/PublicLocaleToggle';
import { getSupportWhatsAppWaMeBase, getSupportWhatsAppDisplayLabel } from '@/lib/supportWhatsApp';

const WA_SUPPORT = getSupportWhatsAppWaMeBase();
const WA_SUPPORT_LABEL = getSupportWhatsAppDisplayLabel();

interface MarketingFooterProps {
  /** "Create an account" destination. Omit if `onCreateAccountClick` is used instead. */
  createAccountHref?: string;
  /** When set, "Create an account" renders as a button (e.g. opens a center/teacher chooser) instead of a Link. */
  onCreateAccountClick?: () => void;
}

/**
 * Shared four-column marketing footer (Product / Your account / Legal / Talk to
 * us), used at the bottom of every public marketing screen — matches
 * `Merged-Public-Marketing.html`'s ".bigfoot" pattern, drawn identically on
 * every one of that file's four sections. Lives under `landing/` because it is
 * only ever used by the marketing pages that make up that one design file.
 *
 * "How it works" and "For parents" are intentionally omitted: the former has
 * no stable cross-page anchor target on every page that would use this
 * footer, and `/parents` has no live route at all (see BUILD-AFTER-REDESIGN.md
 * follow-up). Neither is worth a dead or half-working link.
 */
export default function MarketingFooter({ createAccountHref, onCreateAccountClick }: MarketingFooterProps) {
  const t = useTranslations('publicFooter');

  return (
    <footer className="border-t border-[var(--color-border)] bg-[#14181A] px-5 py-10 text-[#ECE8DF] md:px-6 md:py-12">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-6 gap-y-8 text-start sm:grid-cols-4">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--color-teal)]">
            {t('productHeading')}
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/pricing" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('pricing')}
            </Link>
            <Link href="/center" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('forCenters')}
            </Link>
            <Link href="/teacher/landing" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('forTeachers')}
            </Link>
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--color-teal)]">
            {t('accountHeading')}
          </p>
          <div className="flex flex-col gap-2">
            {onCreateAccountClick ? (
              <button
                type="button"
                onClick={onCreateAccountClick}
                className="text-start text-sm text-[#ECE8DF]/76 transition-colors hover:text-white"
              >
                {t('createAccount')}
              </button>
            ) : (
              <Link
                href={createAccountHref ?? '/signup'}
                className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white"
              >
                {t('createAccount')}
              </Link>
            )}
            <Link href="/login" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('login')}
            </Link>
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--color-teal)]">
            {t('legalHeading')}
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/legal/privacy" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('privacy')}
            </Link>
            <Link href="/legal/terms" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('terms')}
            </Link>
            <Link href="/legal/cookie" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('cookies')}
            </Link>
            {/* s08-3: the design does not draw this footer, so "identical" does
                not bind here — coverage does. Without this row the DPA and the
                public data-rights form are unreachable from the marketing site.
                The three deep links above stay, because people already expect
                them. */}
            <Link href="/legal" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
              {t('legal')}
            </Link>
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--color-teal)]">
            {t('talkHeading')}
          </p>
          <div className="flex flex-col gap-2">
            {WA_SUPPORT ? (
              <>
                <a href={WA_SUPPORT} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
                  {WA_SUPPORT_LABEL}
                </a>
                <a href={WA_SUPPORT} target="_blank" rel="noopener noreferrer" className="text-sm text-[#ECE8DF]/76 transition-colors hover:text-white">
                  {t('whatsappHours')}
                </a>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-5xl flex-wrap items-center gap-3 border-t border-white/10 pt-6">
        <PublicLocaleToggle className="inline-flex items-center gap-1.5 rounded-lg px-0 py-0 text-xs font-semibold text-[#ECE8DF]/76 transition-colors hover:text-white" />
      </div>

      <div className="mx-auto mt-4 max-w-5xl text-xs leading-relaxed text-[#ECE8DF]/44">
        <p>{t('legalLine')}</p>
        <p>{t('rightsLine')}</p>
      </div>
    </footer>
  );
}
