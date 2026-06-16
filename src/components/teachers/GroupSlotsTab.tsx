'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatTime } from '@/lib/formatNumber';
import { DAY_KEYS, type DayOfWeek } from '@/lib/groupSlots';

type Proposal = {
  id: string;
  group_id: string;
  group_name: string | null;
  subject: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string | null;
  note: string | null;
  created_at: string;
};
type Room = { id: string; name: string | null };

const ERROR_KEY: Record<string, string> = {
  SLOT_CONFLICT: 'errorConflict',
  INVALID_STATE: 'errorState',
  NOT_FOUND: 'errorGeneric',
};

function SlotRow({
  proposal,
  rooms,
  onChanged,
}: {
  proposal: Proposal;
  rooms: Room[];
  onChanged: () => void;
}) {
  const t = useTranslations('slotPicking');
  const locale = useLocale();
  const [roomId, setRoomId] = useState<string>(proposal.room_id ?? '');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const dayLabel = (n: number) => t(`days.${DAY_KEYS[(n as DayOfWeek)] ?? 'sat'}` as Parameters<typeof t>[0]);

  const respond = async (action: 'confirm' | 'decline') => {
    setBusy(true);
    setErrorKey(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/center/group-slots/${proposal.id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ action, room_id: action === 'confirm' && roomId ? roomId : undefined }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { code?: string };
        setErrorKey(ERROR_KEY[j.code ?? ''] ?? 'errorGeneric');
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[var(--color-text-primary)]">
            {proposal.group_name ?? proposal.subject ?? '-'}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {t('teacher')}: {proposal.teacher_name ?? '-'}
          </p>
        </div>
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
          {dayLabel(proposal.day_of_week)} · {formatTime(proposal.start_time, locale)} -{' '}
          {formatTime(proposal.end_time, locale)}
        </p>
      </div>

      {proposal.note && <p className="text-xs text-[var(--color-text-secondary)]">{proposal.note}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-text-secondary)]">{t('room')}</span>
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">{t('roomNone')}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ?? '-'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void respond('confirm')}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {t('confirm')}
        </button>
        <button
          type="button"
          onClick={() => void respond('decline')}
          disabled={busy}
          className="rounded-lg border border-[var(--color-danger)]/50 px-3 py-1.5 text-sm font-semibold text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          {t('decline')}
        </button>
      </div>
      {errorKey && <p className="text-xs text-[var(--color-danger)]">{t(errorKey as Parameters<typeof t>[0])}</p>}
    </div>
  );
}

/**
 * Center-side Phase 3 tab: pending slot proposals from attached teachers. The
 * center confirms (optionally assigning a room) -> books the slot on the
 * timetable, or declines -> frees it. Self-fetches; bumps the parent on change.
 */
export default function GroupSlotsTab({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations('slotPicking');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/center/group-slots', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { proposals: Proposal[]; rooms: Room[] };
      setProposals(json.proposals ?? []);
      setRooms(json.rooms ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleChanged = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <Loader2 size={16} className="animate-spin" /> ...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('centerTitle')}</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('centerSubtitle')}</p>
      </div>
      {proposals.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
          {t('noPending')}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {proposals.map((p) => (
            <SlotRow key={p.id} proposal={p} rooms={rooms} onChanged={handleChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
