'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Loader2, Lock, Plus, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import { formatTimeRange } from '@/lib/timeFormat';
import { useToast } from '@/hooks/useToast';
import SheetShell from './SheetShell';

export type SlotOccurrence = {
  groupId: string;
  groupName: string | null;
  scheduleId: string;
  date: string; // YYYY-MM-DD (Cairo)
  feePerClass: number;
  enrolledCount: number;
  effectiveTime: string; // HH:MM
  durationMinutes: number;
  state: 'future' | 'unrecorded' | 'recorded';
  sessionId: string | null;
};

type RosterStudent = { id: string; name: string | null };
type GuestDraft = { name: string; phone: string };

type SessionDetail = {
  attendance: {
    student_id: string;
    student_name: string | null;
    billable: boolean;
    is_guest: boolean;
  }[];
  transactions: {
    id: string;
    student_id: string;
    student_name: string | null;
    amount_billed: number;
    status: string;
    is_guest: boolean;
  }[];
};

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]',
  pending: 'bg-[var(--color-brass)]/15 text-[var(--color-brass)]',
};
const FALLBACK_BADGE = 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]';
const KNOWN_STATUSES = new Set(['paid', 'pending', 'failed', 'cancelled']);

// Egyptian mobile entered by the teacher: 11 digits starting with 01.
const GUEST_PHONE_RE = /^01\d{9}$/;
// Pro guest attendees are capped per session (server enforces the same limit).
const GUEST_LIMIT = 10;

async function authHeader(): Promise<Record<string, string> | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Unified slot bottom sheet. One sheet for everything a teacher can do with a
 * single schedule-slot occurrence, branching on slot state:
 *   future     -> read-only group info + cancel / reschedule
 *   unrecorded -> record attendance (enrolled + one-time guests) + cancel /
 *                 reschedule
 *   recorded   -> read-only session summary + link into the group
 * Replaces the separate RecordAttendanceSheet / CancelClassDialog /
 * RescheduleDialog / SessionDetailSheet.
 */
