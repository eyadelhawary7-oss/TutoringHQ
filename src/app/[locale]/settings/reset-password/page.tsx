'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { Link, useRouter } from '@/i18n/routing';
import { Eye, EyeOff } from 'lucide-react';

function digitsOnly(value: string, maxLen: number): string {
  const v = value.replace(/[^0-9]/g, '');
  return v.length <= maxLen ? v : v.slice(0, maxLen);
}

export default function ResetPasswordPage() {
  const t = useTranslations('resetPassword');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const pinInputClass =
    'w-full ps-4 pe-12 py-3 bg-[var(--color-surface-0)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded-lg text-center text-2xl tracking-widest font-mono';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (currentPin.length !== 6) {
      setError(t('errorPinLength'));
      return;
    }

    if (newPin.length !== 6) {
      setError(t('errorPinLength'));
      return;
    }

    if (newPin !== confirmPin) {
      setError(t('errorPinMismatch'));
      return;
    }

    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError(t('errorUpdateFailed'));
        setLoading(false);
        return;
      }

      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ currentPin, newPin }),
      });

      if (res.status === 429) {
        setError(t('errorUpdateFailed'));
        return;
      }

      const json = await res.json() as { error?: string; ok?: boolean };

      if (!res.ok) {
        if (json.error === 'weak_pin') {
          setError(t('weakPin'));
        } else if (json.error === 'wrong_current_pin') {
          setError(t('errorCurrentIncorrect'));
        } else if (json.error === 'invalid_format') {
          setError(t('errorPinLength'));
        } else {
          setError(t('errorUpdateFailed'));
        }
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push('/settings');
        }, 2000);
      }
    } catch {
      setError(t('errorUpdateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = currentPin.length === 6 && newPin.length === 6 && confirmPin.length === 6;

  if (success) {
    return (
      <div className="min-h-screen bg-bg-primary" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-md mx-auto px-4 py-12">
          <div className="p-6 bg-green-50 rounded-xl border border-green-200 text-center">
            <h2 className="text-xl font-bold text-green-800 mb-2">{t('successMessage')}</h2>
            <p className="text-green-700 text-sm">{t('redirecting')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="glass rounded-xl p-6 shadow">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-6">{t('title')}</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                {t('currentPinLabel')}
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="current-password"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(digitsOnly(e.target.value, 6))}
                  placeholder={t('currentPin')}
                  maxLength={6}
                  required
                  dir="ltr"
                  className={pinInputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((s) => !s)}
                  className="absolute top-1/2 -translate-y-1/2 end-3 p-1 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                  aria-label={showCurrent ? t('pinHideAria') : t('pinShowAria')}
                >
                  {showCurrent ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                {t('newPinLabel')}
              </label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="new-password"
                  value={newPin}
                  onChange={(e) => setNewPin(digitsOnly(e.target.value, 6))}
                  placeholder="••••••"
                  maxLength={6}
                  required
                  dir="ltr"
                  className={pinInputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((s) => !s)}
                  className="absolute top-1/2 -translate-y-1/2 end-3 p-1 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                  aria-label={showNew ? t('pinHideAria') : t('pinShowAria')}
                >
                  {showNew ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
                </button>
              </div>
              <p className="text-text-tertiary text-sm mt-1 text-center">{t('pinHelper')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                {t('confirmPinLabel')}
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(digitsOnly(e.target.value, 6))}
                  placeholder="••••••"
                  maxLength={6}
                  required
                  dir="ltr"
                  className={pinInputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((s) => !s)}
                  className="absolute top-1/2 -translate-y-1/2 end-3 p-1 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                  aria-label={showConfirm ? t('pinHideAria') : t('pinShowAria')}
                >
                  {showConfirm ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full px-4 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? t('updating') : t('updateButton')}
            </button>

            <Link href="/settings" className="block text-center text-sm text-teal-600 hover:underline">
              {t('backToSettings')}
            </Link>
          </form>
        </div>
      </div>
    </div>
  );
}
