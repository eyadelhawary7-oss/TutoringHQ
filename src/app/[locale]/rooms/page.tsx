'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, dbUpdate, auditLog } from '@/lib/db-proxy';

interface Room {
  id: string;
  name: string;
  capacity: number | null;
}

export default function RoomsPage() {
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomCapacity, setNewRoomCapacity] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [saveError, setSaveError] = useState('');

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

      const roomsRes = await dbSelect({
        table: 'rooms',
        select: 'id, name, capacity',
        filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        order: { column: 'name' },
      });

      if (roomsRes.data) setRooms(roomsRes.data as Room[]);
      setIsLoading(false);
    };
    load();
  }, []);

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !newRoomName.trim()) return;
    setIsAdding(true);
    const capacity = newRoomCapacity.trim() ? parseInt(newRoomCapacity, 10) : null;
    const { data, error } = await dbInsert({
      table: 'rooms',
      data: { center_id: centerId, name: newRoomName.trim(), capacity },
      single: true,
    });
    if (!error && data) {
      await auditLog({
        centerId,
        userId,
        action: 'room_create',
        entityType: 'rooms',
        entityId: (data as Room).id,
        details: { name: (data as Room).name },
      });
      setRooms(prev => [...prev, data as Room]);
      setNewRoomName('');
      setNewRoomCapacity('');
    }
    setIsAdding(false);
  };

  const handleDeleteRoom = async (id: string) => {
    if (!centerId || !userId || !confirm(t('deleteConfirm'))) return;
    await dbDelete({
      table: 'rooms',
      filters: [{ column: 'id', op: 'eq', value: id }],
    });
    await auditLog({ centerId, userId, action: 'room_delete', entityType: 'rooms', entityId: id });
    setRooms(prev => prev.filter(r => r.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const startEdit = (r: Room) => {
    setEditingId(r.id);
    setEditName(r.name);
    setEditCapacity(r.capacity != null ? String(r.capacity) : '');
    setSaveError('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !centerId || !userId || !editName.trim()) return;
    setSaveError('');
    const capVal = editCapacity.trim();
    const capacity = capVal ? (parseInt(capVal, 10) || null) : null;
    const { error } = await dbUpdate({
      table: 'rooms',
      data: { name: editName.trim(), capacity },
      filters: [{ column: 'id', op: 'eq', value: editingId }],
      select: false,
    });
    if (!error) {
      setRooms(prev => prev.map(r => r.id === editingId ? { ...r, name: editName.trim(), capacity } : r));
      setEditingId(null);
      await auditLog({
        centerId,
        userId,
        action: 'room_update',
        entityType: 'rooms',
        entityId: editingId,
        details: { name: editName.trim(), capacity },
      });
    } else {
      setSaveError(typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message: string }).message
        : String(error));
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('title')}</h1>

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-6">
              <form onSubmit={handleAddRoom} className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 max-w-md">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('createRoom')}</h2>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder={t('roomName')}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    required
                  />
                  <input
                    type="number"
                    min="1"
                    value={newRoomCapacity}
                    onChange={(e) => setNewRoomCapacity(e.target.value)}
                    placeholder={t('capacity')}
                    className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="mt-3 w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {tCommon('add')}
                </button>
              </form>

              {saveError && (
                <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm">
                  {saveError}
                </div>
              )}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('allRooms')}</h2>
                <div className="flex flex-col gap-3">
                  {rooms.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50"
                    >
                      {editingId === r.id ? (
                        <div className="flex-1 flex flex-wrap gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 min-w-0 px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:text-white"
                          />
                          <input
                            type="number"
                            min="1"
                            value={editCapacity}
                            onChange={(e) => setEditCapacity(e.target.value)}
                            placeholder={t('capacity')}
                            className="w-20 px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:text-white"
                          />
                          <button onClick={handleSaveEdit} className="text-green-600 dark:text-green-400 text-sm font-medium">
                            {tCommon('save')}
                          </button>
                          <button onClick={cancelEdit} className="text-gray-500 dark:text-gray-400 text-sm">
                            {tCommon('cancel')}
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-xl font-mono text-gray-900 dark:text-white truncate">
                              {r.name}
                            </span>
                            {r.capacity != null && (
                              <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
                                ({t('capacity')}: {Number(r.capacity).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en')})
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => startEdit(r)}
                              className="px-3 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                            >
                              {tCommon('edit')}
                            </button>
                            <button
                              onClick={() => handleDeleteRoom(r.id)}
                              className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                            >
                              {tCommon('delete')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {rooms.length === 0 && (
                  <p className="text-gray-500 dark:text-gray-400 py-4">{t('noRooms')}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
