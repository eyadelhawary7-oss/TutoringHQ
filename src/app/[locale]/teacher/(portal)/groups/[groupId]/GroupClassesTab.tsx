'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import { formatTime } from '@/lib/timeFormat';
import { getCurrentCairoClock } from '@/lib/cairo/day';
import { useToast } from '@/hooks/useToast';

type ClassStudent = {
  student_id: string;
  transaction_id: string | null;
  name: string | null;
  is_guest: boolean;
  attended: boolean;
  amount: number;
  status: string | null;
};

type CollectMethod = 'cash' | 'instapay';

type ClassRow = {
  session_id: string;
  scheduled_at: string;
  date: string;
  attended_count: number;
  total_billed: number;
  total_collected: number;
  outstanding: number;
  students: ClassStudent[];
};

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]',
  pending: 'bg-[var(--color-brass)]/15 text-[var(--color-brass)]',
};
const FALLBACK_BADGE = 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]';
const KNOWN_STATUSES = new Set(['paid', 'pending', 'failed', 'cancelled']);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Cairo wall-clock time-of-day for a session timestamp, as "h:mm AM/PM". */
function cairoTimeLabel(scheduledAt: string, labels: { am: string; pm: string }): string {
  const { hour, minute } = getCurrentCairoClock(new Date(scheduledAt));
  return formatTime(`${pad2(hour)}:${pad2(minute)}`, labels);
}

/**
 * Classes tab: the group's past sessions, newest first, with attendance +
 * billing rollups and an expandable per-student breakdown. Cursor-paginated
 * (20/page) against GET .../groups/[groupId]/classes.
 */
export default function GroupClassesTab({ groupId }: { groupId: string }) {
  const t = useTranslations('teacherPortal.groupTabs');
  const tSchedule = useTranslations('teacherPortal.schedule');
  const tf = useTranslations('timeFormat');
  const locale = useLocale();
  const toast = useToast();
  const timeLabels = { am: tf('am'), pm: tf('pm') };

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Which transaction's collect popover is open, and which is in flight.
  const [collectOpen, setCollectOpen] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<string | null>(null);

  const load = useCallback(
    async (nextCursor: string | null) => {
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      setError(false);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setError(true);
          return;
        }
        const url = nextCursor
          ? `/api/teacher/private/groups/${groupId}/classes?cursor=${encodeURIComponent(nextCursor)}`
          : `/api/teacher/private/groups/${groupId}/classes`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = (await res.json()) as { classes: ClassRow[]; next_cursor: string | null };
        setClasses((prev) => (nextCursor ? [...prev, ...data.classes] : data.classes));
        setCursor(data.next_cursor);
        setHasMore(Boolean(data.next_cursor));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [groupId],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Settle a single outstanding charge from the breakdown. On success we patch
  // the row's status to paid and move its amount from outstanding to collected
  // so the rollups stay in sync without a refetch.
  const collect = async (
    sessionId: string,
    transactionId: string,
    amount: number,
    method: CollectMethod,
  ) => {
    setCollectOpen(null);
    setCollecting(transactionId);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error(t('collectError'));
        return;
      }
      const res = await fetch(`/api/teacher/private/transactions/${transactionId}/mark-paid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) {
        toast.error(t('collectError'));
        return;
      }
      setClasses((prev) =>
        prev.map((c) => {
          if (c.session_id !== sessionId) return c;
          return {
            ...c,
            students: c.students.map((s) =>
              s.transaction_id === transactionId ? { ...s, status: 'paid' } : s,
            ),
            total_collected: c.total_collected + amount,
            outstanding: c.outstanding - amount,
          };
        }),
      );
      toast.success(t('collectSuccess'));
    } catch {
      toast.error(t('collectError'));
    } finally {
      setCollecting(null);
    }
  };

  const statusBadge = (status: string | null) => {
    if (!status) return null;
    const label = KNOWN_STATUSES.has(status) ? tSchedule(`txnStatus.${status}`) : status;
    return (
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          STATUS_BADGE[status] ?? FALLBACK_BADGE
        }`}
      >
        {label}
      </span>
    );
  };

  if (loading) {
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

  if (error && classes.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center">
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('classesError')}</p>
        <button
          type="button"
          onClick={() => load(null)}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
        {t('noClasses')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {classes.map((c) => {
          const isOpen = expanded.has(c.session_id);
          return (
            <li
              key={c.session_id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            >
              <button
                type="button"
                onClick={() => toggle(c.session_id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
              >
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">
                    {formatDate(c.date, locale, 'long')}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]" dir="ltr">
                    {cairoTimeLabel(c.scheduled_at, timeLabels)}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    {t('attendedCount', {
                      count: formatNumber(c.attended_count, locale, { integerOnly: true }),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-end">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {formatCurrency(c.total_billed, locale)}
                    </p>
                    {c.outstanding > 0 && (
                      <p className="text-xs text-[var(--color-brass)]">
                        {t('outstandingShort', { amount: formatCurrency(c.outstanding, locale) })}
                      </p>
                    )}
                  </div>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 text-[var(--color-text-muted)] ${
                      isOpen ? 'rotate-180 transition-transform' : 'transition-transform'
                    }`}
                    aria-hidden
                  />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
                  <ul className="flex flex-col gap-1.5">
                    {c.students.map((s) => (
                      <li
                        key={s.student_id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                          {s.name}
                          {s.is_guest && (
                            <span className="rounded-full bg-[var(--color-brass)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-brass)]">
                              {tSchedule('guestBadge')}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-[var(--color-text-secondary)]">
                            {formatCurrency(s.amount, locale)}
                          </span>
                          {statusBadge(s.status)}
                          {s.status === 'pending' && s.transaction_id && (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setCollectOpen((cur) =>
                                    cur === s.transaction_id ? null : s.transaction_id,
                                  )
                                }
                                disabled={collecting === s.transaction_id}
                                className="flex items-center gap-1 rounded-lg border border-[var(--color-teal)]/40 px-2.5 py-1 text-xs font-medium text-[var(--color-teal-deep)] transition-colors hover:bg-[var(--color-teal-soft)] disabled:opacity-50"
                              >
                                {collecting === s.transaction_id && (
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                                )}
                                {t('collectButton')}
                              </button>
                              {collectOpen === s.transaction_id && (
                                <div className="absolute end-0 z-10 mt-1 flex w-32 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] shadow-[var(--shadow-card)]">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      collect(c.session_id, s.transaction_id!, s.amount, 'cash')
                                    }
                                    className="px-3 py-2 text-start text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)]"
                                  >
                                    {t('collectCash')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      collect(c.session_id, s.transaction_id!, s.amount, 'instapay')
                                    }
                                    className="px-3 py-2 text-start text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)]"
                                  >
                                    {t('collectInstapay')}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border-subtle)] pt-3 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-[var(--color-text-secondary)]">{t('totalCollected')}</dt>
                      <dd className="font-medium text-[var(--color-teal-deep)]">
                        {formatCurrency(c.total_collected, locale)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[var(--color-text-secondary)]">{t('outstanding')}</dt>
                      <dd className="font-medium text-[var(--color-brass)]">
                        {formatCurrency(c.outstanding, locale)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button
          type="button"
          onClick={() => load(cursor)}
          disabled={loadingMore}
          className="flex items-center justify-center gap-2 self-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
