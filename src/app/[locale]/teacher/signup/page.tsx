'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/lib/utils/phone';

/**
 * PUBLIC teacher signup page (no auth - mirrors /login). Brand-new, center-less
 * teachers create an account here, then land on /teacher (which shows the
 * center-only zone: no centres, no subscription yet). This is NOT the upsell
 * card flow on the unified home - that is for existing teachers adding a
 * private group.
 */
export default function TeacherSignupPage() {
  const t = useTranslations('teacherSignup');
  const locale = useLocale();
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [subject, setSubject] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setAlreadyRegistered(false);
    if (name.trim().length < 2) {
      setError(t('errorName'));
      return;
    }
    if (!phone.trim()) {
      setError(t('errorPhone'));
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError(t('errorPin'));
      return;
    }
    if (pin !== confirmPin) {
      setError(t('errorPinMatch'));
      return;
    }
    if (!termsAccepted || !privacyAccepted) {
      setError(t('errorConsent'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/teacher/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          pin,
          subject: subject.trim() || undefined,
          termsAccepted: true,
          privacyAccepted: true,
        }),
      });
      const data = (await res.json()) as { code?: string };
      if (res.ok) {
        // Account exists; sign in immediately with phone + PIN, then land home.
        // Same email derivation as the server (normalized E.164 digits).
        const email = `${normalizePhone(phone).replace(/\D/g, '')}@centerhq.local`;
        await supabase.auth.signInWithPassword({ email, password: pin }).catch(() => undefined);
        router.replace('/teacher');
        return;
      }
      if (res.status === 409 && data.code === 'PHONE_ALREADY_REGISTERED') {
        setAlreadyRegistered(true);
      } else if (data.code === 'INVALID_PHONE') {
        setError(t('errorPhone'));
      } else if (data.code === 'WEAK_PIN') {
        setError(t('errorWeakPin'));
      } else if (data.code === 'INVALID_NAME') {
        setError(t('errorName'));
      } else if (data.code === 'CONSENT_REQUIRED') {
        setError(t('errorConsent'));
      } else if (res.status === 429) {
        setError(t('errorRateLimit'));
      } else {
        setError(t('errorGeneric'));
      }
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="flex min-h-screen w-full items-center justify-center bg-[var(--color-surface-0)] p-4"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <h1 className="mb-1 text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('nameLabel')}
            </label>
            <input
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('phoneLabel')}
            </label>
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('subjectLabel')}
            </label>
            <input
              type="text"
              value={subject}
              maxLength={80}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('subjectPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('pinLabel')}
              </label>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 pe-10 text-center text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((s) => !s)}
                  aria-label={showPin ? t('hidePin') : t('showPin')}
                  className="absolute inset-y-0 end-2 flex items-center text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  {showPin ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('confirmPinLabel')}
              </label>
              <div className="relative">
                <input
                  type={showConfirmPin ? 'text' : 'password'}
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 pe-10 text-center text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPin((s) => !s)}
                  aria-label={showConfirmPin ? t('hidePin') : t('showPin')}
                  className="absolute inset-y-0 end-2 flex items-center text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  {showConfirmPin ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                </button>
              </div>
            </div>
          </div>

          {alreadyRegistered && (
            <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] p-3 text-sm text-[var(--color-text-secondary)]">
              {t('alreadyRegistered')}{' '}
              <Link href="/login" className="font-semibold text-[var(--color-teal-deep)] underline">
                {t('logInInstead')}
              </Link>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}

          {/* PDPL: two distinct, mandatory consents - terms acceptance and
              data-processing consent are separate checkboxes, both required. */}
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="consent-terms"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-teal-600"
            />
            <label
              htmlFor="consent-terms"
              className="cursor-pointer text-sm leading-relaxed text-[var(--color-text-secondary)]"
            >
              {t.rich('consentTerms', {
                link: (chunks) => (
                  <a
                    href={`/${locale}/legal/terms`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[var(--color-teal-deep)] underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </label>
          </div>

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="consent-privacy"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-teal-600"
            />
            <label
              htmlFor="consent-privacy"
              className="cursor-pointer text-sm leading-relaxed text-[var(--color-text-secondary)]"
            >
              {t.rich('consentPrivacy', {
                link: (chunks) => (
                  <a
                    href={`/${locale}/legal/privacy`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[var(--color-teal-deep)] underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </label>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !termsAccepted || !privacyAccepted}
            className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? t('submitting') : t('submit')}
          </button>

          <p className="text-center text-sm text-[var(--color-text-muted)]">
            {t('haveAccount')}{' '}
            <Link href="/login" className="font-semibold text-[var(--color-teal-deep)]">
              {t('login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
