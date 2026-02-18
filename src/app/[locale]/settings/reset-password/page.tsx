'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { Link, useRouter } from '@/i18n/routing';

export default function ResetPasswordPage() {
  const t = useTranslations('resetPassword');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();

  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPin !== confirmPin) {
      setError(t('pinsDoNotMatch'));
      return;
    }

    if (newPin.length < 4) {
      setError(t('pinTooShort'));
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPin,
      });

      if (updateError) {
        setError(t('error'));
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push('/settings');
        }, 2000);
      }
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-bg-primary" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-md mx-auto px-4 py-12">
          <div className="p-6 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-700 text-center">
            <h2 className="text-xl font-bold text-green-800 dark:text-green-200 mb-2">{t('success')}</h2>
            <p className="text-green-700 dark:text-green-300 text-sm">{t('redirecting')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="glass rounded-xl p-6 shadow">
          <h1 className="text-2xl font-bold text-text-primary mb-6">{t('title')}</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700">
                <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                {t('newPinLabel')}
              </label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={newPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9]/g, '');
                  if (value.length <= 6) setNewPin(value);
                }}
                placeholder="••••••"
                maxLength={6}
                required
                className="w-full px-4 py-3 bg-bg-tertiary text-text-primary border border-gray-300 dark:border-gray-600 rounded-lg text-center text-2xl tracking-widest font-mono"
                autoComplete="off"
                dir="ltr"
              />
              <p className="text-text-tertiary text-sm mt-1 text-center">
                {t('pinHelper')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                {t('confirmPinLabel')}
              </label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={confirmPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9]/g, '');
                  if (value.length <= 6) setConfirmPin(value);
                }}
                placeholder="••••••"
                maxLength={6}
                required
                className="w-full px-4 py-3 bg-bg-tertiary text-text-primary border border-gray-300 dark:border-gray-600 rounded-lg text-center text-2xl tracking-widest font-mono"
                autoComplete="off"
                dir="ltr"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !newPin || !confirmPin}
              className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? t('updating') : t('updateButton')}
            </button>

            <Link
              href="/settings"
              className="block text-center text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {t('backToSettings')}
            </Link>
          </form>
        </div>
      </div>
    </div>
  );
}
