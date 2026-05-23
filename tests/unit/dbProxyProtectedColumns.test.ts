import { describe, it, expect } from 'vitest';
import {
  USERS_PROTECTED_COLUMNS,
  findProtectedUsersWrite,
  CARD_ORDERS_PROTECTED_COLUMNS,
  findProtectedCardOrdersWrite,
} from '@/lib/dbProxyProtectedColumns';

describe('USERS_PROTECTED_COLUMNS', () => {
  it('includes role (the prior P0 column)', () => {
    expect(USERS_PROTECTED_COLUMNS.has('role')).toBe(true);
  });

  it('includes phone (closes the SUPER_ADMIN_PHONES self-elevation class)', () => {
    // Regression for the users.phone super-admin escalation: a centre owner
    // could PATCH their own users.phone via /api/db to a value in
    // SUPER_ADMIN_PHONES, and the next isSuperAdminPhone() check would return
    // true. The proxy must reject this write at the storage layer.
    expect(USERS_PROTECTED_COLUMNS.has('phone')).toBe(true);
  });

  it('includes every can_* permission flag', () => {
    const expected = [
      'can_record_payments',
      'can_view_payments',
      'can_manage_billing',
      'can_edit_center_profile',
      'can_delete_students',
      'can_manage_academic_calendar',
      'can_place_card_orders',
      'can_request_referral_payouts',
    ];
    for (const key of expected) {
      expect(USERS_PROTECTED_COLUMNS.has(key), `missing protection for ${key}`).toBe(true);
    }
  });
});

describe('findProtectedUsersWrite', () => {
  it('returns "role" for the prior-P0 self-escalation payload', () => {
    // The exact payload a centre owner would have used to escalate via /api/db
    // before this hardening: PATCH users with role='super_admin' on self.
    expect(findProtectedUsersWrite({ role: 'super_admin' })).toBe('role');
  });

  it('returns "phone" for the users.phone super-admin escalation payload', () => {
    // Exact payload a centre owner would use to self-elevate via /api/db by
    // setting their users.phone to a value in SUPER_ADMIN_PHONES.
    expect(findProtectedUsersWrite({ phone: '+201234567890' })).toBe('phone');
  });

  it('returns the permission key when a can_* flag is in the payload', () => {
    expect(findProtectedUsersWrite({ can_manage_billing: true })).toBe('can_manage_billing');
  });

  it('returns null for benign update payloads (display_name etc.)', () => {
    expect(findProtectedUsersWrite({ display_name: 'Aya' })).toBeNull();
  });

  it('returns the first protected key when an array of rows is supplied', () => {
    const data = [
      { display_name: 'A' },
      { role: 'super_admin', display_name: 'B' },
    ];
    expect(findProtectedUsersWrite(data)).toBe('role');
  });

  it('returns null for empty or non-object data', () => {
    expect(findProtectedUsersWrite(null)).toBeNull();
    expect(findProtectedUsersWrite(undefined)).toBeNull();
    expect(findProtectedUsersWrite({})).toBeNull();
    expect(findProtectedUsersWrite([])).toBeNull();
    expect(findProtectedUsersWrite('not an object')).toBeNull();
  });
});

