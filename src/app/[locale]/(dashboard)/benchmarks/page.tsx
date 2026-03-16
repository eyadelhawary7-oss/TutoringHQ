'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { useBranchStore } from '@/stores/branchStore';
import PageHeader from '@/components/shared/PageHeader';
import { Link } from '@/i18n/routing';
import { Loader2, Gift, TrendingUp, DollarSign, Users, BookOpen } from 'lucide-react';

interface BenchmarkMetric {
  your_value: number;
  district_avg: number | null;
  percentile: number;
}

interface BenchmarksData {
  insufficient_data: boolean;
  centers_needed?: number;
  reason?: 'no_district' | string;
  district?: string;
  tier?: string;
  center_count?: number;
  snapshot_date?: string;
  attendance?: BenchmarkMetric;
  revenue_per_student?: BenchmarkMetric;
  retention_30d?: BenchmarkMetric;
  group_utilization?: BenchmarkMetric;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatEgp(n: number): string {
  return `${n.toLocaleString('en-US')} ج.م`;
}

export default function BenchmarksPage() {
  const t = useTranslations('benchmarks');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { user } = useUser();
  const { activeCenterId } = useBranchStore();
  const [data, setData] = useState<BenchmarksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    setError(null);
    try {
      const url = activeCenterId ? `/api/benchmarks?center_id=${activeCenterId}` : '/api/benchmarks';
      const res = await fetch(url, {
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
  }, [activeCenterId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isRTL = locale === 'ar';

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]" dir={isRTL ? 'rtl' : 'ltr'}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <PageHeader title={t('title')} subtitle={tNav('benchmarks')} />
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  const d = data ?? { insufficient_data: true, centers_needed: 10 };

  if (d.insufficient_data) {
    const centersNeeded = d.centers_needed ?? 10;
    const isNoDistrict = d.reason === 'no_district';
    return (
      <div className="p-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <PageHeader title={t('title')} subtitle={tNav('benchmarks')} />
        <div className="rounded-xl border bg-card p-8 text-center max-w-lg mx-auto">
          <p className="text-lg text-muted-foreground mb-6">
            {isNoDistrict ? t('noDistrict') : t('insufficientData', { count: centersNeeded })}
          </p>
          {isNoDistrict ? (
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors"
            >
              {t('settingsCta')}
            </Link>
          ) : (
            <Link
              href="/referrals"
              className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors"
            >
              <Gift size={20} />
              {t('referralCta')}
            </Link>
          )}
        </div>
      </div>
    );
  }

  const cards: { key: string; icon: React.ElementType; metric: BenchmarkMetric | undefined; format: (n: number) => string; descKey: string }[] = [
    { key: 'attendance', icon: TrendingUp, metric: d.attendance, format: formatPct, descKey: 'attendanceDesc' },
    { key: 'revenue', icon: DollarSign, metric: d.revenue_per_student, format: formatEgp, descKey: 'revenueDesc' },
    { key: 'retention', icon: Users, metric: d.retention_30d, format: formatPct, descKey: 'retentionDesc' },
    { key: 'utilization', icon: BookOpen, metric: d.group_utilization, format: formatPct, descKey: 'utilizationDesc' },
  ];

  return (
    <div className="p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader title={t('title')} subtitle={tNav('benchmarks')} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map(({ key, icon: Icon, metric, format, descKey }) => {
          if (!metric) return null;
          const yourVal = metric.your_value;
          const avgVal = metric.district_avg ?? 0;
          const pct = Math.min(100, Math.max(0, metric.percentile));
          return (
            <div key={key} className="rounded-xl border bg-card p-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <Icon className="h-4 w-4" />
                {t(key)}
              </div>
              <p className="text-3xl font-bold text-slate-900 mb-1">{format(yourVal)}</p>
              <p className="text-sm text-slate-500 mb-4">
                {t('districtAvg')}: {format(avgVal)}
              </p>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-sm text-slate-600">{t(descKey, { percentile: pct.toFixed(0) })}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
