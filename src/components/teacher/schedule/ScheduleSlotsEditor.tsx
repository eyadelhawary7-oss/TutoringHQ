'use client';

import { useTranslations } from 'next-intl';
import { formatTimeRange } from '@/lib/timeFormat';

export type ScheduleSlot = {
  day_of_week: number;
  time_start: string; // HH:MM
  duration_minutes: number;
};

/** A slot belonging to one of the teacher's OTHER groups, for overlap checks. */
export type OtherGroupSlot = {
  day_of_week: number;
  time_start: string; // HH:MM
  duration_minutes: number;
  group_name: string | null;
};

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const DEFAULT_TIME = '16:00';
const DEFAULT_DURATION = 60;
const MIN_DURATION = 15;
const MAX_DURATION = 480;
const DURATION_STEP = 15;

/** "HH:MM" -> minutes since midnight, or null when malformed. */
function startMinutes(timeHHMM: string): number | null {
  const [h, m] = timeHHMM.split(':');
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isValidDuration(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= MIN_DURATION &&
    minutes <= MAX_DURATION &&
    minutes % DURATION_STEP === 0
  );
}

/**
 * Weekly recurring-slots editor: one optional slot per day (Sun..Sat).
 * Controlled - `value` is the canonical slot list (at most one per day) and
 * every interaction emits the full new list through `onChange`. Shared by
 * the create-group and edit-group modals and the group-detail Schedule tab.
 *
 * Duration is a free number input (15..480 in 15-min steps) rather than a
 * fixed select - no real tutoring session runs past 8 hours. `otherSlots`
 * lets the editor warn (never block) when this group's time collides with
 * another of the same teacher's groups on the same weekday.
 */
export default function ScheduleSlotsEditor({
  value,
  onChange,
  otherSlots = [],
}: {
  value: ScheduleSlot[];
  onChange: (slots: ScheduleSlot[]) => void;
  otherSlots?: OtherGroupSlot[];
}) {
  const t = useTranslations('teacherPortal.groups');
  const tSchedule = useTranslations('teacherPortal.schedule');
  const tf = useTranslations('timeFormat');
  const timeLabels = { am: tf('am'), pm: tf('pm') };

  const slotFor = (day: number) => value.find((s) => s.day_of_week === day);

  const setDayEnabled = (day: number, enabled: boolean) => {
    if (enabled) {
      onChange([
        ...value.filter((s) => s.day_of_week !== day),
        { day_of_week: day, time_start: DEFAULT_TIME, duration_minutes: DEFAULT_DURATION },
      ]);
    } else {
      onChange(value.filter((s) => s.day_of_week !== day));
    }
  };

  const updateSlot = (day: number, patch: Partial<ScheduleSlot>) => {
    onChange(value.map((s) => (s.day_of_week === day ? { ...s, ...patch } : s)));
  };

  /** First OTHER-group slot whose time range intersects this slot on the day. */
  const overlapFor = (slot: ScheduleSlot): OtherGroupSlot | null => {
    const start = startMinutes(slot.time_start);
    if (start === null) return null;
    const end = start + slot.duration_minutes;
    for (const other of otherSlots) {
      if (other.day_of_week !== slot.day_of_week) continue;
      const oStart = startMinutes(other.time_start);
      if (oStart === null) continue;
      const oEnd = oStart + other.duration_minutes;
      if (start < oEnd && end > oStart) return other;
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-2">
      {DAYS.map((day) => {
        const slot = slotFor(day);
        const durationInvalid = slot ? !isValidDuration(slot.duration_minutes) : false;
        const overlap = slot ? overlapFor(slot) : null;
        return (
          <div
            key={day}
            className="flex flex-col gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-24 cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  checked={Boolean(slot)}
                  onChange={(e) => setDayEnabled(day, e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--color-border)] accent-teal-600"
                />
                {t(`daysOfWeek.${day}`)}
              </label>
              {slot && (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <input
                    type="time"
                    value={slot.time_start}
                    onChange={(e) => updateSlot(day, { time_start: e.target.value })}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={MIN_DURATION}
                      max={MAX_DURATION}
                      step={DURATION_STEP}
                      value={slot.duration_minutes}
                      onChange={(e) =>
                        updateSlot(day, { duration_minutes: Number(e.target.value) })
                      }
                      aria-invalid={durationInvalid}
                      className="w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
                    />
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {t('durationSuffix')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {durationInvalid && (
              <p className="text-xs text-[var(--color-danger)]" role="alert">
                {tSchedule('durationMultipleOf15')}
              </p>
            )}

            {overlap && (
              <p className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-3 py-2 text-xs text-[var(--color-warning)]">
                {tSchedule('overlapWarning', {
                  group: overlap.group_name ?? '',
                  time: formatTimeRange(overlap.time_start, overlap.duration_minutes, timeLabels),
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
