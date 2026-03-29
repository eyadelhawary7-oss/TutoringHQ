'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { Plus, Clock, X, AlertTriangle } from 'lucide-react';
import EmptyState from '@/components/empty-states/EmptyState';

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

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_COLORS = ['#0D9488', '#7C3AED', '#F59E0B', '#DC2626', '#16A34A', '#0EA5E9', '#6B7280'];
const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;

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
  const [formDay, setFormDay] = useState(0);
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('11:00');
  const [formRecurring, setFormRecurring] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [slotSuccess, setSlotSuccess] = useState('');

  const isReadOnly = user?.role === 'teacher' || user?.role === 'assistant';
  const isTeacher = user?.role === 'teacher';
  const canEdit = user?.role === 'owner' || user?.role === 'admin';

  // Teacher group filter: schedule_slots has teacher_id column
  const displaySlots = useMemo(() => {
    if (!isTeacher || !userId) return slots;
    return slots.filter((s) => s.teacher_id === userId);
  }, [slots, isTeacher, userId]);

  useEffect(() => {
    if ((user?.role === 'assistant' || user?.role === 'teacher') && !hasPermission('can_view_schedule')) {
      router.replace('/dashboard');
    }
  }, [user, hasPermission, router]);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);
    setUserId(meData.user.id);

    const [roomsRes, groupsRes, slotsRes] = await Promise.all([
      dbSelect({ table: 'rooms', select: 'id, name, capacity', filters: [{ column: 'center_id', op: 'eq', value: cid }], order: { column: 'name' } }),
      dbSelect({ table: 'student_groups', select: 'id, name, subject', filters: [{ column: 'center_id', op: 'eq', value: cid }], order: { column: 'name' } }),
      dbSelect({ table: 'schedule_slots', select: 'id, room_id, group_id, teacher_id, day_of_week, start_time, end_time, recurring', filters: [{ column: 'center_id', op: 'eq', value: cid }] }),
    ]);

    const roomsData = (roomsRes.data || []) as Room[];
    const groupsData = (groupsRes.data || []) as Group[];
    const slotsData = (slotsRes.data || []) as ScheduleSlot[];
    const groupIds = groupsData.map((g) => g.id);
    const membersRes = groupIds.length > 0
      ? await dbSelect({ table: 'student_group_members', select: 'group_id', filters: [{ column: 'group_id', op: 'in' as const, value: groupIds }] })
      : { data: [] };
    const membersData = (membersRes.data || []) as { group_id: string }[];
    const memberCountByGroup: Record<string, number> = {};
    membersData.forEach((m) => {
      memberCountByGroup[m.group_id] = (memberCountByGroup[m.group_id] || 0) + 1;
    });

    setRooms(roomsData);
    setGroups(groupsData);
    setSlots(slotsData.map(s => ({
      ...s,
      room_name: roomsData.find(r => r.id === s.room_id)?.name ?? '',
      group_name: s.group_id ? groupsData.find(g => g.id === s.group_id)?.name ?? '' : '',
      member_count: s.group_id ? memberCountByGroup[s.group_id] ?? 0 : 0,
    })));
    setIsLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const hasConflict = useMemo(() => {
    if (!formRoomId) return false;
    const startM = timeToMinutes(formStart);
    const endM = timeToMinutes(formEnd);
    return displaySlots.some(s =>
      s.room_id === formRoomId &&
      Number(s.day_of_week) === formDay &&
      timeToMinutes(s.start_time) < endM &&
      timeToMinutes(s.end_time) > startM
    );
  }, [displaySlots, formRoomId, formDay, formStart, formEnd]);

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlotError('');
    if (!centerId || !userId || !formGroupId || !formRoomId) {
      setSlotError(t('roomGroupRequired', { defaultValue: 'Group and room are required' }));
      return;
    }
    if (hasConflict) {
      setSlotError(t('conflictMessage'));
      return;
    }
    setIsSubmitting(true);
    try {
      const group = groups.find(g => g.id === formGroupId);
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
        setSlotError(typeof error === 'object' && error?.message ? String(error.message) : String(error));
        setIsSubmitting(false);
        return;
      }
      if (data) {
        const slot = data as ScheduleSlot;
        await auditLog({ centerId, userId, action: 'schedule_slot_create', entityType: 'schedule_slots', entityId: slot.id, details: {} });
        setShowAddModal(false);
        setFormGroupId('');
        setFormRoomId('');
        setSlotError('');
        setSlotSuccess(t('slotSaved'));
        setTimeout(() => setSlotSuccess(''), 4000);
        await loadData();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSlot = async (id: string) => {
    if (!centerId || !userId || !confirm(t('deleteConfirm'))) return;
    await dbDelete({ table: 'schedule_slots', filters: [{ column: 'id', op: 'eq', value: id }] });
    await auditLog({ centerId, userId, action: 'schedule_slot_delete', entityType: 'schedule_slots', entityId: id });
    setSlots(prev => prev.filter(s => s.id !== id));
  };

  if ((user?.role === 'assistant' || user?.role === 'teacher') && !hasPermission('can_view_schedule')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  const [selectedDay, setSelectedDay] = useState(0);
  const HOURS = Array.from({ length: 15 }, (_, i) => i + 8);

  const getSlotsInCell = (day: number, hour: number) =>
    displaySlots.filter(s => {
      if (Number(s.day_of_week) !== day) return false;
      const startM = timeToMinutes(s.start_time);
      const endM = timeToMinutes(s.end_time);
      const hourStart = hour * 60;
      const hourEnd = (hour + 1) * 60;
      return startM < hourEnd && endM > hourStart;
    });

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
  }, [displaySlots]);

  return (
    <div className="space-y-5 animate-fade-in">
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
        subtitle={(user?.role === 'assistant' || user?.role === 'teacher') && hasPermission('can_view_schedule') ? t('viewOnly', { defaultValue: 'View only' }) : undefined}
      >
        {!isReadOnly && canEdit && (
          <button
            onClick={() => { setShowAddModal(true); setSlotError(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <Plus size={16} /> {t('addSession')}
          </button>
        )}
      </PageHeader>

      {slotSuccess && (
        <div className="p-3 rounded-lg bg-green-100 border border-green-500/30 text-green-700 text-sm">
          {slotSuccess}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-16">
          <svg className="animate-spin h-8 w-8 text-teal-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
          <div className="flex gap-1 bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-xl p-1 mb-4 overflow-x-auto">
            {DAY_ORDER.map(day => (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`flex-1 min-w-[80px] px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${selectedDay === day ? 'bg-teal-600 text-white font-semibold' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-0)]'}`}
              >
                {t(DAY_KEYS[day])}
              </button>
            ))}
          </div>

          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
            <div className="grid grid-cols-8 border-b border-[var(--color-border-subtle)]">
              <div className="py-3 px-3 text-xs font-semibold text-slate-400 uppercase bg-[var(--color-surface-0)] border-e border-[var(--color-border-subtle)]">{t('time')}</div>
              {DAY_ORDER.map(day => (
                <div key={day} className={`py-3 px-3 text-xs font-semibold text-[var(--color-text-secondary)] uppercase text-center bg-[var(--color-surface-0)] border-e border-[var(--color-border-subtle)] last:border-e-0 ${selectedDay === day ? 'ring-1 ring-teal-500/30' : ''}`}>
                  {t(DAY_KEYS[day])}
                </div>
              ))}
            </div>
            {HOURS.map(hour => (
              <div key={hour} className="grid grid-cols-8 border-b border-[var(--color-border-subtle)] min-h-[60px]">
                <div className="py-3 px-3 text-xs text-slate-400 bg-[var(--color-surface-0)]/50 border-e border-[var(--color-border-subtle)] self-start pt-2">
                  {formatHour(hour)}
                </div>
                {DAY_ORDER.map(day => {
                  const cellSlots = getSlotsInCell(day, hour);
                  return (
                    <div key={day} className="border-e border-[var(--color-border-subtle)] last:border-e-0 p-1.5">
                      {cellSlots.map(slot => {
                        const isConflict = getConflictingSlotIds.has(slot.id);
                        return (
                          <div
                            key={slot.id}
                            className={`relative rounded-lg p-2 cursor-pointer transition-colors group ${isConflict ? 'bg-red-50 border border-red-300 text-red-800' : 'bg-teal-50 border border-teal-200 hover:bg-teal-100'}`}
                          >
                            {isConflict && <AlertTriangle className="w-3.5 h-3.5 absolute top-1 end-1 text-red-500" />}
                            <p className={`text-xs font-semibold truncate pe-5 ${isConflict ? 'text-red-800' : 'text-teal-800'}`}>{slot.group_name || '—'}</p>
                            <p className={`text-xs truncate ${isConflict ? 'text-red-700' : 'text-teal-600'}`}>{slot.room_name || '—'}</p>
                            <p className={`text-xs ${isConflict ? 'text-red-600' : 'text-teal-500'}`}>
                              <span dir="ltr">{formatTimeForDisplay(slot.start_time)} – {formatTimeForDisplay(slot.end_time)}</span>
                            </p>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDeleteSlot(slot.id); }}
                                className={`hidden group-hover:block absolute top-1 end-1 p-0.5 rounded ${isConflict ? 'hover:bg-red-200 text-red-700' : 'hover:bg-teal-200 text-teal-700'}`}
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

          {/* Teacher mobile list view */}
          <div className={`md:hidden ${isTeacher ? 'block' : 'hidden'}`}>
            {(() => {
              const todayIndex = new Date().getDay();
              const todaySessions = displaySlots.filter((s) => Number(s.day_of_week) === todayIndex);
              const thisWeekSessions = displaySlots.filter((s) => Number(s.day_of_week) !== todayIndex);
              return (
                <>
                  <h3 className="font-bold text-teal-700 text-sm mb-2">{t('today')}</h3>
                  {todaySessions.length === 0 && (
                    <p className="text-xs text-slate-400 mb-3">{t('noSessionsToday')}</p>
                  )}
                  {todaySessions.map((session) => (
                    <div
                      key={session.id}
                      className="bg-[var(--color-surface-1)] rounded-lg shadow-sm p-3 mb-2 border-r-4 border-teal-500"
                      dir="rtl"
                    >
                      <div className="font-mono text-teal-600 text-sm">
                        <span dir="ltr">{formatTimeForDisplay(session.start_time)} – {formatTimeForDisplay(session.end_time)}</span>
                      </div>
                      <div className="font-bold text-sm mt-0.5">{session.group_name || '—'}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {session.room_name || '—'} • {session.member_count ?? 0} طالب
                      </div>
                    </div>
                  ))}
                  <hr className="my-3" />
                  <h3 className="font-bold text-[var(--color-text-primary)] text-sm mb-2">{t('thisWeek')}</h3>
                  {thisWeekSessions.length === 0 && (
                    <p className="text-xs text-slate-400">{t('noSessionsWeek')}</p>
                  )}
                  {thisWeekSessions.map((session) => (
                    <div key={session.id} className="bg-[var(--color-surface-1)] rounded-lg shadow-sm p-3 mb-2" dir="rtl">
                      <div className="font-mono text-teal-600 text-sm">
                        <span dir="ltr">{formatTimeForDisplay(session.start_time)} – {formatTimeForDisplay(session.end_time)}</span>
                      </div>
                      <div className="font-bold text-sm mt-0.5">{session.group_name || '—'}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {session.room_name || '—'} • {session.member_count ?? 0} طالب
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </>
      )}

      {rooms.length === 0 && !isLoading && (
        <EmptyState
          icon={<Clock />}
          titleKey="rooms.title"
          descriptionKey="rooms.description"
          namespace="emptyStates"
          actionLabel="rooms.action"
          onAction={() => router.push(`/${locale}/rooms`)}
        />
      )}

      {/* Add Session Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                  onChange={e => setFormGroupId(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                  required
                >
                  <option value="">{tCommon('select')}</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('room')}</label>
                <select
                  value={formRoomId}
                  onChange={e => setFormRoomId(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                  required
                >
                  <option value="">{tCommon('select')}</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.capacity != null ? ` (${r.capacity})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('day')}</label>
                <select
                  value={formDay}
                  onChange={e => setFormDay(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                >
                  {DAY_ORDER.map(d => <option key={d} value={d}>{t(DAY_KEYS[d])}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('startTime')}</label>
                  <input
                    type="time"
                    value={formStart}
                    onChange={e => setFormStart(e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('endTime')}</label>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={e => setFormEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={formRecurring}
                  onChange={e => setFormRecurring(e.target.checked)}
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
              {slotError && !hasConflict && (
                <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{slotError}</div>
              )}
              </div>
              <div className="flex justify-end gap-3 p-6 pt-0">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors">{tCommon('cancel')}</button>
                <button type="submit" disabled={!formGroupId || !formRoomId || hasConflict || isSubmitting} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">{t('addSession')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
