/**
 * 12-hour AM/PM time-display helpers for the teacher schedule surfaces.
 *
 * The HTML `<input type="time">` keeps the browser-native 24h control, but every
 * RENDERED time string in the UI must read as 12-hour AM/PM (e.g. "4:00 PM",
 * "4:00 PM - 5:00 PM"). These helpers do that conversion.
 *
 * Labels default to English "AM"/"PM" so the pure formatters are testable
 * without an i18n context; callers in the UI pass localized markers
 * (`timeFormat.am` / `timeFormat.pm`) so Arabic renders "ص"/"م".
 */

export type MeridiemLabels = { am: string; pm: string };

const DEFAULT_LABELS: MeridiemLabels = { am: 'AM', pm: 'PM' };

/** Parse "HH:MM" (24h) to total minutes since midnight, or null if malformed. */
function parseHHMM(timeHHMM: string): number | null {
  const parts = timeHHMM.split(':');
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/** Render minutes-since-midnight (wrapped into a single day) as "h:mm AM/PM". */
function render12h(totalMinutes: number, labels: MeridiemLabels): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const period = hour24 < 12 ? labels.am : labels.pm;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** "16:00" -> "4:00 PM". Returns the input unchanged if it cannot be parsed. */
export function formatTime(timeHHMM: string, labels: MeridiemLabels = DEFAULT_LABELS): string {
  const total = parseHHMM(timeHHMM);
  if (total === null) return timeHHMM;
  return render12h(total, labels);
}

/**
 * ("16:00", 60) -> "4:00 PM - 5:00 PM". The end time wraps past midnight
 * ("23:00", 90 -> "11:00 PM - 12:30 AM"). Falls back to the raw start string
 * if the start time cannot be parsed.
 */
export function formatTimeRange(
  timeStart: string,
  durationMinutes: number,
  labels: MeridiemLabels = DEFAULT_LABELS,
): string {
  const start = parseHHMM(timeStart);
  if (start === null) return timeStart;
  const duration = Number.isFinite(durationMinutes) ? durationMinutes : 0;
  return `${render12h(start, labels)} - ${render12h(start + duration, labels)}`;
}
