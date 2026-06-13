'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { useToast } from '@/hooks/useToast';
import { useTeacherSchedule } from '@/hooks/useTeacherSchedule';
import ScheduleSlotsEditor, {
  type ScheduleSlot,
  type OtherGroupSlot,
} from '@/components/teacher/schedule/ScheduleSlotsEditor';

/**
 * Schedule tab: the group's recurring weekly slots. Loads the current slots,
 * shows overlap warnings against the teacher's OTHER groups (same weekday,
 * intersecting time), and saves the full replace-all set via PATCH. Editing
 * the schedule notifies enrolled students over WhatsApp (warning banner).
 */
export default function GroupScheduleTab({ groupId }: { groupId: string }) {
  const t = useTranslations('teacherPortal.groups');
  const tTabs = useTranslations('teacherPortal.groupTabs');
  const toast = useToast();

  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const { slots: allSlots } = useTeacherSchedule();
  const otherSlots: OtherGroupSlot[] = useMemo(
    () =>
      allSlots
        .filter((s) => s.group_id !== groupId)
        .map((s) => ({
          day_of_week: s.day_of_week,
          time_start: s.time_start,
          duration_minutes: s.duration_minutes,
          group_name: s.group_name,
        })),
    [allSlots, groupId],
  );

  useEffect(() => {
    let stale = false;
    setLoaded(false);
    setLoadError(false);
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setLoadError(true);
          return;
        }
        const res = await fetch(`/api/teacher/private/groups/${groupId}/schedule`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          setLoadError(true);
          return;
        }
        const data = (await res.json()) as {
          slots?: { day_of_week: number; time_start: string; duration_minutes: number }[];
        };
        if (stale) return;
        setSlots(
          (data.slots ?? []).map((s) => ({
            day_of_week: s.day_of_week,
            time_start: s.time_start,
            duration_minutes: s.duration_minutes,
          })),
        );
        setLoaded(true);
      } catch {
        if (!stale) setLoadError(true);
      }
    })();
    return () => {
      stale = true;
    };
  }, [groupId]);

  const save = async () => {
    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error(tTabs('saveError'));
        return;
      }
      const res = await fetch(`/api/teacher/private/groups/${groupId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ schedule: slots }),
      });
      if (res.ok) {
        toast.success(tTabs('scheduleSaved'));
        return;
      }
      toast.error(tTabs('saveError'));
    } catch {
      toast.error(tTabs('saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return <p className="text-sm text-[var(--color-danger)]">{tTabs('classesError')}</p>;
  }
  if (!loaded) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">
        {t('scheduleChangedWarning')}
      </div>
      <ScheduleSlotsEditor value={slots} onChange={setSlots} otherSlots={otherSlots} />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="flex items-center justify-center gap-2 self-start rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:opacity-50"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {tTabs('saveSchedule')}
      </button>
    </div>
  );
}
