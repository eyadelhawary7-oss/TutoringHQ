'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import PageHeader from '@/components/shared/PageHeader';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Building2, Plus, Loader2, TrendingUp, Users, DollarSign, UserCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';

interface BranchRow {
  id: string;
  name: string;
  students: number;
  mrr: number;
  outstanding: number;
  staff_count: number;
}

interface ConsolidatedData {
  total_mrr: number;
  total_students: number;
  total_outstanding: number;
  by_branch: { center_id: string; name: string; mrr: number; students: number; outstanding: number; staff_count: number }[];
}

export default function BranchesPage() {
  const t = useTranslations('branches');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { user } = useUser();
  const isOwner = user?.role === 'owner';

  const [plan, setPlan] = useState<'single' | 'multi'>('single');
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [consolidated, setConsolidated] = useState<ConsolidatedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    setError(null);
    try {
      const [branchesRes, consolidatedRes] = await Promise.all([
        fetch('/api/branches', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch('/api/analytics/consolidated', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);

      const branchesData = await branchesRes.json();
      const consolidatedData = consolidatedRes.ok ? await consolidatedRes.json() : null;

      if (branchesData?.branches) {
        setPlan((branchesData.plan as 'single' | 'multi') ?? 'single');
      }

      if (consolidatedData?.by_branch && consolidatedData.by_branch.length > 0) {
        setConsolidated(consolidatedData);
        const byBranch = consolidatedData.by_branch as { center_id: string; name: string; mrr: number; students: number; outstanding: number; staff_count?: number }[];
        setBranches(
          byBranch.map((b) => ({
            id: b.center_id,
            name: b.name,
            students: b.students,
            mrr: b.mrr,
            outstanding: b.outstanding,
            staff_count: b.staff_count ?? 0,
          }))
        );
      } else if (branchesData?.branches) {
        const br = branchesData.branches as { id: string; name: string }[];
        setBranches(
          br.map((b) => ({
            id: b.id,
            name: b.name,
            students: 0,
            mrr: 0,
            outstanding: 0,
            staff_count: 0,
          }))
        );
        if (br.length > 0) {
          setConsolidated({
            total_mrr: 0,
            total_students: 0,
            total_outstanding: 0,
            by_branch: br.map((b) => ({ center_id: b.id, name: b.name, mrr: 0, students: 0, outstanding: 0, staff_count: 0 })),
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddBranch = async () => {
    if (!newName.trim() || !isOwner) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setNewName('');
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  if (loading && branches.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (plan === 'single') {
    return (
      <div className="p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <PageHeader title={t('title')} subtitle={tNav('branches')} />
        <div className="rounded-xl border bg-card p-8 max-w-lg">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-teal-100 flex items-center justify-center">
              <Building2 className="h-7 w-7 text-teal-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('upgradeTitle')}</h2>
              <p className="text-slate-600 text-sm">{t('upgradeDescription')}</p>
            </div>
          </div>
          <p className="text-slate-600 mb-6">{t('upgradeBenefits')}</p>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 transition-colors"
          >
            {t('upgradeCta')}
          </Link>
        </div>
      </div>
    );
  }

  const chartData = branches.map((b) => ({
    name: b.name,
    students: b.students,
    mrr: b.mrr,
    outstanding: b.outstanding,
  }));

  return (
    <div className="p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader title={t('title')} subtitle={tNav('branches')} />

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {isOwner && (
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('branchName')}</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('branchNamePlaceholder')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <button
            onClick={handleAddBranch}
            disabled={adding || !newName.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus size={18} />}
            {t('addBranch')}
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card mb-8">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">{t('branchName')}</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">{t('students')}</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">{t('monthlyRevenue')}</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">{t('outstanding')}</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">{t('staffCount')}</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} className="border-b last:border-0 hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-slate-900">{b.name}</td>
                <td className="px-4 py-3 text-slate-600">{b.students.toLocaleString('en-US')}</td>
                <td className="px-4 py-3 text-slate-600">{b.mrr.toLocaleString('en-US')} {tCommon('egp')}</td>
                <td className="px-4 py-3 text-slate-600">{b.outstanding.toLocaleString('en-US')} {tCommon('egp')}</td>
                <td className="px-4 py-3 text-slate-600">{b.staff_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {branches.length >= 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Users size={18} />
              {t('studentsByBranch')}
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="students" fill="#0d9488" name={t('students')} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <DollarSign size={18} />
              {t('revenueByBranch')}
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number | undefined) => `${(v ?? 0).toLocaleString('en-US')} ${tCommon('egp')}`} />
                <Bar dataKey="mrr" fill="#0d9488" name={t('monthlyRevenue')} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {consolidated && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <TrendingUp size={16} />
              {t('totalMrr')}
            </div>
            <p className="text-2xl font-bold text-slate-900">{consolidated.total_mrr.toLocaleString('en-US')} {tCommon('egp')}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <Users size={16} />
              {t('totalStudents')}
            </div>
            <p className="text-2xl font-bold text-slate-900">{consolidated.total_students.toLocaleString('en-US')}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <DollarSign size={16} />
              {t('totalOutstanding')}
            </div>
            <p className="text-2xl font-bold text-slate-900">{consolidated.total_outstanding.toLocaleString('en-US')} {tCommon('egp')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
