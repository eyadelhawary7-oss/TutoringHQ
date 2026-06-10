'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, HandCoins, History, Sprout } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/formatNumber';

type IncomeData = {
  collectedThisMonth: number;
  outstanding: number;
  groups: {
    id: string;
    name: string | null;
    collectedThisMonth: number;
    outstanding: number;
  }[];
  recentActivity: {
    sessionId: string;
    date: string;
    groupId: string | null;
    groupName: string | null;
    amountBilled: number;
  }[];
};

/**
 * Private income view (State B only). The server route is gated by
 * requireTeacherPrivateAccess; this component never mounts for lapsed or
 * never-subscribed teachers because the home page only renders it for
 * state === 'unified'.
 */
export default function IncomeView() {
  const t = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<IncomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadIncome = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/private/income', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as IncomeData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadIncome();
  }, [loadIncome]);

  if (loading && !data) {
    return (
      <div>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center">
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
        <button
          onClick={loadIncome}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  const isEmptyPractice =
    data.groups.length === 0 &&
    data.recentActivity.length === 0 &&
    data.collectedThisMonth === 0 &&
    data.outstanding === 0;

  if (isEmptyPractice) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <Sprout size={28} className="mx-auto mb-3 text-teal-400" aria-hidden />
        <h3 className="mb-2 font-bold text-[var(--color-text-primary)]">
          {t('income.emptyTitle')}
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('income.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
          <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Banknote size={16} className="text-teal-400" aria-hidden />
            {t('income.collectedThisMonth')}
          </div>
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(data.collectedThisMonth, locale)}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
          <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <HandCoins size={16} className="text-amber-400" aria-hidden />
            {t('income.outstanding')}
          </div>
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(data.outstanding, locale)}
          </p>
        </div>
      </div>

      {data.groups.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">
            {t('income.byGroup')}
          </h3>
          <ul className="flex flex-col gap-2">
            {data.groups.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
              >
                <span className="font-medium text-[var(--color-text-primary)]">{g.name}</span>
                <span className="flex items-center gap-4 text-sm">
                  <span className="text-[var(--color-text-secondary)]">
                    {t('income.collectedShort')}{' '}
                    <span className="font-semibold text-[var(--color-text-primary)]">
                      {formatCurrency(g.collectedThisMonth, locale)}
                    </span>
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    {t('income.outstandingShort')}{' '}
                    <span className="font-semibold text-amber-400">
                      {formatCurrency(g.outstanding, locale)}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.recentActivity.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-muted)]">
            <History size={14} aria-hidden />
            {t('income.recentActivity')}
          </h3>
          <ul className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {data.recentActivity.map((a) => (
              <li
                key={a.sessionId}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"
              >
                <span className="text-sm text-[var(--color-text-secondary)]">
                  {formatDate(a.date, locale, 'short')}
                </span>
                <span className="flex-1 truncate ps-3 text-sm font-medium text-[var(--color-text-primary)]">
                  {a.groupName ?? ''}
                </span>
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {formatCurrency(a.amountBilled, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
