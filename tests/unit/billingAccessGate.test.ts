import { describe, it, expect } from 'vitest';
import { centerIsLockedNow } from '@/lib/billingAccessGate';
import { autoSuspendAtFromDue } from '@/lib/billingSchedule';
import { lockAtFromBillingDay } from '@/lib/billingLifecycle';

// Cairo 2026-07-02 (summer, UTC+3 → 09:00Z = 12:00 Cairo).
const NOW = new Date('2026-07-02T09:00:00Z');

describe('centerIsLockedNow — single-day model wired into enforcement', () => {
  it('is not locked when paid', () => {
    expect(centerIsLockedNow({ billing_status: 'paid', next_payment_due: '2026-07-01' }, NOW)).toBe(false);
  });

  it('grants full access ON the billing day (failed_today is not locked)', () => {
    expect(centerIsLockedNow({ billing_status: 'active', next_payment_due: '2026-07-02' }, NOW)).toBe(false);
  });

  it('is not locked before the billing day', () => {
    expect(centerIsLockedNow({ billing_status: 'active', next_payment_due: '2026-07-05' }, NOW)).toBe(false);
  });

  it('locks the day AFTER an unpaid billing day', () => {
    expect(centerIsLockedNow({ billing_status: 'active', next_payment_due: '2026-07-01' }, NOW)).toBe(true);
  });

  it('falls back to auto_suspend_at only when next_payment_due is absent', () => {
    expect(
      centerIsLockedNow({ billing_status: 'active', auto_suspend_at: '2026-07-01T00:00:00.000Z' }, NOW),
    ).toBe(true);
    expect(
      centerIsLockedNow({ billing_status: 'paid', auto_suspend_at: '2026-07-01T00:00:00.000Z' }, NOW),
    ).toBe(false);
  });
});

describe('uniform single-day lock timing (2e)', () => {
  it('autoSuspendAtFromDue equals the single-day rule (next Cairo midnight after due)', () => {
    const due = '2026-07-10';
    expect(autoSuspendAtFromDue(due)).toBe(lockAtFromBillingDay(due));
    // A center unpaid on its due day is still NOT locked on the due day itself...
    expect(centerIsLockedNow({ billing_status: 'active', next_payment_due: due }, new Date(`${due}T09:00:00Z`))).toBe(false);
    // ...and locks once now passes the computed auto_suspend_at instant.
    expect(new Date(autoSuspendAtFromDue(due)).getTime()).toBeGreaterThan(new Date(`${due}T12:00:00Z`).getTime());
  });
});
