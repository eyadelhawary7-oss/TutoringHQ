'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, ChevronDown, Loader2, Lock, Plus, Smartphone, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import { formatTime, formatTimeRange } from '@/lib/timeFormat';
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
  state: 'future' | 'unrecorded' | 'live' | 'recorded';
  sessionId: string | null;
  /** For a live session: the student ids already scanned present. */
  initialAttendees?: string[];
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

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
// Debounce window before an attendance edit is synced to the live session.
const SAVE_DEBOUNCE_MS = 800;

async function authHeader(): Promise<Record<string, string> | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Unified slot bottom sheet. One sheet for everything a teacher can do with a
 * single schedule-slot occurrence, branching on phase:
 *   future     -> read-only group info + cancel / reschedule
 *   unrecorded -> PHASE 1: "start class" + read-only roster + cancel/reschedule
 *   live       -> PHASE 2: live attendance (auto-saved), payment, end + bill
 *   recorded   -> PHASE 3: read-only session summary + link into the group
 * The live phase is persistent: closing and reopening the slot lands straight
 * back in PHASE 2 with the recorded attendance pre-ticked.
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

  // Phase + live-session identity. Phase starts from the occurrence state and
  // advances in place as the teacher starts / finishes the class.
  const [phase, setPhase] = useState<SlotOccurrence['state']>('future');
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Roster (future / unrecorded / live)
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Guests
  const [liveGuests, setLiveGuests] = useState<GuestDraft[]>([]); // pending, not yet created
  const [guestNamesById, setGuestNamesById] = useState<Map<string, string>>(new Map());
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);

  // Payment method (live). Cash collects on the spot; digital is the future
  // Paymob payment-link flow (records as cash for now). The server resolves it.
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'digital'>('cash');

  // Start (PHASE 1 -> PHASE 2)
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Live auto-save
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // True only after a real teacher edit, so the prefill / created-guest sync
  // never triggers a redundant save round-trip.
  const userEditedRef = useRef(false);
  // The slot's server state changed (start / save / finish / cancel) so the
  // schedule must refetch when the sheet closes.
  const changedRef = useRef(false);

  // Finish (PHASE 2 -> PHASE 3)
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [confirmCancelLive, setConfirmCancelLive] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);

  // Cancel / reschedule accordions (PHASE 1 + future)
  const [openSection, setOpenSection] = useState<'cancel' | 'reschedule' | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [rescheduleNote, setRescheduleNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Recorded detail (PHASE 3)
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  const groupId = occurrence?.groupId ?? '';
  const initialState = occurrence?.state ?? 'future';

  // Reset all transient state every time the sheet opens for a new occurrence.
  useEffect(() => {
    if (!open) return;
    setPhase(initialState);
    setSessionId(occurrence?.sessionId ?? null);
    setSelected(
      new Set(initialState === 'live' ? (occurrence?.initialAttendees ?? []) : []),
    );
    setLiveGuests([]);
    setGuestNamesById(new Map());
    setShowGuestForm(false);
    setGuestName('');
    setGuestPhone('');
    setGuestError(null);
    setPaymentMethod('cash');
    setStarting(false);
    setStartError(null);
    setSaveState('idle');
    userEditedRef.current = false;
    changedRef.current = false;
    setFinishing(false);
    setFinishError(null);
    setConfirmCancelLive(false);
    setCancelPending(false);
    setOpenSection(null);
    setActionError(null);
    setNewDate('');
    setNewTime(occurrence?.effectiveTime ?? '');
    setRescheduleNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, occurrence?.scheduleId, occurrence?.date, occurrence?.effectiveTime, initialState, occurrence?.sessionId]);

  // Load the active roster for the states that show one.
  useEffect(() => {
    if (!open || !groupId) return;
    if (initialState !== 'future' && initialState !== 'unrecorded' && initialState !== 'live') {
      return;
    }
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
  }, [open, groupId, initialState]);

  // Load the recorded-session detail (PHASE 3).
  useEffect(() => {
    if (!open || phase !== 'recorded' || !sessionId) return;
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
  }, [open, phase, sessionId]);

  // Debounced auto-save of live attendance. Fires only after a real edit.
  useEffect(() => {
    if (phase !== 'live' || !sessionId || !userEditedRef.current) return;
    const handle = setTimeout(() => {
      void saveLiveAttendance();
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, liveGuests, phase, sessionId]);

  if (!open || !occurrence) return null;

  const handleClose = () => {
    if (changedRef.current) onChanged();
    else onClose();
  };

  // ---- Live attendance ----

  const toggleLive = (id: string) => {
    userEditedRef.current = true;
    setSaveState('idle');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllLive = () => {
    userEditedRef.current = true;
    setSaveState('idle');
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of roster) next.add(s.id);
      return next;
    });
  };

  const removeCreatedGuest = (id: string) => {
    userEditedRef.current = true;
    setSaveState('idle');
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setGuestNamesById((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const saveLiveAttendance = async () => {
    if (!sessionId) return;
    setSaveState('saving');
    try {
      const headers = await authHeader();
      if (!headers) {
        setSaveState('error');
        return;
      }
      const res = await fetch(
        `/api/teacher/private/schedule/sessions/${sessionId}/attendance`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attendee_ids: Array.from(selected),
            guests: liveGuests.map((g) => ({ name: g.name, phone: g.phone })),
          }),
        },
      );
      if (!res.ok) {
        setSaveState('error');
        return;
      }
      changedRef.current = true;
      const data = (await res.json().catch(() => ({}))) as {
        created_guests?: { name: string; phone: string; student_id: string }[];
      };
      const created = data.created_guests ?? [];
      if (created.length > 0) {
        // Fold created guests into local state without re-triggering a save.
        userEditedRef.current = false;
        setGuestNamesById((prev) => {
          const next = new Map(prev);
          for (const g of created) next.set(g.student_id, g.name);
          return next;
        });
        setSelected((prev) => {
          const next = new Set(prev);
          for (const g of created) next.add(g.student_id);
          return next;
        });
        setLiveGuests([]);
      } else {
        userEditedRef.current = false;
      }
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  // ---- Start / finish / cancel ----

  const startClass = async () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const headers = await authHeader();
      if (!headers) {
        setStartError(t('genericError'));
        return;
      }
      const res = await fetch('/api/teacher/private/schedule/sessions/start', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: occurrence.groupId,
          schedule_id: occurrence.scheduleId,
          session_date: occurrence.date,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session_id?: string;
        attendees?: string[];
        error?: string;
      };
      if (res.ok && data.session_id) {
        changedRef.current = true;
        setSessionId(data.session_id);
        setSelected(new Set(data.attendees ?? []));
        userEditedRef.current = false;
        setSaveState('idle');
        setPhase('live');
        toast.success(t('classStarted'));
        return;
      }
      if (res.status === 409 && data.error === 'SESSION_ALREADY_FINISHED') {
        setStartError(t('genericError'));
        changedRef.current = true;
        return;
      }
      if (res.status === 409 && data.error === 'CLASS_CANCELLED') {
        setStartError(t('classCancelledError'));
        return;
      }
      setStartError(t('genericError'));
    } catch {
      setStartError(t('genericError'));
    } finally {
      setStarting(false);
    }
  };

  const finishClass = async () => {
    if (!sessionId || finishing || totalPresent === 0) return;
    setFinishing(true);
    setFinishError(null);
    try {
      const headers = await authHeader();
      if (!headers) {
        setFinishError(t('genericError'));
        return;
      }
      const res = await fetch(
        `/api/teacher/private/schedule/sessions/${sessionId}/finish`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_method: paymentMethod }),
        },
      );
      if (res.status === 207) {
        changedRef.current = true;
        toast.warning(t('billingErrorWarning'));
        setPhase('recorded');
        return;
      }
      if (res.ok) {
        changedRef.current = true;
        toast.success(t('sessionFinishedSuccess'));
        setPhase('recorded');
        return;
      }
      setFinishError(t('genericError'));
    } catch {
      setFinishError(t('genericError'));
    } finally {
      setFinishing(false);
    }
  };

  const cancelLiveSession = async () => {
    if (!sessionId || cancelPending) return;
    setCancelPending(true);
    try {
      const headers = await authHeader();
      if (!headers) {
        setFinishError(t('genericError'));
        return;
      }
      const res = await fetch(
        `/api/teacher/private/schedule/sessions/${sessionId}/cancel`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (res.ok) {
        toast.success(t('cancelledToast'));
        onChanged();
        return;
      }
      setFinishError(t('genericError'));
    } catch {
      setFinishError(t('genericError'));
    } finally {
      setCancelPending(false);
      setConfirmCancelLive(false);
    }
  };

  // ---- Guests ----

  const createdGuestIds = Array.from(selected).filter((id) => guestNamesById.has(id));
  const totalGuests = createdGuestIds.length + liveGuests.length;
  const enrolledPresent = Array.from(selected).filter((id) => !guestNamesById.has(id)).length;
  const totalPresent = enrolledPresent + createdGuestIds.length + liveGuests.length;

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
    if (totalGuests >= GUEST_LIMIT) {
      setGuestError(t('guestLimitReached'));
      return;
    }
    userEditedRef.current = true;
    setSaveState('idle');
    setLiveGuests((prev) => [...prev, { name, phone: guestPhone.trim() }]);
    setGuestName('');
    setGuestPhone('');
    setGuestError(null);
    setShowGuestForm(false);
  };

  const removePendingGuest = (idx: number) => {
    setLiveGuests((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---- Cancel + reschedule exceptions (PHASE 1 + future) ----

  const postException = async (body: Record<string, unknown>, successMsg: string) => {
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

  // ---- Guest section (Pro gate), shared by the live phase ----
  const guestSection = !isPro ? (
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
          current: formatNumber(totalGuests, locale, { integerOnly: true }),
        })}
      </p>
      {totalGuests >= GUEST_LIMIT ? (
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
            disabled={totalGuests >= GUEST_LIMIT}
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
  );

  const footer =
    phase === 'live' ? (
      <button
        type="button"
        onClick={finishClass}
        disabled={totalPresent === 0 || finishing}
        className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: 'var(--color-brass)' }}
      >
        {finishing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {t('endAndBill', {
          count: formatNumber(totalPresent, locale, { integerOnly: true }),
        })}
      </button>
    ) : undefined;

  return (
    <SheetShell
      open={open}
      title={occurrence.groupName ?? ''}
      subtitle={subtitle}
      closeLabel={t('close')}
      onClose={handleClose}
      footer={footer}
    >
      {/* FUTURE */}
      {phase === 'future' && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-[var(--color-text-muted)]">{t('classNotStartedDate')}</p>
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

      {/* PHASE 1: NOT STARTED */}
      {phase === 'unrecorded' && (
        <div className="flex flex-col gap-5">
          <button
            type="button"
            onClick={startClass}
            disabled={starting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-3 text-base font-semibold text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
            {t('startClass')}
          </button>
          {startError && (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {startError}
            </p>
          )}
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

      {/* PHASE 2: LIVE */}
      {phase === 'live' && (
        <div className="flex flex-col gap-5">
          {/* Live indicator header */}
          <div className="flex items-center justify-between rounded-lg border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-teal-deep)]">
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-teal)]"
                aria-hidden
              />
              {t('classLive')}
            </span>
            <span className="text-sm text-[var(--color-teal-deep)]" dir="ltr">
              {formatTime(occurrence.effectiveTime, timeLabels)}
            </span>
          </div>

          {/* Attendance */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">
                {t('attendanceTitle')}
              </h3>
              {roster.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllLive}
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
                        onChange={() => toggleLive(s.id)}
                        className="h-5 w-5 rounded border-[var(--color-border)] accent-teal-600"
                      />
                    </label>
                  </li>
                ))}
                {createdGuestIds.map((id) => (
                  <li
                    key={`guest-${id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-surface-0)] px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-[var(--color-text-primary)]">
                        {guestNamesById.get(id)}
                      </span>
                      {guestBadge}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCreatedGuest(id)}
                      aria-label={t('removeGuest')}
                      className="rounded-lg p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
                {liveGuests.map((g, idx) => (
                  <li
                    key={`pending-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-surface-0)] px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-[var(--color-text-primary)]">{g.name}</span>
                      {guestBadge}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePendingGuest(idx)}
                      aria-label={t('removeGuest')}
                      className="rounded-lg p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!rosterLoading && !rosterError && (
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--color-text-secondary)]" role="status">
                  {t('presentCount', {
                    count: formatNumber(totalPresent, locale, { integerOnly: true }),
                  })}
                </p>
                {saveState === 'saving' ? (
                  <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {t('saving')}
                  </span>
                ) : saveState === 'saved' ? (
                  <span className="text-xs text-[var(--color-teal-deep)]">{t('saved')}</span>
                ) : saveState === 'error' ? (
                  <span className="text-xs text-[var(--color-danger)]" role="alert">
                    {t('genericError')}
                  </span>
                ) : null}
              </div>
            )}

            {guestSection}
          </section>

          {/* Payment method */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
              {t('paymentMethodTitle')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                aria-pressed={paymentMethod === 'cash'}
                className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  paymentMethod === 'cash'
                    ? 'border-[var(--color-teal)] bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-0)] text-[var(--color-text-secondary)]'
                }`}
              >
                <Banknote size={18} aria-hidden />
                {t('paymentCash')}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('digital')}
                aria-pressed={paymentMethod === 'digital'}
                className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  paymentMethod === 'digital'
                    ? 'border-[var(--color-brass)] bg-[var(--color-brass)]/15 text-[var(--color-brass)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-0)] text-[var(--color-text-secondary)]'
                }`}
              >
                <Smartphone size={18} aria-hidden />
                {t('paymentDigital')}
              </button>
            </div>
            {paymentMethod === 'digital' && (
              <p
                className="mt-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
                role="note"
              >
                {t('paymentDigitalDisabled')}
              </p>
            )}
          </section>

          {finishError && (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {finishError}
            </p>
          )}

          {/* Cancel (muted, rare mid-session action) */}
          {confirmCancelLive ? (
            <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-surface-0)] p-3">
              <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                {t('cancelLiveSessionWarning')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelLiveSession}
                  disabled={cancelPending}
                  className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {cancelPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {t('confirmCancelAction')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancelLive(false)}
                  className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  {t('confirmCancelBack')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancelLive(true)}
              className="self-start text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)]"
            >
              {t('cancelLiveSession')}
            </button>
          )}
        </div>
      )}

      {/* PHASE 3: RECORDED */}
      {phase === 'recorded' && (
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
