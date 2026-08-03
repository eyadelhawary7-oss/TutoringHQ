'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, MessageCircle, Phone, UserRound } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatPhoneIntlGrouped,
} from '@/lib/formatNumber';
import { initialsOf } from '@/lib/initials';
import TeacherAppBar from '../../../TeacherAppBar';

type StudentDetail = {
  student: { id: string; name: string | null; phone: string | null; parentPhone: string | null };
  groups: { id: string; name: string | null }[];
  billing: {
    outstanding: number;
    pendingCount: number;
    pendingIds: string[];
    transactions: {
      id: string;
      date: string;
      amount: number;
      groupName: string | null;
      status: string | null;
      method: string | null;
    }[];
  };
  attendance: { finishedSessions: number; present: number; rate: number | null };
  reminderBlock: string | null;
};

const MANUAL_METHODS = ['cash', 'instapay', 'vodafone_cash', 'other'] as const;
type ManualMethod = (typeof MANUAL_METHODS)[number];

/** Manual collection method -> its existing teacherPortal.markPaid.* label key. */
const METHOD_LABEL_KEY: Record<string, string> = {
  cash: 'markPaid.cash',
  instapay: 'markPaid.instapay',
  vodafone_cash: 'markPaid.vodafoneCash',
  other: 'markPaid.other',
};

/** Why a manual fee reminder cannot be sent -> the one-line reason we print. */
const REMINDER_BLOCK_KEY: Record<string, string> = {
  reminder_disabled: 'reminderDisabled',
  template_not_approved: 'reminderTemplatePending',
  no_payer_phone: 'reminderNoPhone',
  reminder_cap_reached: 'reminderCapReached',
};

/** Digits, country-code-prefixed, no leading '+' - the wa.me / tel: contract. */
function intlDigits(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('20')) return d;
  if (d.startsWith('0')) return `20${d.slice(1)}`;
  return `20${d}`;
}

/**
 * Merged-Teacher-Students §02 — one student, opened from the roster, a group,
 * or attendance. Their contact and their parent's, an outstanding balance the
 * teacher can collect right here, attendance, and recent classes.
 */
