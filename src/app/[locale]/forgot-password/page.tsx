'use client';

import { useState, FormEvent, useTransition } from 'react';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { useTranslations, useLocale } from 'next-intl';
import { Globe } from 'lucide-react';
import PhoneInput from '@/components/PhoneInput';
import OTPInput from '@/components/OTPInput';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<'phone' | 'otp' | 'new-password'>('phone');
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const t = useTranslations('forgotPassword');
  const tLogin = useTranslations('login');

  const handleSendOTP = async (internationalPhone: string) => {
    setLoading(true);
    setError('');
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: internationalPhone,
      });

      if (otpError) {
        if (otpError.message.includes('rate limit') || otpError.status === 429) {
          setError(t('otpSendFailed'));
        } else {
          setError(otpError.message);
        }
        return;
      }

      setPhone(internationalPhone);
      setMessage(t('otpSent', { phone: internationalPhone }));
      setStep('otp');
    } catch {
      setError(t('otpSendFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (otp: string) => {
    setLoading(true);
    setError('');
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: 'sms',
      });

      if (verifyError) {
        setError(t('invalidOTP'));
        return;
      }

      setMessage(t('otpVerified'));
      setStep('new-password');
    } catch {
      setError(t('invalidOTP'));
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setError('');
    try {
      const { error: resendError } = await supabase.auth.signInWithOtp({ phone });
      if (resendError) {
        if (resendError.message.includes('rate limit') || resendError.status === 429) {
          setError(tLogin('smsTooMany'));
        } else {
          setError(resendError.message);
        }
      }
    } catch {
      setError(tLogin('smsTooMany'));
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (newPassword.length < 8) {
      setError(t('passwordTooShort'));
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError(t('resetFailed'));
        return;
      }

      setMessage(t('resetSuccess'));
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
          <h1 className="text-2xl font-black text-white">CenterHQ</h1>
          <p className="text-white/50 text-sm mt-1 text-center">{t('title')}</p>
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
              <PhoneInput onSubmit={handleSendOTP} isLoading={loading} error={error} />
              <div className="text-center mt-4">
                <Link href="/login" className="text-sm hover:underline" style={{ color: 'hsl(var(--primary))' }}>
                  {t('backToLogin')}
                </Link>
              </div>
            </>
          )}

          {step === 'otp' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setError('');
                  setMessage('');
                }}
                className="text-sm hover:underline mb-4 flex items-center gap-1"
                style={{ color: 'hsl(var(--primary))' }}
              >
                <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t('backToLogin')}
              </button>
              <p className="text-[var(--color-text-secondary)] text-center mb-4 text-sm">{t('enterOTP')}</p>
              <OTPInput
                onSubmit={handleVerifyOTP}
                onResend={handleResendOTP}
                isLoading={loading}
                error={error}
                phone={phone}
              />
            </>
          )}

          {step === 'new-password' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <p className="text-[var(--color-text-secondary)] text-sm">{t('createNewPassword')}</p>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('newPasswordLabel')}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                />
                <p className="text-[var(--color-text-secondary)] text-xs mt-1">{t('passwordRequirements')}</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {loading ? t('resetting') : t('resetPassword')}
              </button>

              <div className="text-center">
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
