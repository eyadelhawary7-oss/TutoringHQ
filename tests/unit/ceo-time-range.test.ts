import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveRange,
  isValidRangeKey,
  DEFAULT_RANGE,
  VALID_RANGE_KEYS,
} from '@/lib/ceo-time-range'

describe('isValidRangeKey', () => {
  it('returns true for all valid keys', () => {
    for (const key of VALID_RANGE_KEYS) {
      expect(isValidRangeKey(key)).toBe(true)
    }
  })

  it('returns false for invalid strings', () => {
    expect(isValidRangeKey('invalid')).toBe(false)
    expect(isValidRangeKey('last_year_2024')).toBe(false)
    expect(isValidRangeKey('')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isValidRangeKey(undefined)).toBe(false)
  })
})

describe('DEFAULT_RANGE', () => {
  it('is this_month', () => {
    expect(DEFAULT_RANGE).toBe('this_month')
  })
})

describe('resolveRange', () => {
  // Pin the clock to 2026-03-15 UTC for deterministic tests
  const FIXED_NOW = new Date('2026-03-15T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('this_month: from = 2026-03-01, to = 2026-03-15', () => {
    const r = resolveRange('this_month')
    expect(r.from).toBe('2026-03-01')
    expect(r.to).toBe('2026-03-15')
    expect(r.key).toBe('this_month')
  })

  it('last_month: full February 2026', () => {
    const r = resolveRange('last_month')
    expect(r.from).toBe('2026-02-01')
    expect(r.to).toBe('2026-02-28')
  })

  it('this_quarter: Q1 2026 from 2026-01-01', () => {
    const r = resolveRange('this_quarter')
    expect(r.from).toBe('2026-01-01')
    expect(r.to).toBe('2026-03-15')
  })

  it('last_quarter: Q4 2025, Oct–Dec', () => {
    const r = resolveRange('last_quarter')
    expect(r.from).toBe('2025-10-01')
    expect(r.to).toBe('2025-12-31')
  })

  it('last_6_months: from 2025-09-01 to 2026-03-15', () => {
    const r = resolveRange('last_6_months')
    expect(r.from).toBe('2025-09-01')
    expect(r.to).toBe('2026-03-15')
  })

  it('this_year: from 2026-01-01', () => {
    const r = resolveRange('this_year')
    expect(r.from).toBe('2026-01-01')
    expect(r.to).toBe('2026-03-15')
  })

  it('last_year: full 2025', () => {
    const r = resolveRange('last_year')
    expect(r.from).toBe('2025-01-01')
    expect(r.to).toBe('2025-12-31')
  })

  it('all_time: from 2025-01-01', () => {
    const r = resolveRange('all_time')
    expect(r.from).toBe('2025-01-01')
    expect(r.to).toBe('2026-03-15')
  })

  it('default argument falls back to this_month', () => {
    const r = resolveRange()
    expect(r.key).toBe('this_month')
  })

  describe('edge case: January — last_month and last_quarter cross year', () => {
    beforeEach(() => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    })

    it('last_month in January → full December of prior year', () => {
      const r = resolveRange('last_month')
      expect(r.from).toBe('2025-12-01')
      expect(r.to).toBe('2025-12-31')
    })

    it('last_quarter in January → Q4 of prior year', () => {
      const r = resolveRange('last_quarter')
      expect(r.from).toBe('2025-10-01')
      expect(r.to).toBe('2025-12-31')
    })
  })
})
