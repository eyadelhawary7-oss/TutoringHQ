'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import PhoneInput from '@/components/PhoneInput';
import OTPInput from '@/components/OTPInput';

type Step = 'phone' | 'otp' | 'done';

export default function AcceptInvitePage() {
  const t = useTranslations('acceptInvite');
  const tLogin = useTranslations('login');
  const router = useRouter();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [centerName, setCenterName] = useState('');
  const [generatedPin, setGeneratedPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCheckAndSendOTP = async (internationalPhone: string) => {
    setIsLoading(true);
    setError('');
    try {
      const checkRes = await fetch('/api/accept-invite/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: internationalPhone }),
      });
      const checkData = await checkRes.json();
      if (!checkData.hasInvite) {
        setError(t('noInvite', { defaultValue: 'No pending invitation found for this phone number.' }));
        return;
      }
      setCenterName(checkData.centerName || '');
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: internationalPhone,
      });
      if (otpError) {
        if (otpError.message.includes('rate limit') || otpError.status === 429) {
          setError(tLogin('smsTooMany'));
        } else {
          setError(otpError.message);
        }
        return;
      }
      setPhone(internationalPhone);
      setStep('otp');
    } catch (err) {
      console.error(err);
      setError(t('error', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (otp: string) => {
    setIsLoading(true);
    setError('');
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: 'sms',
      });
      if (verifyError) {
        setError(tLogin('otpError'));
        return;
      }

      // After OTP verification, complete the invite (server generates PIN)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError(t('error'));
        return;
      }

      const completeRes = await fetch('/api/accept-invite/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) {
        setError(completeData.error || t('error'));
        return;
      }

      setGeneratedPin(completeData.pin);
      setStep('done');
    } catch {
      setError(tLogin('otpError'));
    } finally {
      setIsLoading(false);
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

  return (
    <div className="min-h-screen bg-white" data-theme="light">
      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block mb-4">
              <Image src="/logo-icon.png" alt="CenterHQ" width={64} height={64} className="w-16 h-16 mx-auto mb-3 object-contain" />
              <h1 className="text-3xl font-bold text-text-primary">CenterHQ</h1>
              <p className="text-sm text-indigo-600 mt-1">
                {t('title', { defaultValue: 'Accept Team Invitation' })}
              </p>
            </Link>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl p-8">
            {step === 'phone' && (
              <>
                <h2 className="text-xl font-bold text-text-primary mb-6 text-center">
                  {t('enterPhone', { defaultValue: 'Enter your phone number' })}
                </h2>
                <p className="text-text-secondary text-sm text-center mb-6">
                  {t('enterPhoneDesc', { defaultValue: 'Enter the phone number that received the invitation.' })}
                </p>
                <PhoneInput
                  onSubmit={handleCheckAndSendOTP}
                  isLoading={isLoading}
                  error={error}
                />
              </>
            )}

            {step === 'otp' && (
              <>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setError(''); }}
                  className="text-sm text-indigo-600 hover:underline mb-4 flex items-center gap-1"
                >
                  <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {t('back', { defaultValue: 'Back' })}
                </button>
                {centerName && (
                  <p className="text-text-secondary text-sm text-center mb-4">
                    {t('invitedTo', { centerName, defaultValue: `Invited to ${centerName}` })}
                  </p>
                )}
                <p className="text-text-secondary text-center mb-6">
                  {t('otpSent', { phone, defaultValue: `Code sent to ${phone}` })}
                </p>
                <OTPInput
                  onSubmit={handleVerifyOTP}
                  onResend={handleResendOTP}
                  isLoading={isLoading}
                  error={error}
                  phone={phone}
                />
              </>
            )}

            {step === 'done' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-text-primary mb-2">
                  {t('success', { defaultValue: 'Welcome to the team!' })}
                </h2>
                {centerName && (
                  <p className="text-text-secondary text-sm mb-4">
                    {t('joinedCenter', { centerName, defaultValue: `You've joined ${centerName}` })}
                  </p>
                )}
                <div className="bg-indigo-50 rounded-lg p-4 mb-4">
                  <p className="text-sm text-text-secondary mb-2">
                    {t('yourPin', { defaultValue: 'Your login PIN:' })}
                  </p>
                  <p className="text-3xl font-mono font-bold text-indigo-600 tracking-widest">
                    {generatedPin}
                  </p>
                  <p className="text-xs text-text-tertiary mt-2">
                    {t('savePinWarning', { defaultValue: 'Save this PIN! You will need it to log in.' })}
                  </p>
                </div>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
                >
                  {t('goToDashboard', { defaultValue: 'Go to Dashboard' })}
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm text-indigo-600 hover:text-indigo-700">
              {t('hasAccount', { defaultValue: 'Already have an account? Log in' })}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