export default function TeacherStudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = use(params);
  const t = useTranslations('teacherPortal.pages');
  const tList = useTranslations('teacherPortal.studentsList');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markFailed, setMarkFailed] = useState<number | null>(null);
  const [reminding, setReminding] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState(false);

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

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/teacher/private/students/${studentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (res.status === 403 || res.status === 404) {
        router.replace('/teacher/students');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as StudentDetail);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [studentId, getToken, router]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The balance is an aggregate over N pending charges but the endpoint settles
   * one charge at a time, so this fires one POST per charge and reports how
   * many failed. It never zeroes the card optimistically - the reload after is
   * what moves the number, so a partial failure leaves the real remainder
   * showing (flagged F8).
   */
  const markCollected = async (method: ManualMethod) => {
    if (!data || marking) return;
    const ids = data.billing.pendingIds;
    if (ids.length === 0) return;
    setMarking(true);
    setMarkFailed(null);
    setPickerOpen(false);
    let failed = 0;
    try {
      const token = await getToken();
      if (!token) return;
      for (const id of ids) {
        try {
          const res = await fetch(`/api/teacher/private/transactions/${id}/mark-paid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ method }),
          });
          if (!res.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) setMarkFailed(failed);
    } finally {
      setMarking(false);
      await load();
    }
  };

  const sendReminder = async () => {
    if (!data || reminding || data.reminderBlock) return;
    setReminding(true);
    setReminderError(null);
    setReminderSent(false);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/teacher/private/students/${studentId}/send-reminder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => null)) as
        | { sent?: boolean; code?: string }
        | null;
      if (res.ok && body?.sent === true) {
        setReminderSent(true);
        await load();
        return;
      }
      setReminderError(body?.code ?? 'unknown');
    } catch {
      setReminderError('unknown');
    } finally {
      setReminding(false);
    }
  };

  const title = tList('studentTitle');

  if (loading && data === null) {
    return (
      <div>
        <TeacherAppBar title={title} backHref="/teacher/students" preferHistory />
        <div className="flex flex-col gap-3">
          <div className="mx-auto h-[72px] w-[72px] animate-pulse rounded-full bg-[var(--color-surface-2)]" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-surface-0)] bg-[var(--color-surface-1)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (loadError || data === null) {
    return (
      <div>
        <TeacherAppBar title={title} backHref="/teacher/students" preferHistory />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
          <button
            onClick={load}
            className="rounded-[var(--radius-md)] bg-[var(--color-teal)] px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-[var(--color-teal-deep)]"
          >
            {tPortal('retry')}
          </button>
        </div>
      </div>
    );
  }

  const { student, groups, billing, attendance, reminderBlock } = data;
  const ratePct = attendance.rate === null ? null : Math.round(attendance.rate * 100);
  const contacts = [
    { key: 'student', label: tList('studentContactLabel'), phone: student.phone, Icon: Phone },
    {
      key: 'parent',
      label: tList('parentContactLabel'),
      phone: student.parentPhone,
      Icon: UserRound,
    },
  ].filter((c) => Boolean(c.phone));

  const sectionLabel =
    'mx-1 mb-2 mt-4 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]';

  return (
    <div>
      <TeacherAppBar title={title} backHref="/teacher/students" preferHistory />

      {/* .phead */}
      <div className="flex flex-col items-center py-2 text-center">
        <span
          className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[var(--color-mint-deep)] bg-[var(--color-mint)] text-[30px] font-extrabold text-[var(--color-accent-deep)]"
          aria-hidden
        >
          {initialsOf(student.name)}
        </span>
        <h2 className="mt-3 text-[22px] font-bold text-[var(--color-text-primary)]">
          {student.name ?? '-'}
        </h2>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {groups.map((g) => (
            <span
              key={g.id}
              className="rounded-[var(--radius-pill)] bg-[var(--color-mint)] px-3 py-1 text-[11px] font-semibold text-[var(--color-teal-deep)]"
            >
              {g.name ?? '-'}
            </span>
          ))}
        </div>
      </div>

      {/* Contact */}
      {contacts.length > 0 && (
        <>
          <h3 className={sectionLabel}>{tList('contactHeading')}</h3>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-surface-0)] bg-[var(--color-surface-1)] px-4 py-2">
            {contacts.map((c, i) => {
              const digits = intlDigits(c.phone ?? null);
              const RowIcon = c.Icon;
              return (
                <div
                  key={c.key}
                  className={[
                    'py-4',
                    i > 0 ? 'border-t border-[var(--color-hairline)]' : '',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
                      aria-hidden
                    >
                      <RowIcon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--color-text-disabled)]">
                        {c.label}
                      </p>
                      <p
                        className="mt-1 font-mono text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]"
                        dir="ltr"
                      >
                        {formatPhoneIntlGrouped(c.phone)}
                      </p>
                    </div>
                  </div>
                  {digits && (
                    <div className="mt-2 flex gap-2">
                      <a
                        href={`tel:+${digits}`}
                        aria-label={tList('callAction')}
                        className="flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-mint)] py-3 text-[13px] font-bold text-[var(--color-teal-deep)] transition-opacity hover:opacity-90"
                      >
                        <Phone size={16} aria-hidden />
                        {tList('callShort')}
                      </a>
                      <a
                        href={`https://wa.me/${digits}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={tList('messageAction')}
                        className="flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-mint)] py-3 text-[13px] font-bold text-[var(--color-teal)] transition-opacity hover:opacity-90"
                      >
                        <MessageCircle size={16} aria-hidden />
                        {tList('messageShort')}
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Balance */}
      <h3 className={sectionLabel}>{tList('balanceHeading')}</h3>
      {billing.pendingCount === 0 ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-mint-deep)] bg-[var(--color-mint)] p-4 text-[13px] font-semibold text-[var(--color-teal)]">
          <CheckCircle2 size={18} aria-hidden />
          {tList('settled')}
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-surface-4)] bg-[var(--color-sand)] px-6 pb-4 pt-6">
          <p className="text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-brass)]">
            {tList('outstandingLabel')}
          </p>
          <p className="num my-1 text-[30px] font-extrabold text-[var(--color-brass)]">
            {formatCurrency(billing.outstanding, locale)}
          </p>
          <p className="text-[11px] text-[var(--color-brass)]">
            {tList(
              billing.pendingCount === 1 ? 'pendingClassesCountOne' : 'pendingClassesCount',
              { count: formatNumber(billing.pendingCount, locale) },
            )}
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={marking}
              aria-expanded={pickerOpen}
              className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-teal)] py-3 text-[13px] font-bold text-white transition-colors hover:bg-[var(--color-teal-deep)] disabled:opacity-50"
            >
              {marking && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {tList('markCollected')}
            </button>
            <button
              type="button"
              onClick={sendReminder}
              disabled={Boolean(reminderBlock) || reminding}
              className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-surface-4)] bg-[var(--color-surface-1)] py-3 text-[13px] font-semibold text-[var(--color-brass)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {reminding && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {tList('sendReminder')}
            </button>
          </div>

          {/* Fail visibly: with the WhatsApp template still pending approval and
              the manual switch off, the button is disabled and says why. It can
              never show a "Sent" state that nothing produced. */}
          {reminderBlock && (
            <p className="mt-2 text-[11px] text-[var(--color-brass)]">
              {tList(REMINDER_BLOCK_KEY[reminderBlock] ?? 'reminderUnavailable')}
            </p>
          )}
          {reminderError && (
            <p role="alert" className="mt-2 text-[11px] text-[var(--color-danger)]">
              {tList(REMINDER_BLOCK_KEY[reminderError] ?? 'reminderUnavailable')}
            </p>
          )}
          {reminderSent && (
            <p className="mt-2 text-[11px] text-[var(--color-teal)]">{tList('reminderSent')}</p>
          )}
          {markFailed !== null && (
            <p role="alert" className="mt-2 text-[11px] text-[var(--color-danger)]">
              {markFailed === billing.pendingCount
                ? tList('markCollectedError')
                : tList('markCollectedPartial', {
                    failed: formatNumber(markFailed, locale),
                    total: formatNumber(billing.pendingCount, locale),
                  })}
            </p>
          )}

          {pickerOpen && (
            <div className="mt-3 border-t border-[var(--color-brass)]/25 pt-3">
              <p className="mb-2 text-[11px] text-[var(--color-brass)]">
                {tPortal('markPaid.hint')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {MANUAL_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => markCollected(m)}
                    disabled={marking}
                    className="rounded-[var(--radius-md)] border border-[var(--color-surface-4)] bg-[var(--color-surface-1)] py-2 text-[13px] font-semibold text-[var(--color-brass)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {tPortal(METHOD_LABEL_KEY[m])}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attendance - always drawn. With no finished class there is nothing to
          measure, so it shows an em-dash rather than a 0% nothing produced. */}
      <h3 className={sectionLabel}>{tList('attendanceLabel')}</h3>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-surface-0)] bg-[var(--color-surface-1)] p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="num text-[22px] font-extrabold text-[var(--color-teal-deep)]">
            {ratePct === null ? '—' : formatPercent(ratePct, locale)}
          </span>
          <span className="text-xs font-semibold text-[var(--color-text-muted)]">
            {attendance.finishedSessions === 0
              ? tList('noFinishedClasses')
              : tList('attendanceFraction', {
                  present: formatNumber(attendance.present, locale),
                  total: formatNumber(attendance.finishedSessions, locale),
                })}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--color-surface-2)]">
          <div
            className="h-full rounded-[var(--radius-xs)] bg-[var(--color-teal)]"
            style={{ width: `${ratePct ?? 0}%` }}
          />
        </div>
      </div>

      {/* Recent classes */}
      {billing.transactions.length > 0 && (
        <>
          <h3 className={sectionLabel}>{tList('recentClasses')}</h3>
          <ul className="flex flex-col gap-2">
            {billing.transactions.map((txn) => {
              const methodLabelKey = txn.method ? METHOD_LABEL_KEY[txn.method] : undefined;
              const methodLabel = methodLabelKey ? tPortal(methodLabelKey) : null;
              const paid = txn.status === 'paid';
              return (
                <li
                  key={txn.id}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-surface-0)] bg-[var(--color-surface-1)] p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                      {formatDate(txn.date, locale, { day: 'numeric', month: 'short' })}
                      {txn.groupName ? ` · ${txn.groupName}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      {paid
                        ? methodLabel
                          ? tList('paidVia', { method: methodLabel })
                          : t('statusPaid')
                        : tList('notCollectedYet')}
                    </p>
                  </div>
                  <span className="num me-2 shrink-0 text-[13px] font-bold text-[var(--color-text-primary)]">
                    {formatNumber(txn.amount, locale)}
                  </span>
                  <span
                    className={[
                      'shrink-0 rounded-[var(--radius-pill)] px-3 py-1 text-[11px] font-bold',
                      paid
                        ? 'bg-[var(--color-mint)] text-[var(--color-teal)]'
                        : 'bg-[var(--color-sand)] text-[var(--color-brass)]',
                    ].join(' ')}
                  >
                    {paid ? t('statusPaid') : tList('statusOutstanding')}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
