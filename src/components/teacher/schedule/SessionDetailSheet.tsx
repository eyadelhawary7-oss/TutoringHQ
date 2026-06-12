'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import SheetShell from './SheetShell';

type SessionDetail = {
  session: {
    id: string;
    group_id: string;
    group_name: string | null;
    scheduled_date: string;
    status: string;
    billed: boolean;
    billed_at: string | null;
  };
  attendance: {
    student_id: string;
    student_name: string | null;
    billable: boolean;
  }[];
  transactions: {
    id: string;
    student_id: string;
    student_name: string | null;
    amount_billed: number;
    status: string;
    payment_method: string | null;
    paid_at: string | null;
  }[];
};

// transactions_status_chk: pending | paid | failed | cancelled.
// paid -> teal, pending (outstanding) -> brass, the rest -> gray.
const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]',
  pending: 'bg-[var(--color-brass)]/15 text-[var(--color-brass)]',
};
const FALLBACK_BADGE = 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]';
const KNOWN_STATUSES = new Set(['paid', 'pending', 'failed', 'cancelled']);

/**
 * Read-only detail for an already-recorded session: who attended, what was
 * billed per student, and the paid/outstanding totals.
 */
export default function SessionDetailSheet({
  open,
  sessionId,
  onClose,
}: {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('teacherPortal.schedule');
  const locale = useLocale();

  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return;
    setData(null);
    setLoading(true);
    setLoadError(false);
    let stale = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setLoadError(true);
          return;
        }
        const res = await fetch(`/api/teacher/private/schedule/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          setLoadError(true);
          return;
        }
        const detail = (await res.json()) as SessionDetail;
        if (!stale) setData(detail);
      } catch {
        if (!stale) setLoadError(true);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, sessionId]);

  if (!open) return null;

  const attended = (data?.attendance ?? []).filter((a) => a.billable);
  const transactions = data?.transactions ?? [];
  const totalBilled = transactions.reduce((acc, tx) => acc + tx.amount_billed, 0);
  const totalCollected = transactions
    .filter((tx) => tx.status === 'paid')
    .reduce((acc, tx) => acc + tx.amount_billed, 0);
  const outstanding = totalBilled - totalCollected;

  const statusLabel = (status: string) =>
    KNOWN_STATUSES.has(status) ? t(`txnStatus.${status}`) : status;

  return (
    <SheetShell
      open={open}
      title={t('sessionDetailTitle', { group: data?.session.group_name ?? '' })}
      subtitle={data ? formatDate(data.session.scheduled_date, locale, 'long') : undefined}
      closeLabel={t('close')}
      onClose={onClose}
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
          ))}
        </div>
      ) : loadError || !data ? (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {t('genericError')}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
              {t('attendanceSection')}
            </h3>
            <p className="mb-2 text-sm text-[var(--color-text-secondary)]">
              {t('studentAttended', {
                count: formatNumber(attended.length, locale, { integerOnly: true }),
              })}
            </p>
            <ul className="flex flex-col gap-1.5">
              {attended.map((a) => (
                <li
                  key={a.student_id}
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]"
                >
                  {a.student_name}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
              {t('billedSection')}
            </h3>
            {transactions.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">{t('noCharges')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {transactions.map((tx) => (
                  <li
                    key={tx.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2"
                  >
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {tx.student_name}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        {formatCurrency(tx.amount_billed, locale)}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[tx.status] ?? FALLBACK_BADGE}`}
                      >
                        {statusLabel(tx.status)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
              {t('summarySection')}
            </h3>
            <dl className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-text-secondary)]">{t('totalBilled')}</dt>
                <dd className="font-semibold text-[var(--color-text-primary)]">
                  {formatCurrency(totalBilled, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-text-secondary)]">{t('totalCollected')}</dt>
                <dd className="font-semibold text-[var(--color-teal-deep)]">
                  {formatCurrency(totalCollected, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-text-secondary)]">{t('outstanding')}</dt>
                <dd className="font-semibold text-[var(--color-brass)]">
                  {formatCurrency(outstanding, locale)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </SheetShell>
  );
}
