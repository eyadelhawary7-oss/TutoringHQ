import { describe, expect, it } from 'vitest';
import {
  buildCardOrderTransitionPatch,
  IllegalCardOrderTransitionError,
} from '@/lib/cardOrderState';

const row = (partial: Partial<{ status: string; payment_status: string; refund_status: string | null }>) => ({
  id: '00000000-0000-0000-0000-000000000001',
  status: partial.status ?? 'pending_payment',
  payment_status: partial.payment_status ?? 'unpaid',
  refund_status: partial.refund_status ?? null,
});

describe('buildCardOrderTransitionPatch', () => {
  it('paid → cancelled_after_payment sets refund pending', () => {
    const patch = buildCardOrderTransitionPatch(row({ status: 'paid', payment_status: 'paid' }), 'cancelled_after_payment', {
      reason: 'no_longer_needed',
    });
    expect(patch.status).toBe('cancelled');
    expect(patch.payment_status).toBe('paid');
    expect(patch.refund_status).toBe('pending');
    expect(patch.refund_requested_at).toBeTruthy();
  });

  it('pending_payment → cancelled_before_payment leaves refund_status null', () => {
    const patch = buildCardOrderTransitionPatch(
      row({ status: 'pending_payment', payment_status: 'unpaid' }),
      'cancelled_before_payment',
      { reason: 'wrong_quantity' },
    );
    expect(patch.refund_status).toBeNull();
    expect(patch.payment_status).toBe('unpaid');
    expect(patch.status).toBe('cancelled');
  });

  it('issued → cancelled_after_payment throws', () => {
    expect(() =>
      buildCardOrderTransitionPatch(row({ status: 'issued', payment_status: 'paid' }), 'cancelled_after_payment', {
        reason: 'x',
      }),
    ).toThrow(IllegalCardOrderTransitionError);
  });

  it('refund_paid only valid from refund_status approved', () => {
    expect(() =>
      buildCardOrderTransitionPatch(
        row({ status: 'cancelled', payment_status: 'paid', refund_status: 'pending' }),
        'refund_paid',
      ),
    ).toThrow(IllegalCardOrderTransitionError);

    const patch = buildCardOrderTransitionPatch(
      row({ status: 'cancelled', payment_status: 'paid', refund_status: 'approved' }),
      'refund_paid',
    );
    expect(patch.status).toBe('refunded');
    expect(patch.refund_status).toBe('paid');
    expect(patch.refund_paid_at).toBeTruthy();
  });
});
