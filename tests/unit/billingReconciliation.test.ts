import { describe, it, expect } from 'vitest';
import { makeFakeSupabase, type Row } from './billingFakeSupabase';
import { reconcileRecentBilling } from '@/lib/billing/reconciliation';
import type { PaymobOrderInquiryResult } from '@/lib/paymobOrderInquiry';

const NOW = new Date('2026-06-24T12:00:00Z');
const recent = '2026-06-23'; // within the 7-day window
const recentIso = '2026-06-23T10:00:00Z';

function baseTables(): Record<string, Row[]> {
  return {
    invoices: [],
    billing_reconciliation_reports: [],
    audit_log: [],
  };
}

describe('reconcileRecentBilling', () => {
  it('flags a fabricated mismatch: a paid invoice Paymob does NOT show as paid (no mutation)', async () => {
    const tables = baseTables();
    tables.invoices.push({
      id: 'inv-c1',
      owner_type: 'center',
      center_id: 'c-1',
      teacher_id: null,
      status: 'paid',
      total_amount: 1000,
      payment_method: 'paymob',
      paid_at: recentIso,
      paymob_order_id: 'order-bad',
      paymob_transaction_id: 'txn-c1',
      billing_period_start: recent,
    });
    const db = makeFakeSupabase(tables);

    const summary = await reconcileRecentBilling(db, {
      inquireOrder: async (): Promise<PaymobOrderInquiryResult> => ({ state: 'failed' }),
      finalize: async () => {
        throw new Error('finalize must NOT be called in the paid-vs-paymob direction');
      },
      now: () => NOW,
    });

    expect(summary.paidChecked).toBe(1);
    expect(summary.mismatchesFlagged).toBe(1);
    expect(summary.selfHealed).toBe(0);
    // surfaced for review, NOT auto-mutated
    const report = tables.billing_reconciliation_reports[0];
    expect(report.kind).toBe('paid_without_paymob_success');
    expect(report.status).toBe('open');
    expect(report.owner_type).toBe('center');
    expect(tables.invoices[0].status).toBe('paid'); // untouched
  });

  it('self-heals the one safe direction: Paymob paid but our invoice unfinalized (centers)', async () => {
    const tables = baseTables();
    tables.invoices.push({
      id: 'inv-c2',
      owner_type: 'center',
      center_id: 'c-2',
      teacher_id: null,
      status: 'pending',
      total_amount: 1000,
      payment_method: 'paymob',
      paymob_order_id: 'order-paid',
      paymob_transaction_id: null,
      billing_period_start: recent,
      due_date: recent,
      created_at: recentIso,
    });
    const db = makeFakeSupabase(tables);

    let finalizeArgs: { order: string; txn: string } | null = null;
    const summary = await reconcileRecentBilling(db, {
      inquireOrder: async (): Promise<PaymobOrderInquiryResult> => ({ state: 'paid', transactionId: 'txn-found' }),
      finalize: async (_s, order, txn) => {
        finalizeArgs = { order, txn };
        return { invoiceId: 'inv-c2', settled: true };
      },
      now: () => NOW,
    });

    expect(summary.selfHealed).toBe(1);
    expect(summary.mismatchesFlagged).toBe(0);
    expect(finalizeArgs).toEqual({ order: 'order-paid', txn: 'txn-found' });
    const report = tables.billing_reconciliation_reports[0];
    expect(report.kind).toBe('paymob_paid_unfinalized');
    expect(report.status).toBe('self_healed');
    // audit entry for the self-heal
    expect(tables.audit_log.some((a) => a.action === 'reconciliation_self_heal')).toBe(true);
  });

  it('self-heals teacher invoices through the SAME finalizer (owner-agnostic)', async () => {
    const tables = baseTables();
    tables.invoices.push({
      id: 'inv-t1',
      owner_type: 'teacher',
      center_id: null,
      teacher_id: 't-1',
      status: 'failed',
      total_amount: 500,
      payment_method: 'paymob',
      paymob_order_id: 'order-teacher',
      paymob_transaction_id: null,
      billing_period_start: recent,
      due_date: recent,
      created_at: recentIso,
    });
    const db = makeFakeSupabase(tables);

    const summary = await reconcileRecentBilling(db, {
      inquireOrder: async (): Promise<PaymobOrderInquiryResult> => ({ state: 'paid', transactionId: 'txn-t' }),
      finalize: async () => ({ invoiceId: 'inv-t1', settled: true }),
      now: () => NOW,
    });

    expect(summary.selfHealed).toBe(1);
    const report = tables.billing_reconciliation_reports[0];
    expect(report.owner_type).toBe('teacher');
    expect(report.owner_id).toBe('t-1');
    expect(report.status).toBe('self_healed');
  });

  it('does NOT touch an unpaid invoice Paymob also reports unpaid (no false heal)', async () => {
    const tables = baseTables();
    tables.invoices.push({
      id: 'inv-c3',
      owner_type: 'center',
      center_id: 'c-3',
      teacher_id: null,
      status: 'pending',
      total_amount: 1000,
      payment_method: 'paymob',
      paymob_order_id: 'order-unpaid',
      billing_period_start: recent,
      due_date: recent,
      created_at: recentIso,
    });
    const db = makeFakeSupabase(tables);

    const summary = await reconcileRecentBilling(db, {
      inquireOrder: async (): Promise<PaymobOrderInquiryResult> => ({ state: 'pending' }),
      finalize: async () => {
        throw new Error('must not finalize an invoice Paymob does not show as paid');
      },
      now: () => NOW,
    });

    expect(summary.unpaidChecked).toBe(1);
    expect(summary.selfHealed).toBe(0);
    expect(summary.mismatchesFlagged).toBe(0);
    expect(tables.billing_reconciliation_reports).toHaveLength(0);
    expect(tables.invoices[0].status).toBe('pending');
  });

  it('flags (does not silently drop) a Paymob-paid invoice the finalizer cannot settle', async () => {
    const tables = baseTables();
    tables.invoices.push({
      id: 'inv-c4',
      owner_type: 'center',
      center_id: 'c-4',
      teacher_id: null,
      status: 'pending',
      total_amount: 1000,
      payment_method: 'paymob',
      paymob_order_id: 'order-x',
      billing_period_start: recent,
      due_date: recent,
      created_at: recentIso,
    });
    const db = makeFakeSupabase(tables);

    const summary = await reconcileRecentBilling(db, {
      inquireOrder: async (): Promise<PaymobOrderInquiryResult> => ({ state: 'paid', transactionId: 'txn' }),
      finalize: async () => null, // could not settle
      now: () => NOW,
    });

    expect(summary.selfHealed).toBe(0);
    expect(summary.mismatchesFlagged).toBe(1);
    expect(tables.billing_reconciliation_reports[0].kind).toBe('paymob_paid_unfinalized');
    expect(tables.billing_reconciliation_reports[0].status).toBe('open');
  });

  it('catches a boundary-edge mismatch: invoice DUE in-window but period started long ago', async () => {
    // The webhook-missed case for a monthly invoice: billing_period_start is ~a
    // month old (far outside the 7-day window) but the invoice fell DUE — and was
    // Paymob-paid — within the window. The old `billing_period_start >= cutoff`
    // filter dropped this row entirely (the boundary gap); the corrected
    // created_at/due_date window picks it up and self-heals it.
    const tables = baseTables();
    tables.invoices.push({
      id: 'inv-boundary',
      owner_type: 'center',
      center_id: 'c-b',
      teacher_id: null,
      status: 'overdue',
      total_amount: 1000,
      payment_method: 'paymob',
      paymob_order_id: 'order-boundary',
      paymob_transaction_id: null,
      // Period started 35 days ago — OUTSIDE the 7-day window. Old filter missed it.
      billing_period_start: '2026-05-20',
      created_at: '2026-05-20T08:00:00Z',
      // …but it fell due (and was paid at Paymob) yesterday — INSIDE the window.
      due_date: recent,
    });
    const db = makeFakeSupabase(tables);

    let finalized = false;
    const summary = await reconcileRecentBilling(db, {
      inquireOrder: async (): Promise<PaymobOrderInquiryResult> => ({ state: 'paid', transactionId: 'txn-b' }),
      finalize: async () => {
        finalized = true;
        return { invoiceId: 'inv-boundary', settled: true };
      },
      now: () => NOW,
    });

    expect(summary.unpaidChecked).toBe(1); // would be 0 under the old period-start filter
    expect(summary.selfHealed).toBe(1);
    expect(finalized).toBe(true);
    expect(tables.billing_reconciliation_reports[0].status).toBe('self_healed');
  });

  it('is idempotent: re-running does not pile up duplicate open mismatch rows', async () => {
    const tables = baseTables();
    tables.invoices.push({
      id: 'inv-c5',
      owner_type: 'center',
      center_id: 'c-5',
      teacher_id: null,
      status: 'paid',
      total_amount: 1000,
      payment_method: 'paymob',
      paid_at: recentIso,
      paymob_order_id: 'order-dup',
      billing_period_start: recent,
    });
    const db = makeFakeSupabase(tables);
    const deps = {
      inquireOrder: async (): Promise<PaymobOrderInquiryResult> => ({ state: 'pending' }),
      finalize: async () => null,
      now: () => NOW,
    };

    await reconcileRecentBilling(db, deps);
    await reconcileRecentBilling(db, deps);

    const open = tables.billing_reconciliation_reports.filter(
      (r) => r.kind === 'paid_without_paymob_success' && r.status === 'open',
    );
    expect(open).toHaveLength(1);
  });
});
