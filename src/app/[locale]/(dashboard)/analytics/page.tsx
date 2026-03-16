'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import PageHeader from '@/components/shared/PageHeader';
import RevenueByGroup from '@/components/charts/RevenueByGroup';
import MRRTrend from '@/components/charts/MRRTrend';
import AgingReport from '@/components/analytics/AgingReport';
import PnLCard from '@/components/analytics/PnLCard';
import NaturalQueryBox from '@/components/ai/NaturalQueryBox';
import { DollarSign, TrendingUp, Percent, Users, Loader2 } from 'lucide-react';

interface AnalyticsData {
  mrr: number;
  outstanding_total: number;
  collection_rate: number;
  avg_payment_per_student: number;
  revenue_by_group: { group_id: string; group_name: string; amount: number }[];
  mrr_trend: { month: string; amount: number }[];
  payment_method_distribution: { method: string; amount: number }[];
  aging_report: { student_id: string; student_name: string; group_name: string; days_overdue: number; amount: number }[];
  income_by_month: Record<string, number>;
  expenses_by_month: Record<string, { rent: number; salaries: number; utilities: number; other: number }>;
  pnl_months: string[];
}

export default function AnalyticsPage() {
  const t = useTranslations('analytics');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const canViewRevenue = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_view_revenue');

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics/revenue', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canViewRevenue) return;
    loadData();
  }, [canViewRevenue, loadData]);

  if (!canViewRevenue) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('noAccess')}</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  const d = data ?? {
    mrr: 0,
    outstanding_total: 0,
    collection_rate: 0,
    avg_payment_per_student: 0,
    revenue_by_group: [],
    mrr_trend: [],
    payment_method_distribution: [],
    aging_report: [],
    income_by_month: {},
    expenses_by_month: {},
    pnl_months: [],
  };

  const cards = [
    { label: t('mrr'), value: d.mrr.toLocaleString('en-US'), icon: DollarSign },
    { label: t('outstandingTotal'), value: d.outstanding_total.toLocaleString('en-US'), icon: TrendingUp },
    { label: t('collectionRate'), value: `${d.collection_rate.toFixed(1)}%`, icon: Percent },
    { label: t('avgPaymentPerStudent'), value: d.avg_payment_per_student.toLocaleString('en-US'), icon: Users },
  ];

  return (
    <div className="p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader title={t('title')} subtitle={tNav('analytics')} />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <c.icon className="h-4 w-4" />
              {c.label}
            </div>
            <p className="text-2xl font-bold font-mono">{c.value} {c.label === t('mrr') || c.label === t('outstandingTotal') || c.label === t('avgPaymentPerStudent') ? 'ج.م' : ''}</p>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('revenueByGroup')}</h2>
        <div className="rounded-lg border bg-card p-4">
          <RevenueByGroup data={d.revenue_by_group} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('mrrTrend')}</h2>
        <div className="rounded-lg border bg-card p-4">
          <MRRTrend data={d.mrr_trend} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('pnl')}</h2>
        <PnLCard
          incomeByMonth={d.income_by_month}
          expensesByMonth={d.expenses_by_month}
          pnlMonths={d.pnl_months}
          locale={locale}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">{t('agingReport')}</h2>
        <AgingReport data={d.aging_report} onRefresh={loadData} />
      </section>

      <section className="mt-8">
        <NaturalQueryBox />
      </section>
    </div>
  );
}
