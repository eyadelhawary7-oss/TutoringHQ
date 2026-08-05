'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { EmptyState, PageHeader } from '@/components/shared';
import {
  Plus,
  Clock,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Trash2,
  ClipboardCheck,
} from 'lucide-react';
import { ActionSheet, type SheetAction } from '@/components/patterns';
import { useToast } from '@/components/ui/ToastProvider';
import { formatTime, formatNumber, formatDate } from '@/lib/formatNumber';
import { subjectPalette } from '@/lib/subjectPalette';
import { cairoDateKey, getCurrentCairoClock, parseCairoYmd } from '@/lib/cairo/day';
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
  /**
   * The GROUP's subject, not `schedule_slots.subject`.
   *
   * Both columns exist, but the slot's copy is only ever written at insert
   * (handleAddSlot) and drifts the moment a group's subject is edited. The
   * design tints a session by the subject its group teaches, so the group's
   * value is the one that must drive the colour.
   */
  subject?: string | null;
}

/**
 * "4:00 PM" -> { main: "4:00", suffix: "PM" } for the design's stacked 46px
 * time column. Splits on any whitespace Intl may emit — including the narrow
 * no-break space it uses in several locales — and falls back to one line when
 * the locale has no separate suffix, rather than slicing the string blindly.
 */
function splitClockLabel(formatted: string): { main: string; suffix: string | null } {
  const parts = formatted.split(/[\s  ]+/).filter(Boolean);
  if (parts.length < 2) return { main: formatted, suffix: null };
  return { main: parts[0]!, suffix: parts.slice(1).join(' ') };
}

interface SessionRowProps {
  session: ScheduleSlot;
  /** The by-room board already names the room in its header. */
  showRoom: boolean;
  timing: 'now' | 'done' | null;
  conflict: boolean;
  /**
   * Whether a clash REPLACES the meta line with the "Room 1 clash · overlaps
   * Math 5:30" sentence.
   *
   * True in the by-time list (design lines 1125/1130), where nothing else on
   * screen says which room is double-booked. False in the by-room board (design
   * lines 1169-1170), where the room is already the section header and the
   * header carries its own "▲ overlap" badge — there the clashing rows instead
   * show how far each one runs ("30 students · to 7:00"), which is the fact the
   * header cannot give you. The stripe stays red either way, and the clash text
   * still reaches assistive tech through `aria-label`, so it is never
   * colour-only.
   */
  showConflictLine: boolean;
  locale: string;
  onOpen: () => void;
  onMore: () => void;
  labels: {
    open: string;
    more: string;
    notAvailable: string;
    now: string;
    done: string;
    members: string;
    conflict: string;
    /** "to 6:00" — design's by-room end-time tail. Omitted when absent. */
    endsAt?: string;
  };
}

/**
 * One session row, to `Merged-Center-Groups` §05 (design lines 1112-1132).
 *
 *   fixed 46px time column (4:00 over PM) · 3px subject stripe on the start
 *   edge · name over "Room 2 · 24 students" · Now badge · three-dot
 *
 * Two things here are corrections rather than restyling:
 *
 *  - the by-time list previously showed NO conflict indicator at all, so the
 *    default view of the schedule silently hid room double-bookings. A clash
 *    now replaces the meta line and turns the stripe red in both day views.
 *  - the stripe is `border-inline-start`, not `border-left`, so it sits on the
 *    correct edge in Arabic.
 */
