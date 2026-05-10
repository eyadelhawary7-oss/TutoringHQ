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

  it('paid → cancelled_before_payment throws CARD_ORDER_CANCEL_NOT_ALLOWED', () => {
    expect(() =>
      buildCardOrderTransitionPatch(row({ status: 'paid', payment_status: 'paid' }), 'cancelled_before_payment', {
        reason: 'no_longer_needed',
      }),
    ).toThrow(/CARD_ORDER_CANCEL_NOT_ALLOWED/);
  });

  it('vendor_assigned → cancelled_before_payment throws CARD_ORDER_CANCEL_NOT_ALLOWED', () => {
    expect(() =>
      buildCardOrderTransitionPatch(
        row({ status: 'vendor_assigned', payment_status: 'paid' }),
        'cancelled_before_payment',
        { reason: 'no_longer_needed' },
      ),
    ).toThrow(/CARD_ORDER_CANCEL_NOT_ALLOWED/);
  });

  it('cancelled_before_payment without reason throws IllegalCardOrderTransitionError', () => {
    expect(() =>
      buildCardOrderTransitionPatch(row({ status: 'pending_payment', payment_status: 'unpaid' }), 'cancelled_before_payment', {}),
    ).toThrow(IllegalCardOrderTransitionError);
  });
});
