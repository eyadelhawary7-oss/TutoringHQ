'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { Plus, Clock, X, AlertTriangle } from 'lucide-react';
import EmptyState from '@/components/empty-states/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { formatTime, formatNumber } from '@/lib/formatNumber';
import { cairoDateKey, getCurrentCairoClock } from '@/lib/cairo/day';
import { cairoYmdToJsWeekday, getCairoWeekColumnOrder, getCairoWeekDays } from '@/lib/cairo/week';

interface Room {
  id: string;
  name: string;
  capacity?: number | null;
}

interface Group {
  id: string;
  name: string;
  subject: string | null;
}

interface ScheduleSlot {
  id: string;
  room_id: string;
  group_id?: string | null;
  teacher_id?: string | null;
  day_of_week: number | string;
  start_time: string;
  end_time: string;
  recurring?: boolean;
  room_name?: string;
  group_name?: string;
  member_count?: number;
}

const CAIRO_COL_ORDER = getCairoWeekColumnOrder();
const SHORT_DAY_KEYS: Record<number, string> = {
  6: 'shortSat',
  0: 'shortSun',
  1: 'shortMon',
  2: 'shortTue',
  3: 'shortWed',
  4: 'shortThu',
  5: 'shortFri',
};

const HEADER_ROW_H = 49;
const ROW_PX = 60;
const FIRST_HOUR = 8;

function timeToMinutes(t: string): number {
  let timeStr = t;
  if (t.includes('T')) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    timeStr = t.split('T')[1]?.slice(0, 5) ?? t;
  }
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTimeForDisplay(t: string | undefined): string {
  if (!t) return '';
  const part = t.includes('T') ? t.split('T')[1] : t;
  return (part ?? t).slice(0, 5);
}

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

