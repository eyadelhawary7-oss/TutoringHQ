'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { authEmailFromPhone } from '@/lib/utils/phone';

/**
 * PUBLIC teacher signup page (no auth - mirrors /login). Brand-new, center-less
 * teachers create an account here, then land on /teacher (which shows the
 * center-only zone: no centres, no subscription yet). This is NOT the upsell
 * card flow on the unified home - that is for existing teachers adding a
 * private group.
 *
 * Two-step: phase 'form' collects the details and sends a WhatsApp OTP to the
 * phone; phase 'otp' verifies the 6-digit code, and only then is the account
 * created. ?plan=pro is read on mount and forwarded as planIntent so the
 * post-signup flow can steer the teacher toward Pro (the trial is unchanged).
 */
function TeacherSignupInner() {
  const t = useTranslations('teacherSignup');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  // ITEM 1: only the literal ?plan=pro counts; anything else is ignored.
  const proIntent = searchParams?.get('plan') === 'pro';
  // ITEM 4 capture: prefill the optional referral field from ?ref (mirrors the
  // center signup pattern - field + URL param), sanitized to A-Z0-9 uppercase.
  const refFromUrl = (searchParams?.get('ref') ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

  const [phase, setPhase] = useState<'form' | 'otp'>('form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [subject, setSubject] = useState('');
  const [referralCode, setReferralCode] = useState(refFromUrl);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [code, setCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);

  const validateForm = (): boolean => {
    if (name.trim().length < 2) {
      setError(t('errorName'));
      return false;
    }
    if (!phone.trim()) {
      setError(t('errorPhone'));
      return false;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError(t('errorPin'));
      return false;
    }
    if (pin !== confirmPin) {
      setError(t('errorPinMatch'));
      return false;
    }
    if (!termsAccepted || !privacyAccepted) {
      setError(t('errorConsent'));
      return false;
    }
    return true;
  };

  // Phase 1 -> send the OTP to the entered phone.
  const handleSendOtp = async () => {
    setError(null);
    setAlreadyRegistered(false);
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/teacher/signup/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = (await res.json()) as {
        code?: string;
        maskedPhone?: string;
        devCode?: string;
      };
      if (res.ok) {
        setMaskedPhone(data.maskedPhone ?? '');
        // Non-prod test bypass: the server echoes the real code so the flow is
        // testable while WhatsApp delivery is stubbed.
        if (data.devCode) setCode(data.devCode);
        setPhase('otp');
        return;
      }
      if (res.status === 409 && data.code === 'PHONE_ALREADY_REGISTERED') {
        setAlreadyRegistered(true);
      } else if (data.code === 'INVALID_PHONE') {
        setError(t('errorPhone'));
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

  // Phase 2 -> verify the OTP; the account is created server-side on success.
  const handleVerifyAndCreate = async () => {
    setError(null);
    setAlreadyRegistered(false);
    if (!/^\d{6}$/.test(code)) {
      setError(t('errorOtp'));
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
          code: code.trim(),
          planIntent: proIntent ? 'pro' : undefined,
          referralCode: referralCode.trim() || undefined,
          termsAccepted: true,
          privacyAccepted: true,
        }),
      });
      const data = (await res.json()) as { code?: string };
      if (res.ok) {
        // Account exists; sign in immediately with phone + PIN, then land home.
        // authEmailFromPhone is the SAME derivation the server uses, so this
        // login local-part is byte-identical to the one signup created.
        const email = authEmailFromPhone(phone);
        if (email) {
          await supabase.auth.signInWithPassword({ email, password: pin }).catch(() => undefined);
        }
        // Pro-intent teachers are steered to the Pro pricing screen; everyone
        // else lands on the portal home (both still on the Standard trial).
        router.replace(proIntent ? '/teacher/pricing' : '/teacher');
        return;
      }
      if (res.status === 409 && data.code === 'PHONE_ALREADY_REGISTERED') {
        setAlreadyRegistered(true);
      } else if (data.code === 'OTP_INVALID' || data.code === 'INVALID_CODE') {
        setError(t('errorOtpInvalid'));
      } else if (data.code === 'OTP_EXPIRED') {
        setError(t('errorOtpExpired'));
      } else if (data.code === 'OTP_TOO_MANY_ATTEMPTS') {
        setError(t('errorOtpTooMany'));
      } else if (data.code === 'WEAK_PIN') {
        setError(t('errorWeakPin'));
      } else if (data.code === 'INVALID_NAME') {
        setError(t('errorName'));
      } else if (data.code === 'INVALID_PHONE') {
        setError(t('errorPhone'));
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

        {phase === 'form' ? (
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
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('referralLabel')}
              </label>
              <input
                type="text"
                dir="ltr"
                value={referralCode}
                maxLength={16}
                onChange={(e) =>
                  setReferralCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
                }
                placeholder={t('referralPlaceholder')}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('referralHint')}</p>
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
                    {showConfirmPin ? (
                      <EyeOff size={16} aria-hidden />
                    ) : (
                      <Eye size={16} aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {alreadyRegistered && (
              <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] p-3 text-sm text-[var(--color-text-secondary)]">
                {t('alreadyRegistered')}{' '}
                <Link
                  href="/login"
                  className="font-semibold text-[var(--color-teal-deep)] underline"
                >
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
              onClick={handleSendOtp}
              disabled={submitting || !termsAccepted || !privacyAccepted}
              className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? t('sendingCode') : t('sendCode')}
            </button>

            <p className="text-center text-sm text-[var(--color-text-muted)]">
              {t('haveAccount')}{' '}
              <Link href="/login" className="font-semibold text-[var(--color-teal-deep)]">
                {t('login')}
              </Link>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('otpSentTo')}{' '}
              <span dir="ltr" className="font-semibold text-[var(--color-text-primary)]">
                {maskedPhone}
              </span>
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('otpLabel')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="------"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-center text-lg tracking-[0.5em] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {alreadyRegistered && (
              <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] p-3 text-sm text-[var(--color-text-secondary)]">
                {t('alreadyRegistered')}{' '}
                <Link
                  href="/login"
                  className="font-semibold text-[var(--color-teal-deep)] underline"
                >
                  {t('logInInstead')}
                </Link>
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleVerifyAndCreate}
              disabled={submitting || code.length !== 6}
              className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? t('submitting') : t('submit')}
            </button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setPhase('form');
                  setError(null);
                  setCode('');
                }}
                disabled={submitting}
                className="font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-50"
              >
                {t('otpEditPhone')}
              </button>
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={submitting}
                className="font-semibold text-[var(--color-teal-deep)] transition-colors hover:underline disabled:opacity-50"
              >
                {t('otpResend')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeacherSignupPage() {
  return (
    <Suspense fallback={null}>
      <TeacherSignupInner />
    </Suspense>
  );
}
