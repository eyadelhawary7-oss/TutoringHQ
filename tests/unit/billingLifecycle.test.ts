import { describe, it, expect } from 'vitest';
import {
  resolveBillingAccess,
  hasFullAccess,
  shouldShowFailedBanner,
  isLocked,
  lockAtFromBillingDay,
  reactivationChargeAmount,
} from '@/lib/billingLifecycle';
import { cairoDateKey } from '@/lib/cairo/day';

// Tests run TZ=UTC; cairoDateKey resolves the Africa/Cairo calendar date from the
// IANA zone regardless, so mid-day UTC instants map unambiguously to Cairo dates.
const BILLING_DAY = '2026-06-15';
const beforeDay = new Date('2026-06-14T10:00:00Z'); // Cairo 2026-06-14
const earlyOnDay = new Date('2026-06-15T06:00:00Z'); // Cairo 2026-06-15 (morning)
const lateOnDay = new Date('2026-06-15T18:00:00Z'); // Cairo 2026-06-15 (evening, ~20:00)
const nextDay = new Date('2026-06-16T05:00:00Z'); // Cairo 2026-06-16 (after midnight)

describe('resolveBillingAccess — (a) failed charge keeps full access until 11:59pm same Cairo day', () => {
  it('grants full access (with banner) all of the billing day after a failed charge', () => {
    const input = { billingDayCairo: BILLING_DAY, paid: false, chargeFailedDayCairo: BILLING_DAY };
    for (const now of [earlyOnDay, lateOnDay]) {
      const access = resolveBillingAccess(input, now);
      expect(access).toBe('failed_today');
      expect(hasFullAccess(access)).toBe(true); // still full app access
      expect(shouldShowFailedBanner(access)).toBe(true); // pay-today banner shown
      expect(isLocked(access)).toBe(false);
    }
  });
});

describe('resolveBillingAccess — (b) lock engages at the next Cairo midnight', () => {
  it('locks once the Cairo date rolls to the day after the billing day', () => {
    const input = { billingDayCairo: BILLING_DAY, paid: false, chargeFailedDayCairo: BILLING_DAY };
    const access = resolveBillingAccess(input, nextDay);
    expect(access).toBe('locked');
    expect(isLocked(access)).toBe(true);
    expect(hasFullAccess(access)).toBe(false); // summary screen only
  });

  it('is still full access before the billing day', () => {
    const access = resolveBillingAccess({ billingDayCairo: BILLING_DAY, paid: false }, beforeDay);
    expect(access).toBe('full');
  });

  it('a paid cycle is always full access', () => {
    expect(resolveBillingAccess({ billingDayCairo: BILLING_DAY, paid: true }, nextDay)).toBe('full');
  });
});

describe('resolveBillingAccess — (d) manual cancel preserves access to cycle end', () => {
  it('keeps full access through the cycle-end date, then lapses to locked', () => {
    const input = { billingDayCairo: BILLING_DAY, paid: false, cancelPending: true, cycleEndCairo: '2026-06-30' };
    // On/before cycle end → full.
    expect(resolveBillingAccess(input, new Date('2026-06-20T10:00:00Z'))).toBe('full');
    expect(resolveBillingAccess(input, new Date('2026-06-30T18:00:00Z'))).toBe('full');
    // After cycle end → locked (no immediate lock on cancel).
    expect(resolveBillingAccess(input, new Date('2026-07-01T06:00:00Z'))).toBe('locked');
  });

  it('cancelling does NOT lock immediately even when the charge is unpaid', () => {
    const input = {
      billingDayCairo: BILLING_DAY,
      paid: false,
      chargeFailedDayCairo: BILLING_DAY,
      cancelPending: true,
      cycleEndCairo: '2026-06-30',
    };
    // Day after the failed charge would normally lock, but cancellation grants the
    // rest of the paid cycle.
    expect(resolveBillingAccess(input, nextDay)).toBe('full');
  });
});

describe('(c)(e) no late fee / no reactivation fee — paying charges plain subscription only', () => {
  it('reactivationChargeAmount returns the plain subscription price, no surcharge', () => {
    expect(reactivationChargeAmount(999)).toBe(999);
    expect(reactivationChargeAmount(13499)).toBe(13499);
  });
  it('there is no late-fee or reactivation-fee multiplier anywhere in the model', () => {
    // The amount to come back from a lock equals the subscription price exactly.
    const subscription = 4499;
    expect(reactivationChargeAmount(subscription)).toBe(subscription);
  });
  it('guards against bad input', () => {
    expect(reactivationChargeAmount(0)).toBe(0);
    expect(reactivationChargeAmount(-5)).toBe(0);
    expect(reactivationChargeAmount(NaN)).toBe(0);
  });
});

describe('lockAtFromBillingDay — Cairo midnight of the day after the billing day (DST-safe)', () => {
  it('resolves to the first instant of the following Cairo calendar day', () => {
    const iso = lockAtFromBillingDay(BILLING_DAY);
    const lockInstant = new Date(iso);
    // The lock instant itself is on Cairo 2026-06-16 ...
    expect(cairoDateKey(lockInstant)).toBe('2026-06-16');
    // ... and one second earlier is still Cairo 2026-06-15 (i.e. exactly midnight).
    expect(cairoDateKey(new Date(lockInstant.getTime() - 1000))).toBe('2026-06-15');
  });

  it('matches the proxy lock rule: now >= auto_suspend_at only from the next midnight', () => {
    const lockAt = new Date(lockAtFromBillingDay(BILLING_DAY)).getTime();
    expect(lateOnDay.getTime() < lockAt).toBe(true); // still the billing day → not locked
    expect(nextDay.getTime() >= lockAt).toBe(true); // next day → locked
  });
});