export default function SchedulePage() {
  const t = useTranslations('schedule');
  const tCommon = useTranslations('common');
  const tToast = useTranslations('toasts');
  const tAtt = useTranslations('attendance');
  const { toast } = useToast();
  const locale = useLocale();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formGroupId, setFormGroupId] = useState('');
  const [formRoomId, setFormRoomId] = useState('');
  const [formDay, setFormDay] = useState(6);
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('11:00');
  const [formRecurring, setFormRecurring] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number>(() => cairoYmdToJsWeekday(cairoDateKey()));
  const [minuteTick, setMinuteTick] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const didScrollAnchorRef = useRef(false);

  const isReadOnly = user?.role === 'teacher' || user?.role === 'assistant';
  const isTeacher = user?.role === 'teacher';
  const canEdit = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin';

  const formatMemberCount = (n: number) =>
    `${formatNumber(n, locale)} ${n === 1 ? tCommon('student') : tCommon('students')}`;

  // Door-side flow: tapping a session opens the unified Attendance page scoped to
  // that class (QR scan tab by default, checklist one tap away).
  const openAttendance = (groupId?: string | null) => {
    if (!groupId) return;
    router.push(`/${locale}/attendance?group=${groupId}&date=${cairoDateKey()}&tab=scan`);
  };

  const weekDays = useMemo(() => getCairoWeekDays(new Date(), locale), [locale]);

  const labelForWeekday = (wd: number) =>
    weekDays.find((w) => w.jsWeekday === wd)?.label ?? String(wd);

  const displaySlots = useMemo(() => {
    if (!isTeacher || !userId) return slots;
    return slots.filter((s) => s.teacher_id === userId);
  }, [slots, isTeacher, userId]);

  const cairoTodayWd = useMemo(() => cairoYmdToJsWeekday(cairoDateKey()), [minuteTick]);

  useEffect(() => {
    const id = setInterval(() => setMinuteTick((x) => x + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if ((user?.role === 'assistant' || user?.role === 'teacher') && !hasPermission('can_view_schedule')) {
      router.replace('/dashboard');
    }
  }, [user, hasPermission, router]);

  const loadData = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);
    setUserId(meData.user.id);

    const [roomsRes, groupsRes, slotsRes] = await Promise.all([
      dbSelect({
        table: 'rooms',
        select: 'id, name, capacity',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'student_groups',
        select: 'id, name, subject',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'schedule_slots',
        select: 'id, room_id, group_id, teacher_id, day_of_week, start_time, end_time, recurring',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
      }),
    ]);

    const roomsData = (roomsRes.data || []) as Room[];
    const groupsData = (groupsRes.data || []) as Group[];
    const slotsData = (slotsRes.data || []) as ScheduleSlot[];
    const groupIds = groupsData.map((g) => g.id);
    const membersRes =
      groupIds.length > 0
        ? await dbSelect({
            table: 'student_group_members',
            select: 'group_id',
            filters: [{ column: 'group_id', op: 'in' as const, value: groupIds }],
          })
        : { data: [] };
    const membersData = (membersRes.data || []) as { group_id: string }[];
    const memberCountByGroup: Record<string, number> = {};
    membersData.forEach((m) => {
      memberCountByGroup[m.group_id] = (memberCountByGroup[m.group_id] || 0) + 1;
    });

    setRooms(roomsData);
    setGroups(groupsData);
    setSlots(
      slotsData.map((s) => ({
        ...s,
        room_name: roomsData.find((r) => r.id === s.room_id)?.name ?? '',
        group_name: s.group_id ? groupsData.find((g) => g.id === s.group_id)?.name ?? '' : '',
        member_count: s.group_id ? memberCountByGroup[s.group_id] ?? 0 : 0,
      })),
    );
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (isLoading || rooms.length === 0 || didScrollAnchorRef.current) return;
    didScrollAnchorRef.current = true;
    const el = gridScrollRef.current;
    if (!el) return;

    const { hour, minute } = getCurrentCairoClock();
    const anchorWd = cairoYmdToJsWeekday(cairoDateKey());
    const slotsForDay = displaySlots.filter((s) => Number(s.day_of_week) === anchorWd);
    let earliestMin: number | null = null;
    slotsForDay.forEach((s) => {
      const sm = timeToMinutes(s.start_time);
      if (earliestMin === null || sm < earliestMin) earliestMin = sm;
    });

    let targetHour = hour;
    const nowTotal = hour * 60 + minute;
    if (earliestMin != null && nowTotal < earliestMin - 60) {
      targetHour = Math.max(FIRST_HOUR, Math.floor(earliestMin / 60) - 1);
    }

    const scrollY = Math.max(
      0,
      HEADER_ROW_H + (targetHour - FIRST_HOUR) * ROW_PX - 96,
    );
    requestAnimationFrame(() => el.scrollTo({ top: scrollY, behavior: 'smooth' }));
  }, [isLoading, rooms.length, displaySlots]);

  const scrollColumnIntoView = (jsDay: number) => {
    document.getElementById(`schedule-col-${jsDay}`)?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  };

  const hasConflict = useMemo(() => {
    if (!formRoomId) return false;
    const startM = timeToMinutes(formStart);
    const endM = timeToMinutes(formEnd);
    return displaySlots.some(
      (s) =>
        s.room_id === formRoomId &&
        Number(s.day_of_week) === formDay &&
        timeToMinutes(s.start_time) < endM &&
        timeToMinutes(s.end_time) > startM,
    );
  }, [displaySlots, formRoomId, formDay, formStart, formEnd]);

  const getConflictingSlotIds = useMemo(() => {
    const conflictIds = new Set<string>();
    for (const s1 of slots) {
      for (const s2 of slots) {
        if (s1.id >= s2.id) continue;
        if (s1.room_id !== s2.room_id) continue;
        if (Number(s1.day_of_week) !== Number(s2.day_of_week)) continue;
        const a1 = timeToMinutes(s1.start_time);
        const b1 = timeToMinutes(s1.end_time);
        const a2 = timeToMinutes(s2.start_time);
        const b2 = timeToMinutes(s2.end_time);
        if (a1 < b2 && a2 < b1) {
          conflictIds.add(s1.id);
          conflictIds.add(s2.id);
        }
      }
    }
    return conflictIds;
  }, [slots]);

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !formGroupId || !formRoomId) {
      toast.error(tToast('error'), t('roomGroupRequired', { defaultValue: 'Group and room are required' }));
      return;
    }
    if (hasConflict) {
      toast.error(tToast('error'), t('conflictMessage'));
      return;
    }
    setIsSubmitting(true);
    try {
      const group = groups.find((g) => g.id === formGroupId);
      const startTime = formStart.length === 5 ? formStart + ':00' : formStart;
      const endTime = formEnd.length === 5 ? formEnd + ':00' : formEnd;
      const { data, error } = await dbInsert({
        table: 'schedule_slots',
        data: {
          center_id: centerId,
          room_id: formRoomId,
          subject: group?.subject ?? null,
          group_id: formGroupId,
          teacher_id: userId,
          day_of_week: formDay,
          start_time: startTime,
          end_time: endTime,
          recurring: formRecurring,
        },
        single: true,
      });
      if (error) {
        toast.error(
          tToast('error'),
          typeof error === 'object' && error?.message ? String(error.message) : String(error),
        );
        setIsSubmitting(false);
        return;
      }
      if (data) {
        const slot = data as ScheduleSlot;
        await auditLog({
          centerId,
          userId,
          action: 'schedule_slot_create',
          entityType: 'schedule_slots',
          entityId: slot.id,
          details: {},
        });
        setShowAddModal(false);
        setFormGroupId('');
        setFormRoomId('');
        toast.success(tToast('saved'), t('slotSaved'));
        await loadData();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSlot = async (id: string, skipConfirm = false) => {
    if (!centerId || !userId) return;
    if (!skipConfirm && !confirm(t('deleteConfirm'))) return;
    await dbDelete({ table: 'schedule_slots', filters: [{ column: 'id', op: 'eq', value: id }] });
    await auditLog({
      centerId,
      userId,
      action: 'schedule_slot_delete',
      entityType: 'schedule_slots',
      entityId: id,
    });
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  if ((user?.role === 'assistant' || user?.role === 'teacher') && !hasPermission('can_view_schedule')) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }

  const HOURS = Array.from({ length: 15 }, (_, i) => i + FIRST_HOUR);

  const getSlotsInCell = (day: number, hour: number) =>
    displaySlots.filter((s) => {
      if (Number(s.day_of_week) !== day) return false;
      const startM = timeToMinutes(s.start_time);
      const endM = timeToMinutes(s.end_time);
      const hourStart = hour * 60;
      const hourEnd = (hour + 1) * 60;
      return startM < hourEnd && endM > hourStart;
    });

  const { hour: cairoHour, minute: cairoMinute } = getCurrentCairoClock();
  const nowMinutesFromGridStart = cairoHour * 60 + cairoMinute - FIRST_HOUR * 60;
  const lastRowMinutes = (22 - FIRST_HOUR + 1) * 60;
  const clampedNow = Math.max(0, Math.min(lastRowMinutes, nowMinutesFromGridStart));
  const showNowLine = selectedDay === cairoTodayWd;
  const nowLineTop =
    showNowLine && nowMinutesFromGridStart >= 0 && nowMinutesFromGridStart <= lastRowMinutes
      ? HEADER_ROW_H + (clampedNow / 60) * ROW_PX - 1
      : null;

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] space-y-5 animate-fade-in">
      <PageHeader
        title={
          <>
            {isTeacher ? t('yourSchedule') : t('title')}
            {isReadOnly && (
              <span className="inline-flex items-center text-xs bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 ms-2 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800">
                {t('readOnly')}
              </span>
            )}
          </>
        }
        subtitle={
          (user?.role === 'assistant' || user?.role === 'teacher') && hasPermission('can_view_schedule')
            ? t('viewOnly', { defaultValue: 'View only' })
            : undefined
        }
      >
        {!isReadOnly && canEdit && (
          <span className="group relative inline-flex flex-col items-end">
            <button
              type="button"
              aria-disabled={rooms.length === 0}
              onClick={() => rooms.length > 0 && setShowAddModal(true)}
              className={`flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors ${
                rooms.length === 0 ? 'opacity-50 cursor-not-allowed hover:bg-teal-600' : ''
              }`}
            >
              <Plus size={16} /> {t('addSession')}
            </button>
            {rooms.length === 0 ? (
              <span className="pointer-events-none absolute top-full end-0 z-50 mt-1 hidden max-w-[220px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-start text-xs text-[var(--color-text-secondary)] shadow-lg group-hover:pointer-events-auto group-hover:block">
                {t('addRoomFirstTooltip')}{' '}
                <Link href="/rooms" className="font-semibold text-teal-600 hover:underline dark:text-teal-400">
                  {t('addRoomFirstLink')}
                </Link>
              </span>
            ) : null}
          </span>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="text-center py-16">
          <svg className="animate-spin h-8 w-8 text-teal-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          titleKey="rooms.title"
          descriptionKey="rooms.description"
          namespace="emptyStates"
          actionLabel="rooms.action"
          onAction={() => router.push(`/${locale}/rooms`)}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <div className="flex gap-1 bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-xl p-1 mb-4 overflow-x-auto snap-x snap-mandatory scrollbar-thin">
              {CAIRO_COL_ORDER.map((day, idx) => (
                <button
                  key={day}
                  type="button"
                  aria-label={labelForWeekday(day)}
                  onClick={() => {
                    setSelectedDay(day);
                    scrollColumnIntoView(day);
                  }}
                  className={`snap-start shrink-0 flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold tabular-nums transition-colors ${
                    selectedDay === day
                      ? 'bg-teal-600 text-white ring-2 ring-teal-400/40'
                      : 'bg-[var(--color-surface-0)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  <span className="text-[10px] font-medium opacity-80 leading-none">{t(SHORT_DAY_KEYS[day])}</span>
                  <span className="text-sm leading-tight mt-0.5">{formatNumber(idx + 1, locale)}</span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] shadow-sm">
              <div className="min-w-[720px] bg-[var(--color-surface-1)]">
                <div
                  ref={gridScrollRef}
                  className="relative max-h-[min(560px,calc(100vh-220px))] overflow-y-auto overflow-x-hidden"
                >
                  {nowLineTop != null ? (
                    <div
                      className="pointer-events-none absolute start-0 end-0 z-[8] h-[3px] bg-teal-500/90 shadow-[0_0_8px_rgba(13,148,136,0.6)]"
                      style={{ top: nowLineTop }}
                      aria-hidden
                    />
                  ) : null}
                  <div className="sticky top-0 z-[9] grid grid-cols-8 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                    <div className="border-e border-[var(--color-border-subtle)] px-3 py-3 text-xs font-medium text-[var(--color-text-muted)]">
                      {t('time')}
                    </div>
                    {CAIRO_COL_ORDER.map((day) => (
                      <div
                        key={day}
                        id={`schedule-col-${day}`}
                        className={`border-e border-[var(--color-border-subtle)] px-3 py-3 text-center text-xs font-medium text-[var(--color-text-muted)] last:border-e-0 ${
                          selectedDay === day ? 'ring-1 ring-inset ring-teal-500/35' : ''
                        }`}
                      >
                        {labelForWeekday(day)}
                      </div>
                    ))}
                  </div>
                  {HOURS.map((hour) => (
                    <div key={hour} className="grid grid-cols-8 border-b border-[var(--color-border-subtle)] min-h-[60px]">
                      <div className="border-e border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/50 px-3 py-3 text-xs text-[var(--color-text-secondary)] self-start pt-2">
                        {formatTime(formatHour(hour), locale)}
                      </div>
                      {CAIRO_COL_ORDER.map((day) => {
                        const cellSlots = getSlotsInCell(day, hour);
                        return (
                          <div key={day} className="border-e border-[var(--color-border-subtle)] last:border-e-0 p-1.5">
                            {cellSlots.map((slot) => {
                              const isConflict = getConflictingSlotIds.has(slot.id);
                              return (
                                <div
                                  key={slot.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openAttendance(slot.group_id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      openAttendance(slot.group_id);
                                    }
                                  }}
                                  title={tAtt('captureTitle')}
                                  className={`relative rounded-xl p-2 cursor-pointer transition-colors group border shadow-sm ${
                                    isConflict
                                      ? 'bg-red-500/10 hover:bg-red-500/15 border-red-500/40'
                                      : 'bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] border-[var(--color-border-subtle)]'
                                  }`}
                                >
                                  {isConflict && (
                                    <AlertTriangle className="w-3.5 h-3.5 absolute top-1 end-1 text-red-500" />
                                  )}
                                  <p
                                    className={`text-xs font-semibold truncate pe-5 ${
                                      isConflict ? 'text-red-800 dark:text-red-200' : 'text-[var(--color-text-primary)]'
                                    }`}
                                  >
                                    {slot.group_name || tCommon('notAvailable')}
                                  </p>
                                  <p
                                    className={`text-xs truncate ${
                                      isConflict ? 'text-red-700 dark:text-red-300' : 'text-[var(--color-text-secondary)]'
                                    }`}
                                  >
                                    {slot.room_name || tCommon('notAvailable')}
                                  </p>
                                  <p
                                    className={`text-xs ${
                                      isConflict ? 'text-red-600 dark:text-red-400' : 'text-[var(--color-text-tertiary)]'
                                    }`}
                                  >
                                    <span dir="ltr">
                                      {formatTime(formatTimeForDisplay(slot.start_time), locale)} –{' '}
                                      {formatTime(formatTimeForDisplay(slot.end_time), locale)}
                                    </span>
                                  </p>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteSlot(slot.id);
                                      }}
                                      className={`hidden group-hover:block absolute top-1 end-1 p-0.5 rounded ${
                                        isConflict
                                          ? 'hover:bg-red-500/20 text-red-700 dark:text-red-300'
                                          : 'hover:bg-[var(--color-surface-2)] text-teal-600 dark:text-teal-400'
                                      }`}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={`md:hidden ${isTeacher ? 'hidden' : 'block'}`}>
            <div className="-mx-1 mb-3 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-2">
              {CAIRO_COL_ORDER.map((day, idx) => (
                <button
                  key={day}
                  type="button"
                  aria-label={labelForWeekday(day)}
                  onClick={() => setSelectedDay(day)}
                  className={`snap-start flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold tabular-nums transition-colors ${
                    selectedDay === day
                      ? 'border-teal-600 bg-teal-600 text-white'
                      : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  <span className="text-[10px] font-medium opacity-80 leading-none">{t(SHORT_DAY_KEYS[day])}</span>
                  <span className="text-sm leading-tight mt-0.5">{formatNumber(idx + 1, locale)}</span>
                </button>
              ))}
            </div>
            {displaySlots.filter((s) => Number(s.day_of_week) === selectedDay).length === 0 ? (
              <p className="py-2 text-sm text-[var(--color-text-secondary)]">{t('noSessionsSelectedDay')}</p>
            ) : (
              displaySlots
                .filter((s) => Number(s.day_of_week) === selectedDay)
                .map((session) => (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openAttendance(session.group_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openAttendance(session.group_id);
                      }
                    }}
                    title={tAtt('captureTitle')}
                    className="mb-2 cursor-pointer rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-3 shadow-sm transition-colors hover:bg-[var(--color-surface-2)]"
                  >
                    <div className="font-mono text-sm text-teal-600 dark:text-teal-400">
                      <span dir="ltr">
                        {formatTime(formatTimeForDisplay(session.start_time), locale)} –{' '}
                        {formatTime(formatTimeForDisplay(session.end_time), locale)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm font-bold text-[var(--color-text-primary)]">
                      {session.group_name || tCommon('notAvailable')}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      {session.room_name || tCommon('notAvailable')} • {formatMemberCount(session.member_count ?? 0)}
                    </div>
                    {canEdit && (
                      confirmDeleteId === session.id ? (
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                              handleDeleteSlot(session.id, true);
                            }}
                            className="flex min-h-[44px] items-center text-xs font-semibold text-red-600 hover:underline"
                          >
                            {t('confirmDelete', { defaultValue: 'Sure?' })}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="flex min-h-[44px] items-center text-xs font-semibold text-[var(--color-text-secondary)] hover:underline"
                          >
                            {tCommon('cancel')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(session.id);
                          }}
                          className="mt-2 flex min-h-[44px] min-w-[44px] items-center text-xs font-semibold text-red-600 hover:underline"
                        >
                          {t('delete')}
                        </button>
                      )
                    )}
                  </div>
                ))
            )}
          </div>

          <div className={`md:hidden ${isTeacher ? 'block' : 'hidden'}`}>
            {(() => {
              const todayIndex = cairoTodayWd;
              const todaySessions = displaySlots.filter((s) => Number(s.day_of_week) === todayIndex);
              const thisWeekSessions = displaySlots.filter((s) => Number(s.day_of_week) !== todayIndex);
              return (
                <>
                  <h3 className="mb-2 text-sm font-bold text-teal-700 dark:text-teal-400">{t('today')}</h3>
                  {todaySessions.length === 0 && (
                    <p className="mb-3 text-xs text-[var(--color-text-secondary)]">{t('noSessionsToday')}</p>
                  )}
                  {todaySessions.map((session) => (
                    <div
                      key={session.id}
                      className="mb-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-3 shadow-sm"
                      dir="rtl"
                    >
                      <div className="font-mono text-sm text-teal-600 dark:text-teal-400">
                        <span dir="ltr">
                          {formatTime(formatTimeForDisplay(session.start_time), locale)} –{' '}
                          {formatTime(formatTimeForDisplay(session.end_time), locale)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-[var(--color-text-primary)]">
                        {session.group_name || tCommon('notAvailable')}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        {session.room_name || tCommon('notAvailable')} • {formatMemberCount(session.member_count ?? 0)}
                      </div>
                    </div>
                  ))}
                  <hr className="my-3 border-[var(--color-border-subtle)]" />
                  <h3 className="mb-2 text-sm font-bold text-[var(--color-text-primary)]">{t('thisWeek')}</h3>
                  {thisWeekSessions.length === 0 && (
                    <p className="text-xs text-[var(--color-text-secondary)]">{t('noSessionsWeek')}</p>
                  )}
                  {thisWeekSessions.map((session) => (
                    <div
                      key={session.id}
                      className="mb-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-3 shadow-sm"
                      dir="rtl"
                    >
                      <div className="font-mono text-sm text-teal-600 dark:text-teal-400">
                        <span dir="ltr">
                          {formatTime(formatTimeForDisplay(session.start_time), locale)} –{' '}
                          {formatTime(formatTimeForDisplay(session.end_time), locale)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-[var(--color-text-primary)]">
                        {session.group_name || tCommon('notAvailable')}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        {session.room_name || tCommon('notAvailable')} • {formatMemberCount(session.member_count ?? 0)}
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </>
      )}

      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('addSession')}</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg transition-colors">
                <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <form onSubmit={handleAddSlot}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('group')}</label>
                  <select
                    value={formGroupId}
                    onChange={(e) => setFormGroupId(e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    required
                  >
                    <option value="">{tCommon('select')}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('room')}</label>
                  <select
                    value={formRoomId}
                    onChange={(e) => setFormRoomId(e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    required
                  >
                    <option value="">{tCommon('select')}</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.capacity != null ? ` (${r.capacity})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('day')}</label>
                  <select
                    value={formDay}
                    onChange={(e) => setFormDay(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                  >
                    {CAIRO_COL_ORDER.map((d) => (
                      <option key={d} value={d}>
                        {labelForWeekday(d)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('startTime')}</label>
                    <input
                      type="time"
                      value={formStart}
                      onChange={(e) => setFormStart(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('endTime')}</label>
                    <input
                      type="time"
                      value={formEnd}
                      onChange={(e) => setFormEnd(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={formRecurring}
                    onChange={(e) => setFormRecurring(e.target.checked)}
                    className="rounded accent-primary"
                  />
                  <span className="text-sm text-[var(--color-text-primary)]">{t('recurring')}</span>
                </label>
                {hasConflict && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertTriangle size={16} />
                    <span>{t('conflictMessage')}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 p-6 pt-0">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!formGroupId || !formRoomId || hasConflict || isSubmitting}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('addSession')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
