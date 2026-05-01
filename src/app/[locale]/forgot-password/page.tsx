'use client';

import { useState, FormEvent, useTransition, useRef, useEffect, ClipboardEvent, KeyboardEvent } from 'react';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { useTranslations, useLocale } from 'next-intl';
import { Globe } from 'lucide-react';
import PhoneInput from '@/components/PhoneInput';

type Step = 'phone' | 'pinReset';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const t = useTranslations('forgotPassword');

  useEffect(() => {
    if (step === 'pinReset') {
      otpRefs.current[0]?.focus();
    }
  }, [step]);

  const handleSendResetCode = async (internationalPhone: string) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/auth/reset-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: internationalPhone }),
      });

      if (res.status === 429) {
        setError(t('otpSendFailed'));
        return;
      }

      if (!res.ok) {
        setError(t('otpSendFailed'));
        return;
      }

      setPhone(internationalPhone);
      setMessage(t('otpSent'));
      setStep('pinReset');
    } catch {
      setError(t('otpSendFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/auth/reset-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (res.status === 429) {
        setError(t('otpSendFailed'));
        return;
      }
      setMessage(t('otpSent'));
    } catch {
      setError(t('otpSendFailed'));
    }
  };

  const setOtpIndex = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otpDigits];
    next[index] = value.slice(-1);
    setOtpDigits(next);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const onOtpKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const onOtpPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i] ?? '';
    }
    setOtpDigits(next);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const handleVerifyAndReset = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const otp = otpDigits.join('');
    if (otp.length !== 6) {
      setError(t('invalidOtp'));
      setLoading(false);
      return;
    }

    if (newPin !== confirmPin) {
      setError(t('pinMismatch'));
      setLoading(false);
      return;
    }

    if (!/^\d{6}$/.test(newPin)) {
      setError(t('invalidPin'));
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/verify-pin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, newPin }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (res.status === 429) {
        setError(t('otpSendFailed'));
        return;
      }

      if (!res.ok) {
        if (data.error === 'invalid_otp') {
          setError(t('invalidOtp'));
        } else if (data.error === 'invalid_input') {
          setError(t('invalidPin'));
        } else if (data.error === 'update_failed') {
          setError(t('resetFailed'));
        } else {
          setError(t('resetFailed'));
        }
        return;
      }

      setMessage(t('success'));
      setTimeout(() => {
        router.push('/login?message=password_reset_success');
      }, 2000);
    } catch {
      setError(t('resetFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleLocaleToggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => router.replace(pathname, { locale: next }));
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: 'var(--gradient-hero)' }}>
      <div className="absolute top-4 end-4">
        <button
          type="button"
          onClick={handleLocaleToggle}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 text-white/70 hover:text-white transition-colors"
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
        </button>
      </div>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-black text-2xl mb-4 shadow-lg"
            style={{ background: 'hsl(var(--primary))' }}
          >
            CH
          </div>
          <h1 className="text-2xl font-black flex items-center justify-center gap-0">
            <span
              style={{
                fontFamily: 'var(--font-bodoni), Georgia, serif',
                fontWeight: 700,
                letterSpacing: '2px',
                color: '#f8fafc',
              }}
            >
              CENTER
            </span>
            <span
              style={{
                fontFamily: 'var(--font-bodoni), Georgia, serif',
                fontWeight: 700,
                letterSpacing: '2px',
                color: '#0D9488',
              }}
            >
              HQ
            </span>
          </h1>
          <p className="text-white/50 text-sm mt-1 text-center">{t('subtitle')}</p>
        </div>

        <div
          className="rounded-2xl border border-white/10 p-6 shadow-xl"
          style={{ background: 'hsl(var(--card) / 0.95)', backdropFilter: 'blur(20px)' }}
        >
          {error && (
            <div
              className="rounded-lg px-3 py-2.5 text-sm font-medium mb-4"
              style={{ background: 'hsl(var(--destructive) / 0.1)', color: 'hsl(var(--destructive))' }}
            >
              {error}
            </div>
          )}

          {message && (
            <div
              className="rounded-lg px-3 py-2.5 text-sm font-medium mb-4"
              style={{ background: 'hsl(142 76% 36% / 0.12)', color: 'hsl(142 76% 42%)' }}
            >
              {message}
            </div>
          )}

          {step === 'phone' && (
            <>
              <PhoneInput
                onSubmit={handleSendResetCode}
                isLoading={loading}
                error={error}
                submitLabel={t('sendOtp')}
                phoneLabel={t('phoneLabel')}
                phoneHint={t('phoneHint')}
                phonePlaceholder={t('phonePlaceholder')}
              />
              <div className="text-center mt-4">
                <Link href="/login" className="text-sm hover:underline" style={{ color: 'hsl(var(--primary))' }}>
                  {t('backToLogin')}
                </Link>
              </div>
            </>
          )}

          {step === 'pinReset' && (
            <form onSubmit={handleVerifyAndReset} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setError('');
                  setMessage('');
                  setOtpDigits(['', '', '', '', '', '']);
                  setNewPin('');
                  setConfirmPin('');
                }}
                className="text-sm hover:underline mb-2 flex items-center gap-1"
                style={{ color: 'hsl(var(--primary))' }}
              >
                <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t('changePhone')}
              </button>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('otpLabel')}
                </label>
                <p className="text-[var(--color-text-secondary)] text-xs mb-2">{t('otpHint')}</p>
                <div className="flex gap-2 justify-center" dir="ltr">
                  {otpDigits.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        otpRefs.current[i] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={1}
                      value={d}
                      onChange={(ev) => setOtpIndex(i, ev.target.value)}
                      onKeyDown={(ev) => onOtpKeyDown(i, ev)}
                      onPaste={i === 0 ? onOtpPaste : undefined}
                      className="w-10 h-11 text-center text-lg font-semibold rounded-lg border border-input bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="newPin" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('newPin')}
                </label>
                <input
                  id="newPin"
                  type="text"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="\d{6}"
                  maxLength={6}
                  value={newPin}
                  onChange={(ev) => {
                    const v = ev.target.value.replace(/\D/g, '').slice(0, 6);
                    setNewPin(v);
                    setError('');
                  }}
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  required
                />
                <p className="text-[var(--color-text-secondary)] text-xs mt-1">{t('newPinHint')}</p>
              </div>

              <div>
                <label htmlFor="confirmPin" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('confirmPin')}
                </label>
                <input
                  id="confirmPin"
                  type="text"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="\d{6}"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(ev) => {
                    const v = ev.target.value.replace(/\D/g, '').slice(0, 6);
                    setConfirmPin(v);
                    setError('');
                  }}
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  required
                />
                <p className="text-[var(--color-text-secondary)] text-xs mt-1">{t('confirmPinHint')}</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {loading ? t('resetting') : t('resetPin')}
              </button>

              <div className="flex flex-col gap-2 text-center">
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-sm hover:underline"
                  style={{ color: 'hsl(var(--primary))' }}
                >
                  {t('resendOTP')}
                </button>
                <Link href="/login" className="text-sm hover:underline" style={{ color: 'hsl(var(--primary))' }}>
                  {t('backToLogin')}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
