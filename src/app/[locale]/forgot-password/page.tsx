'use client';

import { useState, FormEvent } from 'react';
import Image from 'next/image';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { useTranslations } from 'next-intl';
import PhoneInput from '@/components/PhoneInput';
import OTPInput from '@/components/OTPInput';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<'phone' | 'otp' | 'new-password'>('phone');
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const router = useRouter();
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900" data-theme="light">
      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block mb-4">
              <Image src="/logo-icon.png" alt="CenterHQ" width={64} height={64} className="w-16 h-16 mx-auto mb-3 object-contain" />
              <h1 className="text-3xl font-bold text-text-primary">CenterHQ</h1>
            </Link>
          </div>

          <div className="bg-bg-primary text-text-primary border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-8">
            <h2 className="text-xl font-bold text-text-primary mb-6 text-center">
              {t('title')}
            </h2>

            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            {message && (
              <div className="bg-green-500/10 border border-green-500 text-green-600 dark:text-green-400 p-3 rounded-lg mb-4 text-sm">
                {message}
              </div>
            )}

            {step === 'phone' && (
              <>
                <PhoneInput
                  onSubmit={handleSendOTP}
                  isLoading={loading}
                  error={error}
                />
                <div className="mt-6 text-center">
                  <Link href="/login" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                    {t('backToLogin')}
                  </Link>
                </div>
              </>
            )}

            {step === 'otp' && (
              <>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setError(''); setMessage(''); }}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-1"
                >
                  <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {t('backToLogin')}
                </button>
                <p className="text-text-secondary text-center mb-6 text-sm">
                  {t('enterOTP')}
                </p>
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
                <p className="text-text-secondary text-sm mb-6">
                  {t('createNewPassword')}
                </p>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    {t('newPasswordLabel')}
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    className="w-full px-4 py-3 bg-bg-tertiary text-text-primary border border-gray-300 dark:border-gray-600 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <p className="text-text-secondary text-sm mt-1">
                    {t('passwordRequirements')}
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? t('resetting') : t('resetPassword')}
                </button>
              </form>
            )}
          </div>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm text-text-secondary hover:text-text-primary">
              ← {t('backToLogin')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
