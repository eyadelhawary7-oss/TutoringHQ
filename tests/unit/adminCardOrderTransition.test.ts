import { describe, expect, it } from 'vitest';
import { buildCardOrderTransitionPatch } from '@/lib/cardOrderState';
import {
  assertAdminCardOrderTransitionEventAllowed,
  AdminCardOrderTransitionNotAllowedError,
} from '@/lib/adminCardOrderTransition';

describe('adminCardOrderTransition whitelist', () => {
  it('allows vendor_assigned', () => {
    expect(() => assertAdminCardOrderTransitionEventAllowed('vendor_assigned')).not.toThrow();
  });

  it('rejects paymob_succeeded', () => {
    expect(() => assertAdminCardOrderTransitionEventAllowed('paymob_succeeded')).toThrow(
      AdminCardOrderTransitionNotAllowedError,
    );
  });

  it('rejects cancelled_before_payment', () => {
    expect(() => assertAdminCardOrderTransitionEventAllowed('cancelled_before_payment')).toThrow(
      AdminCardOrderTransitionNotAllowedError,
    );
  });

  it('rejects refund_approved', () => {
    expect(() => assertAdminCardOrderTransitionEventAllowed('refund_approved')).toThrow(
      AdminCardOrderTransitionNotAllowedError,
    );
  });
});

describe('vendor_assigned from paid (pure patch)', () => {
  it('builds vendor_assigned patch', () => {
    const patch = buildCardOrderTransitionPatch(
      {
        id: 'x',
        status: 'paid',
        payment_status: 'paid',
        refund_status: null,
      },
      'vendor_assigned',
      {},
    );
    expect(patch.status).toBe('vendor_assigned');
  });
});
