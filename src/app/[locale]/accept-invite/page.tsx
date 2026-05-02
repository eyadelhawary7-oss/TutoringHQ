'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import PhoneInput from '@/components/PhoneInput';
import OTPInput from '@/components/OTPInput';
import { LoginThemeEffect } from '@/components/LoginThemeEffect';

type Step = 'phone' | 'otp' | 'done';

const PLAYFAIR = {
  fontFamily: "var(--font-playfair), 'Playfair Display', 'Didot', Georgia, serif",
  fontVariantNumeric: 'tabular-nums' as const,
  fontFeatureSettings: '"zero" 1, "tnum" 1',
} as const;

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
    <div
      className="dark min-h-screen w-full flex flex-col items-center justify-center bg-[#080f1a] px-4 sm:px-6 lg:px-8"
      style={{ backgroundColor: '#080f1a', minHeight: '100vh' }}
    >
      <LoginThemeEffect />
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex flex-col items-center">
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  border: '2px solid #0D9488',
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '12px',
                }}
              >
                <span
                  style={{
                    ...PLAYFAIR,
                    color: '#0D9488',
                    fontWeight: 900,
                    fontSize: '18px',
                  }}
                >
                  CH
                </span>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-bodoni), 'Bodoni Moda', Georgia, serif",
                  fontWeight: 700,
                  letterSpacing: '2px',
                  fontSize: '14px',
                }}
              >
                <span style={{ color: '#f8fafc' }}>CENTER</span>
                <span style={{ color: '#0D9488' }}>HQ</span>
              </span>
              <p
                className="text-xs uppercase tracking-widest mt-3"
                style={{ color: '#64748b' }}
              >
                {t('title', { defaultValue: 'Accept Team Invitation' })}
              </p>
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 shadow-xl p-8 backdrop-blur-sm">
            {step === 'phone' && (
              <>
                <h2 className="text-xl font-bold text-slate-100 mb-6 text-center">
                  {t('enterPhone', { defaultValue: 'Enter your phone number' })}
                </h2>
                <p className="text-slate-400 text-sm text-center mb-6">
                  {t('enterPhoneDesc', { defaultValue: 'Enter the phone number that received the invitation.' })}
                </p>
                <PhoneInput
                  onSubmit={handleCheckAndSendOTP}
                  isLoading={isLoading}
                  error={error}
                  submitLabel={t('sendOtp')}
                />
              </>
            )}

            {step === 'otp' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setError('');
                  }}
                  className="text-sm text-teal-400 hover:text-teal-300 hover:underline mb-4 flex items-center gap-1"
                >
                  <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {t('back', { defaultValue: 'Back' })}
                </button>
                {centerName ? (
                  <p className="text-slate-400 text-sm text-center mb-4">
                    {t('invitedTo', { centerName, defaultValue: `Invited to ${centerName}` })}
                  </p>
                ) : null}
                <p className="text-slate-400 text-center mb-6">
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
                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-slate-100 mb-2">
                  {t('success', { defaultValue: 'Welcome to the team!' })}
                </h2>
                {centerName ? (
                  <p className="text-slate-400 text-sm mb-4">
                    {t('joinedCenter', { centerName, defaultValue: `You've joined ${centerName}` })}
                  </p>
                ) : null}
                <div className="bg-slate-800/80 border border-slate-600/60 rounded-lg p-4 mb-4">
                  <p className="text-sm text-slate-400 mb-2">
                    {t('yourPin', { defaultValue: 'Your login PIN:' })}
                  </p>
                  <p className="text-3xl font-mono font-bold text-teal-400 tracking-widest">
                    {generatedPin}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    {t('savePinWarning', { defaultValue: 'Save this PIN! You will need it to log in.' })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-medium rounded-lg"
                >
                  {t('goToDashboard', { defaultValue: 'Go to Dashboard' })}
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm text-teal-400 hover:text-teal-300">
              {t('hasAccount', { defaultValue: 'Already have an account? Log in' })}
            </Link>
          </div>
        </div>
    </div>
  );
}