describe('CARD_ORDERS_PROTECTED_COLUMNS', () => {
  it('protects payment + workflow state columns (status, payment_status, refund_status)', () => {
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('status')).toBe(true);
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('payment_status')).toBe(true);
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('refund_status')).toBe(true);
  });

  it('protects lifecycle columns set by the state machine', () => {
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('cancelled_at')).toBe(true);
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('cancellation_reason')).toBe(true);
  });

  it('protects webhook-linkage columns (Paymob + Bosta)', () => {
    for (const key of [
      'paymob_order_id',
      'paymob_transaction_id',
      'bosta_order_id',
      'bosta_status',
      'bosta_shipment_id',
      'bosta_updated_at',
      'bosta_notes',
    ]) {
      expect(CARD_ORDERS_PROTECTED_COLUMNS.has(key), `missing protection for ${key}`).toBe(true);
    }
  });

  // Regression for the §9 follow-up: the original protected set covered
  // status/payment_status but not quantity / students / price_per_card /
  // total_amount / delivery_fee. A centre could keep status='paid' (set by
  // Paymob webhook for a small paid order) and then PATCH quantity from
  // 10 to 100 + students to a 100-row array via /api/db , vendor prints
  // 100 cards for the price of 10. These must be blocked too.
  it('protects order-content columns (quantity, students)', () => {
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('quantity')).toBe(true);
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('students')).toBe(true);
  });

  it('protects money columns (price_per_card, total_amount, delivery_fee)', () => {
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('price_per_card')).toBe(true);
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('total_amount')).toBe(true);
    expect(CARD_ORDERS_PROTECTED_COLUMNS.has('delivery_fee')).toBe(true);
  });

  it('protects fulfillment columns (shipping_zone, card_style, delivery address/phone/governorate)', () => {
    for (const key of [
      'shipping_zone',
      'card_style',
      'delivery_address',
      'delivery_phone',
      'delivery_governorate',
    ]) {
      expect(CARD_ORDERS_PROTECTED_COLUMNS.has(key), `missing protection for ${key}`).toBe(true);
    }
  });
});

describe('findProtectedCardOrdersWrite', () => {
  it('returns "status" for the free-fulfillment payload', () => {
    // Exact payload a centre owner would use to mark their own card order paid
    // via /api/db, bypassing the cardOrderState state machine and Paymob.
    expect(
      findProtectedCardOrdersWrite({ status: 'paid', payment_status: 'paid' }),
    ).toBe('status');
  });

  it('returns "payment_status" when only the payment column is touched', () => {
    expect(findProtectedCardOrdersWrite({ payment_status: 'paid' })).toBe('payment_status');
  });

  // §9 follow-up regression cases. Each describes a real exploit shape
  // against an already-paid card_order row.
  it('returns "quantity" for the print-run tampering payload', () => {
    // Post-payment PATCH that asks the vendor to print 100 cards instead of 10.
    expect(findProtectedCardOrdersWrite({ quantity: 100 })).toBe('quantity');
  });

  it('returns "students" for a roster tampering payload', () => {
    expect(
      findProtectedCardOrdersWrite({ students: [{ id: 'x', name: 'Aya' }] }),
    ).toBe('students');
  });

  it('returns "price_per_card" for a price-drift payload', () => {
    expect(findProtectedCardOrdersWrite({ price_per_card: 0 })).toBe('price_per_card');
  });

  it('returns "total_amount" for a money-drift payload', () => {
    expect(findProtectedCardOrdersWrite({ total_amount: 0 })).toBe('total_amount');
  });

  it('returns "delivery_fee" for a shipping-money tampering payload', () => {
    expect(findProtectedCardOrdersWrite({ delivery_fee: 0 })).toBe('delivery_fee');
  });

  it('returns "delivery_address" for a redirect-cards-to-attacker payload', () => {
    // Post-payment PATCH redirects the printed cards to an arbitrary address.
    expect(
      findProtectedCardOrdersWrite({ delivery_address: '1 Attacker Lane' }),
    ).toBe('delivery_address');
  });

  it('returns "delivery_phone" for a redirect-tracking-sms payload', () => {
    expect(findProtectedCardOrdersWrite({ delivery_phone: '+201111111111' })).toBe('delivery_phone');
  });

  it('returns "delivery_governorate" / "shipping_zone" / "card_style" each individually', () => {
    expect(findProtectedCardOrdersWrite({ delivery_governorate: 'Cairo' })).toBe('delivery_governorate');
    expect(findProtectedCardOrdersWrite({ shipping_zone: 'cairo' })).toBe('shipping_zone');
    expect(findProtectedCardOrdersWrite({ card_style: 'dark' })).toBe('card_style');
  });

  it('returns null for benign updates (notes only)', () => {
    expect(
      findProtectedCardOrdersWrite({ notes: 'leave with doorman' }),
    ).toBeNull();
  });

  it('returns null for empty / non-object data', () => {
    expect(findProtectedCardOrdersWrite(null)).toBeNull();
    expect(findProtectedCardOrdersWrite({})).toBeNull();
    expect(findProtectedCardOrdersWrite([])).toBeNull();
  });
});
