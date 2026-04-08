import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveRange,
  isValidRangeKey,
  DEFAULT_RANGE,
  VALID_RANGE_KEYS,
  CEO_RANGE_PILLS,
} from '@/lib/ceo-time-range';

describe('isValidRangeKey', () => {
  it('returns true for all valid keys', () => {
    for (const key of VALID_RANGE_KEYS) {
      expect(isValidRangeKey(key)).toBe(true);
    }
  });

  it('returns true for CEO pill keys', () => {
    for (const key of CEO_RANGE_PILLS) {
      expect(isValidRangeKey(key)).toBe(true);
    }
  });

  it('returns false for invalid strings', () => {
    expect(isValidRangeKey('invalid')).toBe(false);
    expect(isValidRangeKey('last_year_2024')).toBe(false);
    expect(isValidRangeKey('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidRangeKey(undefined)).toBe(false);
  });
});

describe('DEFAULT_RANGE', () => {
  it('is 30D', () => {
    expect(DEFAULT_RANGE).toBe('30D');
  });
});

describe('resolveRange', () => {
  const FIXED_NOW = new Date('2026-03-15T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('7D: inclusive week ending 2026-03-15', () => {
    const r = resolveRange('7D');
    expect(r.from).toBe('2026-03-09');
    expect(r.to).toBe('2026-03-15');
    expect(r.key).toBe('7D');
  });

  it('30D: trailing 30 days', () => {
    const r = resolveRange('30D');
    expect(r.from).toBe('2026-02-14');
    expect(r.to).toBe('2026-03-15');
  });

  it('MTD matches this_month', () => {
    const mtd = resolveRange('MTD');
    const tm = resolveRange('this_month');
    expect(mtd.from).toBe(tm.from);
    expect(mtd.to).toBe(tm.to);
  });

  it('QTD matches this_quarter', () => {
    const q = resolveRange('QTD');
    const tq = resolveRange('this_quarter');
    expect(q.from).toBe(tq.from);
    expect(q.to).toBe(tq.to);
  });

  it('YTD matches this_year', () => {
    const y = resolveRange('YTD');
    const ty = resolveRange('this_year');
    expect(y.from).toBe(ty.from);
    expect(y.to).toBe(ty.to);
  });

  it('this_month: from = 2026-03-01, to = 2026-03-15', () => {
    const r = resolveRange('this_month');
    expect(r.from).toBe('2026-03-01');
    expect(r.to).toBe('2026-03-15');
  });

  it('last_month: full February 2026', () => {
    const r = resolveRange('last_month');
    expect(r.from).toBe('2026-02-01');
    expect(r.to).toBe('2026-02-28');
  });

  it('6M aligns with last_6_months', () => {
    const a = resolveRange('6M');
    const b = resolveRange('last_6_months');
    expect(a.from).toBe(b.from);
    expect(a.to).toBe(b.to);
  });

  it('default argument falls back to 30D', () => {
    const r = resolveRange();
    expect(r.key).toBe('30D');
  });

  describe('edge case: January — last_month and last_quarter cross year', () => {
    beforeEach(() => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    });

    it('last_month in January → full December of prior year', () => {
      const r = resolveRange('last_month');
      expect(r.from).toBe('2025-12-01');
      expect(r.to).toBe('2025-12-31');
    });

    it('last_quarter in January → Q4 of prior year', () => {
      const r = resolveRange('last_quarter');
      expect(r.from).toBe('2025-10-01');
      expect(r.to).toBe('2025-12-31');
    });
  });
});
