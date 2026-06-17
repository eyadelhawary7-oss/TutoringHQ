'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, CalendarDays, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatTime } from '@/lib/formatNumber';
import { CAIRO_WEEK_ORDER, DAY_KEYS, type DayOfWeek } from '@/lib/groupSlots';

type BookedSlot = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string | null;
};
type Pending = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  note: string | null;
  status: string;
};
type GroupRow = {
  group_id: string;
  name: string | null;
  subject: string | null;
  center_id: string | null;
  center_name: string | null;
  center_cut_egp: number;
  booked_slots: BookedSlot[];
  pending: Pending | null;
  last_response: { status: string; responded_at: string | null } | null;
};

type CenterScheduleSlot = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_name: string | null;
};

const ERROR_KEY: Record<string, string> = {
  SLOT_CONFLICT: 'errorConflict',
  ALREADY_PENDING: 'errorState',
  INVALID_STATE: 'errorState',
  INVALID_INPUT: 'errorGeneric',
  NOT_FOUND: 'errorGeneric',
};

/**
 * Read-only weekly view (Ref 1) of a center's EXISTING schedule, so the teacher
 * can see what is already booked before proposing a time. Groups slots by the
 * Cairo week order (Sat -> Fri). Self-fetches from /api/teacher/center-schedule
 * (server-gated to centers the teacher relates to). Not an availability system -
 * it just shows the existing bookings (day/time + room).
 */
function CenterScheduleView({ centerId, onClose }: { centerId: string; onClose: () => void }) {
  const t = useTranslations('slotPicking');
  const locale = useLocale();
  const [slots, setSlots] = useState<CenterScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(
          `/api/teacher/center-schedule?center_id=${encodeURIComponent(centerId)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { slots: CenterScheduleSlot[] };
        if (!cancelled) setSlots(json.slots ?? []);
      } catch {
        /* non-fatal: renders empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centerId]);

  const dayLabel = (n: number) =>
    t(`days.${DAY_KEYS[(n as DayOfWeek)] ?? 'sat'}` as Parameters<typeof t>[0]);
  const byDay = (d: DayOfWeek) =>
    slots
      .filter((s) => s.day_of_week === d)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{t('scheduleTitle')}</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:underline"
        >
          <X size={12} aria-hidden /> {t('scheduleClose')}
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <Loader2 size={14} className="animate-spin" /> {t('scheduleLoading')}
        </div>
      ) : slots.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">{t('scheduleEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {CAIRO_WEEK_ORDER.map((d) => {
            const daySlots = byDay(d);
            return (
              <li key={d}>
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">{dayLabel(d)}</p>
                {daySlots.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)]">{t('scheduleDayEmpty')}</p>
                ) : (
                  <ul className="mt-0.5 space-y-0.5 ps-3">
                    {daySlots.map((s) => (
                      <li key={s.id} className="text-xs text-[var(--color-text-secondary)]">
                        <span dir="ltr">
                          {formatTime(s.start_time, locale)} - {formatTime(s.end_time, locale)}
                        </span>
                        {s.room_name ? ` · ${s.room_name}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GroupSlotCard({ group, onChanged }: { group: GroupRow; onChanged: () => void }) {
  const t = useTranslations('slotPicking');
  const locale = useLocale();
  const [day, setDay] = useState<DayOfWeek>(6);
  const [start, setStart] = useState('16:00');
  const [end, setEnd] = useState('17:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  const dayLabel = (n: number) => t(`days.${DAY_KEYS[(n as DayOfWeek)] ?? 'sat'}` as Parameters<typeof t>[0]);

  const submit = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/teacher/group-slots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({
          group_id: group.group_id,
          day_of_week: day,
          start_time: start,
          end_time: end,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { code?: string };
        setErrorKey(ERROR_KEY[j.code ?? ''] ?? 'errorGeneric');
        return;
      }
      setNote('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[var(--color-text-primary)]">
            {group.name ?? group.subject ?? '-'}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {group.center_name ?? '-'} · {t('cut')}: {formatCurrency(group.center_cut_egp, locale)}
          </p>
        </div>
        {group.center_id && (
          <button
            type="button"
            onClick={() => setShowSchedule((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-teal-deep)] hover:bg-[var(--color-teal-soft)]"
          >
            <CalendarDays size={14} aria-hidden /> {t('viewSchedule')}
          </button>
        )}
      </div>

      {showSchedule && group.center_id && (
        <CenterScheduleView centerId={group.center_id} onClose={() => setShowSchedule(false)} />
      )}

      {/* Booked (confirmed) times */}
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">{t('bookedTitle')}</p>
        {group.booked_slots.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">{t('noBooked')}</p>
        ) : (
          <ul className="space-y-1">
            {group.booked_slots.map((s) => (
              <li key={s.id} className="text-sm text-[var(--color-text-primary)]">
                {dayLabel(s.day_of_week)} · {formatTime(s.start_time, locale)} - {formatTime(s.end_time, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {group.pending ? (
        <div className="rounded-lg bg-[var(--color-teal-soft)] px-3 py-2">
          <span className="inline-flex rounded-full bg-[var(--color-surface-1)] px-2 py-0.5 text-xs font-semibold text-[var(--color-teal-deep)]">
            {t('awaiting')}
          </span>
          <p className="mt-1 text-sm text-[var(--color-text-primary)]">
            {dayLabel(group.pending.day_of_week)} · {formatTime(group.pending.start_time, locale)} -{' '}
            {formatTime(group.pending.end_time, locale)}
          </p>
        </div>
      ) : (
        <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{t('proposeTitle')}</p>
          {group.last_response?.status === 'declined' && (
            <p className="text-xs text-amber-700">{t('declinedHint')}</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-text-secondary)]">{t('day')}</span>
              <select
                value={day}
                onChange={(e) => setDay(Number(e.target.value) as DayOfWeek)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              >
                {CAIRO_WEEK_ORDER.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-text-secondary)]">{t('start')}</span>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-text-secondary)]">{t('end')}</span>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              />
            </label>
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          />
          {errorKey && <p className="text-xs text-[var(--color-danger)]">{t(errorKey as Parameters<typeof t>[0])}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t('submit')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Teacher slot-picking section (Phase 3): for each center-attached group (cut
 * already agreed), the teacher proposes a weekly time; the center confirms it.
 * Read/propose only — booking happens center-side. Self-fetches. A read-only
 * "view center schedule" panel (Ref 1) lets the teacher see existing bookings
 * before proposing; a clashing proposal is rejected with a clean message.
 */
export default function GroupSlotsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTranslations('slotPicking');
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/teacher/group-slots', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { groups: GroupRow[] };
      setGroups(json.groups ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={18} className="text-[var(--color-teal-deep)]" />
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> ...
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
          {t('noCenterGroups')}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <GroupSlotCard key={g.group_id} group={g} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
}
