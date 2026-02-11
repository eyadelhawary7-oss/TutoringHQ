'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import LanguageToggle from '@/components/LanguageToggle';

type OnboardingMode = 'choose' | 'create' | 'join';

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const router = useRouter();

  const [mode, setMode] = useState<OnboardingMode>('choose');
  const [centerName, setCenterName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setUserId(user.id);

      // Check if already has a center
      const { data: userRecord } = await supabase
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .single();

      if (userRecord?.center_id) {
        router.push('/dashboard');
      }
    };
    getUser();
  }, [router]);

  const handleCreateCenter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerName.trim() || !userId) return;

    setIsLoading(true);
    setError('');

    try {
      // Create center
      const { data: center, error: centerError } = await supabase
        .from('centers')
        .insert({ name: centerName.trim() })
        .select()
        .single();

      if (centerError) throw centerError;

      // Create user record linked to center
      const { error: userError } = await supabase
        .from('users')
        .upsert({
          id: userId,
          center_id: center.id,
          role: 'admin',
        });

      if (userError) throw userError;

      // Create default subscription (trial)
      await supabase.from('subscriptions').insert({
        center_id: center.id,
        status: 'active',
        plan: 'trial',
        start_date: new Date().toISOString(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      router.push('/dashboard');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinCenter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim() || !userId) return;

    setIsLoading(true);
    setError('');

    try {
      // Look up invite code
      const { data: center, error: lookupError } = await supabase
        .from('centers')
        .select('id')
        .eq('invite_code', inviteCode.trim())
        .single();

      if (lookupError || !center) {
        setError(t('invalidCode'));
        return;
      }

      // Create user record
      const { error: userError } = await supabase
        .from('users')
        .upsert({
          id: userId,
          center_id: center.id,
          role: 'assistant',
        });

      if (userError) throw userError;

      router.push('/dashboard');
    } catch {
      setError(t('invalidCode'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900">
      {/* Language Toggle */}
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-lg w-full">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <span className="text-2xl font-bold text-white">RG</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('title')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {t('subtitle')}
            </p>
          </div>

          {mode === 'choose' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Create Center Card */}
              <button
                onClick={() => setMode('create')}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 text-center hover:shadow-xl transition-shadow border-2 border-transparent hover:border-indigo-500"
              >
                <div className="w-14 h-14 mx-auto bg-indigo-100 dark:bg-indigo-900 rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white text-lg">
                  {t('createCenter')}
                </h3>
              </button>

              {/* Join Center Card */}
              <button
                onClick={() => setMode('join')}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 text-center hover:shadow-xl transition-shadow border-2 border-transparent hover:border-indigo-500"
              >
                <div className="w-14 h-14 mx-auto bg-green-100 dark:bg-green-900 rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white text-lg">
                  {t('joinCenter')}
                </h3>
              </button>
            </div>
          )}

          {mode === 'create' && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
              <button
                onClick={() => { setMode('choose'); setError(''); }}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-1"
              >
                <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t('subtitle')}
              </button>

              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-6">
                {t('createCenter')}
              </h2>

              <form onSubmit={handleCreateCenter} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('centerName')}
                  </label>
                  <input
                    type="text"
                    value={centerName}
                    onChange={(e) => setCenterName(e.target.value)}
                    placeholder={t('centerNamePlaceholder')}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white transition-colors"
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !centerName.trim()}
                  className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-lg shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[48px]"
                >
                  {isLoading && (
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {t('continue')}
                </button>
              </form>
            </div>
          )}

          {mode === 'join' && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
              <button
                onClick={() => { setMode('choose'); setError(''); }}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-1"
              >
                <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t('subtitle')}
              </button>

              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-6">
                {t('joinCenter')}
              </h2>

              <form onSubmit={handleJoinCenter} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('inviteCode')}
                  </label>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder={t('inviteCodePlaceholder')}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white transition-colors"
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !inviteCode.trim()}
                  className="w-full py-3 px-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-lg shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[48px]"
                >
                  {isLoading && (
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {t('continue')}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
