import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isSubscriptionPastDueBanner, shouldSuspendAfterGrace } from '@/lib/subscriptionPastDue';

describe('subscriptionPastDue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags active centre when next_payment_due is before Cairo today', () => {
    expect(
      isSubscriptionPastDueBanner({
        status: 'active',
        subscription_status: 'active',
        billing_status: 'active',
        next_payment_due: '2026-05-01',
      }),
    ).toBe(true);
  });

  it('does not flag when subscription is suspended', () => {
    expect(
      isSubscriptionPastDueBanner({
        status: 'suspended',
        subscription_status: 'suspended',
        billing_status: 'suspended',
        next_payment_due: '2026-05-01',
      }),
    ).toBe(false);
  });

  it('flags overdue subscription_status', () => {
    expect(
      isSubscriptionPastDueBanner({
        status: 'active',
        subscription_status: 'overdue',
        billing_status: 'active',
        next_payment_due: '2026-06-01',
      }),
    ).toBe(true);
  });

  it('shouldSuspendAfterGrace matches calendar grace days', () => {
    expect(shouldSuspendAfterGrace('2026-05-01', 7, '2026-05-07')).toBe(false);
    expect(shouldSuspendAfterGrace('2026-05-01', 7, '2026-05-08')).toBe(true);
  });
});
