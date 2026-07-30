/**
 * Merged-Center-Home §01 "Schedule" row status - derived, not stored.
 *
 * schedule_slots has no per-occurrence completion/billing flag (it is a
 * recurring weekly template: day_of_week + start_time/end_time, see
 * src/lib/cairo/day.ts's scheduleSlotsDayOfWeek doc). So "billed" here means
 * only that the slot's end_time has already passed today - not a claim that
 * money was specifically confirmed collected for it.
 */
export type ScheduleSlotStatus = 'billed' | 'next' | 'later';

export interface ScheduleSlotTiming {
  id: string;
  /** "HH:MM" or "HH:MM:SS". */
  start_time: string;
  end_time: string;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * `next` is the single soonest slot that has not yet ended (ties broken by
 * whichever sorts first); everything else not-yet-ended is `later`.
 */
export function classifyTodaySchedule<T extends ScheduleSlotTiming>(
  slots: readonly T[],
  nowMinutes: number,
): Map<string, ScheduleSlotStatus> {
  const notYetOver = slots.filter((s) => toMinutes(s.end_time) > nowMinutes);
  const nextSlotId =
    notYetOver.length > 0
      ? notYetOver.reduce((a, b) => (toMinutes(a.start_time) <= toMinutes(b.start_time) ? a : b)).id
      : null;

  const out = new Map<string, ScheduleSlotStatus>();
  for (const s of slots) {
    out.set(s.id, toMinutes(s.end_time) <= nowMinutes ? 'billed' : s.id === nextSlotId ? 'next' : 'later');
  }
  return out;
}