export default function SlotActionSheet({
  open,
  occurrence,
  planKey,
  onClose,
  onChanged,
}: {
  open: boolean;
  occurrence: SlotOccurrence | null;
  /** Teacher's plan; gates the guest-attendee section. Defaults to Standard. */
  planKey: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('teacherPortal.schedule');
  const tf = useTranslations('timeFormat');
  const locale = useLocale();
  const toast = useToast();
  const timeLabels = { am: tf('am'), pm: tf('pm') };
  const isPro = planKey === 'teacher_699';

  // Roster (future + unrecorded)
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Guests (unrecorded)
  const [guests, setGuests] = useState<GuestDraft[]>([]);
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);

  // Submit (record)
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Cancel / reschedule accordions
  const [openSection, setOpenSection] = useState<'cancel' | 'reschedule' | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [rescheduleNote, setRescheduleNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Recorded detail
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  const groupId = occurrence?.groupId ?? '';
  const sessionId = occurrence?.sessionId ?? null;
  const state = occurrence?.state ?? 'future';

  // Reset transient state every time the sheet opens for a new occurrence.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setGuests([]);
    setShowGuestForm(false);
    setGuestName('');
    setGuestPhone('');
    setGuestError(null);
    setSubmitError(null);
    setOpenSection(null);
    setActionError(null);
    setNewDate('');
    setNewTime(occurrence?.effectiveTime ?? '');
    setRescheduleNote('');
  }, [open, occurrence?.scheduleId, occurrence?.date, occurrence?.effectiveTime]);

  // Load the active roster for future / unrecorded states.
  useEffect(() => {
    if (!open || !groupId || (state !== 'future' && state !== 'unrecorded')) return;
    let stale = false;
    setRosterLoading(true);
    setRosterError(false);
    (async () => {
      try {
        const headers = await authHeader();
        if (!headers) {
          setRosterError(true);
          return;
        }
        const res = await fetch(`/api/teacher/private/groups/${groupId}/roster`, { headers });
        if (!res.ok) {
          setRosterError(true);
          return;
        }
        const data = (await res.json()) as {
          roster?: { status: string; student: { id: string; name: string | null } }[];
        };
        if (stale) return;
        setRoster(
          (data.roster ?? [])
            .filter((r) => r.status === 'active')
            .map((r) => ({ id: r.student.id, name: r.student.name })),
        );
      } catch {
        if (!stale) setRosterError(true);
      } finally {
        if (!stale) setRosterLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, groupId, state]);

  // Load the recorded-session detail.
  useEffect(() => {
    if (!open || state !== 'recorded' || !sessionId) return;
    let stale = false;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(false);
    (async () => {
      try {
        const headers = await authHeader();
        if (!headers) {
          setDetailError(true);
          return;
        }
        const res = await fetch(`/api/teacher/private/schedule/sessions/${sessionId}`, { headers });
        if (!res.ok) {
          setDetailError(true);
          return;
        }
        if (!stale) setDetail((await res.json()) as SessionDetail);
      } catch {
        if (!stale) setDetailError(true);
      } finally {
        if (!stale) setDetailLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, state, sessionId]);

  if (!open || !occurrence) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addGuest = () => {
    const name = guestName.trim();
    if (name.length < 1) {
      setGuestError(t('guestNameRequired'));
      return;
    }
    if (!GUEST_PHONE_RE.test(guestPhone.trim())) {
      setGuestError(t('guestPhoneInvalid'));
      return;
    }
    if (guests.length >= GUEST_LIMIT) {
      setGuestError(t('guestLimitReached'));
      return;
    }
    setGuests((prev) => [...prev, { name, phone: guestPhone.trim() }]);
    setGuestName('');
    setGuestPhone('');
    setGuestError(null);
    setShowGuestForm(false);
  };

  const removeGuest = (idx: number) => {
    setGuests((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalAttendees = selected.size + guests.length;

  const submitRecord = async () => {
    if (totalAttendees === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const headers = await authHeader();
      if (!headers) {
        setSubmitError(t('genericError'));
        return;
      }
      const res = await fetch('/api/teacher/private/schedule/sessions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: occurrence.groupId,
          schedule_id: occurrence.scheduleId,
          session_date: occurrence.date,
          attendee_ids: Array.from(selected),
          guests,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 207) {
        toast.warning(t('billingErrorWarning'));
        onChanged();
        return;
      }
      if (res.ok) {
        toast.success(t('recordedToast'));
        onChanged();
        return;
      }
      if (res.status === 409 && data.error === 'CLASS_CANCELLED') {
        setSubmitError(t('classCancelledError'));
        return;
      }
      if (res.status === 403 && data.error === 'GUESTS_PRO_ONLY') {
        setSubmitError(t('guestProOnly'));
        return;
      }
      if (res.status === 400 && data.error === 'GUEST_LIMIT_EXCEEDED') {
        setSubmitError(t('guestLimitReached'));
        return;
      }
      setSubmitError(t('genericError'));
    } catch {
      setSubmitError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  const postException = async (
    body: Record<string, unknown>,
    successMsg: string,
  ) => {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const headers = await authHeader();
      if (!headers) {
        setActionError(t('genericError'));
        return;
      }
      const res = await fetch('/api/teacher/private/schedule/exceptions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: occurrence.groupId,
          schedule_id: occurrence.scheduleId,
          exception_date: occurrence.date,
          ...body,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        toast.success(successMsg);
        onChanged();
        return;
      }
      if (res.status === 409 && data.error === 'EXCEPTION_ALREADY_EXISTS') {
        setActionError(t('exceptionExistsError'));
        return;
      }
      setActionError(t('genericError'));
    } catch {
      setActionError(t('genericError'));
    } finally {
      setActionPending(false);
    }
  };

  const cancelClass = () => postException({ kind: 'cancelled' }, t('cancelledToast'));

  const reschedule = () => {
    if (!newDate) {
      setActionError(t('newDateRequired'));
      return;
    }
    postException(
      {
        kind: 'rescheduled',
        new_date: newDate,
        new_time_start: newTime || null,
        note: rescheduleNote.trim() || null,
      },
      t('rescheduledToast'),
    );
  };

  const subtitle = `${formatDate(occurrence.date, locale, 'long')} · ${formatTimeRange(
    occurrence.effectiveTime,
    occurrence.durationMinutes,
    timeLabels,
  )}`;

  const statusLabel = (status: string) =>
    KNOWN_STATUSES.has(status) ? t(`txnStatus.${status}`) : status;

  // Recorded-session rollups (safe before the detail loads - empty until then).
  const attended = (detail?.attendance ?? []).filter((a) => a.billable);
  const recordedTxns = detail?.transactions ?? [];
  const recTotalBilled = recordedTxns.reduce((acc, tx) => acc + tx.amount_billed, 0);
  const recTotalCollected = recordedTxns
    .filter((tx) => tx.status === 'paid')
    .reduce((acc, tx) => acc + tx.amount_billed, 0);
  const recOutstanding = recTotalBilled - recTotalCollected;

  const guestBadge = (
    <span className="rounded-full bg-[var(--color-brass)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-brass)]">
      {t('guestBadge')}
    </span>
  );

  // ---- Cancel + reschedule accordions (shared by future + unrecorded) ----
  const accordions = (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setOpenSection((s) => (s === 'cancel' ? null : 'cancel'))}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
        >
          {t('cancelClass')}
          <ChevronDown
            size={16}
            className={openSection === 'cancel' ? 'rotate-180 transition-transform' : 'transition-transform'}
            aria-hidden
          />
        </button>
        {openSection === 'cancel' && (
          <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
            <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{t('confirmCancelBody')}</p>
            <button
              type="button"
              onClick={cancelClass}
              disabled={actionPending}
              className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {actionPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t('confirmCancelAction')}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setOpenSection((s) => (s === 'reschedule' ? null : 'reschedule'))}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--color-text-primary)]"
        >
          {t('reschedule')}
          <ChevronDown
            size={16}
            className={openSection === 'reschedule' ? 'rotate-180 transition-transform' : 'transition-transform'}
            aria-hidden
          />
        </button>
        {openSection === 'reschedule' && (
          <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3">
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
              {t('newDate')}
              <input
                type="date"
                value={newDate}
                min={occurrence.date}
                onChange={(e) => setNewDate(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
              {t('newTime')}
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
              {t('note')}
              <input
                type="text"
                value={rescheduleNote}
                onChange={(e) => setRescheduleNote(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
              />
            </label>
            <button
              type="button"
              onClick={reschedule}
              disabled={actionPending}
              className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:opacity-50"
            >
              {actionPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t('rescheduleSubmit')}
            </button>
          </div>
        )}
      </div>

      {actionError && (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );

  // ---- Group info + enrolled list (future + unrecorded) ----
  const groupInfo = (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-[var(--color-text-secondary)]">{t('feeLabel')}</span>
        <span className="font-semibold text-[var(--color-text-primary)]">
          {formatCurrency(occurrence.feePerClass, locale)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[var(--color-text-secondary)]">{t('enrolledLabel')}</span>
        <span className="font-semibold text-[var(--color-text-primary)]">
          {t('enrolledCount', {
            count: formatNumber(occurrence.enrolledCount, locale, { integerOnly: true }),
          })}
        </span>
      </div>
    </div>
  );

  const footer =
    state === 'unrecorded' ? (
      <button
        type="button"
        onClick={submitRecord}
        disabled={totalAttendees === 0 || submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {t('submitRecordAttendees', {
          count: formatNumber(totalAttendees, locale, { integerOnly: true }),
        })}
      </button>
    ) : undefined;

  return (
    <SheetShell
      open={open}
      title={occurrence.groupName ?? ''}
      subtitle={subtitle}
      closeLabel={t('close')}
      onClose={onClose}
      footer={footer}
    >
      {/* FUTURE */}
      {state === 'future' && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-[var(--color-text-muted)]">{t('futureSlotLabel')}</p>
          {groupInfo}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
              {t('enrolledStudentsTitle')}
            </h3>
            {rosterLoading ? (
              <div className="h-10 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
            ) : rosterError ? (
              <p className="text-sm text-[var(--color-danger)]">{t('genericError')}</p>
            ) : roster.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">{t('emptyRoster')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {roster.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {s.name}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {accordions}
        </div>
      )}

      {/* UNRECORDED */}
      {state === 'unrecorded' && (
        <div className="flex flex-col gap-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">
                {t('recordAttendanceTitle')}
              </h3>
              {roster.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set(roster.map((s) => s.id)))}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  {t('selectAll')}
                </button>
              )}
            </div>

            {rosterLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
                ))}
              </div>
            ) : rosterError ? (
              <p className="text-sm text-[var(--color-danger)]">{t('genericError')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {roster.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-4 py-3">
                      <span className="font-medium text-[var(--color-text-primary)]">{s.name}</span>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggle(s.id)}
                        className="h-5 w-5 rounded border-[var(--color-border)] accent-teal-600"
                      />
                    </label>
                  </li>
                ))}
                {guests.map((g, idx) => (
                  <li
                    key={`guest-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-surface-0)] px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-[var(--color-text-primary)]">{g.name}</span>
                      {guestBadge}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeGuest(idx)}
                      aria-label={t('removeGuest')}
                      className="rounded-lg p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* One-time (guest) attendees - Pro only, capped at 10/session */}
            {!isPro ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <Lock size={14} className="text-[var(--color-brass)]" aria-hidden />
                  {t('guestProOnly')}
                </span>
                <Link
                  href="/teacher/subscription/upgrade"
                  className="text-sm font-medium text-[var(--color-brass)] hover:underline"
                >
                  {t('guestUpgradeCta')}
                </Link>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t('guestCount', {
                    current: formatNumber(guests.length, locale, { integerOnly: true }),
                  })}
                </p>
                {guests.length >= GUEST_LIMIT ? (
                  <p className="text-xs font-medium text-[var(--color-brass)]" role="status">
                    {t('guestLimitReached')}
                  </p>
                ) : showGuestForm ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] p-3">
                    <input
                      type="text"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder={t('guestName')}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                    />
                    <input
                      type="tel"
                      inputMode="numeric"
                      dir="ltr"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder={t('guestPhone')}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                    />
                    {guestError && (
                      <p className="text-xs text-[var(--color-danger)]" role="alert">
                        {guestError}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={addGuest}
                      disabled={guests.length >= GUEST_LIMIT}
                      className="self-start rounded-lg bg-[var(--color-brass)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('addGuest')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowGuestForm(true)}
                    className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-brass)]"
                  >
                    <Plus size={16} aria-hidden />
                    {t('addGuestAttendee')}
                  </button>
                )}
              </div>
            )}

            {submitError && (
              <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
                {submitError}
              </p>
            )}
          </section>

          {accordions}
        </div>
      )}

      {/* RECORDED */}
      {state === 'recorded' && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-[var(--color-text-muted)]">{t('recordedSlotLabel')}</p>
          {detailLoading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
              ))}
            </div>
          ) : detailError || !detail ? (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {t('genericError')}
            </p>
          ) : (
            <>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
                  {t('attendanceSection')}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {attended.map((a) => (
                    <li
                      key={a.student_id}
                      className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]"
                    >
                      {a.student_name}
                      {a.is_guest && guestBadge}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
                  {t('billedSection')}
                </h3>
                {recordedTxns.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">{t('noCharges')}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {recordedTxns.map((tx) => (
                      <li
                        key={tx.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                          {tx.student_name}
                          {tx.is_guest && guestBadge}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-sm text-[var(--color-text-secondary)]">
                            {formatCurrency(tx.amount_billed, locale)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              STATUS_BADGE[tx.status] ?? FALLBACK_BADGE
                            }`}
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
                      {formatCurrency(recTotalBilled, locale)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--color-text-secondary)]">{t('totalCollected')}</dt>
                    <dd className="font-semibold text-[var(--color-teal-deep)]">
                      {formatCurrency(recTotalCollected, locale)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--color-text-secondary)]">{t('outstanding')}</dt>
                    <dd className="font-semibold text-[var(--color-brass)]">
                      {formatCurrency(recOutstanding, locale)}
                    </dd>
                  </div>
                </dl>
              </section>
            </>
          )}
          <Link
            href={`/teacher/groups/${groupId}?tab=classes`}
            className="inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            {t('viewInGroup')}
          </Link>
        </div>
      )}
    </SheetShell>
  );
}
