'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { Link as RouterLink } from '@/i18n/routing';
import {
  Plus,
  BookOpen,
  Atom,
  FlaskConical,
  X,
  Search,
  Link2,
  Copy,
  Check,
  ChevronRight,
  ChevronLeft,
  GraduationCap,
  UserPlus,
  Users,
  Layers,
  Pencil,
  Trash2,
  MoreVertical,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AttendanceHeatmap } from '@/components/AttendanceHeatmap';
import { ActionSheet, RecordActionBar, type SheetAction } from '@/components/patterns';
import { useToast } from '@/components/ui/ToastProvider';
import { formatCurrency, formatNumber, formatDate, formatPercent, formatTime } from '@/lib/formatNumber';
import { getCairoWeekColumnOrder, getCairoWeekDays } from '@/lib/cairo/week';
import { cairoDateKey } from '@/lib/cairo/day';
import { subjectPalette } from '@/lib/subjectPalette';
import { isUuid } from '@/lib/uuid';
import { initialsOf } from '@/lib/initials';
import { getStudentBalances, type StudentBalance } from '@/lib/studentBalance';
import * as Sentry from '@sentry/nextjs';
import { useVerificationState } from '@/hooks/useVerificationState';

interface Group {
  id: string;
  name: string;
  subject: string | null;
  fee_per_class?: number;
  /** Center's share of fee_per_class, in EGP. The design's "center 30%" is derived from it. */
  center_cut_egp?: number | null;
  /**
   * The OUTSIDE teacher who runs this group — `student_groups.teacher_id`
   * (verified in information_schema.columns). This, not the schedule slots, is
   * the design's teacher signal: `handleAddSlot` fills `schedule_slots.teacher_id`
   * with the CREATING ADMIN's user id, so a slot-derived name would show the
   * admin as the group's teacher.
   */
  teacher_id?: string | null;
  /** Member count (same as student_count; kept for mutations). */
  member_count?: number;
  /** Display count for UI (synced with member_count). */
  student_count?: number;
  teacher_name?: string | null;
  max_capacity?: number | null;
  /** Design's schedule line: ordered JS weekdays, first start time, room name. */
  schedule?: { days: number[]; startTime: string | null; roomName: string | null };
}

interface Student {
  id: string;
  name: string;
  subject: string | null;
  student_number?: string | null;
}

interface Subject {
  id: string;
  name: string;
}

/**
 * Attendance rolled up per group, from ONE centre-wide `attendance_scans` read.
 *
 * Every figure the design asks for on this screen — the Avg attendance tile,
 * the heatmap's group size, Recent sessions, and each member's "Present 24/24"
 * — comes from the same three columns, so they are fetched once and aggregated
 * here rather than re-queried per group (which is what the old per-detail
 * effect and the per-group member-count loop did).
 *
 * `(student_id, session_date)` is de-duplicated exactly the way
 * `attendance-heatmap/route.ts` does it: two scans of the same student on the
 * same day are one attendance, not two.
 */
interface GroupAttendance {
  /** Distinct session dates, newest first. */
  dates: string[];
  /** session date -> distinct students present. */
  presentByDate: Record<string, number>;
  /** student id -> distinct session dates that student attended. */
  presentByStudent: Record<string, number>;
}

/** The design's four subject glyphs, in the same order as SUBJECT_PALETTES. */
const SUBJECT_GLYPHS: LucideIcon[] = [Atom, BookOpen, FlaskConical, BookOpen];

const EMPTY_ATTENDANCE: GroupAttendance = { dates: [], presentByDate: {}, presentByStudent: {} };

