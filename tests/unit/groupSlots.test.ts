/**
 * Phase 3 slot-picking pure helpers: day/time validation, weekday ordering, and
 * the RPC-error -> HTTP mapping. The DB behaviors (confirm books a slot, decline
 * frees it, conflict guard blocks double-booking, center scoping) are exercised
 * against the live RPCs in a rolled-back transaction during verification.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidDayOfWeek,
  normalizeTime,
  isValidTimeRange,
  toMinutes,
  mapSlotRpcError,
  CAIRO_WEEK_ORDER,
  DAY_KEYS,
} from '@/lib/groupSlots';

describe('isValidDayOfWeek', () => {
  it('accepts 0..6 integers only', () => {
    for (let d = 0; d <= 6; d++) expect(isValidDayOfWeek(d)).toBe(true);
    expect(isValidDayOfWeek(7)).toBe(false);
    expect(isValidDayOfWeek(-1)).toBe(false);
    expect(isValidDayOfWeek(2.5)).toBe(false);
    expect(isValidDayOfWeek('3')).toBe(false);
    expect(isValidDayOfWeek(null)).toBe(false);
  });
});

describe('normalizeTime', () => {
  it('accepts valid HH:MM and trims', () => {
    expect(normalizeTime('09:00')).toBe('09:00');
    expect(normalizeTime(' 23:59 ')).toBe('23:59');
    expect(normalizeTime('00:00')).toBe('00:00');
  });
  it('rejects malformed or out-of-range times', () => {
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('9:00')).toBeNull();
    expect(normalizeTime('09:60')).toBeNull();
    expect(normalizeTime('abc')).toBeNull();
    expect(normalizeTime(900)).toBeNull();
    expect(normalizeTime('')).toBeNull();
  });
});

describe('isValidTimeRange', () => {
  it('requires end strictly after start', () => {
    expect(isValidTimeRange('16:00', '17:00')).toBe(true);
    expect(isValidTimeRange('16:00', '16:00')).toBe(false);
    expect(isValidTimeRange('17:00', '16:00')).toBe(false);
    expect(isValidTimeRange(null, '17:00')).toBe(false);
    expect(isValidTimeRange('16:00', null)).toBe(false);
  });
});

describe('toMinutes', () => {
  it('converts HH:MM to minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('01:30')).toBe(90);
    expect(toMinutes('23:59')).toBe(1439);
  });
});

describe('weekday constants', () => {
  it('Cairo week order is Sat..Fri and covers all 7 days once', () => {
    expect(CAIRO_WEEK_ORDER).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(new Set(CAIRO_WEEK_ORDER).size).toBe(7);
  });
  it('every day index maps to an i18n key', () => {
    for (let d = 0; d <= 6; d++) expect(DAY_KEYS[d as 0]).toBeTruthy();
  });
});

describe('mapSlotRpcError', () => {
  const status = (code: string) => {
    const res = mapSlotRpcError({ code });
    return res ? res.status : null;
  };
  it('maps known Postgres error codes to HTTP statuses', () => {
    expect(status('P0002')).toBe(404); // not found / not owned
    expect(status('23P01')).toBe(409); // conflict guard
    expect(status('23505')).toBe(409); // already pending
    expect(status('22023')).toBe(400); // invalid input
    expect(status('23514')).toBe(409); // invalid state
  });
  it('returns null for unrecognized codes (caller emits 500)', () => {
    expect(mapSlotRpcError({ code: 'XX999' })).toBeNull();
    expect(mapSlotRpcError({})).toBeNull();
  });
  it('conflict maps to the SLOT_CONFLICT code', async () => {
    const res = mapSlotRpcError({ code: '23P01' });
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body.code).toBe('SLOT_CONFLICT');
  });
});
