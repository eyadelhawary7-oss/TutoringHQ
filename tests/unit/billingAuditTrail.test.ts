import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate money-safety wiring from WhatsApp side effects (same as the underpayment test).
vi.mock('@/lib/centerNotify', () => ({
  sendChqPaymentConfirmedTemplate: vi.fn(async () => {}),
  sendChqPaymentFailedTemplate: vi.fn(async () => {}),
  sendPaymentConfirmed: vi.fn(async () => {}),
}));

import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { logBillingEvent, invoiceOwner } from '@/lib/billingAudit';
import { makeFakeSupabase, type Row } from './billingFakeSupabase';

const audits = (t: Record<string, Row[]>) => t.audit_log ?? [];

describe('billingAudit helper', () => {
  it('logs a center event with center_id set and null user_id (append-only, system actor)', async () => {
    const tables: Record<string, Row[]> = { audit_log: [] };
    const db = makeFakeSupabase(tables);
    await logBillingEvent(db, 'invoice_paid', { ownerType: 'center', ownerId: 'c-1' }, { invoiceId: 'i-1' });
    expect(tables.audit_log).toHaveLength(1);
    expect(tables.audit_log[0]).toMatchObject({
      action: 'invoice_paid',
      entity_type: 'billing',
      entity_id: 'c-1',
      center_id: 'c-1',
      user_id: null,
    });
    expect((tables.audit_log[0].details as Row).ownerType).toBe('center');
  });

  it('logs a teacher event with null center_id (polymorphic owner)', async () => {
    const tables: Record<string, Row[]> = { audit_log: [] };
    const db = makeFakeSupabase(tables);
    await logBillingEvent(db, 'invoice_paid', { ownerType: 'teacher', ownerId: 't-1' }, {});
    expect(tables.audit_log[0]).toMatchObject({ entity_id: 't-1', center_id: null });
  });

  it('invoiceOwner derives the right owner for each type', () => {
    expect(invoiceOwner({ owner_type: 'center', center_id: 'c', teacher_id: null })).toEqual({
      ownerType: 'center',
      ownerId: 'c',
    });
    expect(invoiceOwner({ owner_type: 'teacher', center_id: null, teacher_id: 't' })).toEqual({
      ownerType: 'teacher',
      ownerId: 't',
    });
  });
});

describe('finalizeInvoicePaymentSuccess — audit trail (both owner types)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes invoice_paid for a CENTER invoice', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        {
          id: 'inv-c',
          owner_type: 'center',
          center_id: 'c-1',
          teacher_id: null,
          status: 'pending',
          invoice_type: 'late_payment_fee',
          total_amount: 200,
          amount_received: 0,
          metadata: {},
          paymob_order_id: 'ord-c',
        },
      ],
      centers: [{ id: 'c-1', billing_status: 'overdue' }],
      audit_log: [],
    };
    const db = makeFakeSupabase(tables);

    const res = await finalizeInvoicePaymentSuccess(db, 'ord-c', 'txn-c');
    expect(res).toEqual({ invoiceId: 'inv-c', settled: true });

    const paid = audits(tables).filter((a) => a.action === 'invoice_paid');
    expect(paid).toHaveLength(1);
    expect(paid[0].entity_id).toBe('c-1');
    expect((paid[0].details as Row).transactionId).toBe('txn-c');
  });

  it('writes invoice_paid for a TEACHER invoice', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        {
          id: 'inv-t',
          owner_type: 'teacher',
          center_id: null,
          teacher_id: 't-1',
          status: 'pending',
          invoice_type: 'subscription',
          total_amount: 500,
          amount_received: 0,
          metadata: {},
          paymob_order_id: 'ord-t',
        },
      ],
      teacher_subscriptions: [{ teacher_id: 't-1', status: 'past_due' }],
      audit_log: [],
    };
    const db = makeFakeSupabase(tables);

    const res = await finalizeInvoicePaymentSuccess(db, 'ord-t', 'txn-t');
    expect(res).toEqual({ invoiceId: 'inv-t', settled: true });

    const paid = audits(tables).filter((a) => a.action === 'invoice_paid');
    expect(paid).toHaveLength(1);
    expect(paid[0].entity_id).toBe('t-1');
    expect(paid[0].center_id).toBe(null);
  });

  it('writes invoice_payment_applied (not invoice_paid) for a partial payment', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        {
          id: 'inv-p',
          owner_type: 'center',
          center_id: 'c-1',
          teacher_id: null,
          status: 'pending',
          invoice_type: 'late_payment_fee',
          total_amount: 1000,
          amount_received: 0,
          metadata: {},
          paymob_order_id: 'ord-p',
        },
      ],
      centers: [{ id: 'c-1', billing_status: 'overdue' }],
      audit_log: [],
    };
    const db = makeFakeSupabase(tables);

    await finalizeInvoicePaymentSuccess(db, 'ord-p', 'txn-p1', { amountPaidEgp: 400 });
    expect(audits(tables).filter((a) => a.action === 'invoice_payment_applied')).toHaveLength(1);
    expect(audits(tables).filter((a) => a.action === 'invoice_paid')).toHaveLength(0);
  });

  it('duplicate webhook delivery does NOT double-apply or double-audit', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        {
          id: 'inv-d',
          owner_type: 'center',
          center_id: 'c-1',
          teacher_id: null,
          status: 'pending',
          invoice_type: 'late_payment_fee',
          total_amount: 200,
          amount_received: 0,
          metadata: {},
          paymob_order_id: 'ord-d',
        },
      ],
      centers: [{ id: 'c-1', billing_status: 'overdue' }],
      audit_log: [],
    };
    const db = makeFakeSupabase(tables);

    await finalizeInvoicePaymentSuccess(db, 'ord-d', 'txn-d'); // first delivery
    await finalizeInvoicePaymentSuccess(db, 'ord-d', 'txn-d'); // duplicate delivery

    expect(tables.invoices[0].amount_received).toBe(200); // not 400
    expect(audits(tables).filter((a) => a.action === 'invoice_paid')).toHaveLength(1);
  });
});
