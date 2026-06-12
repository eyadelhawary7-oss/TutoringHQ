/**
 * Shared validation + shaping helpers for the teacher schedule feature
 * (group_schedule recurring slots and schedule_exceptions one-time edits).
 */

export type ScheduleSlotInput = {
  day_of_week: number;
  time_start: string; // HH:MM
  duration_minutes: number;
};

const TIME_RE = /^\d{2}:\d{2}$/;

export function isValidTimeHHMM(value: string): boolean {
  if (!TIME_RE.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Parse the optional `schedule` field on group create/edit bodies.
 * Rules: each slot needs day_of_week 0-6 (int), time_start HH:MM and
 * duration_minutes 1-480 (int). One slot per day - duplicates by
 * day_of_week collapse, last one wins - so the result is at most 7 slots.
 * `{ ok: false }` means the field was present but malformed (400 at the
 * route); an absent/undefined field never reaches this function.
 */
export function parseScheduleSlots(
  raw: unknown,
): { ok: true; slots: ScheduleSlotInput[] } | { ok: false } {
  if (!Array.isArray(raw)) return { ok: false };
  const byDay = new Map<number, ScheduleSlotInput>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return { ok: false };
    const { day_of_week, time_start, duration_minutes } = item as {
      day_of_week?: unknown;
      time_start?: unknown;
      duration_minutes?: unknown;
    };
    if (
      typeof day_of_week !== 'number' ||
      !Number.isInteger(day_of_week) ||
      day_of_week < 0 ||
      day_of_week > 6
    ) {
      return { ok: false };
    }
    if (typeof time_start !== 'string' || !isValidTimeHHMM(time_start)) {
      return { ok: false };
    }
    if (
      typeof duration_minutes !== 'number' ||
      !Number.isInteger(duration_minutes) ||
      duration_minutes < 1 ||
      duration_minutes > 480
    ) {
      return { ok: false };
    }
    byDay.set(day_of_week, { day_of_week, time_start, duration_minutes });
  }
  return { ok: true, slots: Array.from(byDay.values()) };
}

/** Postgres `time` comes back as HH:MM:SS - the API contract is HH:MM. */
export function toHHMM(time: string | null): string {
  return (time ?? '').slice(0, 5);
}
