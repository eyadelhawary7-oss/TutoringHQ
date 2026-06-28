import { describe, it, expect } from 'vitest';
import { resolveSummerReferralStatus, summerReferralRewardAllowed } from '@/lib/summer/referral';

describe('summer referral — pending until referred customer pays first invoice', () => {
  it('stays pending while the referred customer has not paid (the free period)', () => {
    expect(
      resolveSummerReferralStatus({ current: 'pending', referredFirstInvoicePaid: false }),
    ).toBe('pending');
    expect(
      summerReferralRewardAllowed({ current: 'pending', referredFirstInvoicePaid: false }),
    ).toBe(false);
  });

  it('converts to granted exactly when the first invoice is paid', () => {
    expect(
      resolveSummerReferralStatus({ current: 'pending', referredFirstInvoicePaid: true }),
    ).toBe('granted');
    expect(
      summerReferralRewardAllowed({ current: 'pending', referredFirstInvoicePaid: true }),
    ).toBe(true);
  });

  it('is idempotent once granted (never double-grants)', () => {
    expect(
      resolveSummerReferralStatus({ current: 'granted', referredFirstInvoicePaid: true }),
    ).toBe('granted');
    expect(
      summerReferralRewardAllowed({ current: 'granted', referredFirstInvoicePaid: true }),
    ).toBe(false);
  });

  it('never rewards a self-referral', () => {
    expect(
      resolveSummerReferralStatus({ current: 'pending', referredFirstInvoicePaid: true, selfReferral: true }),
    ).toBe('pending');
    expect(
      summerReferralRewardAllowed({ current: 'pending', referredFirstInvoicePaid: true, selfReferral: true }),
    ).toBe(false);
  });
});
