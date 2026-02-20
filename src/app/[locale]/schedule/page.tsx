'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { Plus, Clock, X, AlertTriangle } from 'lucide-react';

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
  day_of_week: number | string;
  start_time: string;
  end_time: string;
  recurring?: boolean;
  room_name?: string;
  group_name?: string;
}

const DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
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

  const canEdit = user?.role === 'owner' || user?.role === 'admin';

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
      dbSelect({ table: 'schedule_slots', select: 'id, room_id, group_id, day_of_week, start_time, end_time, recurring', filters: [{ column: 'center_id', op: 'eq', value: cid }] }),
    ]);

    const roomsData = (roomsRes.data || []) as Room[];
    const groupsData = (groupsRes.data || []) as Group[];
    const slotsData = (slotsRes.data || []) as ScheduleSlot[];

    setRooms(roomsData);
    setGroups(groupsData);
    setSlots(slotsData.map(s => ({
      ...s,
      room_name: roomsData.find(r => r.id === s.room_id)?.name ?? '',
      group_name: s.group_id ? groupsData.find(g => g.id === s.group_id)?.name ?? '' : '',
    })));
    setIsLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const hasConflict = useMemo(() => {
    if (!formRoomId) return false;
    const startM = timeToMinutes(formStart);
    const endM = timeToMinutes(formEnd);
    return slots.some(s =>
      s.room_id === formRoomId &&
      Number(s.day_of_week) === formDay &&
      timeToMinutes(s.start_time) < endM &&
      timeToMinutes(s.end_time) > startM
    );
  }, [slots, formRoomId, formDay, formStart, formEnd]);

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

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-foreground">
          {t('title')}
          {(user?.role === 'assistant' || user?.role === 'teacher') && hasPermission('can_view_schedule') && (
            <span className="text-base font-normal text-muted-foreground ms-2">{t('viewOnly')}</span>
          )}
        </h1>
        {canEdit && (
          <button
            onClick={() => { setShowAddModal(true); setSlotError(''); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: 'hsl(var(--primary))' }}
          >
            <Plus size={14} /> {t('addSession')}
          </button>
        )}
      </div>

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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {DAY_ORDER.map(day => {
            const daySlots = slots.filter(s => Number(s.day_of_week) === day);
            const color = DAY_COLORS[day];
            return (
              <div key={day} className="ch-card overflow-hidden">
                <div className="px-3 py-2 text-xs font-bold text-white text-center" style={{ background: color }}>
                  {t(DAY_KEYS[day])}
                </div>
                <div className="p-2 space-y-2 min-h-[80px]">
                  {daySlots.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">{t('noSlots')}</p>
                  ) : daySlots.map(slot => (
                    <div key={slot.id} className="rounded-lg p-2 text-xs" style={{ background: `${color}15`, borderInlineStart: `3px solid ${color}` }}>
                      <div className="font-semibold text-foreground truncate">{slot.group_name || '—'}</div>
                      <div className="text-muted-foreground">{slot.room_name || '—'}</div>
                      <div className="flex items-center gap-1 text-muted-foreground mt-1">
                        <Clock size={10} />
                        <span className="font-mono">{formatTimeForDisplay(slot.start_time)}{'\u2013'}{formatTimeForDisplay(slot.end_time)}</span>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteSlot(slot.id); }}
                          className="mt-2 text-red-600 hover:text-red-700 text-[10px] font-medium"
                        >
                          {t('delete')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rooms.length === 0 && !isLoading && (
        <p className="text-muted-foreground py-8 text-center">{t('noRooms')}</p>
      )}

      {/* Add Session Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-card rounded-2xl border border-border shadow-xl p-6 max-w-sm mx-4 w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">{t('addSession')}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddSlot} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('group')}</label>
                <select
                  value={formGroupId}
                  onChange={e => setFormGroupId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                >
                  <option value="">{tCommon('select')}</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('room')}</label>
                <select
                  value={formRoomId}
                  onChange={e => setFormRoomId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                >
                  <option value="">{tCommon('select')}</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.capacity != null ? ` (${r.capacity})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('day')}</label>
                <select
                  value={formDay}
                  onChange={e => setFormDay(Number(e.target.value))}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {DAY_ORDER.map(d => <option key={d} value={d}>{t(DAY_KEYS[d])}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t('startTime')}</label>
                  <input
                    type="time"
                    value={formStart}
                    onChange={e => setFormStart(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t('endTime')}</label>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={e => setFormEnd(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
                <span className="text-sm text-foreground">{t('recurring')}</span>
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
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted">{tCommon('cancel')}</button>
                <button type="submit" disabled={!formGroupId || !formRoomId || hasConflict || isSubmitting} className="px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>{tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
