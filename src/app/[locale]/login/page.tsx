'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import LanguageToggle from '@/components/LanguageToggle';
import PhoneInput from '@/components/PhoneInput';
import OTPInput from '@/components/OTPInput';

type LoginStep = 'phone' | 'otp';

export default function LoginPage() {
  const t = useTranslations('login');
  const tLanding = useTranslations('landing');
  const router = useRouter();

  const [step, setStep] = useState<LoginStep>('phone');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOTP = async (internationalPhone: string) => {
    setIsLoading(true);
    setError('');

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: internationalPhone,
      });

      if (otpError) {
        if (otpError.message.includes('rate limit') || otpError.status === 429) {
          setError(t('smsTooMany'));
        } else {
          setError(otpError.message);
        }
        return;
      }

      setPhone(internationalPhone);
      setStep('otp');
    } catch {
      setError(t('invalidPhone'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (otp: string) => {
    setIsLoading(true);
    setError('');

    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: 'sms',
      });

      if (verifyError) {
        setError(t('otpError'));
        return;
      }

      if (data.user) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch('/api/auth/check-invite', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        const result = await res.json();

        if (result.centerId) {
          router.push(result.needsOnboarding ? '/onboarding' : '/dashboard');
        } else if (result.contactSales) {
          setError(t('contactSales'));
        } else {
          router.push('/onboarding');
        }
      }
    } catch {
      setError(t('otpError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setError('');
    try {
      const { error: resendError } = await supabase.auth.signInWithOtp({
        phone,
      });
      if (resendError) {
        if (resendError.message.includes('rate limit') || resendError.status === 429) {
          setError(t('smsTooMany'));
        } else {
          setError(resendError.message);
        }
      }
    } catch {
      setError(t('smsTooMany'));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900">
      {/* Language Toggle */}
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          {/* Header / Logo */}
          <div className="text-center mb-8">
            <Link href="/" className="inline-block mb-4">
              <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg">
                <span className="text-2xl font-bold text-white">RG</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                CenterHQ
              </h1>
              <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-1">
                {tLanding('subtitle')}
              </p>
            </Link>
          </div>

          {/* Login Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            {/* Phone OTP Section */}
            {step === 'phone' ? (
              <>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-6 text-center">
                  {t('phoneTitle')}
                </h2>
                <PhoneInput
                  onSubmit={handleSendOTP}
                  isLoading={isLoading}
                  error={error}
                />
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setError(''); }}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-1"
                >
                  <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {t('phoneLabel')}
                </button>
                <OTPInput
                  onSubmit={handleVerifyOTP}
                  onResend={handleResendOTP}
                  isLoading={isLoading}
                  error={error}
                  phone={phone}
                />
              </>
            )}
          </div>

          {/* Back to Home */}
          <div className="text-center mt-6">
            <Link
              href="/"
              className="text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
              ← {t('backToHome')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
