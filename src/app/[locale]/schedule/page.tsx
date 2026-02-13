'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog, type Filter } from '@/lib/db-proxy';
import Navbar from '@/components/Navbar';
import { useUser } from '@/contexts/UserContext';

function isOwnerOrAdmin(role?: string): boolean {
  return role === 'owner' || role === 'admin';
}

function canEditSchedule(role?: string): boolean {
  return role === 'owner' || role === 'admin';
}

interface Room {
  id: string;
  name: string;
}

interface Subject {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
  subject: string | null;
}

interface ScheduleSlot {
  id: string;
  room_id: string;
  subject_id?: string;
  subject?: string;
  group_id?: string | null;
  teacher_id: string;
  day_of_week: number | string; // SMALLINT 0-6 or TEXT 'sat','sun','mon',...
  start_time: string;
  end_time: string;
  recurring?: boolean;
  room_name?: string;
  subject_name?: string;
  group_name?: string;
  teacher_name?: string;
}

const DAYS = [
  { d: 6, label: 'Sat', key: 'sat' },
  { d: 0, label: 'Sun', key: 'sun' },
  { d: 1, label: 'Mon', key: 'mon' },
  { d: 2, label: 'Tue', key: 'tue' },
  { d: 3, label: 'Wed', key: 'wed' },
  { d: 4, label: 'Thu', key: 'thu' },
  { d: 5, label: 'Fri', key: 'fri' },
];
const DAY_NUM_TO_KEY: Record<number, string> = Object.fromEntries(DAYS.map(x => [x.d, x.key]));

function getHoursRange(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => i + start);
}

