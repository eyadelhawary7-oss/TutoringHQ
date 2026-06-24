import { describe, it, expect } from 'vitest';
import { computeUpcomingForecast } from '@/lib/billingForecast';

describe('computeUpcomingForecast', () => {
  it('forecasts subscription + processing fee on the next billing date', () => {
    const f = computeUpcomingForecast({
      nextPaymentDue: '2026-09-01',
      billingAmount: 999,
      processingFee: 20,
      subscriptionActive: true,
    });
    expect(f).not.toBeNull();
    expect(f!.isForecast).toBe(true);
    expect(f!.estimated).toBe(true);
    expect(f!.subscription).toBe(999);
    expect(f!.fee).toBe(20);
    expect(f!.amount).toBe(1019);
    expect(f!.date).toBe('2026-09-01');
  });

  it('handles a fee that is disabled (0)', () => {
    const f = computeUpcomingForecast({
      nextPaymentDue: '2026-09-01',
      billingAmount: 999,
      processingFee: 0,
      subscriptionActive: true,
    });
    expect(f!.amount).toBe(999);
    expect(f!.fee).toBe(0);
  });

  it('returns null when the subscription is not active (nothing to forecast)', () => {
    expect(
      computeUpcomingForecast({
        nextPaymentDue: '2026-09-01',
        billingAmount: 999,
        processingFee: 20,
        subscriptionActive: false,
      }),
    ).toBeNull();
  });

  it('returns null without a next billing date or amount', () => {
    expect(
      computeUpcomingForecast({ nextPaymentDue: null, billingAmount: 999, processingFee: 20, subscriptionActive: true }),
    ).toBeNull();
    expect(
      computeUpcomingForecast({ nextPaymentDue: '2026-09-01', billingAmount: 0, processingFee: 20, subscriptionActive: true }),
    ).toBeNull();
  });

  it('normalises a timestamp date down to YYYY-MM-DD', () => {
    const f = computeUpcomingForecast({
      nextPaymentDue: '2026-09-01T00:00:00.000Z',
      billingAmount: 500,
      processingFee: 20,
      subscriptionActive: true,
    });
    expect(f!.date).toBe('2026-09-01');
  });
});
