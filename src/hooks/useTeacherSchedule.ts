'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type ScheduleSlotItem = {
  schedule_id: string;
  group_id: string;
  group_name: string | null;
  fee_per_class: number;
  day_of_week: number;
  time_start: string; // HH:MM
  duration_minutes: number;
  enrolled_count: number;
};

export type ScheduleExceptionItem = {
  id: string;
  group_id: string;
  schedule_id: string;
  exception_date: string; // YYYY-MM-DD
  kind: 'cancelled' | 'rescheduled';
  new_date: string | null;
  new_time_start: string | null;
  new_duration_minutes: number | null;
  note: string | null;
};

export type RecordedSessionItem = {
  id: string;
  group_id: string;
  scheduled_date: string; // YYYY-MM-DD (Cairo)
};

export type LiveSessionItem = {
  session_id: string;
  group_id: string;
  session_date: string; // YYYY-MM-DD (Cairo)
  attendee_ids: string[];
};

type ScheduleResponse = {
  slots: ScheduleSlotItem[];
  exceptions: ScheduleExceptionItem[];
  sessions: RecordedSessionItem[];
  live_sessions: LiveSessionItem[];
};

/**
 * The teacher's full weekly schedule (recurring slots across active private
 * groups + exceptions for the next 30 Cairo days). Plain fetch/useState - the
 * teacher portal pages do not use SWR.
 */
export function useTeacherSchedule() {
  const [slots, setSlots] = useState<ScheduleSlotItem[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleExceptionItem[]>([]);
  const [sessions, setSessions] = useState<RecordedSessionItem[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    setError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError(true);
        return;
      }
      const res = await fetch('/api/teacher/private/schedule', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as ScheduleResponse;
      setSlots(data.slots ?? []);
      setExceptions(data.exceptions ?? []);
      setSessions(data.sessions ?? []);
      setLiveSessions(data.live_sessions ?? []);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { slots, exceptions, sessions, liveSessions, isLoading, error, refetch };
}
