// src/lib/groupSlots.ts
//
// Phase 3 slot-picking shared helpers. The teacher proposes a weekly time slot
// for their center-attached group; the center confirms (booking a schedule_slots
// row) or declines. Validation + error mapping live here so the routes stay thin
// and the pure logic is unit-testable. All writes go through the SECURITY DEFINER
// RPCs (propose_group_slot / confirm_group_slot / decline_group_slot).
import { NextResponse } from 'next/server';

/** Day index 0=Sunday … 6=Saturday (matches schedule_slots.day_of_week stored as the numeric string). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Cairo week starts Saturday; column order Sat→Fri for display. */
export const CAIRO_WEEK_ORDER: DayOfWeek[] = [6, 0, 1, 2, 3, 4, 5];

/** i18n key suffix per day index (consumed as slotPicking.days.<key>). */
export const DAY_KEYS: Record<DayOfWeek, string> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

export function isValidDayOfWeek(value: unknown): value is DayOfWeek {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Accept "HH:MM" (24h). Returns normalized "HH:MM" or null. */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(TIME_RE);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

/** end must be strictly after start; both valid HH:MM. */
export function isValidTimeRange(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  return toMinutes(start) < toMinutes(end);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  return h * 60 + m;
}

export type SlotStatus = 'pending' | 'confirmed' | 'declined' | 'withdrawn';

export interface SlotProposalOut {
  id: string;
  group_id: string;
  day_of_week: number;
  start_time: string; // HH:MM:SS from PG
  end_time: string;
  room_id: string | null;
  note: string | null;
  status: SlotStatus;
  created_at: string;
  responded_at: string | null;
}

export interface BookedSlotOut {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string | null;
}

/**
 * Map a Postgres error from the slot RPCs to an HTTP response. Returns null when
 * unrecognized so the caller can emit a 500 (and log to Sentry).
 */
export function mapSlotRpcError(err: { code?: string; message?: string }): NextResponse | null {
  switch (err.code) {
    case 'P0002': // not found / foreign / not owned (no existence oracle)
      return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
    case '23P01': // exclusion_violation — our conflict guard
      return NextResponse.json(
        { error: 'That time is already booked', code: 'SLOT_CONFLICT' },
        { status: 409 },
      );
    case '23505': // unique_violation — one-pending-per-group race
      return NextResponse.json(
        { error: 'A slot is already pending for this group', code: 'ALREADY_PENDING' },
        { status: 409 },
      );
    case '22023': // invalid input
      return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
    case '23514': // check_violation — wrong state (not pending / not attached / room not in center)
      return NextResponse.json(
        { error: 'Not allowed in the current state', code: 'INVALID_STATE' },
        { status: 409 },
      );
    default:
      return null;
  }
}
