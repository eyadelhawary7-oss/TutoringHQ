'use client';

import { useTranslations } from 'next-intl';

export type ScheduleSlot = {
  day_of_week: number;
  time_start: string; // HH:MM
  duration_minutes: number;
};

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const DURATIONS = [45, 60, 90, 120] as const;
const DEFAULT_TIME = '16:00';
const DEFAULT_DURATION = 60;

/**
 * Weekly recurring-slots editor: one optional slot per day (Sun..Sat).
 * Controlled - `value` is the canonical slot list (at most one per day) and
 * every interaction emits the full new list through `onChange`. Shared by
 * the create-group and edit-group modals.
 */
export default function ScheduleSlotsEditor({
  value,
  onChange,
}: {
  value: ScheduleSlot[];
  onChange: (slots: ScheduleSlot[]) => void;
}) {
  const t = useTranslations('teacherPortal.groups');

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

  return (
    <div className="flex flex-col gap-2">
      {DAYS.map((day) => {
        const slot = slotFor(day);
        return (
          <div
            key={day}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2"
          >
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
                <select
                  value={slot.duration_minutes}
                  onChange={(e) => updateSlot(day, { duration_minutes: Number(e.target.value) })}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {t(`duration${d}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
