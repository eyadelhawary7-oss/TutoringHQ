'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { Plus, DoorOpen, X, MoreVertical, Users, Pencil, Trash2 } from 'lucide-react';
import { ActionSheet, type SheetAction } from '@/components/patterns';
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
   * The writer stores `schedule_slots.day_of_week` as a JS weekday in text and
   * `scheduleSlotsDayOfWeek` is the single helper for reading it, so this is a
   * genuine same-day count — the design's "3 today" chip, not a weekly total.
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
  const [centerName, setCenterName] = useState<string>('');
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCapacity, setAddCapacity] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [sheetRoom, setSheetRoom] = useState<Room | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);
    setUserId(meData.user.id);

    // Design (§03): the subtitle is the BRANCH NAME ("Al-Nahda"), and the room
    // count moves into the body. `centers` is direct-scoped on `id` in
    // dbProxyScope, so this select is already permitted.
    const [centerRes, roomsRes] = await Promise.all([
      dbSelect({
        table: 'centers',
        select: 'name',
        filters: [{ column: 'id', op: 'eq', value: cid }],
        single: true,
      }),
      dbSelect({
        table: 'rooms',
        select: 'id, name, capacity',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
    ]);
    const centerRow = Array.isArray(centerRes.data) ? centerRes.data[0] : centerRes.data;
    setCenterName((centerRow as { name?: string | null } | null)?.name ?? '');

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
      setAddError(t('roomNameRequired'));
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
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom || !centerId || !userId || !editName.trim()) {
      setEditError(t('roomNameRequired'));
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
    await dbDelete({
      table: 'rooms',
      filters: [
        { column: 'id', op: 'eq', value: roomId },
        { column: 'center_id', op: 'eq', value: centerId },
      ],
    });
    await auditLog({ centerId, userId, action: 'room_delete', entityType: 'rooms', entityId: roomId });
    setRooms(prev => prev.filter(r => r.id !== roomId));
    setConfirmDeleteId(null);
    setIsDeleting(false);
  };

  const roomSheetActions = (room: Room): SheetAction[] => [
    { id: 'edit', label: tCommon('edit'), icon: Pencil, onSelect: () => openEdit(room) },
    { id: 'delete', label: t('delete'), icon: Trash2, destructive: true, onSelect: () => setConfirmDeleteId(room.id) },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          {centerName && (
            <p className="truncate text-sm text-[var(--color-text-secondary)] mt-0.5">{centerName}</p>
          )}
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
        {!isLoading && rooms.length > 0 && (
          <>
            <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
              {t('subtitleCount', { count: formatNumber(rooms.length, locale) })}
            </p>
            {/* Design (§03): two columns at every width — these cards are a
                fixed 118px tile, not a responsive card. */}
            <div className="grid grid-cols-2 gap-4">
              {rooms.map((r) => (
                <div key={r.id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="rounded-lg bg-teal-100 p-2">
                      <DoorOpen className="h-5 w-5 text-teal-600" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setSheetRoom(r)}
                      className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
                      aria-label={t('moreActions')}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                  <h3 className="truncate font-semibold text-[var(--color-text-primary)]">{r.name}</h3>
                  {/* `rooms.capacity` defaults to 0 in the live catalog. The
                      design has no empty-capacity state and "0 seats" would be
                      a claim about the room, so an unset capacity draws nothing. */}
                  {r.capacity != null && Number.isFinite(Number(r.capacity)) && Number(r.capacity) > 0 && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
                      <Users size={14} aria-hidden />
                      <span className="font-mono tabular-nums">
                        {t('seatsValue', { count: formatNumber(Number(r.capacity), locale) })}
                      </span>
                    </p>
                  )}
                  <span
                    className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      (r.schedule_count ?? 0) > 0
                        ? 'bg-teal-500/12 text-teal-700'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {(r.schedule_count ?? 0) > 0 && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#1A6D4D]" aria-hidden />
                    )}
                    {(r.schedule_count ?? 0) > 0
                      ? t('sessionsToday', { count: formatNumber(Number(r.schedule_count), locale) })
                      : t('freeToday')}
                  </span>
                  {/* KEPT against the design, deliberately.
                      `schedule_slots_room_id_fkey` is ON DELETE CASCADE
                      (verified in pg_constraint), so deleting a room silently
                      deletes every session scheduled in it. Without this strip
                      one tap destroys a centre's schedule with no warning and
                      no error to recover from. */}
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
                </div>
              ))}
            </div>
          </>
        )}

        {rooms.length === 0 && !isLoading && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-16 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-[#E2DDD1] bg-[#FFFDF8] text-teal-700">
              <DoorOpen size={42} strokeWidth={1.6} aria-hidden />
            </div>
            <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">{t('noRoomsTitle')}</p>
            <p className="max-w-[32ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {t('noRoomsDescription')}
            </p>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="mt-3 inline-flex h-[46px] items-center gap-2 rounded-md bg-[var(--color-accent)] px-5 text-md font-semibold text-[var(--color-panel)] hover:bg-[var(--color-accent-deep)] btn-press chq-focus"
            >
              <Plus size={18} aria-hidden /> {t('addRoom')}
            </button>
          </div>
        )}
      </div>

      {/* Add Room */}
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
                  placeholder={t('capacityPlaceholder')}
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

      {/* Edit Room */}
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
                  placeholder={t('capacityPlaceholder')}
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

      {/* The shared three-dot sheet — this screen was one of the three named
          non-adopters in design/PER-FILE-PROMPT.md. */}
      <ActionSheet
        open={sheetRoom !== null}
        onClose={() => setSheetRoom(null)}
        title={sheetRoom?.name ?? ''}
        actions={sheetRoom ? roomSheetActions(sheetRoom) : []}
      />
    </div>
  );
}
