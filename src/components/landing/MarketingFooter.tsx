'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/routing';
import SummerLine from '@/components/marketing/SummerLine';
import { SITE } from '@/config/site';

/**
 * The `.bigfoot` block drawn identically at the bottom of all four public
 * marketing screens: a CTA band, four link columns, a language row, and the
 * operating-company line.
 *
 * Support number: read from `SITE` (src/config/site.ts), NOT from
 * `getSupportWhatsAppWaMeBase()`. The env helper resolves
 * `NEXT_PUBLIC_SUPPORT_WHATSAPP`, which is currently unset in production and
 * falls back to a placeholder — so the whole Talk-to-us column rendered with no
 * children, silently. A constant cannot be unset, so the column is always
 * populated and that failure mode is gone. The env helpers stay for the
 * server-side alert path (`ADMIN_WHATSAPP_NUMBER`), a genuinely different
 * number.
 *
 * "For parents" is still omitted from the Your-account column: the design draws
 * the link but no `/parents` screen exists in any design file, so shipping it
 * would put a 404 on all four public pages. It is a NEEDS-DESIGN item.
 */
export default function MarketingFooter({
  /** Where "How it works" points: the landing page's own `#steps` anchor on
   *  screens that have it, the landing page itself everywhere else. */
  howItWorksHref = '/',
  /** Brass CTA + the teacher wording of the summer line, on /teachers. */
  tone = 'center',
  createAccountHref = '/signup',
}: {
  howItWorksHref?: string;
  tone?: 'center' | 'teacher';
  createAccountHref?: string;
}) {
  const t = useTranslations('publicFooter');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const pathname = usePathname();
  const bare = (pathname ?? '/').replace(/^\/(?:ar|en)(?=\/|$)/, '') || '/';

  const wa = `https://wa.me/${SITE.supportWhatsAppIntl}`;
  const linkCls = 'block text-xs leading-snug text-[#ECE8DF]/76 transition-colors hover:text-white';
  // Column headings tint with the page's accent family: mint on teal screens,
  // sand on /teachers (design `.fh` / `.t .fh`).
  const headCls = `mb-3 text-[11px] font-bold uppercase tracking-[.1em] rtl:normal-case rtl:tracking-[.02em] ${
    tone === 'teacher' ? 'text-[var(--color-canvas)]' : 'text-[var(--color-mint-deep)]'
  }`;

  return (
    <footer className="bg-[#14181A] px-6 pb-6 pt-12 text-[var(--color-paper)]">
      {/* CTA band */}
      <div className="mb-6 border-b border-[#ECE8DF]/14 pb-8">
        <h3 className="mb-2 text-[22px] font-bold leading-tight tracking-[-.01em] text-white rtl:tracking-normal">
          {t('ctaHeading')}
        </h3>
        <SummerLine
          variant={tone === 'teacher' ? 'fctaTeacher' : 'fcta'}
          className="mb-4 text-xs leading-snug text-[#ECE8DF]/68"
        />
        <Link
          href={createAccountHref}
          className="inline-flex min-h-[46px] items-center justify-center rounded-xl px-6 text-[15px] font-bold text-[var(--color-paper)]"
          style={{
            backgroundColor: tone === 'teacher' ? 'var(--color-brass)' : 'var(--color-accent)',
          }}
        >
          {t('ctaButton')}
        </Link>
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="min-w-[116px]">
          <p className={headCls}>{t('productHeading')}</p>
          <Link href={howItWorksHref} className={linkCls}>
            {t('howItWorks')}
          </Link>
          <Link href="/pricing" className={linkCls}>
            {t('pricing')}
          </Link>
          <Link href="/centers" className={linkCls}>
            {t('forCenters')}
          </Link>
          <Link href="/teachers" className={linkCls}>
            {t('forTeachers')}
          </Link>
        </div>

        <div className="min-w-[116px]">
          <p className={headCls}>{t('accountHeading')}</p>
          <Link href={createAccountHref} className={linkCls}>
            {t('createAccount')}
          </Link>
          <Link href="/login" className={linkCls}>
            {t('login')}
          </Link>
        </div>

        <div className="min-w-[116px]">
          <p className={headCls}>{t('legalHeading')}</p>
          <Link href="/privacy" className={linkCls}>
            {t('privacy')}
          </Link>
          <Link href="/terms" className={linkCls}>
            {t('terms')}
          </Link>
          <Link href="/cookies" className={linkCls}>
            {t('cookies')}
          </Link>
        </div>

        <div className="min-w-[116px]">
          <p className={headCls}>{t('talkHeading')}</p>
          <a href={wa} target="_blank" rel="noopener noreferrer" dir="ltr" className={`mkt-mono ${linkCls}`}>
            {SITE.supportWhatsAppDisplay}
          </a>
          <a href={wa} target="_blank" rel="noopener noreferrer" className={linkCls}>
            {t('whatsappHours')}
          </a>
        </div>
      </div>

      {/* Language row — both endonyms, the active one in white. */}
      <div className="mt-6 flex items-center gap-2 border-t border-[#ECE8DF]/14 pt-6 text-[11px] text-[#ECE8DF]/50">
        <span>{t('languageLabel')}</span>
        <Link
          href={bare}
          locale="en"
          className={`font-semibold ${isAr ? 'text-[#ECE8DF]/76' : 'text-white'}`}
        >
          English
        </Link>
        <span aria-hidden>·</span>
        <Link
          href={bare}
          locale="ar"
          className={`font-semibold ${isAr ? 'text-white' : 'text-[#ECE8DF]/76'}`}
        >
          العربية
        </Link>
      </div>

      <div className="mt-4 border-t border-[#ECE8DF]/14 pt-6 text-[11px] leading-relaxed text-[#ECE8DF]/44">
        <p>
          {t.rich('legalLine', {
            b: (chunks) => <b className="font-medium text-[#ECE8DF]/68">{chunks}</b>,
          })}
        </p>
        <p>{t('rightsLine')}</p>
      </div>
    </footer>
  );
}
