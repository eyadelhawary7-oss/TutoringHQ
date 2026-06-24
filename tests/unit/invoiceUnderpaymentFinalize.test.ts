import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the money-safety wiring from the WhatsApp side effects.
vi.mock('@/lib/centerNotify', () => ({
  sendChqPaymentConfirmedTemplate: vi.fn(async () => {}),
  sendChqPaymentFailedTemplate: vi.fn(async () => {}),
  sendPaymentConfirmed: vi.fn(async () => {}),
}));

import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';

type Row = Record<string, unknown>;

/**
 * Minimal in-memory Supabase fake: chainable select/update/insert with eq/neq/in
 * filters. Builders are thenable so `await from().update().eq()` applies the write.
 */
function makeFakeSupabase(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | null = null;

    const apply = () => {
      const rows = tables[table] ?? (tables[table] = []);
      if (mode === 'insert') {
        rows.push({ ...(payload as Row) });
        return { data: payload, error: null };
      }
      if (mode === 'update') {
        for (const r of rows) {
          if (filters.every((f) => f(r))) Object.assign(r, payload);
        }
        return { data: null, error: null };
      }
      return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
    };

    const api: Record<string, unknown> = {
      select() {
        mode = 'select';
        return api;
      },
      update(p: Row) {
        mode = 'update';
        payload = p;
        return api;
      },
      insert(p: Row) {
        mode = 'insert';
        payload = p;
        return Promise.resolve(apply());
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return api;
      },
      neq(col: string, val: unknown) {
        filters.push((r) => r[col] !== val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      maybeSingle() {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(apply()).then(resolve);
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) } as never;
}

const ORDER = 'order-1';

function seed() {
  const tables: Record<string, Row[]> = {
    invoices: [
      {
        id: 'inv-1',
        center_id: 'c-1',
        status: 'pending',
        invoice_type: 'late_payment_fee', // simple settled handler (centers update only)
        total_amount: 999,
        amount_received: 0,
        metadata: { processing_fee: 20 },
        paymob_order_id: ORDER,
      },
    ],
    centers: [{ id: 'c-1', billing_status: 'suspended', status: 'suspended' }],
    renewal_history: [],
  };
  return tables;
}

const inv = (t: Record<string, Row[]>) => t.invoices[0];
const center = (t: Record<string, Row[]>) => t.centers[0];

describe('finalizeInvoicePaymentSuccess — underpayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a partial payment leaves the invoice unpaid, credits the partial, and does NOT unlock', async () => {
    const tables = seed();
    const db = makeFakeSupabase(tables);

    const res = await finalizeInvoicePaymentSuccess(db, ORDER, 't1', { amountPaidEgp: 900 });

    expect(res).toEqual({ invoiceId: 'inv-1', settled: false });
    expect(inv(tables).status).toBe('pending'); // still unpaid
    expect(inv(tables).amount_received).toBe(900); // held as credit
    expect((inv(tables).metadata as Row).applied_txns).toEqual(['t1']);
    // account stays locked — no billing_status flip on a partial
    expect(center(tables).billing_status).toBe('suspended');
  });

  it('paying the remaining difference settles the invoice and unlocks — one fee, never lost', async () => {
    const tables = seed();
    // start mid-way: 900 already received
    inv(tables).amount_received = 900;
    (inv(tables).metadata as Row).applied_txns = ['t1'];
    const db = makeFakeSupabase(tables);

    const res = await finalizeInvoicePaymentSuccess(db, ORDER, 't2', { amountPaidEgp: 99 });

    expect(res).toEqual({ invoiceId: 'inv-1', settled: true });
    expect(inv(tables).status).toBe('paid');
    expect(inv(tables).amount_received).toBe(999); // exact total — no extra fee added
    expect((inv(tables).metadata as Row).applied_txns).toEqual(['t1', 't2']);
    expect(center(tables).billing_status).toBe('paid'); // unlocked
  });

  it('is idempotent: replaying the same transaction never double-counts', async () => {
    const tables = seed();
    const db = makeFakeSupabase(tables);

    await finalizeInvoicePaymentSuccess(db, ORDER, 't1', { amountPaidEgp: 900 });
    const replay = await finalizeInvoicePaymentSuccess(db, ORDER, 't1', { amountPaidEgp: 900 });

    expect(replay).toEqual({ invoiceId: 'inv-1', settled: false });
    expect(inv(tables).amount_received).toBe(900); // not 1800
    expect((inv(tables).metadata as Row).applied_txns).toEqual(['t1']);
  });

  it('an already-paid invoice is a no-op', async () => {
    const tables = seed();
    inv(tables).status = 'paid';
    inv(tables).amount_received = 999;
    const db = makeFakeSupabase(tables);

    const res = await finalizeInvoicePaymentSuccess(db, ORDER, 'tX', { amountPaidEgp: 999 });
    expect(res).toEqual({ invoiceId: 'inv-1', settled: true });
    expect((inv(tables).metadata as Row).applied_txns).toBeUndefined(); // untouched
  });

  it('without an explicit amount (MIT / poll) treats the payment as covering the full balance', async () => {
    const tables = seed();
    const db = makeFakeSupabase(tables);

    const res = await finalizeInvoicePaymentSuccess(db, ORDER, 'tfull');
    expect(res).toEqual({ invoiceId: 'inv-1', settled: true });
    expect(inv(tables).status).toBe('paid');
    expect(inv(tables).amount_received).toBe(999);
    expect(center(tables).billing_status).toBe('paid');
  });
});
