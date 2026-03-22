'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useLayout } from '@/contexts/LayoutContext';
import { AdminSidebar } from '@/components/AdminSidebar';
import {
  Building2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  CreditCard,
  Gift,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface DashboardData {
  totalActiveCenters: number;
  mrr: number;
  arr: number;
  netNew30d: number;
  monthlyChurnRate: number;
  collectionRate: number;
  referralRate: number;
  newYesterday: number;
  churned: number;
  atRisk: number;
  healthDistribution: { name: string; value: number; color: string }[];
  cohortTable: { month: string; total: number; [k: string]: number | string }[];
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function CeoDashboardPage() {
  const t = useTranslations('ceoDashboard');
  const locale = useLocale();
  const { setHideShell } = useLayout();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ceo/dashboard', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const isRTL = locale === 'ar';

  if (loading && !data) {
    return (
      <div className="flex min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <AdminSidebar activeTab="ceoDashboard" activeRoute="/ceo-dashboard" />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        </main>
      </div>
    );
  }

  const d = data ?? {
    totalActiveCenters: 0,
    mrr: 0,
    arr: 0,
    netNew30d: 0,
    monthlyChurnRate: 0,
    collectionRate: 0,
    referralRate: 0,
    newYesterday: 0,
    churned: 0,
    atRisk: 0,
    healthDistribution: [],
    cohortTable: [],
  };

  const metrics = [
    { label: t('totalActiveCenters'), value: fmt(d.totalActiveCenters), icon: Building2 },
    { label: t('mrr'), value: `EGP ${fmt(d.mrr)}`, icon: DollarSign },
    { label: t('arr'), value: `EGP ${fmt(d.arr)}`, icon: TrendingUp },
    { label: t('netNew30d'), value: d.netNew30d >= 0 ? `+${d.netNew30d}` : String(d.netNew30d), icon: Users },
    { label: t('monthlyChurnRate'), value: `${d.monthlyChurnRate.toFixed(1)}%`, icon: TrendingDown },
    { label: t('collectionRate'), value: `${d.collectionRate.toFixed(1)}%`, icon: CreditCard },
    { label: t('referralRate'), value: `${d.referralRate.toFixed(1)}%`, icon: Gift },
  ];

  return (
    <div className="flex min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
      <AdminSidebar activeTab="ceoDashboard" activeRoute="/ceo-dashboard" />
      <main className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-slate-200 text-[var(--color-text-secondary)]"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-4">
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
                <Icon className="h-4 w-4" />
                {label}
              </div>
              <p className="text-xl font-bold text-[var(--color-text-primary)] font-mono">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('healthDistribution')}</h2>
            {d.healthDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={d.healthDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {d.healthDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => [v ?? 0, '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[var(--color-text-secondary)] text-center py-8">{t('noHealthData')}</p>
            )}
          </div>

          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('briefingPreview')}</h2>
            <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
              <p>{t('activeCenters')}: {d.totalActiveCenters}</p>
              <p>{t('mrr')}: EGP {fmt(d.mrr)}</p>
              <p>{t('newYesterday')}: {d.newYesterday}</p>
              <p>{t('churned')}: {d.churned}</p>
              <p className="flex items-center gap-1">
                {t('atRisk')}: {d.atRisk}
                {d.atRisk > 0 && <AlertTriangle className="h-4 w-4 text-amber-500" />}
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('cohortTable')}</h2>
          {d.cohortTable.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-start py-2 font-medium text-[var(--color-text-primary)]">{t('signupMonth')}</th>
                    <th className="text-start py-2 font-medium text-[var(--color-text-primary)]">{t('total')}</th>
                    {[0, 1, 2, 3, 4, 5, 6].map((m) => (
                      <th key={m} className="text-center py-2 font-medium text-[var(--color-text-primary)]">
                        M{m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.cohortTable.slice(0, 12).map((row) => (
                    <tr key={row.month} className="border-b border-[var(--color-border-subtle)]">
                      <td className="py-2">{row.month}</td>
                      <td className="py-2">{row.total}</td>
                      {[0, 1, 2, 3, 4, 5, 6].map((m) => (
                        <td key={m} className="text-center py-2">
                          {(row[`m${m}`] as number) ?? '—'}%
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[var(--color-text-secondary)] text-center py-8">{t('noCohortData')}</p>
          )}
        </section>
      </main>
    </div>
  );
}
