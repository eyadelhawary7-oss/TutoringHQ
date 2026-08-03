'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/formatNumber';
import { supportWhatsAppLink } from '@/config/site';
import Wordmark from '@/components/marketing/Wordmark';

const FORM_ID = 'talk-form';

/**
 * `/talk-to-us` — the second door next to Start free, for the owner who will
 * not sign up without talking to a person first.
 *
 * Three structural changes from the design, on top of the surface going from
 * the dark shell to cream:
 *
 *  1. The submit button and the WhatsApp fallback move OUT of the scrolling
 *     form and into a pinned foot, wired back with `form="talk-form"`. On a
 *     390px screen the fifth field pushed the button below the fold.
 *  2. Area becomes free text. A governorate `<select>` cannot express "6th of
 *     October", and area is the field that routes the lead to the rep who owns
 *     that territory. `demo_requests.area` is a nullable `text` column with no
 *     CHECK and no FK, and `demoRequestSchema` already accepts any string up to
 *     50 characters, so this needs no migration. It does mean territory routing
 *     now depends on unvalidated text, and `/admin/demo-requests` will render
 *     the raw value rather than a governorate label.
 *  3. The submitted subtitle takes the typed area straight through. It used to
 *     look the value up in `EGYPT_GOVERNORATES` and fall back to the generic
 *     line when it missed — with free text that lookup would miss every time.
 */
export default function TalkToUsPage() {
  const t = useTranslations('talkToUs');
  const locale = useLocale();
  const isAr = locale === 'ar';

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [centerName, setCenterName] = useState('');
  const [area, setArea] = useState('');
  const [studentCount, setStudentCount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedArea, setSubmittedArea] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          centerName,
          area,
          studentCount: studentCount ? Number(studentCount) : undefined,
        }),
      });
      if (!res.ok) {
        setError(t('submitError'));
        return;
      }
      setSubmittedArea(area.trim() || null);
      setSubmitted(true);
    } catch {
      setError(t('submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  const labelCls = 'mx-1 mb-1 mt-3 block text-xs font-semibold text-[var(--color-ink-body)]';
  const inputCls =
    'w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] chq-focus';
  const hintCls = 'mx-1 mt-1 text-[11px] leading-snug text-[var(--color-muted)]';
  const btnCls =
    'block w-full rounded-xl py-4 text-center text-[15px] font-bold text-[var(--color-paper)] disabled:opacity-60';

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="flex min-h-screen flex-col bg-[var(--color-paper)] text-[var(--color-ink)]"
    >
      {/* Brand bar */}
      <div className="flex shrink-0 items-center gap-2 px-6 pb-4 pt-2">
        <Link href="/" className="flex items-center gap-2 rounded-lg chq-focus" aria-label="TutoringHQ">
          <Wordmark size="brand" />
        </Link>
        <span className="ms-auto text-[11px] text-[var(--color-muted)]">{t('brandSub')}</span>
      </div>

      {!submitted ? (
        <>
          <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-6 pb-6">
            <h1 className="mx-1 mb-2 text-[22px] font-bold leading-tight">{t('title')}</h1>
            <p className="mx-1 mb-4 text-[13px] leading-relaxed text-[var(--color-mid)]">
              {t('lede')}
            </p>

            <form id={FORM_ID} onSubmit={handleSubmit}>
              <label className={labelCls} htmlFor="ttu-name">
                {t('nameLabel')}
              </label>
              <input
                id="ttu-name"
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className={inputCls}
              />

              <label className={labelCls} htmlFor="ttu-phone">
                {t('phoneLabel')}
              </label>
              <input
                id="ttu-phone"
                type="tel"
                dir="ltr"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('phonePlaceholder')}
                className={inputCls}
              />
              <p className={hintCls}>{t('phoneHint')}</p>

              <label className={labelCls} htmlFor="ttu-center">
                {t('centerNameLabel')}
              </label>
              <input
                id="ttu-center"
                type="text"
                maxLength={200}
                value={centerName}
                onChange={(e) => setCenterName(e.target.value)}
                placeholder={t('centerNamePlaceholder')}
                className={inputCls}
              />

              <label className={labelCls} htmlFor="ttu-area">
                {t('areaLabel')}
              </label>
              <input
                id="ttu-area"
                type="text"
                required
                // 50 is the schema's own ceiling (demoRequestSchema.area), so a
                // long answer is trimmed here rather than rejected with a 400.
                maxLength={50}
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder={t('areaPlaceholder')}
                className={inputCls}
              />
              <p className={hintCls}>{t('areaHint')}</p>

              <label className={labelCls} htmlFor="ttu-students">
                {t('studentCountLabel')}
              </label>
              <input
                id="ttu-students"
                type="number"
                min={0}
                inputMode="numeric"
                value={studentCount}
                onChange={(e) => setStudentCount(e.target.value)}
                placeholder={t('studentCountPlaceholder')}
                className={inputCls}
              />

              {error ? (
                <p className="mx-1 mt-3 text-[13px] text-[var(--color-danger)]">{error}</p>
              ) : null}
            </form>
          </div>

          <div className="shrink-0 border-t border-[var(--color-line)] px-6 pb-6 pt-3">
            <div className="mx-auto w-full max-w-md">
              <button
                type="submit"
                form={FORM_ID}
                disabled={submitting}
                className={`${btnCls} chq-focus`}
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                {t('submitCta')}
              </button>
              <p className="mt-2 text-center text-[11px] leading-snug text-[var(--color-muted)]">
                <a
                  href={supportWhatsAppLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {t('whatsappFallback')}
                </a>
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-8 py-8 text-center">
            <div
              className="mb-4 flex items-center justify-center rounded-full"
              style={{
                width: 66,
                height: 66,
                backgroundColor: 'var(--color-mint)',
                color: 'var(--color-accent-deep)',
              }}
              aria-hidden
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h1 className="mb-2 text-[22px] font-bold">{t('submittedTitle')}</h1>
            <p className="max-w-[32ch] text-[13px] leading-relaxed text-[var(--color-mid)]">
              {submittedArea
                ? t('submittedSubtitle', { area: submittedArea })
                : t('submittedSubtitleGeneric')}
            </p>

            <div className="mt-4 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
              {(['step1', 'step2', 'step3'] as const).map((key, i) => (
                <div
                  key={key}
                  className="flex items-start gap-2 border-b border-[var(--color-hairline)] py-3 text-start last:border-b-0"
                >
                  <span
                    className="mkt-mono flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{
                      width: 22,
                      height: 22,
                      backgroundColor: 'var(--color-tile)',
                      color: 'var(--color-mid)',
                    }}
                    aria-hidden
                  >
                    {formatNumber(i + 1, locale)}
                  </span>
                  <span className="text-xs leading-relaxed text-[var(--color-ink-body)]">
                    {t.rich(key, {
                      b: (chunks) => <b className="font-semibold">{chunks}</b>,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="shrink-0 border-t border-[var(--color-line)] px-6 pb-6 pt-3">
            <div className="mx-auto w-full max-w-md">
              <Link
                href="/signup"
                className={`${btnCls} chq-focus`}
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                {t('startFreeTrialCta')}
              </Link>
              <p className="mt-2 text-center text-[11px] leading-snug text-[var(--color-muted)]">
                {t('startFreeTrialHint')}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
