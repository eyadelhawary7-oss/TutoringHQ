'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarPlus, Loader2, NotebookPen } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

type SessionItem = {
  id: string;
  scheduled_at: string;
  status: string;
  billed: boolean;
  presentCount: number;
  billedTotal: number;
};

/** Recent classes for the group + the record-a-class action (today default,
 * recent past allowed - teachers record after the fact, never the future). */
export default function SessionsSection({ groupId }: { groupId: string }) {
  const t = useTranslations('teacherPortal.sessions');
  const locale = useLocale();
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [recordDate, setRecordDate] = useState('');
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/teacher/private/groups/${groupId}/sessions`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setSessions(((await res.json()) as { sessions: SessionItem[] }).sessions);
      }
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const recordClass = async () => {
    setRecording(true);
    setError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/teacher/private/groups/${groupId}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(recordDate ? { scheduled_date: recordDate } : {}),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { session: { id: string } };
      router.push(`/teacher/groups/${groupId}/sessions/${data.session.id}`);
    } catch {
      setError(true);
    } finally {
      setRecording(false);
    }
  };

  const statusLabel = (s: SessionItem) => {
    if (s.billed) return t('statusBilled');
    if (s.status === 'finished') return t('statusFinished');
    if (s.status === 'cancelled') return t('statusCancelled');
    return t('statusScheduled');
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-muted)]">
          <NotebookPen size={14} aria-hidden />
          {t('title')}
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={recordDate}
            max={todayIso}
            onChange={(e) => setRecordDate(e.target.value)}
            aria-label={t('dateLabel')}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
          />
          <button
            onClick={recordClass}
            disabled={recording}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recording ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CalendarPlus size={16} aria-hidden />
            )}
            {t('record')}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
          {t('recordError')}
        </p>
      )}

      {loading && sessions === null ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            />
          ))}
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/teacher/groups/${groupId}/sessions/${s.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3 transition-colors hover:border-[var(--color-teal)]/40"
              >
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">
                    {formatDate(s.scheduled_at, locale, 'short')}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                    {t('present', { count: formatNumber(s.presentCount, locale) })}
                  </p>
                </div>
                <div className="text-end">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      s.billed
                        ? 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {statusLabel(s)}
                  </span>
                  {s.billedTotal > 0 && (
                    <p className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
                      {formatCurrency(s.billedTotal, locale)}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