function SessionRow({
  session,
  showRoom,
  timing,
  conflict,
  showConflictLine,
  locale,
  onOpen,
  onMore,
  labels,
}: SessionRowProps) {
  const clock = splitClockLabel(formatTime(formatTimeForDisplay(session.start_time), locale));
  const stripe = conflict ? '#9C3322' : subjectPalette(session.subject).fg;
  const clashReplacesMeta = conflict && showConflictLine;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      /* When the clash sentence is not drawn (by-room board), the meaning still
         has to reach a screen reader — the red stripe alone is colour-only. */
      aria-label={conflict && !showConflictLine ? labels.conflict : undefined}
      title={conflict ? labels.conflict : labels.open}
      className={`flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 shadow-sm transition-colors hover:bg-[var(--color-surface-2)] ${
        timing === 'done' ? 'opacity-60' : ''
      }`}
      style={{ borderInlineStartWidth: '3px', borderInlineStartColor: stripe, borderInlineStartStyle: 'solid' }}
    >
      <div className="w-[46px] shrink-0 text-center">
        <div className="font-mono text-sm font-semibold leading-tight text-[var(--color-text-primary)]">{clock.main}</div>
        {clock.suffix && (
          <div className="text-xs leading-tight text-[var(--color-text-muted)]">{clock.suffix}</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {session.group_name || labels.notAvailable}
        </div>
        {clashReplacesMeta ? (
          <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold" style={{ color: '#9C3322' }}>
            <AlertTriangle size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{labels.conflict}</span>
          </div>
        ) : (
          <div className="mt-0.5 truncate font-mono text-xs text-[var(--color-text-secondary)]">
            {showRoom ? `${session.room_name || labels.notAvailable} · ${labels.members}` : labels.members}
            {/* Design line 1169: a by-room clash row says how far it runs, so
                the overlap the header flagged is legible on the rows themselves. */}
            {conflict && labels.endsAt ? ` · ${labels.endsAt}` : ''}
            {timing === 'done' ? ` · ${labels.done}` : ''}
          </div>
        )}
      </div>
      {timing === 'now' && (
        <span className="shrink-0 rounded-full bg-[#DFEEEB] px-2 py-0.5 text-xs font-semibold text-[#0A514A]">
          ● {labels.now}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onMore();
        }}
        aria-label={labels.more}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
      >
        <MoreVertical size={20} />
      </button>
    </div>
  );
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
  const tEmpty = useTranslations('emptyStates');
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
  // Design (Merged-Center-Groups §05): a By time / By room toggle, so free
  // rooms and how heavily each is used are visible, not just the time order.
  const [dayView, setDayView] = useState<'time' | 'room'>('time');
  /**
   * Design (§05): Day / Week is a CHOICE, not a viewport.
   *
   * Before this the week grid was `hidden md:block` and the day list
   * `md:hidden`, so a phone could never reach the week grid and a desktop could
   * never reach the day list. Both now render at every width, under this state.
   */
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [minuteTick, setMinuteTick] = useState(0);
  /** One shared sheet for every session row — §04's "one sheet, one gesture". */
  const [sheetSlot, setSheetSlot] = useState<ScheduleSlot | null>(null);
  // Design (Merged-Center-Groups §05): prev/next week nav + a "13 - 19 July"
  // label. schedule_slots is a recurring weekly template with no per-occurrence
  // date, so every week shows the same pattern - navigating only changes which
  // calendar dates the strip's pills show, not which slots render.
  const [weekOffset, setWeekOffset] = useState(0);

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const didScrollAnchorRef = useRef(false);

  const isReadOnly = user?.role === 'teacher' || user?.role === 'assistant';
  const isTeacher = user?.role === 'teacher';
  const canEdit = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin';
  const isRtl = locale === 'ar' || locale.startsWith('ar-');
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  const formatMemberCount = (n: number) =>
    `${formatNumber(n, locale)} ${n === 1 ? tCommon('student') : tCommon('students')}`;

  // Door-side flow: tapping a session opens the unified Attendance page scoped to
  // that class (QR scan tab by default, checklist one tap away).
  const openAttendance = (groupId?: string | null) => {
    if (!groupId) return;
    router.push(`/${locale}/attendance?group=${groupId}&date=${cairoDateKey()}&tab=scan`);
  };

  const weekAnchorDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);
  const weekDays = useMemo(() => getCairoWeekDays(weekAnchorDate, locale), [weekAnchorDate, locale]);
  const weekRangeLabel = useMemo(() => {
    if (weekDays.length === 0) return '';
    const first = parseCairoYmd(weekDays[0]!.dayKey);
    const last = parseCairoYmd(weekDays[weekDays.length - 1]!.dayKey);
    const firstStr = formatDate(`${first.y}-${String(first.m).padStart(2, '0')}-${String(first.d).padStart(2, '0')}`, locale, { day: 'numeric', month: first.m === last.m ? undefined : 'short' });
    const lastStr = formatDate(`${last.y}-${String(last.m).padStart(2, '0')}-${String(last.d).padStart(2, '0')}`, locale, { day: 'numeric', month: 'short' });
    return `${firstStr} – ${lastStr}`;
  }, [weekDays, locale]);

  const labelForWeekday = (wd: number) =>
    weekDays.find((w) => w.jsWeekday === wd)?.label ?? String(wd);

  // The week strip's date-of-month, from the same weekDays already computed
  // for the label above - not the day's position in the strip.
  const dateOfMonthForWeekday = (wd: number) => {
    const dayKey = weekDays.find((w) => w.jsWeekday === wd)?.dayKey;
    return dayKey ? parseCairoYmd(dayKey).d : null;
  };

  // Egypt's weekend - Friday (5) and Saturday (6) - muted in the week strip
  // when not the selected day.
  const isWeekend = (wd: number) => wd === 5 || wd === 6;

  // Design's day-pill load dots: how many classes that day carries, at a
  // glance, before tapping in. Same displaySlots the grid itself renders.
  const slotCountForDay = (wd: number) => displaySlots.filter((s) => Number(s.day_of_week) === wd).length;

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
      slotsData.map((s) => {
        const group = s.group_id ? groupsData.find((g) => g.id === s.group_id) : undefined;
        return {
          ...s,
          room_name: roomsData.find((r) => r.id === s.room_id)?.name ?? '',
          group_name: group?.name ?? '',
          subject: group?.subject ?? null,
          member_count: s.group_id ? memberCountByGroup[s.group_id] ?? 0 : 0,
        };
      }),
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

  // `scrollColumnIntoView` lived here to centre a day column when the day strip
  // was tapped. The strip now belongs to the day view and the grid to the week
  // view, so nothing can scroll a column into view any more — the helper went
  // with its only caller rather than sitting unused.

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
      // `schedule_slots.room_id` is NULLABLE in the live catalog (verified in
      // information_schema.columns). Two room-less slots are not a ROOM clash,
      // and `null !== null` is false, so without this guard they would both be
      // flagged and the row would claim a double-booking that does not exist.
      // No such row exists live today (0 of 1 slots has a null room_id) — this
      // is closing the hole, not fixing a visible number.
      if (!s1.room_id) continue;
      for (const s2 of slots) {
        if (s1.id >= s2.id) continue;
        if (!s2.room_id) continue;
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

  // Design (§05): conflict copy names the clashing session ("Overlaps Math
  // 5:30") instead of a bare "conflict" chip. First partner found per slot.
  const conflictPartnerName = useMemo(() => {
    const partner = new Map<string, string>();
    for (const s1 of slots) {
      // Same nullable-room_id guard as getConflictingSlotIds — the two must
      // agree or a row could be striped red with no partner to name.
      if (!s1.room_id) continue;
      for (const s2 of slots) {
        if (s1.id === s2.id) continue;
        if (!s2.room_id) continue;
        if (s1.room_id !== s2.room_id) continue;
        if (Number(s1.day_of_week) !== Number(s2.day_of_week)) continue;
        const a1 = timeToMinutes(s1.start_time);
        const b1 = timeToMinutes(s1.end_time);
        const a2 = timeToMinutes(s2.start_time);
        const b2 = timeToMinutes(s2.end_time);
        if (a1 < b2 && a2 < b1 && !partner.has(s1.id)) {
          const name = s2.group_name || tCommon('notAvailable');
          partner.set(s1.id, `${name} ${formatTime(formatTimeForDisplay(s2.start_time), locale)}`);
        }
      }
    }
    return partner;
  }, [slots, locale, tCommon]);

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

  /**
   * Per-room breakdown of the SELECTED day.
   *
   * The header carries a SESSION COUNT and, when any of them clash, an overlap
   * badge — which is what the design asks and what a room header can actually
   * explain. The old "% booked" figure was booked-minutes over the board's
   * 15-hour window; nothing on screen said that, so 20% read as a capacity
   * number it never was.
   *
   * Rooms with nothing booked are kept and shown free — the design's whole
   * reason for this view is seeing which rooms are open.
   *
   * ORDER is the design's, not the room list's: earliest session first, free
   * rooms last (design lines 1161/1167/1173 run Room 2 at 3:00, Room 1 at 5:00,
   * then the free Room 3). Sorting by room name instead — which is what this did
   * — could open the board on a room that has nothing in it all day. Ties fall
   * back to name so the order is stable rather than dependent on fetch order.
   */
  const dayRoomBreakdown = (() => {
    const slotsToday = displaySlots.filter((s) => Number(s.day_of_week) === selectedDay);
    return rooms
      .map((room) => {
        const slots = slotsToday
          .filter((s) => s.room_id === room.id)
          .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
        const overlaps = slots.some((s) => getConflictingSlotIds.has(s.id));
        const firstStart = slots.length > 0 ? timeToMinutes(slots[0]!.start_time) : null;
        return { room, slots, overlaps, firstStart };
      })
      .sort((a, b) => {
        if (a.firstStart == null && b.firstStart == null) return a.room.name.localeCompare(b.room.name);
        if (a.firstStart == null) return 1;
        if (b.firstStart == null) return -1;
        if (a.firstStart !== b.firstStart) return a.firstStart - b.firstStart;
        return a.room.name.localeCompare(b.room.name);
      });
  })();

  /** Distinct subjects actually present in the loaded slots — the §05 legend. */
  const legendSubjects = Array.from(
    new Set(displaySlots.map((s) => s.subject).filter((v): v is string => !!v && v.trim() !== '')),
  ).sort((a, b) => a.localeCompare(b));

  const slotSheetActions = (slot: ScheduleSlot): SheetAction[] => {
    const actions: SheetAction[] = [];
    if (slot.group_id) {
      actions.push({
        id: 'attendance',
        label: t('takeAttendance'),
        icon: ClipboardCheck,
        onSelect: () => openAttendance(slot.group_id),
      });
    }
    // Filtered out rather than rendered disabled: an assistant should not see a
    // delete they cannot perform.
    if (canEdit) {
      actions.push({
        id: 'delete',
        label: t('delete'),
        icon: Trash2,
        destructive: true,
        onSelect: () => handleDeleteSlot(slot.id, true),
      });
    }
    return actions;
  };

  /**
   * Design (§05): the topbar subtitle names the view you are actually in —
   * "Week view", "Sunday 13 · by room", or the month.
   *
   * It replaces the old assistant-only "View only" string, which said nothing
   * about the schedule; the read-only state is already the inline badge beside
   * the title, which is where the design's own topbar puts it.
   */
  const headerSubtitle = (() => {
    if (viewMode === 'week') return t('weekView');
    const dayLabel = labelForWeekday(selectedDay);
    const dom = dateOfMonthForWeekday(selectedDay);
    if (dayView === 'room') {
      return `${dayLabel}${dom != null ? ` ${formatNumber(dom, locale)}` : ''} · ${t('byRoom')}`;
    }
    return formatDate(weekAnchorDate, locale, { month: 'long', year: 'numeric' });
  })();

  const { hour: cairoHour, minute: cairoMinute } = getCurrentCairoClock();
  const nowMinutesFromGridStart = cairoHour * 60 + cairoMinute - FIRST_HOUR * 60;
  const lastRowMinutes = (22 - FIRST_HOUR + 1) * 60;
  const clampedNow = Math.max(0, Math.min(lastRowMinutes, nowMinutesFromGridStart));
  // Only the real current week - a navigated week's same weekday is not "now".
  const showNowLine = weekOffset === 0 && selectedDay === cairoTodayWd;
  const nowLineTop =
    showNowLine && nowMinutesFromGridStart >= 0 && nowMinutesFromGridStart <= lastRowMinutes
      ? HEADER_ROW_H + (clampedNow / 60) * ROW_PX - 1
      : null;

  // Design (§05, "By time"/"By room" day views): a "● Now" badge on the
  // in-progress session and a dimmed "done" tag on ones that already ended -
  // absent from the mobile day lists (only the desktop week grid had a "now"
  // line). `onToday` scopes this to the real current day, same guard as
  // showNowLine, so a navigated week's same weekday is never marked "now".
  const sessionTimingState = (startTime: string, endTime: string, onToday: boolean): 'now' | 'done' | null => {
    if (!onToday) return null;
    const nowM = cairoHour * 60 + cairoMinute;
    const startM = timeToMinutes(startTime);
    const endM = timeToMinutes(endTime);
    if (nowM >= endM) return 'done';
    if (nowM >= startM && nowM < endM) return 'now';
    return null;
  };

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] space-y-5 animate-fade-in">
      <PageHeader
        title={
          <>
            {isTeacher ? t('yourSchedule') : t('title')}
            {isReadOnly && (
              <span className="inline-flex items-center text-xs bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 ms-2">
                {t('readOnly')}
              </span>
            )}
          </>
        }
        subtitle={headerSubtitle}
      >
        {/* Design (§05): a 42px teal icon square. BOTH live guards are kept —
            the role gate (an assistant must not reach the add form at all) and
            the no-rooms disabled state with its tooltip out to /rooms, because
            schedule_slots.room_id FKs to rooms and a session cannot be created
            without one. The design draws a bare square; a bare square here
            would be a control that errors for half the people who can see it. */}
        {!isReadOnly && canEdit && (
          <span className="group relative inline-flex flex-col items-end">
            <button
              type="button"
              aria-disabled={rooms.length === 0}
              aria-label={t('addSession')}
              title={t('addSession')}
              onClick={() => rooms.length > 0 && setShowAddModal(true)}
              className={`flex h-[42px] w-[42px] items-center justify-center rounded-md bg-teal-600 text-white transition-colors hover:bg-teal-700 btn-press chq-focus ${
                rooms.length === 0 ? 'opacity-50 cursor-not-allowed hover:bg-teal-600' : ''
              }`}
            >
              <Plus size={22} aria-hidden />
            </button>
            {rooms.length === 0 ? (
              <span className="pointer-events-none absolute top-full end-0 z-50 mt-1 hidden max-w-[220px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-start text-xs text-[var(--color-text-secondary)] shadow-lg group-hover:pointer-events-auto group-hover:block">
                {t('addRoomFirstTooltip')}{' '}
                <Link href="/rooms" className="font-semibold text-teal-600 hover:underline">
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
          icon={Clock}
          title={tEmpty('rooms.title')}
          description={tEmpty('rooms.description')}
          action={
            <button
              type="button"
              onClick={() => router.push(`/${locale}/rooms`)}
              className="flex items-center justify-center gap-2 px-4 py-2 w-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {tEmpty('rooms.action')}
            </button>
          }
        />
      ) : (
        <>
          {/* Design (§05): Day / Week. The view is now a choice rather than a
              consequence of screen width — before this a phone could not reach
              the week grid at all and a desktop could not reach the day list. */}
          <div className={`mb-3 gap-1 rounded-md bg-[var(--color-surface-2)] p-1 ${isTeacher ? 'hidden md:flex' : 'flex'}`}>
            {(['day', 'week'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`min-h-[40px] flex-1 rounded-sm text-[13px] font-semibold transition-colors ${
                  viewMode === mode
                    ? 'bg-teal-600 text-white'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                }`}
              >
                {mode === 'day' ? t('day') : t('week')}
              </button>
            ))}
          </div>

          {/* Design (§05): "13 - 19 July" + prev/next week nav, INSIDE the week
              view — it moves which calendar dates the grid heads are labelled
              with, which is meaningless while a single day is on screen. The
              grid itself always shows the same recurring weekly pattern. */}
          <div className={`mb-3 items-center justify-between gap-2 ${viewMode === 'week' && !(isTeacher) ? 'flex' : viewMode === 'week' ? 'hidden md:flex' : 'hidden'}`}>
            <button
              type="button"
              onClick={() => setWeekOffset((v) => v - 1)}
              aria-label={t('previousWeek', { defaultValue: 'Previous week' })}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-sm border border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] btn-press chq-focus"
            >
              <PrevIcon size={16} aria-hidden />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]" dir="ltr">
                {weekRangeLabel}
              </span>
              {/* KEPT against the design, deliberately (recorded in the PR's
                  flagged list): §05's wnav is prev/label/next only (design
                  lines 1191-1195), but without this reset a user who paged N
                  weeks away needs N taps back — the link only renders once
                  they have left the current week. */}
              {weekOffset !== 0 && (
                <button
                  type="button"
                  onClick={() => setWeekOffset(0)}
                  className="text-xs font-semibold text-teal-600 hover:underline"
                >
                  {t('thisWeek')}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setWeekOffset((v) => v + 1)}
              aria-label={t('nextWeek', { defaultValue: 'Next week' })}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-sm border border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] btn-press chq-focus"
            >
              <NextIcon size={16} aria-hidden />
            </button>
          </div>

          <div className={viewMode === 'week' ? (isTeacher ? 'hidden md:block' : 'block') : 'hidden'}>
            {/* Design (§05): a subject legend, built from the subjects ACTUALLY
                present in the loaded slots and coloured through the same
                palette function the blocks use. A hardcoded Physics/Chemistry/
                Math/English list would disagree with the grid the moment a
                centre taught a fifth subject. */}
            {legendSubjects.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-3 px-0.5 text-xs text-[var(--color-text-muted)]">
                {legendSubjects.map((s) => {
                  const p = subjectPalette(s);
                  return (
                    <span key={s} className="inline-flex items-center gap-1.5">
                      <i className="inline-block h-2.5 w-2.5 rounded-xs" style={{ background: p.bg }} aria-hidden />
                      <bdi>{s}</bdi>
                    </span>
                  );
                })}
              </div>
            )}

            <div className="overflow-x-auto rounded-md border border-[var(--color-line)] shadow-sm">
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
                    {/* Design (§05): weekday stacked over date-of-month, the
                        selected day's number in teal and the weekend's muted.
                        Both come from `weekDays`, so the heads follow week
                        navigation instead of naming a fixed calendar week. */}
                    {CAIRO_COL_ORDER.map((day) => {
                      const dom = dateOfMonthForWeekday(day);
                      return (
                        <div
                          key={day}
                          id={`schedule-col-${day}`}
                          className={`border-e border-[var(--color-border-subtle)] px-3 py-2 text-center last:border-e-0 ${
                            selectedDay === day ? 'ring-1 ring-inset ring-teal-500/35' : ''
                          }`}
                        >
                          <span className="block text-xs font-medium text-[var(--color-text-muted)]">
                            {labelForWeekday(day)}
                          </span>
                          {dom != null && (
                            <span
                              className={`block text-sm font-semibold tabular-nums ${
                                selectedDay === day
                                  ? 'text-teal-600'
                                  : isWeekend(day)
                                    ? 'text-[#A6A79D]'
                                    : 'text-[var(--color-text-secondary)]'
                              }`}
                            >
                              {formatNumber(dom, locale)}
                            </span>
                          )}
                        </div>
                      );
                    })}
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
                              const partnerName = conflictPartnerName.get(slot.id);
                              const palette = subjectPalette(slot.subject);
                              // Design (§05, lines 1123-1130): the clash line
                              // LEADS with the double-booked room — "Room 1
                              // clash · overlaps Math 5:30".
                              const clashLabel = partnerName
                                ? t('conflictWith', {
                                    room: slot.room_name || tCommon('notAvailable'),
                                    name: partnerName,
                                  })
                                : t('conflictShort');
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
                                  title={isConflict ? clashLabel : tAtt('captureTitle')}
                                  /* Design (§05): a clash is an OUTLINE, not a
                                     red fill — the block keeps its subject
                                     colour so the grid still reads as a
                                     timetable. aria-label carries the meaning
                                     so it is never colour-only. */
                                  aria-label={isConflict ? clashLabel : undefined}
                                  className="relative cursor-pointer rounded-sm p-2 shadow-sm transition-opacity hover:opacity-90"
                                  style={{
                                    background: palette.bg,
                                    color: palette.fg,
                                    ...(isConflict
                                      ? { outline: '1.5px solid #9C3322', outlineOffset: '-1.5px' }
                                      : {}),
                                  }}
                                >
                                  <p className="truncate text-xs font-semibold">
                                    {slot.group_name || tCommon('notAvailable')}
                                  </p>
                                  <p className="truncate text-xs opacity-80">
                                    {slot.room_name || tCommon('notAvailable')}
                                  </p>
                                  <p className="text-xs opacity-70">
                                    <span dir="ltr">
                                      {formatTime(formatTimeForDisplay(slot.start_time), locale)} –{' '}
                                      {formatTime(formatTimeForDisplay(slot.end_time), locale)}
                                    </span>
                                  </p>
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
            {/* Design (§05): the caption that explains the outline. Without it
                the red ring is an unexplained decoration. */}
            <p className="mt-2 flex items-center gap-1.5 px-0.5 text-xs text-[var(--color-text-muted)]">
              <AlertTriangle size={12} className="shrink-0 text-[#9C3322]" aria-hidden />
              {t('gridCaption')}
            </p>
          </div>

          <div className={viewMode === 'day' ? (isTeacher ? 'hidden md:block' : 'block') : 'hidden'}>
            <div className="-mx-1 mb-3 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-2">
              {CAIRO_COL_ORDER.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-label={labelForWeekday(day)}
                  onClick={() => setSelectedDay(day)}
                  className={`snap-start flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold tabular-nums transition-colors ${
                    selectedDay === day
                      ? 'border-teal-600 bg-teal-600 text-white'
                      : isWeekend(day)
                        ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-muted)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  <span className="text-[10px] font-medium opacity-80 leading-none">{t(SHORT_DAY_KEYS[day])}</span>
                  <span className="text-sm leading-tight mt-0.5">
                    {dateOfMonthForWeekday(day) != null
                      ? formatNumber(dateOfMonthForWeekday(day) as number, locale)
                      : ''}
                  </span>
                  {/* Design's day-pill load dots — up to FOUR, one per session. */}
                  {slotCountForDay(day) > 0 && (
                    <span className="mt-0.5 flex gap-0.5" aria-hidden>
                      {Array.from({ length: Math.min(4, slotCountForDay(day)) }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-1 w-1 rounded-full ${selectedDay === day ? 'bg-white/80' : 'bg-teal-500/70'}`}
                        />
                      ))}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {/* Design (§05): a full-width segmented control, the same shape as
                Day / Week above it. Still hidden for teachers — the by-room
                board is a room-management view, not a teaching one. */}
            {!isTeacher && (
              <div className="mb-3 flex w-full gap-1 rounded-md bg-[var(--color-surface-2)] p-1">
                {(['time', 'room'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDayView(mode)}
                    aria-pressed={dayView === mode}
                    className={`min-h-[38px] flex-1 rounded-sm text-[13px] font-semibold transition-colors ${
                      dayView === mode
                        ? 'bg-teal-600 text-white'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                    }`}
                  >
                    {mode === 'time' ? t('byTime') : t('byRoom')}
                  </button>
                ))}
              </div>
            )}

            {dayView === 'room' ? (
              rooms.length === 0 ? (
                <p className="py-2 text-sm text-[var(--color-text-secondary)]">{t('noSessionsSelectedDay')}</p>
              ) : (
                dayRoomBreakdown.map(({ room, slots, overlaps }) => (
                  <div key={room.id} className="mb-4">
                    {/* Design (§05): room name, session count, and an overlap
                        badge pushed to the end when any of them clash. */}
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--color-text-primary)]">{room.name}</span>
                      <span className="font-mono text-xs text-[var(--color-text-muted)]">
                        {slots.length === 0
                          ? `· ${t('roomFreeToday')}`
                          : t('sessionsCount', { count: formatNumber(slots.length, locale) })}
                      </span>
                      {overlaps && (
                        <span
                          className="ms-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{ background: '#F4E5E2', color: '#9C3322' }}
                        >
                          <AlertTriangle size={11} aria-hidden />
                          {t('overlapBadge')}
                        </span>
                      )}
                    </div>
                    {slots.length === 0 ? (
                      /* Design (§05): a free room is an INVITATION, not a blank.
                         Tapping pre-fills the add form with this room and the
                         selected day. Gated on the same rules as the topbar's
                         add control — an assistant taps nothing here. */
                      <button
                        type="button"
                        disabled={isReadOnly || !canEdit}
                        onClick={() => {
                          setFormRoomId(room.id);
                          setFormDay(selectedDay);
                          setShowAddModal(true);
                        }}
                        className="w-full rounded-md border border-dashed border-[#CDB98A] p-3 text-center text-xs font-semibold text-[#9A6B1F] disabled:cursor-default disabled:opacity-60 btn-press chq-focus"
                      >
                        {t('roomOpenAllDay')}
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {slots.map((s) => (
                          <SessionRow
                            key={s.id}
                            session={s}
                            showRoom={false}
                            timing={sessionTimingState(s.start_time, s.end_time, selectedDay === cairoTodayWd)}
                            conflict={getConflictingSlotIds.has(s.id)}
                            // The room header already names the room and
                            // already carries the overlap badge, so the row
                            // spends its line on the end time instead.
                            showConflictLine={false}
                            locale={locale}
                            onOpen={() => openAttendance(s.group_id)}
                            onMore={() => setSheetSlot(s)}
                            labels={{
                              open: tAtt('captureTitle'),
                              more: t('moreActions'),
                              notAvailable: tCommon('notAvailable'),
                              now: t('now'),
                              done: t('sessionDone'),
                              members: formatMemberCount(s.member_count ?? 0),
                              endsAt: t('endsAt', {
                                time: formatTime(formatTimeForDisplay(s.end_time), locale),
                              }),
                              // Still built, still reachable — it is the row's
                              // aria-label and title here rather than its
                              // visible meta line.
                              conflict: conflictPartnerName.get(s.id)
                                ? t('conflictWith', {
                                    room: s.room_name || tCommon('notAvailable'),
                                    name: conflictPartnerName.get(s.id) as string,
                                  })
                                : t('conflictShort'),
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : displaySlots.filter((s) => Number(s.day_of_week) === selectedDay).length === 0 ? (
              <p className="py-2 text-sm text-[var(--color-text-secondary)]">{t('noSessionsSelectedDay')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {displaySlots
                  .filter((s) => Number(s.day_of_week) === selectedDay)
                  .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
                  .map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      showRoom
                      timing={sessionTimingState(session.start_time, session.end_time, selectedDay === cairoTodayWd)}
                      conflict={getConflictingSlotIds.has(session.id)}
                      // Design lines 1125/1130: in the by-time list the clash
                      // sentence IS the meta line — nothing else names the room.
                      showConflictLine
                      locale={locale}
                      onOpen={() => openAttendance(session.group_id)}
                      onMore={() => setSheetSlot(session)}
                      labels={{
                        open: tAtt('captureTitle'),
                        more: t('moreActions'),
                        notAvailable: tCommon('notAvailable'),
                        now: t('now'),
                        done: t('sessionDone'),
                        members: formatMemberCount(session.member_count ?? 0),
                        conflict: conflictPartnerName.get(session.id)
                          ? t('conflictWith', {
                              room: session.room_name || tCommon('notAvailable'),
                              name: conflictPartnerName.get(session.id) as string,
                            })
                          : t('conflictShort'),
                      }}
                    />
                  ))}
              </div>
            )}
          </div>

          <div className={`md:hidden ${isTeacher ? 'block' : 'hidden'}`}>
            {(() => {
              const todayIndex = cairoTodayWd;
              const todaySessions = displaySlots.filter((s) => Number(s.day_of_week) === todayIndex);
              const thisWeekSessions = displaySlots.filter((s) => Number(s.day_of_week) !== todayIndex);
              return (
                <>
                  <h3 className="mb-2 text-sm font-bold text-teal-700">{t('today')}</h3>
                  {todaySessions.length === 0 && (
                    <p className="mb-3 text-xs text-[var(--color-text-secondary)]">{t('noSessionsToday')}</p>
                  )}
                  {todaySessions.map((session) => {
                    const timing = sessionTimingState(session.start_time, session.end_time, true);
                    return (
                    <div
                      key={session.id}
                      className={`mb-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 shadow-sm ${timing === 'done' ? 'opacity-60' : ''}`}
                      dir={isRtl ? 'rtl' : 'ltr'}
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-mono text-sm text-teal-600">
                          <span dir="ltr">
                            {formatTime(formatTimeForDisplay(session.start_time), locale)} –{' '}
                            {formatTime(formatTimeForDisplay(session.end_time), locale)}
                          </span>
                        </div>
                        {timing === 'now' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
                            ● {t('now')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-[var(--color-text-primary)]">
                        {session.group_name || tCommon('notAvailable')}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        {session.room_name || tCommon('notAvailable')} • {formatMemberCount(session.member_count ?? 0)}
                        {timing === 'done' ? ` • ${t('sessionDone')}` : ''}
                      </div>
                    </div>
                    );
                  })}
                  <hr className="my-3 border-[var(--color-border-subtle)]" />
                  <h3 className="mb-2 text-sm font-bold text-[var(--color-text-primary)]">{t('thisWeek')}</h3>
                  {thisWeekSessions.length === 0 && (
                    <p className="text-xs text-[var(--color-text-secondary)]">{t('noSessionsWeek')}</p>
                  )}
                  {thisWeekSessions.map((session) => (
                    <div
                      key={session.id}
                      className="mb-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 shadow-sm"
                      dir={isRtl ? 'rtl' : 'ltr'}
                    >
                      <div className="font-mono text-sm text-teal-600">
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

      {/* The shared sheet every session row opens — replaces the inline
          Delete -> "Sure?" pair that used to sit inside each card. */}
      <ActionSheet
        open={sheetSlot !== null}
        onClose={() => setSheetSlot(null)}
        title={sheetSlot?.group_name || tCommon('notAvailable')}
        subtitle={sheetSlot?.room_name || undefined}
        actions={sheetSlot ? slotSheetActions(sheetSlot) : []}
      />
    </div>
  );
}
