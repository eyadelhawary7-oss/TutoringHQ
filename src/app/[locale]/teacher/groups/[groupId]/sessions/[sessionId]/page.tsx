'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

type SessionDetail = {
  session: { id: string; scheduled_at: string; status: string; billed: boolean };
  group: { id: string; name: string | null; fee_per_class: number };
  roster: { studentId: string; name: string | null; payer: string | null; present: boolean }[];
  charges: { studentId: string; amount: number; status: string }[];
};

/**
 * The attendance sheet - the teacher's daily screen. Tap a student to toggle
 * present (optimistic, server response is truth), watch the count, then
 * finish: one confirm step (N x fee = total, display-only) and
 * finish_class_and_bill creates the pending charges.
 */
export default function SessionPage({
  params,
}: {
  params: Promise<{ groupId: string; sessionId: string }>;
}) {
  const { groupId, sessionId } = use(params);
  const t = useTranslations('teacherPortal.attendance');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);

  const getToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/login');
      return null;
    }
    return session.access_token;
  }, [router]);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(
        `/api/teacher/private/groups/${groupId}/sessions/${sessionId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (res.status === 403 || res.status === 404) {
        router.replace('/teacher');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as SessionDetail);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [groupId, sessionId, getToken, router]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const toggle = async (studentId: string, present: boolean) => {
    if (!data || data.session.billed || togglingId) return;
    setTogglingId(studentId);
    setToggleError(false);
    // Optimistic flip; reverted on failure, refetched on conflict.
    setData({
      ...data,
      roster: data.roster.map((r) => (r.studentId === studentId ? { ...r, present } : r)),
    });
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(
        `/api/teacher/private/groups/${groupId}/sessions/${sessionId}/attendance`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ student_id: studentId, present }),
        },
      );
      if (!res.ok) {
        setToggleError(true);
        await loadDetail();
      }
    } catch {
      setToggleError(true);
      await loadDetail();
    } finally {
      setTogglingId(null);
    }
  };

  const finish = async () => {
    setFinishing(true);
    setFinishError(false);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(
        `/api/teacher/private/groups/${groupId}/sessions/${sessionId}/finish`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok && res.status !== 409) {
        setFinishError(true);
        return;
      }
      // Success or already-billed/conflict: the refetched session is truth.
      setConfirming(false);
      await loadDetail();
    } catch {
      setFinishError(true);
    } finally {
      setFinishing(false);
    }
  };

  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft;

  if (loading && !data) {
    return (
      <div>
        <div className="mb-6 h-7 w-44 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="mb-2 h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
          />
        ))}
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
          {tPortal('errorTitle')}
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
        <button
          onClick={loadDetail}
          className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {tPortal('retry')}
        </button>
      </div>
    );
  }

  const presentCount = data.roster.filter((r) => r.present).length;
  const fee = data.group.fee_per_class;
  const expectedTotal = Math.round(presentCount * fee * 100) / 100;
  const nameById = new Map(data.roster.map((r) => [r.studentId, r.name]));
  const chargesTotal =
    Math.round(data.charges.reduce((acc, c) => acc + c.amount, 0) * 100) / 100;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/teacher/groups/${groupId}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <BackIcon size={16} aria-hidden />
          {tPortal('roster.back')}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              {data.group.name}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {formatDate(data.session.scheduled_at, locale, 'short')}
            </p>
          </div>
          {!data.session.billed && (
            <span className="rounded-full bg-[var(--color-surface-2)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)]">
              {t('presentCount', {
                present: formatNumber(presentCount, locale),
                total: formatNumber(data.roster.length, locale),
              })}
            </span>
          )}
        </div>
      </div>

      {toggleError && (
        <p className="rounded-lg border border-red-900 bg-red-900/20 p-3 text-sm text-red-400">
          {t('toggleError')}
        </p>
      )}

      {data.session.billed ? (
        <section className="rounded-xl border border-teal-800 bg-[var(--color-surface-1)] p-6">
          <h2 className="mb-1 text-lg font-bold text-teal-400">{t('billedTitle')}</h2>
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('pendingNote')}</p>
          <ul className="mb-4 flex flex-col gap-2">
            {data.charges.map((c) => (
              <li
                key={c.studentId}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3"
              >
                <span className="font-medium text-[var(--color-text-primary)]">
                  {nameById.get(c.studentId) ?? ''}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {formatCurrency(c.amount, locale)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      c.status === 'paid'
                        ? 'bg-teal-900/40 text-teal-400'
                        : 'bg-amber-900/30 text-amber-400'
                    }`}
                  >
                    {c.status === 'paid' ? t('statusPaid') : t('statusPending')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-end text-sm text-[var(--color-text-secondary)]">
            {t('billedTotal')}{' '}
            <span className="text-lg font-bold text-[var(--color-text-primary)]">
              {formatCurrency(chargesTotal, locale)}
            </span>
          </p>
        </section>
      ) : data.session.status === 'cancelled' ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
          {t('cancelled')}
        </p>
      ) : (
        <>
          {data.roster.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
              {t('emptyRoster')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.roster.map((r) => (
                <li key={r.studentId}>
                  <button
                    onClick={() => toggle(r.studentId, !r.present)}
                    disabled={togglingId !== null}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-4 text-start transition-colors ${
                      r.present
                        ? 'border-teal-600 bg-teal-900/30'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-1)] hover:border-[var(--color-text-muted)]'
                    }`}
                  >
                    <span
                      className={`text-base font-medium ${
                        r.present ? 'text-teal-300' : 'text-[var(--color-text-primary)]'
                      }`}
                    >
                      {r.name}
                    </span>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                        r.present
                          ? 'border-teal-500 bg-teal-600 text-primary-foreground'
                          : 'border-[var(--color-border)]'
                      }`}
                      aria-hidden
                    >
                      {togglingId === r.studentId ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : r.present ? (
                        <Check size={16} />
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {finishError && (
            <p className="rounded-lg border border-red-900 bg-red-900/20 p-3 text-sm text-red-400">
              {t('finishError')}
            </p>
          )}

          {confirming ? (
            <div className="rounded-xl border border-teal-800 bg-[var(--color-surface-1)] p-6">
              <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
                {t('confirmTitle')}
              </h2>
              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                {t('confirmLine', {
                  count: formatNumber(presentCount, locale),
                  fee: formatCurrency(fee, locale),
                  total: formatCurrency(expectedTotal, locale),
                })}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={finishing}
                  className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  {t('confirmCancel')}
                </button>
                <button
                  onClick={finish}
                  disabled={finishing}
                  className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {finishing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {finishing ? t('finishing') : t('confirmGo')}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setConfirming(true)}
                disabled={presentCount === 0 || data.roster.length === 0}
                className="w-full rounded-xl bg-teal-600 px-4 py-4 text-base font-bold text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('finish')}
              </button>
              {presentCount === 0 && data.roster.length > 0 && (
                <p className="mt-2 text-center text-sm text-[var(--color-text-muted)]">
                  {t('noAttendees')}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
