'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { EGYPT_GOVERNORATES, governorateLabel } from '@/lib/egyptGovernorates';
import { supportWhatsAppLink } from '@/config/site';

export default function TalkToUsPage() {
  const t = useTranslations('talkToUs');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

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
      const selected = EGYPT_GOVERNORATES.find((g) => g.value === area);
      setSubmittedArea(selected ? governorateLabel(selected, locale === 'ar' ? 'ar' : 'en') : null);
      setSubmitted(true);
    } catch {
      setError(t('submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-surface-2)] px-6 py-16"
      dir={dir}
    >
      <div className="w-full max-w-md space-y-6">
        <Link
          href="/"
          className="mx-auto inline-flex items-center gap-2 chq-focus rounded-lg justify-center w-full"
          aria-label="TutoringHQ"
        >
          <span
            className="text-base tracking-tight"
            style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
          >
            <span className="text-[var(--color-navy-50)]">Tutoring</span>
            <span className="text-[var(--color-brand-500)]">HQ</span>
          </span>
        </Link>

        {!submitted ? (
          <>
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-white md:text-3xl">{t('title')}</h1>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)] md:text-base">
                {t('lede')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]">
                  {t('nameLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none chq-focus"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]">
                  {t('phoneLabel')}
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none chq-focus"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('phoneHint')}</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]">
                  {t('centerNameLabel')}
                </label>
                <input
                  type="text"
                  value={centerName}
                  onChange={(e) => setCenterName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none chq-focus"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]">
                  {t('areaLabel')}
                </label>
                <select
                  required
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none chq-focus"
                >
                  <option value="" disabled className="text-black">
                    {t('areaPlaceholder')}
                  </option>
                  {EGYPT_GOVERNORATES.map((g) => (
                    <option key={g.value} value={g.value} className="text-black">
                      {governorateLabel(g, locale === 'ar' ? 'ar' : 'en')}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('areaHint')}</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]">
                  {t('studentCountLabel')}
                </label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={studentCount}
                  onChange={(e) => setStudentCount(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none chq-focus"
                />
              </div>

              {error ? <p className="text-sm text-red-400">{error}</p> : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 btn-press chq-focus disabled:opacity-60"
              >
                {t('submitCta')}
              </button>

              <p className="text-center text-xs text-[var(--color-text-muted)]">
                <a href={supportWhatsAppLink()} target="_blank" rel="noopener noreferrer" className="underline">
                  {t('whatsappFallback')}
                </a>
              </p>
            </form>
          </>
        ) : (
          <div className="text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teal-500/20">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-teal-400"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white md:text-3xl">{t('submittedTitle')}</h1>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)] md:text-base">
                {submittedArea
                  ? t('submittedSubtitle', { area: submittedArea })
                  : t('submittedSubtitleGeneric')}
              </p>
            </div>
            <ol className="space-y-3 text-start text-sm text-[var(--color-text-muted)]">
              <li className="flex gap-2">
                <span className="font-semibold text-white">1.</span> {t('step1')}
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-white">2.</span> {t('step2')}
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-white">3.</span> {t('step3')}
              </li>
            </ol>
            <div>
              <Link
                href="/signup"
                className="inline-flex w-full items-center justify-center rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 btn-press chq-focus"
              >
                {t('startFreeTrialCta')}
              </Link>
              <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
                {t('startFreeTrialHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
