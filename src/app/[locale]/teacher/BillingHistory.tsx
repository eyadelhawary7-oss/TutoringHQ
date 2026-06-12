'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

type SessionRow = {
  sessionId: string;
  date: string;
  groupId: string | null;
  groupName: string | null;
  total: number;
  attendees: number;
  status: 'paid' | 'pending';
};

/**
 * Attendance and billing history (PRIVATE zone). Each row is one billed class:
 * date, group, attendee count, total, and paid/pending. Self-fetches
 * /api/teacher/private/billing.
 */
export default function BillingHistory() {
  const t = useTranslations('teacherPortal.pages');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
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
      const res = await fetch('/api/teacher/private/billing', {
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
      const data = (await res.json()) as { sessions: SessionRow[] };
      setSessions(data.sessions ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && sessions === null) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
          />
        ))}
      </div>
    );
  }

  if (loadError || sessions === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center">
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
        <button
          onClick={load}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {tPortal('retry')}
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <ClipboardList size={28} className="mx-auto mb-3 text-[var(--color-text-muted)]" aria-hidden />
        <h3 className="mb-2 font-bold text-[var(--color-text-primary)]">{t('billingEmptyTitle')}</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('billingEmptyBody')}</p>
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]">
      {sessions.map((s) => (
        <li
          key={s.sessionId}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"
        >
          <div className="min-w-0">
            <p className="font-medium text-[var(--color-text-primary)]">{s.groupName ?? '-'}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {formatDate(s.date, locale, 'short')}
              <span className="ms-2">
                {t('attendees', { count: formatNumber(s.attendees, locale) })}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="num text-sm font-semibold text-[var(--color-text-primary)]">
              {formatCurrency(s.total, locale)}
            </span>
            <span
              className={[
                'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                s.status === 'paid'
                  ? 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                  : 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
              ].join(' ')}
            >
              {s.status === 'paid' ? t('statusPaid') : t('statusPendingBill')}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
