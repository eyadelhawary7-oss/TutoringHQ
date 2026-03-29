import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  deriveBillingSummary,
  maskPhone,
  currentMonthStr,
} from '@/lib/whatsapp-pack'

describe('deriveBillingSummary', () => {
  it('returns not_issued for empty array', () => {
    const r = deriveBillingSummary([])
    expect(r.status).toBe('not_issued')
    expect(r.totalAmount).toBe(0)
    expect(r.parentCount).toBe(0)
  })

  it('returns charged when all rows are charged', () => {
    const r = deriveBillingSummary([
      { amount: 10, status: 'charged' },
      { amount: 10, status: 'charged' },
    ])
    expect(r.status).toBe('charged')
    expect(r.totalAmount).toBe(20)
    expect(r.parentCount).toBe(2)
  })

  it('returns failed when any row is failed', () => {
    const r = deriveBillingSummary([
      { amount: 10, status: 'charged' },
      { amount: 10, status: 'failed' },
    ])
    expect(r.status).toBe('failed')
  })

  it('returns pending when rows exist but not all charged and none failed', () => {
    const r = deriveBillingSummary([
      { amount: 10, status: 'charged' },
      { amount: 10, status: 'pending' },
    ])
    expect(r.status).toBe('pending')
    expect(r.totalAmount).toBe(20)
  })

  it('handles numeric string amounts from DB', () => {
    const r = deriveBillingSummary([
      { amount: '10.00' as unknown as number, status: 'charged' },
    ])
    expect(r.totalAmount).toBe(10)
  })

  it('handles null amount gracefully', () => {
    const r = deriveBillingSummary([
      { amount: null as unknown as number, status: 'charged' },
    ])
    expect(r.totalAmount).toBe(0)
  })

  it('failed takes priority over pending', () => {
    const r = deriveBillingSummary([
      { amount: 10, status: 'pending' },
      { amount: 10, status: 'failed' },
      { amount: 10, status: 'charged' },
    ])
    expect(r.status).toBe('failed')
  })
})

describe('maskPhone', () => {
  it('masks all but last 4 digits', () => {
    expect(maskPhone('+201220601410')).toBe('••••1410')
  })

  it('works with short numbers', () => {
    expect(maskPhone('01234')).toBe('••••1234')
  })
})

describe('currentMonthStr', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns first day of current month as YYYY-MM-DD', () => {
    expect(currentMonthStr()).toBe('2026-03-01')
  })

  it('returns a valid date string format', () => {
    expect(currentMonthStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
