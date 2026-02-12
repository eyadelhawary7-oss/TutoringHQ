'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Navbar from '@/components/Navbar';

interface Center {
  id: string;
  name: string;
  created_at: string;
}

interface DemoRequest {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  center_name: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export default function AdminPage() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [centers, setCenters] = useState<Center[]>([]);
  const [demoRequests, setDemoRequests] = useState<DemoRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [newCenterName, setNewCenterName] = useState('');
  const [newCenterPhone, setNewCenterPhone] = useState('');
  const [newCenterPlan, setNewCenterPlan] = useState('starter');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }

      try {
        const [centersRes, demoRes] = await Promise.all([
          fetch('/api/admin/centers', {
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          }),
          fetch('/api/admin/demo-requests', {
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          }),
        ]);

        if (centersRes.status === 403 || demoRes.status === 403) {
          setIsAuthorized(false);
          router.replace('/dashboard');
          return;
        }

        if (centersRes.ok) {
          const data = await centersRes.json();
          setCenters(data.centers || []);
        }
        if (demoRes.ok) {
          const data = await demoRes.json();
          setDemoRequests(data.requests || []);
        }
        setIsAuthorized(true);
      } catch {
        setIsAuthorized(false);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [router]);

  const handleCreateCenter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCenterName.trim() || !newCenterPhone.trim()) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setIsCreating(true);
    setCreateError('');

    try {
      const res = await fetch('/api/admin/centers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: newCenterName.trim(),
          ownerPhone: newCenterPhone.trim(),
          plan: newCenterPlan,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setCenters(prev => [{ id: data.centerId, name: newCenterName.trim(), created_at: new Date().toISOString() }, ...prev]);
        setNewCenterName('');
        setNewCenterPhone('');
        setCreateError('');
      } else {
        setCreateError(data.error || 'Failed to create center');
      }
    } catch {
      setCreateError('Network error');
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">
            {t('title')}
          </h1>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Create Center */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                {t('createCenter')}
              </h2>
              <form onSubmit={handleCreateCenter} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('centerName')}</label>
                  <input
                    type="text"
                    value={newCenterName}
                    onChange={(e) => setNewCenterName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('ownerPhone')}</label>
                  <input
                    type="tel"
                    value={newCenterPhone}
                    onChange={(e) => setNewCenterPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    placeholder="01XXXXXXXXX"
                    dir="ltr"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('plan')}</label>
                  <select
                    value={newCenterPlan}
                    onChange={(e) => setNewCenterPlan(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  >
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                {createError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>
                )}
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg disabled:opacity-50"
                >
                  {isCreating ? t('creating') : t('create')}
                </button>
              </form>
            </section>

            {/* Centers List */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                {t('centers')} ({centers.length})
              </h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {centers.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg"
                  >
                    <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
                    <span className="text-xs text-gray-500">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
                {centers.length === 0 && (
                  <p className="text-sm text-gray-400">{t('noCenters')}</p>
                )}
              </div>
            </section>
          </div>

          {/* Demo Requests */}
          <section className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              {t('demoRequests')} ({demoRequests.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('name')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('phone')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('centerName')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {demoRequests.map((req) => (
                    <tr key={req.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="px-4 py-3 text-gray-900 dark:text-white">{req.name}</td>
                      <td className="px-4 py-3" dir="ltr">{req.phone}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{req.center_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          req.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          req.status === 'approved' ? 'bg-green-100 text-green-800' :
                          req.status === 'rejected' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(req.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {demoRequests.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">{t('noDemoRequests')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