function timeToMinutes(t: string): number {
  // Handle full ISO timestamp (e.g. "2000-01-01T09:00:00.000Z") - extract time part
  let timeStr = t;
  if (t.includes('T')) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      const h = d.getHours();
      const m = d.getMinutes();
      return h * 60 + m;
    }
    timeStr = t.split('T')[1]?.slice(0, 5) ?? t;
  }
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Format TIME column value (e.g. '09:00:00') for display as '09:00' */
function formatTimeForDisplay(t: string | undefined): string {
  if (!t) return '';
  return t.substring(0, 5);
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function SchedulePage() {
  const t = useTranslations('schedule');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(6);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const [formRoom, setFormRoom] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formRecurring, setFormRecurring] = useState(false);
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('10:00');
  const [formDay, setFormDay] = useState(6);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [slotSuccessMessage, setSlotSuccessMessage] = useState('');
  const [scheduleStartHour, setScheduleStartHour] = useState(8);
  const [scheduleEndHour, setScheduleEndHour] = useState(20);
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [editStartHour, setEditStartHour] = useState(8);
  const [editEndHour, setEditEndHour] = useState(20);
  const [isSavingHours, setIsSavingHours] = useState(false);

  const hours = getHoursRange(scheduleStartHour, scheduleEndHour);

  const canEdit = canEditSchedule(user?.role);

  useEffect(() => {
    if (user?.role === 'assistant' && !hasPermission('can_view_calendar')) {
      router.replace('/dashboard');
    }
  }, [user, hasPermission, router]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);
      setUserId(meData.user.id);

      const [centerRes, roomsRes, subjectsRes, grpRes, slotsRes] = await Promise.all([
        dbSelect({
          table: 'centers',
          select: 'schedule_start_hour, schedule_end_hour',
          filters: [{ column: 'id', op: 'eq' as const, value: meData.user.center_id }],
          single: true,
        }),
        dbSelect({
          table: 'rooms',
          select: 'id, name',
          filters: [{ column: 'center_id', op: 'eq' as const, value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'subjects',
          select: 'id, name',
          filters: [{ column: 'center_id', op: 'eq' as const, value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'student_groups',
          select: 'id, name, subject',
          filters: [{ column: 'center_id', op: 'eq' as const, value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'schedule_slots',
          select: 'id, room_id, subject, subject_id, group_id, teacher_id, day_of_week, start_time, end_time, recurring, recurring_until',
          filters: [{ column: 'center_id', op: 'eq' as const, value: meData.user.center_id }],
        }),
      ]);
      if (slotsRes?.error) console.log('Slots error:', slotsRes.error);

      if (centerRes?.data) {
        const c = centerRes.data as { schedule_start_hour?: number | null; schedule_end_hour?: number | null };
        if (c.schedule_start_hour != null) setScheduleStartHour(c.schedule_start_hour);
        if (c.schedule_end_hour != null) setScheduleEndHour(c.schedule_end_hour);
      }
      if (roomsRes.data) setRooms(roomsRes.data as Room[]);
      if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[]);
      if (grpRes?.data) setGroups(grpRes.data as Group[]);

      if (slotsRes.data) {
        const slotsData = slotsRes.data as ScheduleSlot[];
        const roomsData = (roomsRes.data || []) as Room[];
        const subjectsData = (subjectsRes.data || []) as Subject[];
        const groupsData = (grpRes?.data || []) as Group[];
        const withNames = slotsData.map((s) => ({
          ...s,
          room_name: roomsData.find((r) => r.id === s.room_id)?.name ?? '',
          subject_name: (s.subject || subjectsData.find((sub) => sub.id === s.subject_id)?.name) ?? '',
          group_name: s.group_id ? groupsData.find((g) => g.id === s.group_id)?.name ?? '' : '',
        }));
        setSlots(withNames);
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const slotsForDay = slots.filter((s) => {
    const d = s.day_of_week;
    if (typeof d === 'number') return d === selectedDay;
    const key = DAY_NUM_TO_KEY[selectedDay];
    return key === d || key === String(d).toLowerCase() || DAYS.find(x => x.label === d)?.d === selectedDay;
  });

  const scheduleTitle = t('centerSchedule');
  const showViewOnly = user?.role === 'assistant' && hasPermission('can_view_calendar');

  if (user?.role === 'assistant' && !hasPermission('can_view_calendar')) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </>
    );
  }

  const checkConflict = (
    roomId: string,
    groupId: string | null,
    day: number,
    start: string,
    end: string,
    excludeId?: string
  ): string | null => {
    const startM = timeToMinutes(start);
    const endM = timeToMinutes(end);
    for (const s of slots) {
      if (s.id === excludeId) continue;
      const slotDay = typeof s.day_of_week === 'number' ? s.day_of_week : DAYS.find(x => x.key === s.day_of_week)?.d;
      if (slotDay !== day) continue;
      const sStart = timeToMinutes(s.start_time);
      const sEnd = timeToMinutes(s.end_time);
      const overlaps = startM < sEnd && endM > sStart;
      if (overlaps && s.room_id === roomId) return t('conflict');
      if (overlaps && groupId && s.group_id === groupId) return t('conflict');
    }
    return null;
  };

  const selectedSubjectName = subjects.find((s) => s.id === formSubject)?.name ?? '';
  const filteredGroups = formSubject
    ? groups.filter((g) => g.subject === selectedSubjectName)
    : [];

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlotError('');
    if (!centerId || !userId || !formRoom || !formSubject || !formGroup) {
      setSlotError('Room, subject, and group are required');
      return;
    }
    setConflictError('');
    const conflict = checkConflict(formRoom, formGroup || null, formDay, formStart, formEnd);
    if (conflict) {
      setConflictError(conflict);
      return;
    }
    setIsSubmitting(true);
    try {
      const startTime = formStart.includes(':') && formStart.length === 5 ? formStart + ':00' : formStart;
      const endTime = formEnd.includes(':') && formEnd.length === 5 ? formEnd + ':00' : formEnd;
      const { data, error } = await dbInsert({
        table: 'schedule_slots',
        data: {
          center_id: centerId,
          room_id: formRoom,
          subject: selectedSubjectName,
          group_id: formGroup || null,
          teacher_id: userId,
          day_of_week: formDay,
          start_time: startTime,
          end_time: endTime,
          recurring: formRecurring,
        },
        single: true,
      });
      if (error) {
        console.error('[Schedule] Slot insert failed:', error);
        const errMsg = typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message: string }).message
          : String(error);
        setSlotError(errMsg);
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
          details: { room_id: formRoom, subject_id: formSubject, group_id: formGroup, day: formDay },
        });
        setShowAddModal(false);
        setFormRoom('');
        setFormSubject('');
        setFormGroup('');
        setFormRecurring(false);
        setSlotError('');
        setSlotSuccessMessage(t('slotSaved'));
        setTimeout(() => setSlotSuccessMessage(''), 4000);
        const slotsRes = await dbSelect({
          table: 'schedule_slots',
          select: 'id, room_id, subject, subject_id, group_id, teacher_id, day_of_week, start_time, end_time, recurring, recurring_until',
          filters: [{ column: 'center_id', op: 'eq' as const, value: centerId }],
        });
        if (slotsRes?.data) {
          const slotsData = slotsRes.data as ScheduleSlot[];
          console.log('All slots for center:', slotsData);
          const withNames = slotsData.map((s) => ({
            ...s,
            room_name: rooms.find((r) => r.id === s.room_id)?.name ?? '',
            subject_name: (s.subject || subjects.find((sub) => sub.id === s.subject_id)?.name) ?? '',
            group_name: s.group_id ? groups.find((g) => g.id === s.group_id)?.name ?? '' : '',
          }));
          setSlots(withNames);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSlot = async (id: string) => {
    if (!centerId || !userId || !confirm(t('deleteConfirm'))) return;
    await dbDelete({
      table: 'schedule_slots',
      filters: [{ column: 'id', op: 'eq' as const, value: id }],
    });
    await auditLog({ centerId, userId, action: 'schedule_slot_delete', entityType: 'schedule_slots', entityId: id });
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const getSlotAt = (roomId: string, hour: number) => {
    const startM = hour * 60;
    const endM = (hour + 1) * 60;
    return slotsForDay.find((s) => {
      if (s.room_id !== roomId) return false;
      const sStart = timeToMinutes(s.start_time);
      const sEnd = timeToMinutes(s.end_time);
      return startM < sEnd && endM > sStart;
    });
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {scheduleTitle}
              {showViewOnly && <span className="text-base font-normal text-gray-500 dark:text-gray-400 ml-2">{t('viewOnly')}</span>}
            </h1>
            <div className="flex gap-2">
              {canEdit && (
                <>
                  <button
                    onClick={() => {
                      setEditStartHour(scheduleStartHour);
                      setEditEndHour(scheduleEndHour);
                      setShowHoursModal(true);
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('workingHours')}
                  </button>
                  <button
                    onClick={() => {
                      setFormDay(selectedDay);
                      setShowAddModal(true);
                      setConflictError('');
                      setSlotError('');
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    {t('addSlot')}
                  </button>
                </>
              )}
            </div>
          </div>

          {slotSuccessMessage && (
            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm">
              {slotSuccessMessage}
            </div>
          )}
          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <>
              <div className="flex gap-1 mb-4">
                {DAYS.map(({ d, label }) => (
                  <button
                    key={d}
                    onClick={() => setSelectedDay(d)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      selectedDay === d
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse bg-white dark:bg-gray-800 rounded-lg shadow">
                  <thead>
                    <tr>
                      <th className="w-16 p-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-gray-700">
                        Time
                      </th>
                      {rooms.map((r) => (
                        <th key={r.id} className="p-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-gray-700 min-w-[120px]">
                          {r.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map((hour) => (
                      <tr key={hour}>
                        <td className="p-2 text-xs text-gray-600 dark:text-gray-400 border-r border-b border-gray-200 dark:border-gray-700">
                          {formatTime(hour * 60)}
                        </td>
                        {rooms.map((room) => {
                          const slot = getSlotAt(room.id, hour);
                          return (
                            <td
                              key={room.id}
                              className="p-1 border-r border-b border-gray-200 dark:border-gray-700 min-h-[48px] align-top"
                            >
                              {slot && (
                                <div
                                  className="text-xs p-2 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-200"
                                  title={`${formatTimeForDisplay(slot.start_time)} - ${formatTimeForDisplay(slot.end_time)} ${slot.group_name ? `| ${slot.group_name} - ${slot.room_name}` : `| ${slot.subject_name ?? ''}`}`}
                                >
                                  <div className="font-medium truncate">
                                    {slot.group_name ? `${slot.group_name} - ${slot.room_name}` : `${slot.subject_name ?? ''} - ${slot.room_name ?? ''}`}
                                  </div>
                                  {slot.recurring && (
                                    <span className="text-indigo-500" title={t('recurring')}>↻</span>
                                  )}
                                  {canEdit && (
                                    <button
                                      onClick={() => handleDeleteSlot(slot.id)}
                                      className="mt-1 text-red-600 hover:underline"
                                    >
                                      {tCommon('delete')}
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rooms.length === 0 && !isLoading && (
                <p className="text-gray-500 dark:text-gray-400 py-8">{t('noRooms')}</p>
              )}
            </>
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('addSlot')}</h2>
            <form onSubmit={handleAddSlot} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('day')}</label>
                <select
                  value={formDay}
                  onChange={(e) => setFormDay(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  {DAYS.map(({ d, label }) => (
                    <option key={d} value={d}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('subject')}</label>
                <select
                  value={formSubject}
                  onChange={(e) => { setFormSubject(e.target.value); setFormGroup(''); }}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  <option value="">{tCommon('select')}</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('group')}</label>
                <select
                  value={formGroup}
                  onChange={(e) => setFormGroup(e.target.value)}
                  required
                  disabled={!formSubject}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white disabled:opacity-50"
                >
                  <option value="">{formSubject ? tCommon('select') : '—'}</option>
                  {filteredGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('room')}</label>
                <select
                  value={formRoom}
                  onChange={(e) => setFormRoom(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  <option value="">{tCommon('select')}</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('start')}</label>
                  <input
                    type="time"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('end')}</label>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formRecurring}
                  onChange={(e) => setFormRecurring(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{t('recurring')}</span>
              </label>
              {(conflictError || slotError) && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {conflictError || slotError}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {tCommon('loading')}
                    </>
                  ) : (
                    tCommon('save')
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  {tCommon('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Working Hours Modal */}
      {showHoursModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('workingHours')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('startHour')}</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={editStartHour}
                  onChange={(e) => setEditStartHour(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('endHour')}</label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={editEndHour}
                  onChange={(e) => setEditEndHour(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    if (!centerId || !userId || editStartHour >= editEndHour) return;
                    setIsSavingHours(true);
                    const { error } = await dbUpdate({
                      table: 'centers',
                      data: { schedule_start_hour: editStartHour, schedule_end_hour: editEndHour },
                      filters: [{ column: 'id', op: 'eq' as const, value: centerId }],
                      select: false,
                    });
                    if (!error) {
                      setScheduleStartHour(editStartHour);
                      setScheduleEndHour(editEndHour);
                      setShowHoursModal(false);
                    }
                    setIsSavingHours(false);
                  }}
                  disabled={isSavingHours || editStartHour >= editEndHour}
                  className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {tCommon('save')}
                </button>
                <button
                  onClick={() => setShowHoursModal(false)}
                  className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg"
                >
                  {tCommon('cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
