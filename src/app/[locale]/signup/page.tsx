'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';

type Plan = 'starter' | 'pro' | 'enterprise';

export default function SignupPage() {
  const t = useTranslations('signup');
  const tLanding = useTranslations('landing');
  const router = useRouter();

  const [formData, setFormData] = useState({
    centerName: '',
    phone: '',
    email: '',
    plan: 'starter' as Plan,
    termsAccepted: false,
    referralCode: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.termsAccepted) {
      setError(t('terms'));
      return;
    }
    const cleanPhone = formData.phone.replace(/\D/g, '');
    if (cleanPhone.length !== 11 || !cleanPhone.startsWith('01')) {
      setError(t('invalidPhone'));
      return;
    }
    const code = formData.referralCode.trim();
    if (code && code.length !== 8) {
      setError(t('referralCodeInvalid'));
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centerName: formData.centerName.trim(),
          phone: cleanPhone,
          email: formData.email.trim() || undefined,
          plan: formData.plan,
          termsAccepted: formData.termsAccepted,
          referralCode: formData.referralCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === 'referralCodeInvalid' ? t('referralCodeInvalid') : (data.error || t('error')));
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch {
      setError(t('error'));
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900">
        <div className="absolute top-4 end-4 z-10">
          <LanguageToggle />
        </div>
        <div className="min-h-screen flex flex-col items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              {t('success')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('successMessage')}
            </p>
            <Link
              href="/"
              className="inline-block py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
            >
              {tLanding('footer')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900">
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block mb-4">
              <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg">
                <span className="text-2xl font-bold text-white">CH</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                CenterHQ
              </h1>
              <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-1">
                {tLanding('subtitle')}
              </p>
            </Link>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-6 text-center">
              {t('title')}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('centerName')} *
                </label>
                <input
                  type="text"
                  required
                  value={formData.centerName}
                  onChange={(e) => { setFormData({ ...formData, centerName: e.target.value }); setError(''); }}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                  placeholder="اسم السنتر"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('phone')} *
                </label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  pattern="01[0-9]{9}"
                  value={formData.phone}
                  onChange={(e) => { setFormData({ ...formData, phone: e.target.value }); setError(''); }}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                  placeholder="01012345678"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('email')}
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                  placeholder="email@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('referralCode')}
                </label>
                <input
                  type="text"
                  maxLength={8}
                  value={formData.referralCode}
                  onChange={(e) => { setFormData({ ...formData, referralCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }); setError(''); }}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white font-mono tracking-widest"
                  placeholder="XXXXXXXX"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('selectPlan')} *
                </label>
                <div className="space-y-3">
                  {(['starter', 'pro', 'enterprise'] as const).map((p) => (
                    <label
                      key={p}
                      className="flex items-center p-4 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-400"
                    >
                      <input
                        type="radio"
                        name="plan"
                        value={p}
                        checked={formData.plan === p}
                        onChange={() => setFormData({ ...formData, plan: p })}
                        className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="ms-3 text-gray-900 dark:text-white font-medium">
                        {t(p)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.termsAccepted}
                  onChange={(e) => { setFormData({ ...formData, termsAccepted: e.target.checked }); setError(''); }}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('terms')}
                </span>
              </label>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '...' : t('submit')}
              </button>
            </form>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('hasAccount')}{' '}
              <Link href="/login" className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-medium">
                {tLanding('loginButton')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
