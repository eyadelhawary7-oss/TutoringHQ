'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarCheck, Wallet } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

type CenterSession = {
  session_id: string;
  date: string;
  group_name: string | null;
  attended_count: number;
  earned: number;
};

type CenterAttendanceData = {
  earnedThisMonth: number;
  earnedAllTime: number;
  sessions: CenterSession[];
};

/**
 * Center earnings + attendance (FREE zone). Shows a teacher's cut earned from
 * center work (this Cairo month and all-time) and the recent attendance
 * sessions for their center groups. Every teacher sees it regardless of
 * subscription - reads /api/teacher/center-attendance (requireTeacherAuth).
 */
export default function CenterEarningsSection() {
  const t = useTranslations('freeZone');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<CenterAttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
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
      const res = await fetch('/api/teacher/center-attendance', {
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
      setData((await res.json()) as CenterAttendanceData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
      <Wallet size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
      {t('earningsTitle')}
    </h2>
  );

  if (loading && !data) {
    return (
      <section>
        {header}
        <div className="h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
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
            onClick={load}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            {tPortal('retry')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      {header}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 shadow-card">
          <p className="text-xs text-[var(--color-text-muted)]">{t('earnedThisMonth')}</p>
          <p className="num mt-1 text-2xl font-bold text-[var(--color-teal-deep)]">
            {formatCurrency(data.earnedThisMonth, locale)}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 shadow-card">
          <p className="text-xs text-[var(--color-text-muted)]">{t('earnedAllTime')}</p>
          <p className="num mt-1 text-2xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(data.earnedAllTime, locale)}
          </p>
        </div>
      </div>

      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-muted)]">
        <CalendarCheck size={14} aria-hidden />
        {t('attendanceTitle')}
      </h3>
      {data.sessions.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
          {t('attendanceEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.sessions.map((s) => (
            <li
              key={s.session_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
            >
              <div>
                <p className="font-medium text-[var(--color-text-primary)]">{s.group_name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {formatDate(s.date, locale, 'long')}
                </p>
              </div>
              <div className="text-end">
                <p className="num text-sm font-semibold text-[var(--color-teal-deep)]">
                  {formatCurrency(s.earned, locale)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t('attendedCount', {
                    count: formatNumber(s.attended_count, locale, { integerOnly: true }),
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
