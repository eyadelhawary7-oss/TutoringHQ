import { describe, it, expect } from 'vitest';
import { resolveOwnerForOrder } from '@/lib/savedCard/handleTokenCallback';
import { makeFakeSupabase, type Row } from './billingFakeSupabase';

/**
 * W3 / Gap 2 — a Paymob TOKEN callback must resolve TEACHER owners, not just
 * centers. Teachers now flow through the same `invoices` machinery
 * (owner_type='teacher', teacher_id set, center_id null), so resolving by
 * center_id alone would drop a teacher's saved card (owner_unresolved).
 */
describe('resolveOwnerForOrder — token callback owner resolution (Gap 2)', () => {
  it('resolves a TEACHER owner from a teacher-owned invoice', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        {
          id: 'inv-t',
          paymob_order_id: 'ord_teacher',
          owner_type: 'teacher',
          teacher_id: 'teacher-9',
          center_id: null,
        },
      ],
    };
    const owner = await resolveOwnerForOrder(makeFakeSupabase(tables), 'ord_teacher');
    expect(owner).toEqual({ ownerType: 'teacher', ownerId: 'teacher-9' });
  });

  it('still resolves a CENTER owner from a center-owned invoice', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        {
          id: 'inv-c',
          paymob_order_id: 'ord_center',
          owner_type: 'center',
          teacher_id: null,
          center_id: 'center-3',
        },
      ],
    };
    const owner = await resolveOwnerForOrder(makeFakeSupabase(tables), 'ord_center');
    expect(owner).toEqual({ ownerType: 'center', ownerId: 'center-3' });
  });

  it('falls back to a combined_payment_session (center) when no invoice matches', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [],
      combined_payment_sessions: [{ paymob_order_id: 'ord_sess', center_id: 'center-7' }],
    };
    const owner = await resolveOwnerForOrder(makeFakeSupabase(tables), 'ord_sess');
    expect(owner).toEqual({ ownerType: 'center', ownerId: 'center-7' });
  });

  it('returns null for an unknown order and for an empty order id', async () => {
    const tables: Record<string, Row[]> = { invoices: [], combined_payment_sessions: [] };
    expect(await resolveOwnerForOrder(makeFakeSupabase(tables), 'nope')).toBeNull();
    expect(await resolveOwnerForOrder(makeFakeSupabase(tables), '')).toBeNull();
  });
});