export default function GroupsPage() {
  // Imported from the one state machine, never re-derived here.
  const { state: verification } = useVerificationState();
  const t = useTranslations('groups');
  const tEmpty = useTranslations('emptyStates');
  const tCommon = useTranslations('common');
  const tAtt = useTranslations('attendance');
  const tToast = useTranslations('toasts');
  const tCut = useTranslations('centerCut');
  const { toast } = useToast();
  const locale = useLocale();
  const isRTL = locale === 'ar';
  // Chevrons flip by GLYPH SWAP, not by a CSS transform — a mirrored transform
  // does not survive a screenshot diff and reads wrong at small sizes.
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  // Localised short weekday label per JS weekday index, from the Cairo week
  // helper so Arabic and English both come from one place.
  const dayLabelByWeekday = useMemo(() => {
    const map: Record<number, string> = {};
    for (const d of getCairoWeekDays(new Date(), locale)) map[d.jsWeekday] = d.label;
    return map;
  }, [locale]);
  // Surface the real DB/validation reason in save toasts instead of a generic
  // "something went wrong" — a swallowed message is what hid the dropped-column
  // failure during the attendance rework.
  const errorDetail = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    return msg && msg !== 'Unknown error' ? msg : t('errors.saveFailedGeneric');
  };

  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, string[]>>({});
  const [attendanceByGroup, setAttendanceByGroup] = useState<Record<string, GroupAttendance>>({});
  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerCode, setCenterCode] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [detailGroup, setDetailGroup] = useState<Group | null>(null);
  const [formMode, setFormMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ name: '', subjectId: '', fee_per_class: '', centerCutPct: '', maxCapacity: '' });
  const [isAdding, setIsAdding] = useState(false);
  /**
   * §02 (Center Groups Verified) gate, HALF ONE — /api/me's exposure of the
   * platform switch `digital_student_fee_collection.enabled`. Live value is
   * `false` (row exists, set 19 June 2026; re-verified 4 Aug 2026).
   * Fail-closed: anything but `true` keeps it off.
   *
   * This flag alone was the whole gate, and that was a latent defect. It is a
   * PLATFORM switch with no per-centre component, so flipping it would have
   * turned on digital collection for every centre at once, verified or not —
   * which contradicts VERIFICATION-SPEC §6, where online collection is gated on
   * a passed identity check. The flag is now necessary but not sufficient; see
   * `digitalCollectionActive` below.
   */
  const [platformDigitalCollection, setPlatformDigitalCollection] = useState(false);
  const [members, setMembers] = useState<{ student_id: string; student_name: string }[]>([]);
  const [studentOtherGroups, setStudentOtherGroups] = useState<Record<string, string[]>>({});
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [waitlist, setWaitlist] = useState<{ id: string; name: string; parent_phone?: string | null }[]>([]);
  const [activeTab, setActiveTab] = useState<'members' | 'waitlist'>('members');
  const [memberBalances, setMemberBalances] = useState<Map<string, StudentBalance>>(new Map());
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  /**
   * One sheet at a time — `Merged-Design-Patterns` §04's "one sheet, one
   * gesture". The row decides what goes in it; the sheet only presents.
   */
  const [sheet, setSheet] = useState<
    | { kind: 'group'; group: Group }
    | { kind: 'member'; studentId: string; name: string }
    | null
  >(null);

  /**
   * §02 gate, BOTH HALVES. The platform switch says the feature exists at all;
   * the verification state says this centre may use it. Online collection is
   * gated on a passed identity check (VERIFICATION-SPEC §6), so a centre that
   * has not verified must keep the §01 layout even after the platform flips.
   *
   * `state.isVerified` is the ONE boolean `resolveEffectiveState` guarantees
   * cannot be true while the Valify guard is unhappy — an `unconfigured`
   * deployment resolves to false no matter what any stored row says. So this is
   * fail-closed twice over, and today it is false because Valify is not
   * configured (all four VALIFY_* values are placeholders).
   */
  const digitalCollectionActive = platformDigitalCollection && verification.isVerified;

  // Design (§01 New group form): a "+ New" chip inline in the subject picker,
  // so a center doesn't have to abandon group creation to add a subject first.
  const NEW_SUBJECT_VALUE = '__new__';
  const [newSubjectInlineName, setNewSubjectInlineName] = useState('');
  const [isCreatingSubjectInline, setIsCreatingSubjectInline] = useState(false);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);
    setUserId(meData.user.id);
    setPlatformDigitalCollection(meData.user.digital_student_fee_collection === true);

    const { data: centerRow } = await dbSelect({
      table: 'centers',
      select: 'center_code',
      filters: [{ column: 'id', op: 'eq', value: cid }],
      single: true,
    });
    const centerInfo = Array.isArray(centerRow) ? centerRow[0] : centerRow;
    const code = (centerInfo as { center_code?: string | null } | null)?.center_code ?? null;
    setCenterCode(code);

    const [groupsRes, studentsRes, subjectsRes, slotsRes, roomsRes, scansRes] = await Promise.all([
      dbSelect({
        table: 'student_groups',
        select: 'id, name, subject, fee_per_class, center_cut_egp, max_capacity, teacher_id',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'students',
        select: 'id, name, subject, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'subjects',
        select: 'id, name',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      // day_of_week / start_time / room_id feed the design's
      // "Sun · Tue · 4:00 PM · Room 2" line. All verified present in
      // information_schema.columns. `teacher_id` is deliberately NOT read here:
      // handleAddSlot fills it with the creating admin's user id, so it must
      // never feed the teacher chip (that comes from student_groups.teacher_id).
      dbSelect({
        table: 'schedule_slots',
        select: 'group_id, day_of_week, start_time, end_time, room_id',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
      }),
      dbSelect({
        table: 'rooms',
        select: 'id, name',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
      }),
      // ONE centre-wide attendance read feeds the Avg-attendance tile, Recent
      // sessions and every member's "Present x/y". All four columns verified in
      // information_schema.columns.
      dbSelect({
        table: 'attendance_scans',
        select: 'group_id, student_id, session_date, scanned_at',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
      }),
    ]);

    const groupsData = (groupsRes.data || []) as Group[];
    const studentsData = (studentsRes.data || []) as Student[];
    const subjectsData = (subjectsRes.data || []) as Subject[];
    const slotsData = (slotsRes.data || []) as {
      group_id?: string | null;
      day_of_week?: string | null;
      start_time?: string | null;
      end_time?: string | null;
      room_id?: string | null;
    }[];
    const roomNameById = Object.fromEntries(
      ((roomsRes.data || []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
    );

    /**
     * The design's per-group schedule line: "Sun · Tue · 4:00 PM · Room 2".
     *
     * day_of_week is read through the ONE convention set by the writer — a JS
     * weekday as text, "0" Sunday to "6" Saturday. Anything that parses to
     * outside 0-6 is skipped rather than guessed at, so a stray value shows no
     * day instead of the wrong one.
     *
     * Days are ordered by the Cairo week (Sat→Fri), not numerically, so a
     * Sat+Sun group reads "Sat · Sun" the way a centre says it.
     */
    const scheduleByGroup: Record<string, { days: number[]; startTime: string | null; roomName: string | null }> = {};
    for (const slot of slotsData) {
      if (!slot.group_id) continue;
      const entry = (scheduleByGroup[slot.group_id] ??= { days: [], startTime: null, roomName: null });
      const dow = Number(slot.day_of_week);
      if (Number.isInteger(dow) && dow >= 0 && dow <= 6 && !entry.days.includes(dow)) {
        entry.days.push(dow);
      }
      if (!entry.startTime && slot.start_time) entry.startTime = slot.start_time;
      if (!entry.roomName && slot.room_id) entry.roomName = roomNameById[slot.room_id] ?? null;
    }
    const cairoDayOrder = getCairoWeekColumnOrder();
    for (const entry of Object.values(scheduleByGroup)) {
      entry.days.sort((a, b) => cairoDayOrder.indexOf(a) - cairoDayOrder.indexOf(b));
    }

    // One membership read for the whole centre. Replaces both the per-group
    // count loop and the second identical query the detail pane used to run.
    const groupIds = groupsData.map((g) => g.id);
    const membershipsRes = groupIds.length > 0
      ? await dbSelect({
          table: 'student_group_members',
          select: 'group_id, student_id',
          filters: [{ column: 'group_id', op: 'in' as const, value: groupIds }],
        })
      : { data: [] };
    const byGroup: Record<string, string[]> = {};
    for (const m of ((membershipsRes.data || []) as { group_id: string; student_id: string }[])) {
      (byGroup[m.group_id] ??= []).push(m.student_id);
    }

    // De-duplicate (student_id, session_date) per group before counting.
    const seen: Record<string, Record<string, Set<string>>> = {};
    for (const scan of ((scansRes.data || []) as {
      group_id?: string | null;
      student_id: string;
      session_date?: string | null;
      scanned_at?: string | null;
    }[])) {
      if (!scan.group_id) continue;
      const date = scan.session_date || (scan.scanned_at ? scan.scanned_at.slice(0, 10) : '');
      if (!date) continue;
      ((seen[scan.group_id] ??= {})[date] ??= new Set()).add(scan.student_id);
    }
    const attendance: Record<string, GroupAttendance> = {};
    for (const [gid, byDate] of Object.entries(seen)) {
      const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));
      const presentByDate: Record<string, number> = {};
      const presentByStudent: Record<string, number> = {};
      for (const date of dates) {
        const set = byDate[date]!;
        presentByDate[date] = set.size;
        for (const sid of set) presentByStudent[sid] = (presentByStudent[sid] ?? 0) + 1;
      }
      attendance[gid] = { dates, presentByDate, presentByStudent };
    }

    /**
     * Teacher names come from `student_groups.teacher_id` — the true outside-
     * teacher pointer — resolved through `users`. The previous slot-derived
     * lookup keyed off `schedule_slots.teacher_id`, which handleAddSlot fills
     * with the CREATING ADMIN's user id, so it displayed the admin who typed
     * the slot as the group's teacher. A group whose teacher_id resolves to no
     * users row shows no teacher rather than a guess.
     */
    const teacherNameById: Record<string, string> = {};
    const teacherIds = [...new Set(groupsData.map((g) => g.teacher_id).filter((v): v is string => !!v))];
    if (teacherIds.length > 0) {
      const { data: usersData } = await dbSelect({
        table: 'users',
        select: 'id, name',
        filters: [{ column: 'id', op: 'in', value: teacherIds }],
      });
      for (const u of (usersData || []) as { id: string; name: string | null }[]) {
        if (u.name && u.name.trim()) teacherNameById[u.id] = u.name.trim();
      }
    }

    setGroups(groupsData.map((g) => {
      const n = byGroup[g.id]?.length ?? 0;
      return {
        ...g,
        subject: g.subject ?? null,
        member_count: n,
        student_count: n,
        teacher_name: g.teacher_id ? teacherNameById[g.teacher_id] ?? null : null,
        schedule: scheduleByGroup[g.id],
      };
    }));
    setStudents(studentsData);
    setSubjects(subjectsData);
    setMembersByGroup(byGroup);
    setAttendanceByGroup(attendance);
    setIsLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!detailGroup) {
      setActiveTab('members');
      setPickerOpen(false);
      setAddMemberSearch('');
    }
  }, [detailGroup]);

  const loadWaitlist = useCallback(async (groupId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`/api/groups/${groupId}/waitlist`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    setWaitlist(data?.waitlist ?? []);
  }, []);

  useEffect(() => {
    if (!detailGroup) { setMembers([]); setStudentOtherGroups({}); setWaitlist([]); setMemberBalances(new Map()); return; }
    const ids = membersByGroup[detailGroup.id] ?? [];
    setMembers(ids.map((id) => ({
      student_id: id,
      student_name: students.find((st) => st.id === id)?.name || '',
    })));

    const map: Record<string, string[]> = {};
    for (const [gid, studentIds] of Object.entries(membersByGroup)) {
      if (gid === detailGroup.id) continue;
      const g = groups.find((gr) => gr.id === gid);
      if (!g) continue;
      for (const sid of studentIds) (map[sid] ??= []).push(g.name);
    }
    setStudentOtherGroups(map);

    let cancelled = false;
    void (async () => {
      // Merged-Center-Groups §01 member row: a per-member balance badge, same
      // real-time helper the roster/detail pages already use — not a new
      // per-student payment concept.
      const balances = ids.length > 0 ? await getStudentBalances(supabase, { studentIds: ids }) : new Map();
      if (!cancelled) setMemberBalances(balances);
    })();

    // Design (§01 Detail · Waitlist): the tab and its count are always drawn,
    // so the list is always loaded. The auto-notify on removal keeps its own
    // capacity guard — a group with no cap never "opens a seat".
    loadWaitlist(detailGroup.id);
    return () => { cancelled = true; };
  }, [detailGroup, students, groups, membersByGroup, loadWaitlist]);

  const studentsForAddInDetail = useMemo(() => {
    const alreadyInGroup = new Set(members.map(m => m.student_id));
    let list = students.filter(s => !alreadyInGroup.has(s.id));
    if (addMemberSearch.trim()) {
      const q = addMemberSearch.trim().toLowerCase();
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.student_number || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, members, addMemberSearch]);

  const inviteUrlFor = (groupId: string) =>
    `https://tutoringhq.app/${locale}/join/${centerCode ?? centerId ?? ''}/${groupId}`;

  /**
   * What the invite row DISPLAYS. The design's `thq.eg/j/PHY10` short domain
   * does not exist — it is an externality behind the ONE env key
   * NEXT_PUBLIC_INVITE_LINK_BASE (unset live). When the domain is registered
   * and the env set, the row shows `{base}/{code}/{groupId}`; until then it
   * shows the real canonical URL. The COPY button always writes the canonical
   * working URL either way — the display never shortens what gets shared.
   */
  const inviteDisplayFor = (groupId: string) => {
    const base = (process.env.NEXT_PUBLIC_INVITE_LINK_BASE ?? '').trim().replace(/\/+$/, '');
    if (!base) return inviteUrlFor(groupId);
    return `${base}/${centerCode ?? centerId ?? ''}/${groupId}`;
  };

  const openCreateForm = () => {
    setEditingGroupId(null);
    setAddForm({ name: '', subjectId: '', fee_per_class: '', centerCutPct: '', maxCapacity: '' });
    setNewSubjectInlineName('');
    setFormMode('create');
  };

  /**
   * Design (§01): editing a group was simply impossible — nothing on this page
   * ever ran an update against `student_groups`. The same full-screen form does
   * both, prefilled from the open group.
   *
   * The centre's cut is stored in EGP (`center_cut_egp`) and shown as a percent,
   * so it is converted back on the way in.
   */
  const openEditForm = (g: Group) => {
    const fee = Number(g.fee_per_class ?? 0);
    const cut = Number(g.center_cut_egp ?? 0);
    const pct = fee > 0 && cut > 0 ? Math.round((cut / fee) * 100) : 0;
    setEditingGroupId(g.id);
    setAddForm({
      name: g.name,
      subjectId: subjects.find((s) => s.name === g.subject)?.id ?? '',
      fee_per_class: g.fee_per_class != null ? String(g.fee_per_class) : '',
      centerCutPct: pct > 0 ? String(pct) : '',
      maxCapacity: g.max_capacity != null ? String(g.max_capacity) : '',
    });
    setNewSubjectInlineName('');
    setFormMode('edit');
  };

  const handleSubmitGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !isUuid(centerId)) {
      toast.error(tToast('error'), t('pleaseWait'));
      return;
    }
    if (!addForm.name.trim()) {
      toast.error(tToast('error'), t('groupNameRequired'));
      return;
    }
    if (!addForm.subjectId || addForm.subjectId === NEW_SUBJECT_VALUE) {
      toast.error(tToast('error'), t('subjectRequired'));
      return;
    }
    const fee = Number(addForm.fee_per_class);
    // student_groups_center_priced_chk: a centre-run group must carry a fee > 0.
    if (isNaN(fee) || fee <= 0) {
      toast.error(tToast('error'), t('validFeeRequired'));
      return;
    }
    const pct = addForm.centerCutPct.trim() ? Number(addForm.centerCutPct) : 0;
    // The DB CHECK is `center_cut_egp <= fee_per_class`, i.e. 100% is legal.
    // The old client rule rejected equality and was stricter than the database
    // for no reason.
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast.error(tToast('error'), t('centerCutPctInvalid'));
      return;
    }
    const centerCut = Math.round(fee * pct) / 100;
    const subjectName = subjects.find(s => s.id === addForm.subjectId)?.name ?? '';
    const maxCap = addForm.maxCapacity.trim() ? parseInt(addForm.maxCapacity, 10) : null;
    const cappedValue = maxCap && maxCap > 0 ? maxCap : null;

    // MONEY GUARD: `studentBalance.ts` prices PAST attended sessions at the
    // CURRENT fee_per_class, so editing the fee retroactively reprices
    // history — every member's amount due changes for sessions already taken.
    // The edit is allowed (same form, per the design) but never silently.
    if (formMode === 'edit' && editingGroupId) {
      const prevFee = Number(groups.find((g) => g.id === editingGroupId)?.fee_per_class ?? 0);
      if (prevFee > 0 && fee !== prevFee && !confirm(t('feeEditRepricingWarning'))) {
        return;
      }
    }

    setIsAdding(true);
    try {
      if (formMode === 'edit' && editingGroupId) {
        const { error } = await dbUpdate({
          table: 'student_groups',
          data: {
            name: addForm.name.trim(),
            subject: subjectName,
            fee_per_class: fee,
            center_cut_egp: centerCut,
            max_capacity: cappedValue,
          },
          filters: [{ column: 'id', op: 'eq', value: editingGroupId }],
        });
        if (error) {
          Sentry.captureException(error, { tags: { feature: 'groups', action: 'update' }, extra: { centerId, groupId: editingGroupId } });
          toast.error(tToast('error'), errorDetail(error));
          setIsAdding(false);
          return;
        }
        try {
          await auditLog({ centerId, userId, action: 'group_update', entityType: 'student_groups', entityId: editingGroupId, details: { name: addForm.name.trim() } });
        } catch {}
        setGroups(prev => prev.map(g => g.id === editingGroupId
          ? { ...g, name: addForm.name.trim(), subject: subjectName, fee_per_class: fee, center_cut_egp: centerCut, max_capacity: cappedValue }
          : g));
        setDetailGroup(prev => prev && prev.id === editingGroupId
          ? { ...prev, name: addForm.name.trim(), subject: subjectName, fee_per_class: fee, center_cut_egp: centerCut, max_capacity: cappedValue }
          : prev);
        setFormMode('closed');
        setEditingGroupId(null);
        toast.success(tToast('saved'));
        return;
      }

      const { data, error } = await dbInsert({
        table: 'student_groups',
        data: { center_id: centerId, name: addForm.name.trim(), subject: subjectName, fee_per_class: fee, center_cut_egp: centerCut, max_capacity: cappedValue },
        single: true,
      });
      if (error) {
        Sentry.captureException(error, {
          tags: { feature: 'groups', action: 'create' },
          extra: { centerId, name: addForm.name },
        });
        toast.error(tToast('error'), errorDetail(error));
        setIsAdding(false);
        return;
      }
      const inserted = Array.isArray(data) ? data[0] : data;
      if (inserted?.id) {
        try {
          await auditLog({ centerId, userId, action: 'group_create', entityType: 'student_groups', entityId: inserted.id, details: { name: inserted.name } });
        } catch {}
        setGroups(prev => [...prev, { id: inserted.id, name: inserted.name, subject: subjectName, fee_per_class: fee, center_cut_egp: centerCut, member_count: 0, student_count: 0, teacher_name: null, max_capacity: cappedValue }]);
        setMembersByGroup(prev => ({ ...prev, [inserted.id]: [] }));
        setFormMode('closed');
        setAddForm({ name: '', subjectId: '', fee_per_class: '', centerCutPct: '', maxCapacity: '' });
        toast.success(tToast('saved'));
      } else {
        toast.warning(t('groupCreatedRefresh'));
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: 'groups', action: formMode === 'edit' ? 'update' : 'create' },
        extra: { centerId, name: addForm.name },
      });
      toast.error(tToast('error'), errorDetail(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!centerId || !userId || !confirm(t('deleteConfirm'))) return;
    await dbDelete({ table: 'student_group_members', filters: [{ column: 'group_id', op: 'eq', value: id }] });
    await dbDelete({ table: 'student_groups', filters: [{ column: 'id', op: 'eq', value: id }] });
    await auditLog({ centerId, userId, action: 'group_delete', entityType: 'student_groups', entityId: id });
    setGroups(prev => prev.filter(g => g.id !== id));
    setMembersByGroup(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (detailGroup?.id === id) setDetailGroup(null);
  };

  const handleAddMember = async (studentId: string) => {
    if (!detailGroup || !centerId) return;
    const student = students.find(s => s.id === studentId);
    const { error } = await dbInsert({
      table: 'student_group_members',
      data: { group_id: detailGroup.id, student_id: studentId },
      select: false,
    });
    if (!error) {
      setMembers(prev => [...prev, { student_id: studentId, student_name: student?.name || '' }]);
      setMembersByGroup(prev => ({
        ...prev,
        [detailGroup.id]: [...(prev[detailGroup.id] ?? []), studentId],
      }));
      setGroups(prev =>
        prev.map((g) =>
          g.id === detailGroup.id
            ? { ...g, member_count: (g.member_count ?? 0) + 1, student_count: (g.student_count ?? g.member_count ?? 0) + 1 }
            : g,
        ),
      );
      // A student enrolled while still on this group's waitlist would otherwise sit there
      // forever - nothing else in this codebase ever clears waitlist_group_id/waitlist_position.
      if (waitlist.some(w => w.id === studentId)) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try {
            await fetch(`/api/groups/${detailGroup.id}/waitlist`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ student_id: studentId }),
            });
            setWaitlist(prev => prev.filter(w => w.id !== studentId));
          } catch {}
        }
      }
    } else {
      Sentry.captureException(error, { tags: { feature: 'groups', action: 'add_member' }, extra: { groupId: detailGroup.id, studentId } });
      toast.error(tToast('error'), errorDetail(error));
    }
  };

  const handleRemoveMember = async (studentId: string) => {
    if (!detailGroup || !centerId) return;
    await dbDelete({
      table: 'student_group_members',
      filters: [{ column: 'group_id', op: 'eq', value: detailGroup.id }, { column: 'student_id', op: 'eq', value: studentId }],
    });
    setMembers(prev => prev.filter(m => m.student_id !== studentId));
    setMembersByGroup(prev => ({
      ...prev,
      [detailGroup.id]: (prev[detailGroup.id] ?? []).filter((id) => id !== studentId),
    }));
    setGroups(prev =>
      prev.map((g) => {
        if (g.id !== detailGroup.id) return g;
        const next = Math.max(0, (g.member_count ?? 1) - 1);
        return { ...g, member_count: next, student_count: next };
      }),
    );
    const maxCap = detailGroup.max_capacity ?? 999;
    const newCount = (detailGroup.student_count ?? detailGroup.member_count ?? 1) - 1;
    if (maxCap < 999 && newCount < maxCap) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        try {
          await fetch(`/api/groups/${detailGroup.id}/notify-waitlist`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          loadWaitlist(detailGroup.id);
        } catch {}
      }
    }
  };

  const handleCopyInviteLink = async (groupId: string) => {
    if (!centerCode && !centerId) {
      toast.error(tToast('error'));
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrlFor(groupId));
      setCopiedGroupId(groupId);
      setTimeout(() => setCopiedGroupId((v) => (v === groupId ? null : v)), 2000);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(tToast('error'));
    }
  };

  // Design (§01 New group form): the subject picker's "+ New" chip, wired the
  // same way settings/subjects/page.tsx already creates one (dbInsert + audit
  // log) - not a new pattern, just reached from a second place.
  const handleCreateSubjectInline = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSubjectInlineName.trim();
    if (!centerId || !userId || !name) return;
    setIsCreatingSubjectInline(true);
    try {
      const { data, error } = await dbInsert({ table: 'subjects', data: { center_id: centerId, name }, single: true });
      if (error) {
        toast.error(tToast('error'), errorDetail(error));
        return;
      }
      const inserted = Array.isArray(data) ? data[0] : data;
      if (inserted?.id) {
        await auditLog({ centerId, userId, action: 'subject_create', entityType: 'subjects', entityId: inserted.id, details: { name: inserted.name } });
        setSubjects(prev => [...prev, { id: inserted.id, name: inserted.name }].sort((a, b) => a.name.localeCompare(b.name)));
        setAddForm(prev => ({ ...prev, subjectId: inserted.id }));
        setNewSubjectInlineName('');
      }
    } catch (err) {
      toast.error(tToast('error'), errorDetail(err));
    } finally {
      setIsCreatingSubjectInline(false);
    }
  };

  /** Header subtitle: "8 groups · 3 subjects" — subjects DISTINCT AMONG THE GROUPS. */
  const distinctSubjectCount = useMemo(
    () => new Set(groups.map((g) => g.subject).filter(Boolean)).size,
    [groups],
  );

  const groupSheetActions = (g: Group): SheetAction[] => [
    { id: 'edit', label: t('editGroup'), icon: Pencil, onSelect: () => openEditForm(g) },
    { id: 'delete', label: t('deleteGroup'), icon: Trash2, destructive: true, onSelect: () => handleDeleteGroup(g.id) },
  ];

  const detailAttendance = detailGroup ? attendanceByGroup[detailGroup.id] ?? EMPTY_ATTENDANCE : EMPTY_ATTENDANCE;
  const detailEnrolled = detailGroup ? (detailGroup.student_count ?? detailGroup.member_count ?? 0) : 0;
  const detailHasCap =
    detailGroup?.max_capacity != null &&
    Number.isFinite(Number(detailGroup.max_capacity)) &&
    Number(detailGroup.max_capacity) > 0 &&
    Number(detailGroup.max_capacity) < 999;
  /**
   * Avg attendance across the group's sessions, as a share of ENROLLED.
   *
   * Null — rendered as an em dash, never "0%" — until a session exists. A group
   * that has not met yet has no attendance, and reading that as zero attendance
   * is the difference between "not started" and "nobody shows up".
   */
  const detailAvgPct = (() => {
    if (detailAttendance.dates.length === 0 || detailEnrolled <= 0) return null;
    const totalPresent = detailAttendance.dates.reduce((s, d) => s + (detailAttendance.presentByDate[d] ?? 0), 0);
    return Math.round((totalPresent / detailAttendance.dates.length / detailEnrolled) * 100);
  })();

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen w-full bg-[var(--color-surface-0)] space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          {isLoading ? (
            <div className="mt-1.5 h-[11px] w-[120px] rounded-xs bg-[var(--color-surface-2)] animate-pulse" aria-hidden />
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              {groups.length === 0
                ? t('headerCountEmpty')
                : t('headerCount', {
                    groups: formatNumber(groups.length, locale),
                    subjects: formatNumber(distinctSubjectCount, locale),
                  })}
            </p>
          )}
        </div>
        {/* Design (§01, line 391): the 42px icon-only teal square — same
            conversion as Branches. The label lives in aria-label + title. */}
        <button
          type="button"
          onClick={openCreateForm}
          aria-label={t('addGroup')}
          title={t('addGroup')}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white transition-colors hover:bg-teal-700 btn-press chq-focus"
        >
          <Plus size={22} aria-hidden />
        </button>
      </div>

      {isLoading ? (
        // Design (§01 Loading): four card-shaped skeletons, not a spinner — the
        // structure of this list is known before its content is.
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-live="polite">
          {[58, 50, 64, 54].map((w, i) => (
            <div key={i} className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-5" aria-hidden>
              <div className="mb-3.5 flex items-center gap-3">
                <div className="h-[34px] w-[34px] shrink-0 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 h-3.5 rounded-xs bg-[var(--color-surface-2)] animate-pulse" style={{ width: `${w}%` }} />
                  <div className="h-[11px] w-4/5 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                </div>
              </div>
              <div className="h-1.5 w-full rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        // Design (§01 Empty): a 76px mint tile, the two lines, and the CTA moved
        // out of the card into a bottom bar.
        <div className="flex min-h-[min(60vh,26rem)] flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-6 text-center">
            <div className="mb-1.5 flex h-[76px] w-[76px] items-center justify-center rounded-3xl bg-[#DFEEEB] text-[#0A514A]">
              <Layers size={34} strokeWidth={1.8} aria-hidden />
            </div>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">{tEmpty('groups.title')}</p>
            <p className="max-w-[30ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {tEmpty('groups.description')}
            </p>
          </div>
          <div className="sticky bottom-0 border-t border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
            <button
              type="button"
              onClick={openCreateForm}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] text-md font-semibold text-[var(--color-panel)] hover:bg-[var(--color-accent-deep)] btn-press chq-focus"
            >
              <Plus size={18} aria-hidden /> {t('createGroupCta')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* §02 (Center Groups Verified), design lines 676/750 — renders ONLY
              while platform_config's digital_student_fee_collection.enabled is
              true. It is false in production today, so this banner does not
              exist for any live centre; nothing about it is "coming soon". */}
          {digitalCollectionActive && (
            <div className="rounded-md border border-[rgba(14,107,97,0.2)] bg-[#DFEEEB] px-4 py-3 text-xs leading-relaxed text-[#0A514A]">
              {t('digitalCollectionNote')}
            </div>
          )}
          {digitalCollectionActive && (
            <p className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('allGroups')}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(g => {
            // Design (Merged-Center-Groups §01) shows enrolment AGAINST capacity
            // — "24/30" — not a bare headcount, because the question a center
            // asks scanning this list is "which groups still have room".
            const enrolled = g.student_count ?? g.member_count ?? 0;
            const cap = g.max_capacity;
            // 999 is the sentinel this page already treats as "no real cap"
            // (see the remove-member guard), so it is not a limit worth showing
            // a student a ratio against.
            const hasCap = cap != null && Number.isFinite(Number(cap)) && Number(cap) > 0 && Number(cap) < 999;
            const full = hasCap && enrolled >= Number(cap);
            const fillPct = hasCap ? Math.min(100, Math.round((enrolled / Number(cap)) * 100)) : null;
            const palette = subjectPalette(g.subject);
            const Glyph = SUBJECT_GLYPHS[palette.index] ?? BookOpen;
            const fee = Number(g.fee_per_class ?? 0);
            const cut = Number(g.center_cut_egp ?? 0);
            // The teacher chip is an OUTSIDE-teacher signal: it renders exactly
            // when `student_groups.teacher_id` resolved to a user. The percent
            // segment needs both a fee and a cut behind it — a cut with no fee
            // cannot be expressed as a percent, so the segment is omitted, not
            // shown as 0%. Under the §02 flag the teacher moves into the row
            // line instead, so the chip stands down.
            const showTeacherChip = !digitalCollectionActive && !!g.teacher_name;
            const showCutPct = showTeacherChip && cut > 0 && fee > 0;
            const cutPct = showCutPct ? Math.round((cut / fee) * 100) : 0;
            return (
            <div
              key={g.id}
              className="bg-[var(--color-panel)] rounded-md border border-[var(--color-line)] shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setDetailGroup(g)}
            >
              <div className="flex items-center gap-3 mb-3">
                {/* Design (§01): a 34px subject-tinted tile, one colour per
                    subject, shared with the Schedule week grid via
                    src/lib/subjectPalette.ts. Inline style because the palette
                    is resolved at runtime and Tailwind cannot express it. */}
                <div
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl"
                  style={{ background: palette.bg, color: palette.fg }}
                  aria-hidden
                >
                  <Glyph size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-[var(--color-text-primary)]">{g.name}</h3>
                  {/* Design (§01): "Sun · Tue · 4:00 PM · Room 2". Each part is
                      omitted when absent rather than shown as a placeholder, so
                      a group with no slot yet simply has no line. Under the §02
                      flag (design lines 680-702) the line is
                      "{teacher} · {n} students" instead. */}
                  {(() => {
                    if (digitalCollectionActive) {
                      const parts: string[] = [];
                      if (g.teacher_name) parts.push(g.teacher_name);
                      parts.push(t('studentsCountLine', { count: formatNumber(enrolled, locale) }));
                      return <p className="truncate text-xs text-[var(--color-text-muted)]">{parts.join(' · ')}</p>;
                    }
                    const sch = g.schedule;
                    const parts: string[] = [];
                    if (sch) {
                      for (const d of sch.days) {
                        const label = dayLabelByWeekday[d];
                        if (label) parts.push(label);
                      }
                      if (sch.startTime) parts.push(formatTime(sch.startTime, locale));
                      if (sch.roomName) parts.push(sch.roomName);
                    }
                    if (parts.length === 0) return null;
                    return <p className="truncate text-xs text-[var(--color-text-muted)]">{parts.join(' · ')}</p>;
                  })()}
                  {showTeacherChip && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-pill bg-[#F4EBD7] px-2 py-0.5 text-xs font-semibold text-[#9A6B1F]">
                      <GraduationCap size={13} aria-hidden />
                      <bdi>{g.teacher_name}</bdi>
                      {showCutPct && <> · {t('centerCutPct', { pct: formatPercent(cutPct, locale) })}</>}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSheet({ kind: 'group', group: g });
                  }}
                  className="ms-1 shrink-0 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-teal)] transition-colors"
                  aria-label={t('moreActions')}
                >
                  <MoreVertical size={18} />
                </button>
                <Chevron size={18} className="shrink-0 text-[#80827a]" aria-hidden />
              </div>
              {/* Design (§01): one row — fill bar, then 24/30, then the fee. */}
              <div className="flex items-center gap-2.5">
                {fillPct != null && (
                  <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-[var(--color-surface-2)]">
                    <div
                      className={`h-full rounded-pill ${full ? 'bg-[var(--color-danger)]' : 'bg-teal-600'}`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                )}
                <span
                  className={`font-mono text-xs tabular-nums ${full ? 'font-semibold text-[var(--color-danger)]' : 'font-semibold text-[var(--color-text-secondary)]'} ${fillPct == null ? 'flex-1' : ''}`}
                  title={full ? t('groupFull') : t('studentCount')}
                >
                  {hasCap
                    ? t('enrolledOfCapacity', {
                        count: formatNumber(enrolled, locale),
                        capacity: formatNumber(Number(cap), locale),
                      })
                    : formatNumber(enrolled, locale)}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">
                  {g.fee_per_class != null ? formatCurrency(g.fee_per_class, locale) : tCommon('notSet')}
                  {g.fee_per_class != null ? ` ${t('perLesson')}` : ''}
                </span>
              </div>
            </div>
            );
          })}
          </div>
        </>
      )}

      {/* New / edit group — a full screen, not a modal (design §01 "New group") */}
      {formMode !== 'closed' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-panel)]" dir={isRTL ? 'rtl' : 'ltr'}>
          <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
            <button
              type="button"
              onClick={() => { setFormMode('closed'); setEditingGroupId(null); }}
              className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)]"
              aria-label={tCommon('cancel')}
            >
              <X size={20} />
            </button>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {formMode === 'edit' ? t('editGroup') : t('newGroupTitle')}
            </h2>
          </div>
          <form id="group-form" onSubmit={handleSubmitGroup} className="flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">{t('groupName')}</label>
              <input
                value={addForm.name}
                onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                className="h-[46px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 text-sm text-[var(--color-text-primary)]"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">{t('subject')}</label>
              {/* Design (§01): a wrapped chip picker with a "+ New" chip in the
                  same row, not a <select>. */}
              <div className="flex flex-wrap gap-2">
                {subjects.map(s => {
                  const on = addForm.subjectId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setAddForm(prev => ({ ...prev, subjectId: s.id }))}
                      aria-pressed={on}
                      className={`rounded-pill border px-3 py-1.5 text-sm font-medium transition-colors ${
                        on
                          ? 'border-transparent bg-[#DFEEEB] text-[#0A514A]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface-0)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setAddForm(prev => ({ ...prev, subjectId: NEW_SUBJECT_VALUE }))}
                  className="rounded-pill border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-1.5 text-sm font-semibold text-teal-600"
                >
                  {t('add.newSubjectOption')}
                </button>
              </div>
              {subjects.length === 0 && (
                <RouterLink href="/settings/subjects" className="mt-1.5 inline-block text-xs text-teal-600 hover:underline">
                  {t('add.createSubjectHelper')}
                </RouterLink>
              )}
              {addForm.subjectId === NEW_SUBJECT_VALUE && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={newSubjectInlineName}
                    onChange={e => setNewSubjectInlineName(e.target.value)}
                    placeholder={t('add.newSubjectPlaceholder')}
                    className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={handleCreateSubjectInline}
                    disabled={isCreatingSubjectInline || !newSubjectInlineName.trim()}
                    className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    {tCommon('add')}
                  </button>
                </div>
              )}
            </div>
            <div>
              {/* NOT relabelled "Monthly fee": `student_groups` has no monthly
                  fee column (verified in information_schema) and calling a
                  per-lesson figure monthly would misstate money. See
                  needsMigration N1. */}
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">{t('feePerLesson')}</label>
              <div className="flex h-[46px] items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3">
                <input
                  name="fee_per_class"
                  value={addForm.fee_per_class}
                  onChange={e => setAddForm(prev => ({ ...prev, fee_per_class: e.target.value }))}
                  type="number"
                  min={0}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-[var(--color-text-primary)] outline-none"
                  required
                />
                <span className="ms-2 shrink-0 text-sm text-[var(--color-text-muted)]">{t('feeSuffixEgp')}</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">{t('capacityLabel')}</label>
              <div className="flex h-[46px] items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3">
                <input
                  value={addForm.maxCapacity}
                  onChange={e => setAddForm(prev => ({ ...prev, maxCapacity: e.target.value }))}
                  type="number"
                  min={0}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-[var(--color-text-primary)] outline-none"
                />
                <span className="ms-2 shrink-0 text-sm text-[var(--color-text-muted)]">{t('capacitySuffix')}</span>
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-sm font-medium text-[var(--color-text-primary)]">{tCut('label')}</label>
              <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">{t('centerCutHelper')}</p>
              {/* Entered and shown as a percent, stored as EGP in
                  `center_cut_egp` — the live money column. */}
              <div className="flex h-[46px] items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3">
                <input
                  value={addForm.centerCutPct}
                  onChange={e => setAddForm(prev => ({ ...prev, centerCutPct: e.target.value }))}
                  type="number"
                  min={0}
                  max={100}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-[var(--color-text-primary)] outline-none"
                />
                <span className="ms-2 shrink-0 text-sm text-[var(--color-text-muted)]">%</span>
              </div>
              {addForm.centerCutPct.trim() !== '' && (Number(addForm.centerCutPct) < 0 || Number(addForm.centerCutPct) > 100) && (
                <p className="mt-1 text-xs text-[var(--color-danger)]">{t('centerCutPctInvalid')}</p>
              )}
            </div>
          </form>
          <div className="border-t border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
            <button
              type="submit"
              form="group-form"
              disabled={isAdding}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] text-md font-semibold text-[var(--color-panel)] hover:bg-[var(--color-accent-deep)] disabled:opacity-50 btn-press chq-focus"
            >
              <Check size={18} aria-hidden />
              {formMode === 'edit' ? tCommon('save') : t('createGroup')}
            </button>
          </div>
        </div>
      )}

      {/* Group Detail Slide-over */}
      {detailGroup && (
        <div className="fixed inset-0 z-40" onClick={() => setDetailGroup(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute top-0 end-0 bottom-0 flex w-full max-w-md flex-col bg-[var(--color-panel)] border-s border-[var(--color-border)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <button
                onClick={() => setDetailGroup(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)]"
                aria-label={tCommon('close')}
              >
                <X size={20} />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">{detailGroup.name}</h2>
                {/* Design (§01 detail): days + time only — the room is on the card. */}
                {(() => {
                  const sch = detailGroup.schedule;
                  if (!sch) return null;
                  const parts: string[] = [];
                  for (const d of sch.days) {
                    const label = dayLabelByWeekday[d];
                    if (label) parts.push(label);
                  }
                  if (sch.startTime) parts.push(formatTime(sch.startTime, locale));
                  if (parts.length === 0) return null;
                  return <p className="truncate text-xs text-[var(--color-text-muted)]">{parts.join(' · ')}</p>;
                })()}
              </div>
              <button
                type="button"
                onClick={() => setSheet({ kind: 'group', group: detailGroup })}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)]"
                aria-label={t('moreActions')}
              >
                <MoreVertical size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Two bordered stat tiles */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] p-3">
                  <p className="text-xs text-[var(--color-text-muted)]">{t('enrolled')}</p>
                  <p className="font-mono text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
                    {formatNumber(detailEnrolled, locale)}
                    {detailHasCap && (
                      <span className="text-sm font-semibold text-[var(--color-text-muted)]">
                        /{formatNumber(Number(detailGroup.max_capacity), locale)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] p-3">
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {activeTab === 'waitlist' ? t('waiting') : tAtt('avgAttendance')}
                  </p>
                  <p className="font-mono text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
                    {activeTab === 'waitlist'
                      ? formatNumber(waitlist.length, locale)
                      : detailAvgPct != null
                        ? formatPercent(detailAvgPct, locale)
                        : '—'}
                  </p>
                </div>
              </div>

              {/* Invite link. Displayed text comes from inviteDisplayFor —
                  the canonical URL until NEXT_PUBLIC_INVITE_LINK_BASE exists
                  (the design's `thq.eg/j/...` domain is not registered, so no
                  short form is invented). The copy button ALWAYS copies the
                  full working canonical URL. */}
              <div className="flex items-center gap-2.5 rounded-md bg-[var(--color-surface-2)]/60 p-2.5">
                <Link2 size={18} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs text-[#0A514A]"
                  dir="ltr"
                  title={inviteUrlFor(detailGroup.id)}
                >
                  {inviteDisplayFor(detailGroup.id)}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyInviteLink(detailGroup.id)}
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)] text-[var(--color-panel)] btn-press chq-focus"
                  aria-label={t('copyLink')}
                  title={t('copyLink')}
                >
                  {copiedGroupId === detailGroup.id ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>

              {/* Heatmap — always visible, no toggle (design §01 detail) */}
              <AttendanceHeatmap
                groupId={detailGroup.id}
                groupSize={detailEnrolled}
                weeks={8}
              />

              {/* Recent sessions, capped at three */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('recentSessions')}</h3>
                  <RouterLink
                    href={`/attendance?group=${detailGroup.id}&date=${cairoDateKey()}&tab=checklist`}
                    className="text-xs font-semibold text-teal-600 hover:underline"
                  >
                    {t('seeAll')}
                  </RouterLink>
                </div>
                {detailAttendance.dates.length === 0 ? (
                  <p className="py-1 text-sm text-[var(--color-text-secondary)]">{tAtt('noDataInPeriod')}</p>
                ) : (
                  <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3.5 py-0.5">
                    {detailAttendance.dates.slice(0, 3).map((date) => (
                      <div
                        key={date}
                        className="flex items-center justify-between border-b border-[var(--color-hairline,var(--color-line))] py-2.5 last:border-b-0"
                      >
                        {/* Midday UTC, not bare "YYYY-MM-DD": a date-only string
                            parses as UTC midnight and would render as the
                            PREVIOUS day for any viewer behind UTC. Same guard
                            the heatmap's tooltip uses. */}
                        <span className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">
                          {formatDate(`${date}T12:00:00Z`, locale, { weekday: 'short', day: '2-digit', month: '2-digit' })}
                        </span>
                        <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                          {t('sessionPresent', {
                            present: formatNumber(detailAttendance.presentByDate[date] ?? 0, locale),
                            total: formatNumber(detailEnrolled, locale),
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tab bar sits directly above its own rows */}
              <div className="flex gap-1 rounded-lg bg-[var(--color-surface-2)]/50 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('members')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${activeTab === 'members' ? 'bg-[var(--color-surface-0)] shadow text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                >
                  {t('membersCount', { count: formatNumber(members.length, locale) })}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('waitlist')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${activeTab === 'waitlist' ? 'bg-[var(--color-surface-0)] shadow text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                >
                  {t('waitlistCount', { count: formatNumber(waitlist.length, locale) })}
                </button>
              </div>

              {activeTab === 'waitlist' ? (
                <>
                  {/* Accurate as written: POST /api/groups/[groupId]/notify-waitlist
                      really does send the parent a WhatsApp message, and
                      handleRemoveMember really calls it. */}
                  <p className="px-0.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                    {t('waitlistExplainer')}
                  </p>
                  <div className="space-y-2">
                    {waitlist.map((w, i) => (
                      <div key={w.id} className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-2)] font-mono text-xs font-semibold text-[var(--color-text-secondary)]" aria-hidden>
                          {formatNumber(i + 1, locale)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{w.name}</div>
                          {/* The design's "Requested 09/07 ·" half has no source:
                              `students` carries waitlist_group_id and
                              waitlist_position only. See needsMigration N2. */}
                          {w.parent_phone && (
                            <div className="mt-0.5 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">{w.parent_phone}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddMember(w.id)}
                          className="shrink-0 rounded-pill bg-[#DFEEEB] px-3 py-1.5 text-sm font-semibold text-[#0A514A] btn-press chq-focus"
                        >
                          {tCommon('add')}
                        </button>
                      </div>
                    ))}
                    {waitlist.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">{t('noWaitlist')}</p>}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  {members.map(m => {
                    const balance = memberBalances.get(m.student_id)?.balance ?? 0;
                    const owes = balance > 0;
                    const present = detailAttendance.presentByStudent[m.student_id] ?? 0;
                    const totalSessions = detailAttendance.dates.length;
                    return (
                      <div key={m.student_id} className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2.5">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#E4F0E9] text-xs font-semibold text-[#1A6D4D]"
                          aria-hidden
                        >
                          {initialsOf(m.student_name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{m.student_name}</div>
                          {/* Nothing at all when the group has never met — "0/0"
                              is not a fact about this student. */}
                          {totalSessions > 0 && (
                            <div className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                              {t('presentOfSessions', {
                                present: formatNumber(present, locale),
                                total: formatNumber(totalSessions, locale),
                              })}
                            </div>
                          )}
                        </div>
                        {/* Same real-time balance model as the roster/detail pages
                            (getStudentBalances) — never a per-student payment_status read. */}
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold"
                          style={owes ? { background: '#F4E5E2', color: '#9C3322' } : { background: '#E4F0E9', color: '#1A6D4D' }}
                        >
                          {owes ? <span aria-hidden>■</span> : <Check size={12} strokeWidth={2.5} aria-hidden />}
                          {owes ? t('memberOverdue') : t('memberPaid')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSheet({ kind: 'member', studentId: m.student_id, name: m.student_name })}
                          className="shrink-0 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-teal)]"
                          aria-label={t('moreActions')}
                        >
                          <MoreVertical size={16} />
                        </button>
                      </div>
                    );
                  })}
                  {members.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">{t('noMembers')}</p>}
                </div>
              )}

              {/* KEPT against the design: the student picker.
                  `Merged-Design-Patterns` has no form/picker bottom-sheet
                  primitive — ActionSheet takes SheetAction[] only and Modal is
                  centre-screen — and forking one is explicitly not allowed. The
                  bottom bar below is the design's entry point; this is the list
                  it opens, in place rather than in a sheet. Removing it would
                  leave "Add member" with nothing to open. */}
              {pickerOpen && (
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] p-3">
                  <div className="relative mb-2">
                    <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-muted)]" />
                    <input
                      value={addMemberSearch}
                      onChange={e => setAddMemberSearch(e.target.value)}
                      placeholder={t('searchStudents')}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] py-2 ps-9 pe-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
                    />
                  </div>
                  <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                    {studentsForAddInDetail
                      .filter(s => activeTab !== 'waitlist' || !waitlist.some(w => w.id === s.id))
                      .map(s => {
                        const otherGroups = studentOtherGroups[s.id] || [];
                        const suffix = otherGroups.length > 0 ? ` (${otherGroups.join(', ')})` : '';
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={async () => {
                              if (activeTab === 'waitlist') {
                                const { data: { session } } = await supabase.auth.getSession();
                                if (!session) return;
                                await fetch(`/api/groups/${detailGroup.id}/waitlist`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                                  body: JSON.stringify({ student_id: s.id }),
                                });
                                loadWaitlist(detailGroup.id);
                              } else {
                                handleAddMember(s.id);
                              }
                            }}
                            className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/20"
                          >
                            + <bdi>{s.name}{suffix}</bdi>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <RecordActionBar
              primaryLabel={
                pickerOpen
                  ? t('hidePicker')
                  : activeTab === 'waitlist'
                    ? t('addToWaitlist')
                    : t('addMember')
              }
              primaryIcon={activeTab === 'waitlist' ? Plus : UserPlus}
              onPrimary={() => setPickerOpen((v) => !v)}
              onMore={() => setSheet({ kind: 'group', group: detailGroup })}
              moreLabel={t('moreActions')}
            />
          </div>
        </div>
      )}

      {/* One shared sheet — the card three-dot, the detail three-dot, the
          action bar's More and every member row all open THIS. */}
      <ActionSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheet?.kind === 'member' ? sheet.name : sheet?.kind === 'group' ? sheet.group.name : ''}
        actions={
          sheet?.kind === 'group'
            ? groupSheetActions(sheet.group)
            : sheet?.kind === 'member'
              ? [{
                  id: 'remove',
                  label: t('remove'),
                  icon: Users,
                  destructive: true,
                  onSelect: () => handleRemoveMember(sheet.studentId),
                }]
              : []
        }
      />
    </div>
  );
}
