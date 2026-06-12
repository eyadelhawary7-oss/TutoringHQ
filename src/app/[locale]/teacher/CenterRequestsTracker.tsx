'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/formatNumber';

type JoinRequest = {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string;
  centerName: string | null;
};

const BADGE: Record<string, { labelKey: string; className: string }> = {
  pending: {
    labelKey: 'statusPending',
    className: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
  },
  accepted: {
    labelKey: 'statusAccepted',
    className: 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]',
  },
  declined: {
    labelKey: 'statusDeclined',
    className: 'bg-[var(--color-danger-muted)] text-[var(--color-danger)]',
  },
};

/**
 * Join-request status tracker, shown inside "What centers owe me". Surfaces the
 * teacher's pending/accepted/declined center join requests so a fresh teacher
 * (whose centers list is still empty) can see their outreach is in flight.
 * "Try again" on a declined request asks the join card to focus its code tab.
 */
export default function CenterRequestsTracker() {
  const t = useTranslations('teacherPortal.requestTracker');
  const locale = useLocale();

  const [requests, setRequests] = useState<JoinRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/teacher/center-requests', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { requests: JoinRequest[] };
        if (!cancelled) setRequests(json.requests ?? []);
      } catch {
        // Non-fatal: the tracker just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = requests.filter((r) => r.status !== 'withdrawn');
  if (visible.length === 0) return null;

  return (
    <div className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <h3 className="mb-3 text-sm font-bold text-[var(--color-text-primary)]">{t('title')}</h3>
      <ul className="flex flex-col gap-2">
        {visible.map((r) => {
          const badge = BADGE[r.status] ?? BADGE.pending;
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  {r.centerName ?? '-'}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t('sentOn', { date: formatDate(r.createdAt, locale) })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}
                >
                  {t(badge.labelKey)}
                </span>
                {r.status === 'declined' && (
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent('teacher:join-code-tab'))
                    }
                    className="text-xs font-semibold text-[var(--color-brass)] hover:underline"
                  >
                    {t('tryAgain')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
