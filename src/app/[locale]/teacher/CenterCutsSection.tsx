'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, HandCoins } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatPercent } from '@/lib/formatNumber';
import CenterRequestsTracker from './CenterRequestsTracker';

type GroupCut = {
  id: string;
  name: string | null;
  collectedThisMonth: number;
  outstanding: number;
  snapTeacherPct: number | null;
};

type CenterCut = {
  id: string;
  name: string | null;
  collectedThisMonth: number;
  outstanding: number;
  groups: GroupCut[];
};

type CenterCutsData = {
  centers: CenterCut[];
  totalCollectedThisMonth: number;
  totalOutstanding: number;
};

/**
 * Center-cut tracker (FREE zone). Visible to EVERY teacher regardless of
 * subscription - fetches /api/teacher/center-cuts (requireTeacherAuth, no
 * private gate), independently of the private-engine income view.
 */
export default function CenterCutsSection() {
  const t = useTranslations('teacherPortal.centerCuts');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<CenterCutsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadCuts = useCallback(async () => {
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
      const res = await fetch('/api/teacher/center-cuts', {
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
      setData((await res.json()) as CenterCutsData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadCuts();
  }, [loadCuts]);

  const header = (
    <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
      <Building2 size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
      {t('title')}
    </h2>
  );

  if (loading && !data) {
    return (
      <section>
        {header}
        <div className="mb-4 h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
        <div className="h-20 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      </section>
    );
  }

  if (loadError || !data) {
    return (
      <section>
        {header}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center">
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
          <button
            onClick={loadCuts}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            {tPortal('retry')}
          </button>
        </div>
      </section>
    );
  }

  if (data.centers.length === 0) {
    return (
      <section>
        {header}
        <CenterRequestsTracker />
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
          <Building2 size={28} className="mx-auto mb-3 text-[var(--color-text-muted)]" aria-hidden />
          <h3 className="mb-2 font-bold text-[var(--color-text-primary)]">{t('emptyTitle')}</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">{t('emptyBody')}</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      {header}

      <CenterRequestsTracker />

      {/* Headline: what centers owe me (total outstanding). Teal identity. */}
      <div className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] p-5">
        <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-teal-deep)]">
          <HandCoins size={16} aria-hidden />
          {t('totalOutstanding')}
        </div>
        <p className="num text-3xl font-bold text-[var(--color-teal-deep)]">
          {formatCurrency(data.totalOutstanding, locale)}
        </p>
        <p className="num mt-1 text-sm text-[var(--color-teal-deep)]/80">
          {t('collectedThisMonth', { amount: formatCurrency(data.totalCollectedThisMonth, locale) })}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {data.centers.map((c) => (
          <li
            key={c.id}
            className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 shadow-card"
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold text-[var(--color-text-primary)]">{c.name ?? t('unknownCenter')}</p>
              <span className="num text-sm text-[var(--color-text-secondary)]">
                {t('owedShort')}{' '}
                <span className="font-semibold text-[var(--color-teal-deep)]">
                  {formatCurrency(c.outstanding, locale)}
                </span>
              </span>
            </div>
            <p className="num mb-3 text-sm text-[var(--color-text-muted)]">
              {t('collectedShort')} {formatCurrency(c.collectedThisMonth, locale)}
            </p>

            {c.groups.length > 0 && (
              <ul className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
                {c.groups.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2"
                  >
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {g.name}
                      {g.snapTeacherPct != null && (
                        <span className="num ms-2 text-xs text-[var(--color-text-muted)]">
                          {t('cutLabel', { pct: formatPercent(g.snapTeacherPct, locale) })}
                        </span>
                      )}
                    </span>
                    <span className="num text-sm text-[var(--color-text-secondary)]">
                      {formatCurrency(g.outstanding, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
