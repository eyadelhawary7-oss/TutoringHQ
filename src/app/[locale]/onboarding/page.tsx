'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const tReferral = useTranslations('referral');
  const router = useRouter();
  const [centerName, setCenterName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [existingCenterId, setExistingCenterId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const res = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data?.user?.center_id) {
        setExistingCenterId(data.user.center_id);
        const { data: centerData } = await dbSelect({
          table: 'centers',
          select: 'name',
          filters: [{ column: 'id', op: 'eq', value: data.user.center_id }],
          single: true,
        });
        if (centerData && (centerData as { name?: string }).name) {
          setCenterName((centerData as { name: string }).name);
        }
      }
      setIsCheckingAuth(false);
    };
    checkAuth();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!centerName.trim()) {
      setError('Center name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Get the current session token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please log in again.');
      }
      
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          centerName: centerName.trim(),
          referralCode: referralCode.trim() || undefined,
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned non-JSON response (status ${response.status})`);
      }

      if (!response.ok) {
        const errorMessage = data?.error === 'Invalid code' ? tReferral('invalidCode') : (data?.details || data?.error || `Server error: ${response.status}`);
        throw new Error(errorMessage);
      }

      if (data.success) {
        router.push('/dashboard');
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (err: unknown) {
      console.error('Error creating center:', err);
      let errorMessage = 'An unknown error occurred';
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err && typeof err === 'object' && 'message' in err) {
        errorMessage = String((err as { message: unknown }).message);
      } else {
        try { errorMessage = JSON.stringify(err); } catch { /* keep default */ }
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
        <div className="text-white text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block bg-blue-600 text-white text-4xl font-bold rounded-2xl w-24 h-24 flex items-center justify-center mb-4">
            RG
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome to CenterHQ</h1>
          <p className="text-slate-300">Choose how to continue</p>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-8 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-6">
            {existingCenterId ? 'Complete Your Center Setup' : 'Create a New Center'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-slate-300 mb-2">{t('centerName')}</label>
              <input
                type="text"
                value={centerName}
                onChange={(e) => {
                  setCenterName(e.target.value);
                  setError('');
                }}
                placeholder="eyad center"
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-2">{tReferral('referralCodeOptional')}</label>
              <input
                type="text"
                value={referralCode}
                onChange={(e) => {
                  setReferralCode(e.target.value.toUpperCase().slice(0, 8));
                  setError('');
                }}
                placeholder="XXXXXXXX"
                maxLength={8}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono tracking-widest"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                <p className="text-red-400 text-sm font-medium">
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !centerName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {loading ? 'Creating...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}