'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, auditLog } from '@/lib/db-proxy';
import { Plus, DoorOpen, X } from 'lucide-react';

interface Room {
  id: string;
  name: string;
  capacity: number | null;
  schedule_count?: number;
}

export default function RoomsPage() {
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCapacity, setAddCapacity] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');

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
    const { data: slotsData } = await dbSelect({
      table: 'schedule_slots',
      select: 'room_id',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
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

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus size={14} /> {t('addRoom')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16">
          <svg className="animate-spin h-8 w-8 text-teal-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map(r => (
            <div key={r.id} className="ch-card p-5 hover:shadow-lg transition-all">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-primary/10" style={{ color: 'hsl(var(--primary))' }}>
                  <DoorOpen size={22} />
                </div>
                <div>
                  <h3 className="font-bold text-foreground">{r.name}</h3>
                  <p className="text-xs text-muted-foreground">{t('maxCapacity')}: <span className="font-mono font-bold text-foreground">{r.capacity ?? '—'}</span></p>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm border-t border-border pt-3">
                <span className="text-muted-foreground">{t('scheduleCount')}</span>
                <span className="font-bold font-mono text-foreground">{r.schedule_count ?? 0}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {rooms.length === 0 && !isLoading && (
        <p className="text-muted-foreground py-8 text-center">{t('noRooms')}</p>
      )}

      {/* Add Room Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-card rounded-2xl border border-border shadow-xl p-6 max-w-sm mx-4 w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">{t('addRoom')}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddRoom} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('roomName')}</label>
                <input
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('capacity')}</label>
                <input
                  type="number"
                  min={1}
                  value={addCapacity}
                  onChange={e => setAddCapacity(e.target.value)}
                  placeholder="—"
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {addError && <p className="text-sm text-red-500">{addError}</p>}
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted">{tCommon('cancel')}</button>
                <button type="submit" disabled={isAdding} className="px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>{tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
