'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import PhoneInput from '@/components/PhoneInput';
import OTPInput from '@/components/OTPInput';

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
      className="min-h-screen w-full flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8"
      style={{ background: 'var(--color-surface-0)', minHeight: '100vh' }}
    >
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex flex-col items-center">
              <span
                style={{
                  fontFamily: "var(--font-bodoni), 'Bodoni Moda', Georgia, serif",
                  fontWeight: 700,
                  letterSpacing: '2px',
                  fontSize: '14px',
                }}
              >
                <span style={{ color: 'var(--color-text-primary)' }}>Tutoring</span>
                <span style={{ color: 'var(--color-teal)' }}>HQ</span>
              </span>
              <p
                className="text-xs uppercase tracking-widest mt-3"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('title', { defaultValue: 'Accept Team Invitation' })}
              </p>
            </Link>
          </div>

          <div
            className="rounded-2xl p-8"
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {step === 'phone' && (
              <>
                <h2
                  className="text-xl font-bold mb-6 text-center"
                  style={{ ...PLAYFAIR, color: 'var(--color-text-primary)' }}
                >
                  {t('enterPhone', { defaultValue: 'Enter your phone number' })}
                </h2>
                <p className="text-sm text-center mb-6" style={{ color: 'var(--color-text-secondary)' }}>
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
                  className="text-sm hover:underline mb-4 flex items-center gap-1"
                  style={{ color: 'var(--color-teal)' }}
                >
                  <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {t('back', { defaultValue: 'Back' })}
                </button>
                {centerName ? (
                  <p className="text-sm text-center mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('invitedTo', { centerName, defaultValue: `Invited to ${centerName}` })}
                  </p>
                ) : null}
                <p className="text-center mb-6" style={{ color: 'var(--color-text-secondary)' }}>
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
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: 'var(--color-success-muted)' }}
                >
                  <svg
                    className="w-8 h-8"
                    fill="none"
                    stroke="var(--color-success)"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2
                  className="text-xl font-bold mb-2"
                  style={{ ...PLAYFAIR, color: 'var(--color-text-primary)' }}
                >
                  {t('success', { defaultValue: 'Welcome to the team!' })}
                </h2>
                {centerName ? (
                  <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('joinedCenter', { centerName, defaultValue: `You've joined ${centerName}` })}
                  </p>
                ) : null}
                <div
                  className="rounded-lg p-4 mb-4"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('yourPin', { defaultValue: 'Your login PIN:' })}
                  </p>
                  <p
                    className="text-3xl font-mono font-bold tracking-widest"
                    style={{ color: 'var(--color-teal)' }}
                  >
                    {generatedPin}
                  </p>
                  <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                    {t('savePinWarning', { defaultValue: 'Save this PIN! You will need it to log in.' })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="w-full py-2.5 text-white font-medium rounded-lg transition-opacity hover:opacity-90"
                  style={{ background: 'var(--color-teal)' }}
                >
                  {t('goToDashboard', { defaultValue: 'Go to Dashboard' })}
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm hover:underline" style={{ color: 'var(--color-teal)' }}>
              {t('hasAccount', { defaultValue: 'Already have an account? Log in' })}
            </Link>
          </div>
        </div>
    </div>
  );
}
