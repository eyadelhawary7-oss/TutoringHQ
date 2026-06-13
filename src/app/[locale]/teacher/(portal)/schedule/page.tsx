'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, Clock, Users } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import {
  cairoDateKey,
  cairoYmdMinusDays,
  cairoYmdPlusDays,
  getCurrentCairoClock,
  parseCairoYmd,
} from '@/lib/cairo/day';
import {
  useTeacherSchedule,
  type ScheduleExceptionItem,
  type ScheduleSlotItem,
} from '@/hooks/useTeacherSchedule';
import { formatTimeRange } from '@/lib/timeFormat';
import { fetchTeacherSubscription } from '@/components/teacher/teacherSubscriptionClient';
import SlotActionSheet, {
  type SlotOccurrence,
} from '@/components/teacher/schedule/SlotActionSheet';

type View = 'today' | 'week';

type OccurrenceState = 'future' | 'unrecorded' | 'recorded' | 'cancelled' | 'readonly';

type Occurrence = {
  slot: ScheduleSlotItem;
  date: string; // YYYY-MM-DD (Cairo)
  exception: ScheduleExceptionItem | null;
  effectiveTime: string; // HH:MM after applying a reschedule
  state: OccurrenceState;
  sessionId: string | null;
};

/** 0=Sunday..6=Saturday for a Cairo calendar date (Gregorian). */
function dayOfWeekOf(ymd: string): number {
  const { y, m, d } = parseCairoYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export default function TeacherSchedulePage() {
  const t = useTranslations('teacherPortal.schedule');
  const tGroups = useTranslations('teacherPortal.groups');
  const tf = useTranslations('timeFormat');
  const locale = useLocale();
  const timeLabels = { am: tf('am'), pm: tf('pm') };
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams?.get('view') ?? null;

  const [view, setView] = useState<View>(viewParam === 'week' ? 'week' : 'today');
  // Same URL-sync pattern as the admin tabs: the param is the source of truth.
  useLayoutEffect(() => {
    setView(viewParam === 'week' ? 'week' : 'today');
  }, [viewParam]);
  const changeView = (v: View) => {
    setView(v);
    router.replace(`/teacher/schedule?view=${v}`, { scroll: false });
  };

  const { slots, exceptions, sessions, isLoading, error, refetch } = useTeacherSchedule();

  const [activeOccurrence, setActiveOccurrence] = useState<SlotOccurrence | null>(null);
  // Plan gates the guest-attendee section in the sheet. Fetched once here (not
  // per sheet open); defaults to Standard until it loads.
  const [planKey, setPlanKey] = useState('teacher_299');
  useEffect(() => {
    let on = true;
    fetchTeacherSubscription().then((s) => {
      if (on && s) setPlanKey(s.plan_key);
    });
    return () => {
      on = false;
    };
  }, []);

  const todayKey = cairoDateKey();
  const todayDow = dayOfWeekOf(todayKey);
  const { hour, minute } = getCurrentCairoClock();
  const nowHHMM = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const sessionByGroupDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      map.set(`${s.group_id}|${s.scheduled_date}`, s.id);
    }
    return map;
  }, [sessions]);

  const exceptionBySlotDate = useMemo(() => {
    const map = new Map<string, ScheduleExceptionItem>();
    for (const e of exceptions) {
      map.set(`${e.schedule_id}|${e.exception_date}`, e);
    }
    return map;
  }, [exceptions]);

  const occurrenceFor = (slot: ScheduleSlotItem, date: string): Occurrence => {
    const exception = exceptionBySlotDate.get(`${slot.schedule_id}|${date}`) ?? null;
    const effectiveTime =
      exception?.kind === 'rescheduled' && exception.new_time_start
        ? exception.new_time_start
        : slot.time_start;
    const sessionId = sessionByGroupDate.get(`${slot.group_id}|${date}`) ?? null;

    let state: OccurrenceState;
    if (sessionId) {
      state = 'recorded';
    } else if (exception?.kind === 'cancelled') {
      state = 'cancelled';
    } else if (date > todayKey) {
      state = 'readonly';
    } else if (date === todayKey && effectiveTime > nowHHMM) {
      state = 'future';
    } else {
      state = 'unrecorded';
    }
    return { slot, date, exception, effectiveTime, state, sessionId };
  };

  const todayOccurrences = useMemo(() => {
    return slots
      .filter((s) => s.day_of_week === todayDow)
      .map((s) => occurrenceFor(s, todayKey))
      .sort((a, b) => a.effectiveTime.localeCompare(b.effectiveTime));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, exceptions, sessions, todayKey, todayDow, nowHHMM]);

  const weekDates = useMemo(() => {
    const sunday = cairoYmdMinusDays(todayKey, todayDow);
    return Array.from({ length: 7 }, (_, i) => cairoYmdPlusDays(sunday, i));
  }, [todayKey, todayDow]);

  const onActionDone = () => {
    setActiveOccurrence(null);
    refetch();
  };

  // Map the page's Occurrence to the sheet's contract. Future-dated
  // ('readonly') occurrences open in 'future' mode (cancel/reschedule, no
  // record); 'cancelled' occurrences are not tappable.
  const toSheetOccurrence = (o: Occurrence): SlotOccurrence | null => {
    const sheetState: SlotOccurrence['state'] | null =
      o.state === 'recorded'
        ? 'recorded'
        : o.state === 'unrecorded'
          ? 'unrecorded'
          : o.state === 'future' || o.state === 'readonly'
            ? 'future'
            : null;
    if (!sheetState) return null;
    return {
      groupId: o.slot.group_id,
      groupName: o.slot.group_name,
      scheduleId: o.slot.schedule_id,
      date: o.date,
      feePerClass: o.slot.fee_per_class,
      enrolledCount: o.slot.enrolled_count,
      effectiveTime: o.effectiveTime,
      durationMinutes: o.slot.duration_minutes,
      state: sheetState,
      sessionId: o.sessionId,
    };
  };

  const openByState = (o: Occurrence) => {
    const occ = toSheetOccurrence(o);
    if (occ) setActiveOccurrence(occ);
  };

  const renderEmpty = () => (
    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
      <CalendarDays size={28} className="mx-auto mb-3 text-[var(--color-text-muted)]" aria-hidden />
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('emptyToday')}</p>
      <Link
        href="/teacher/groups"
        className="inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
      >
        {t('goToGroups')}
      </Link>
    </div>
  );

  const renderTodayCard = (o: Occurrence) => {
    const muted = o.state === 'cancelled';
    const tappable = o.state !== 'cancelled';
    const cardClass = [
      'rounded-xl border bg-[var(--color-surface-1)] p-4',
      muted ? 'border-[var(--color-border-subtle)] opacity-60' : 'border-[var(--color-border)]',
    ].join(' ');
    const inner = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-start">
          <p className="font-bold text-[var(--color-text-primary)]">{o.slot.group_name}</p>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Clock size={14} aria-hidden />
            <span dir="ltr">
              {formatTimeRange(o.effectiveTime, o.slot.duration_minutes, timeLabels)}
            </span>
          </p>
          {o.state !== 'recorded' && !muted && (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
              <Users size={14} aria-hidden />
              {t('enrolledCount', {
                count: formatNumber(o.slot.enrolled_count, locale, { integerOnly: true }),
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {muted && (
            <span className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
              {t('cancelledBadge')}
            </span>
          )}
          {o.exception?.kind === 'rescheduled' && (
            <span className="rounded-full bg-[var(--color-brass)]/15 px-3 py-1 text-xs font-medium text-[var(--color-brass)]">
              {t('rescheduledBadge')}
            </span>
          )}
          {o.state === 'future' && (
            <span className="text-xs text-[var(--color-text-muted)]">{t('notStartedYet')}</span>
          )}
        </div>
      </div>
    );
    return tappable ? (
      <button
        key={`${o.slot.schedule_id}|${o.date}`}
        type="button"
        onClick={() => openByState(o)}
        className={`${cardClass} w-full text-start transition-colors hover:bg-[var(--color-surface-2)]`}
      >
        {inner}
      </button>
    ) : (
      <div key={`${o.slot.schedule_id}|${o.date}`} className={cardClass}>
        {inner}
      </div>
    );
  };

  const renderWeekCell = (date: string) => {
    const dow = dayOfWeekOf(date);
    const occurrences = slots
      .filter((s) => s.day_of_week === dow)
      .map((s) => occurrenceFor(s, date))
      .sort((a, b) => a.effectiveTime.localeCompare(b.effectiveTime));
    const isToday = date === todayKey;
    return (
      <div
        key={date}
        className={[
          'flex min-h-32 flex-col gap-1.5 rounded-lg border bg-[var(--color-surface-1)] p-2',
          isToday
            ? 'border-s-4 border-[var(--color-teal)]'
            : 'border-[var(--color-border-subtle)]',
        ].join(' ')}
      >
        <p
          className={[
            'text-center text-xs font-semibold',
            isToday ? 'text-[var(--color-teal-deep)]' : 'text-[var(--color-text-muted)]',
          ].join(' ')}
        >
          {tGroups(`daysOfWeek.${dow}`)}
          <span className="mt-0.5 block font-normal">
            {formatDate(date, locale, { day: 'numeric', month: 'numeric' })}
          </span>
        </p>
        {occurrences.map((o) => {
          const tappable = o.state !== 'cancelled';
          const inner = (
            <>
              <p className="truncate text-xs font-medium text-[var(--color-text-primary)]">
                {o.slot.group_name}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]" dir="ltr">
                {formatTimeRange(o.effectiveTime, o.slot.duration_minutes, timeLabels)}
              </p>
              {o.state === 'cancelled' && (
                <p className="text-[10px] text-[var(--color-text-muted)]">{t('cancelledBadge')}</p>
              )}
            </>
          );
          const cardClass = [
            'w-full rounded-md border px-2 py-1.5 text-start',
            o.state === 'cancelled'
              ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] opacity-60'
              : 'border-[var(--color-border)] bg-[var(--color-surface-0)]',
          ].join(' ');
          return tappable ? (
            <button
              key={`${o.slot.schedule_id}|${o.date}`}
              type="button"
              onClick={() => openByState(o)}
              className={`${cardClass} transition-colors hover:bg-[var(--color-surface-2)]`}
            >
              {inner}
            </button>
          ) : (
            <div key={`${o.slot.schedule_id}|${o.date}`} className={cardClass}>
              {inner}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('pageTitle')}</h1>
        <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-1">
          {(['today', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              className={[
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                view === v
                  ? 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              ].join(' ')}
            >
              {v === 'today' ? t('todayTab') : t('weekTab')}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('genericError')}</p>
          <button
            type="button"
            onClick={refetch}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            {t('retry')}
          </button>
        </div>
      ) : slots.length === 0 ? (
        renderEmpty()
      ) : view === 'today' ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {formatDate(todayKey, locale, 'long')}
          </p>
          {todayOccurrences.length === 0 ? (
            renderEmpty()
          ) : (
            <div className="flex flex-col gap-3">{todayOccurrences.map(renderTodayCard)}</div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[840px] grid-cols-7 gap-2 md:min-w-0">
            {weekDates.map(renderWeekCell)}
          </div>
        </div>
      )}

      <SlotActionSheet
        open={activeOccurrence !== null}
        occurrence={activeOccurrence}
        planKey={planKey}
        onClose={() => setActiveOccurrence(null)}
        onChanged={onActionDone}
      />
    </div>
  );
}
