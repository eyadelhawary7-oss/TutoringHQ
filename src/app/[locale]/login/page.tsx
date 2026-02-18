'use client';

import Image from 'next/image';
import { useState, FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const t = useTranslations('login');
  const router = useRouter();

  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!phone || !pin) {
      setError(t('invalidCredentials'));
      return;
    }

    setIsLoading(true);
    try {
      // Query users table to find user by phone
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, email')
        .eq('phone', phone)
        .single();

      if (userError || !userData) {
        setError(t('phoneNotFound', { defaultValue: 'Phone number not registered' }));
        setIsLoading(false);
        return;
      }

      // Login using the email from users table
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: userData.email || `${phone.replace(/[^0-9]/g, '')}@centerhq.local`,
        password: pin,
      });

      if (loginError) {
        setError(t('invalidCredentials'));
        setIsLoading(false);
        return;
      }

      if (data.user) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const checkRes = await fetch('/api/admin/check', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const checkData = await checkRes.json();
        if (checkData.isAdmin) {
          router.replace('/admin');
          return;
        }

        const res = await fetch('/api/auth/check-invite', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
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
      setError(t('invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900" data-theme="light">
      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block mb-4">
              <Image src="/logo-icon.png" alt="CenterHQ" width={64} height={64} className="w-16 h-16 mx-auto mb-3 object-contain" />
              <h1 className="text-3xl font-bold text-text-primary">
                CenterHQ
              </h1>
            </Link>
          </div>

          <div className="bg-bg-primary text-text-primary border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-8">
            <h2 className="text-xl font-bold text-text-primary mb-6 text-center">
              {t('credentialsTitle', { defaultValue: 'Login' })}
            </h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-text-primary mb-2">
                  {t('phoneLabel', { defaultValue: 'Phone Number' })}
                </label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => {
                    let value = e.target.value.replace(/[^0-9+]/g, '');

                    // Auto-add +20 if user starts typing a digit
                    if (value.length === 1 && value !== '+') {
                      value = '+20' + value;
                    }

                    // Limit to +20XXXXXXXXXX (13 chars)
                    if (value.length <= 13) {
                      setPhone(value);
                    }
                    setError('');
                  }}
                  placeholder="+20 1XXXXXXXXX"
                  required
                  className="w-full px-4 py-3 bg-bg-tertiary border border-gray-300 dark:border-gray-600 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-text-primary text-end"
                  dir="ltr"
                  autoComplete="tel"
                />
              </div>
              <div>
                <label htmlFor="pin" className="block text-sm font-medium text-text-primary mb-2">
                  {t('pinLabel', { defaultValue: 'PIN Code' })}
                </label>
                <input
                  id="pin"
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9]/g, '');
                    if (value.length <= 6) setPin(value);
                    setError('');
                  }}
                  placeholder="••••••"
                  maxLength={6}
                  required
                  className="w-full px-4 py-3 bg-bg-tertiary border border-gray-300 dark:border-gray-600 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-text-primary text-center text-2xl tracking-widest font-mono"
                  autoComplete="off"
                />
                <p className="text-text-tertiary text-sm mt-1 text-center">
                  {t('pinHelper', { defaultValue: 'Enter your 6-digit PIN' })}
                </p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '...' : t('loginButton', { defaultValue: 'Login' })}
              </button>
              <div className="mt-4 text-center">
                <Link href="/forgot-password" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                  {t('forgotPin', { defaultValue: 'Forgot PIN?' })}
                </Link>
              </div>
            </form>
          </div>

          <div className="text-center mt-6">
            <Link
              href="/"
              className="text-sm text-text-secondary hover:text-text-primary"
            >
              ← {t('backToHome')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
