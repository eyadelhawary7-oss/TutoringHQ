'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { Plus, DoorOpen, X, MoreVertical } from 'lucide-react';
import { formatNumber } from '@/lib/formatNumber';
import { cairoDateKey } from '@/lib/cairo/day';
import { scheduleSlotsDayOfWeek } from '@/lib/cairo/week';

interface Room {
  id: string;
  name: string;
  capacity: number | null;
  /**
   * Slots booked in this room TODAY, in Cairo.
   *
   * Was a whole-week count while `schedule_slots.day_of_week` had two
   * incompatible readers in the codebase. That is settled: the writer stores a
   * JS weekday as text, and `scheduleSlotsDayOfWeek` is the single helper for
   * it. So the chip now says what the design says.
   */
  schedule_count?: number;
}

export default function RoomsPage() {
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCapacity, setAddCapacity] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const onClickAway = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [openMenuId]);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);
    setUserId(meData.user.id);

    const roomsRes = await dbSelect({
      table: 'rooms',
      select: 'id, name, capacity',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
      order: { column: 'name' },
    });

    const roomsData = (roomsRes.data || []) as Room[];
    // Cairo day, not the browser's: a centre open past midnight would otherwise
    // still see the previous day's bookings.
    const todayDow = scheduleSlotsDayOfWeek(cairoDateKey());
    const { data: slotsData } = await dbSelect({
      table: 'schedule_slots',
      select: 'room_id',
      filters: [
        { column: 'center_id', op: 'eq', value: cid },
        { column: 'day_of_week', op: 'eq', value: todayDow },
      ],
    });

    const countByRoom: Record<string, number> = {};
    for (const s of (slotsData || []) as { room_id: string }[]) {
      countByRoom[s.room_id] = (countByRoom[s.room_id] ?? 0) + 1;
    }

    setRooms(roomsData.map(r => ({ ...r, schedule_count: countByRoom[r.id] ?? 0 })));
    setIsLoading(false);
  };

  useEffect(() => {
    const id = setTimeout(() => loadData(), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (searchParams?.get('action') === 'add') {
      setShowAddModal(true);
    }
  }, [searchParams]);

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    if (!centerId || !userId || !addName.trim()) {
      setAddError(t('roomNameRequired', { defaultValue: 'Room name is required' }));
      return;
    }
    setIsAdding(true);
    const capacity = addCapacity.trim() ? parseInt(addCapacity, 10) : null;
    const { data, error } = await dbInsert({
      table: 'rooms',
      data: { center_id: centerId, name: addName.trim(), capacity },
      single: true,
    });
    if (error) {
      setAddError(typeof error === 'object' && error?.message ? String(error.message) : 'Failed to create room');
      setIsAdding(false);
      return;
    }
    if (data) {
      const inserted = data as Room;
      await auditLog({ centerId, userId, action: 'room_create', entityType: 'rooms', entityId: inserted.id, details: { name: inserted.name } });
      setRooms(prev => [...prev, { ...inserted, schedule_count: 0 }]);
      setShowAddModal(false);
      setAddName('');
      setAddCapacity('');
    }
    setIsAdding(false);
  };

  const openEdit = (room: Room) => {
    setEditingRoom(room);
    setEditName(room.name);
    setEditCapacity(room.capacity != null ? String(room.capacity) : '');
    setEditError('');
    setOpenMenuId(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom || !centerId || !userId || !editName.trim()) {
      setEditError(t('roomNameRequired', { defaultValue: 'Room name is required' }));
      return;
    }
    setIsSaving(true);
    setEditError('');
    const capacity = editCapacity.trim() ? parseInt(editCapacity, 10) : null;
    const { error } = await dbUpdate({
      table: 'rooms',
      data: { name: editName.trim(), capacity },
      filters: [
        { column: 'id', op: 'eq', value: editingRoom.id },
        { column: 'center_id', op: 'eq', value: centerId },
      ],
    });
    if (error) {
      setEditError(typeof error === 'object' && error?.message ? String(error.message) : 'Failed to update room');
      setIsSaving(false);
      return;
    }
    await auditLog({ centerId, userId, action: 'room_update', entityType: 'rooms', entityId: editingRoom.id, details: { name: editName.trim(), capacity } });
    setRooms(prev => prev.map(r => (r.id === editingRoom.id ? { ...r, name: editName.trim(), capacity } : r)));
    setEditingRoom(null);
    setIsSaving(false);
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!centerId || !userId) return;
    setIsDeleting(true);
    const { error } = await dbDelete({
      table: 'rooms',
      filters: [
        { column: 'id', op: 'eq', value: roomId },
        { column: 'center_id', op: 'eq', value: centerId },
      ],
    });
    if (error) {
      setDeleteError(prev => ({ ...prev, [roomId]: t('deleteInUse', { defaultValue: "Couldn't delete this room — something still references it." }) }));
      setIsDeleting(false);
      return;
    }
    await auditLog({ centerId, userId, action: 'room_delete', entityType: 'rooms', entityId: roomId });
    setRooms(prev => prev.filter(r => r.id !== roomId));
    setConfirmDeleteId(null);
    setIsDeleting(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {t('subtitleCount', { count: formatNumber(rooms.length, locale) })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus size={16} /> {t('addRoom')}
        </button>
      </div>

      <div className="relative min-h-[min(50vh,20rem)]">
        {isLoading && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[var(--color-surface-0)]/80 backdrop-blur-[1px]"
            aria-busy="true"
            aria-live="polite"
          >
            <svg className="animate-spin h-8 w-8 text-teal-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((r) => (
              <div key={r.id} className="relative bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 bg-teal-100 rounded-lg">
                    <DoorOpen className="w-5 h-5 text-teal-600" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenMenuId((v) => (v === r.id ? null : r.id))}
                    className="p-1.5 hover:bg-[var(--color-surface-2)] rounded-lg text-[var(--color-text-muted)]"
                    aria-label={t('moreActions', { defaultValue: 'More' })}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {openMenuId === r.id && (
                    <div
                      ref={menuRef}
                      role="menu"
                      className="absolute end-3 top-11 z-10 w-36 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openEdit(r)}
                        className="block w-full rounded-md px-3 py-2 text-start text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                      >
                        {tCommon('edit')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setConfirmDeleteId(r.id);
                          setOpenMenuId(null);
                        }}
                        className="block w-full rounded-md px-3 py-2 text-start text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                      >
                        {t('delete')}
                      </button>
                    </div>
                  )}
                </div>
                <h3 className="font-semibold text-[var(--color-text-primary)]">{r.name}</h3>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  {r.capacity != null && Number.isFinite(Number(r.capacity))
                    ? t('maxCapacityValue', { count: formatNumber(Number(r.capacity), locale) })
                    : `${t('maxCapacity')}: -`}
                </p>
                {/* Design (Merged-Center-Groups §03) puts an in-use / free chip on
                    every room card. The count was already being fetched and
                    thrown away — see loadData. Weekly, not daily: see the note
                    on schedule_count in the Room type. */}
                <span
                  className={`mt-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    (r.schedule_count ?? 0) > 0
                      ? 'bg-teal-500/12 text-teal-700'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {(r.schedule_count ?? 0) > 0
                    ? t('sessionsToday', {
                        count: formatNumber(Number(r.schedule_count), locale),
                      })
                    : t('freeToday')}
                </span>
                {confirmDeleteId === r.id && (
                  <div className="mt-3 flex items-center gap-3 rounded-lg bg-[var(--color-surface-2)] p-2.5">
                    <p className="flex-1 text-xs text-[var(--color-text-primary)]">{t('deleteConfirm')}</p>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs font-semibold text-[var(--color-text-secondary)] hover:underline"
                    >
                      {tCommon('cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void handleDeleteRoom(r.id)}
                      className="text-xs font-semibold text-[var(--color-danger)] hover:underline disabled:opacity-50"
                    >
                      {t('confirmDelete')}
                    </button>
                  </div>
                )}
                {deleteError[r.id] && (
                  <p className="mt-2 text-xs text-[var(--color-danger)]">{deleteError[r.id]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {rooms.length === 0 && !isLoading && (
          <div className="text-center py-16 max-w-md mx-auto px-4">
            <DoorOpen className="w-12 h-12 text-[var(--color-text-secondary)] mx-auto mb-4" />
            <p className="text-[var(--color-text-primary)] font-semibold">{t('noRoomsTitle')}</p>
            <p className="text-[var(--color-text-secondary)] text-sm mt-2">{t('noRoomsDescription')}</p>
          </div>
        )}
      </div>

      {/* Add Room Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('addRoom')}</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg transition-colors"><X className="w-5 h-5 text-[var(--color-text-secondary)]" /></button>
            </div>
            <form onSubmit={handleAddRoom} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('roomName')}</label>
                <input
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('capacity')}</label>
                <input
                  type="number"
                  min={1}
                  value={addCapacity}
                  onChange={e => setAddCapacity(e.target.value)}
                  placeholder="-"
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              {addError && <p className="text-sm text-[var(--color-danger)]">{addError}</p>}
              <div className="flex justify-end gap-3 pt-0">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors">{tCommon('cancel')}</button>
                <button type="submit" disabled={isAdding} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">{tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Room Modal */}
      {editingRoom && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingRoom(null)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('editRoom')}</h2>
              <button onClick={() => setEditingRoom(null)} className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg transition-colors"><X className="w-5 h-5 text-[var(--color-text-secondary)]" /></button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('roomName')}</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('capacity')}</label>
                <input
                  type="number"
                  min={1}
                  value={editCapacity}
                  onChange={e => setEditCapacity(e.target.value)}
                  placeholder="-"
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              {editError && <p className="text-sm text-[var(--color-danger)]">{editError}</p>}
              <div className="flex justify-end gap-3 pt-0">
                <button type="button" onClick={() => setEditingRoom(null)} className="px-4 py-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors">{tCommon('cancel')}</button>
                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">{tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
