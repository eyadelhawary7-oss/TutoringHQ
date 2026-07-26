import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeSubscriptionInvoiceReprice,
  repriceSubscriptionInvoice,
} from '@/lib/repriceSubscriptionInvoice';

describe('computeSubscriptionInvoiceReprice — pure calc', () => {
  it('reuses the existing fee, does not re-derive it from config', () => {
    const r = computeSubscriptionInvoiceReprice({
      newBase: 12999,
      existingFee: 20,
      amountReceived: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.base).toBe(12999);
    expect(r.value.fee).toBe(20);
    expect(r.value.total).toBe(13019);
  });

  it('computes a fresh VAT snapshot for the NEW total, not the old one', () => {
    const r = computeSubscriptionInvoiceReprice({
      newBase: 12999,
      existingFee: 20,
      amountReceived: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // vat = total * 0.14 / 1.14
    expect(r.value.vatAmount).toBeCloseTo((13019 * 0.14) / 1.14, 2);
    expect(r.value.vatRate).toBe(0.14);
  });

  it('preserves a custom existing VAT rate rather than defaulting to 14%', () => {
    const r = computeSubscriptionInvoiceReprice({
      newBase: 1000,
      existingFee: 20,
      existingVatRate: 0.2,
      amountReceived: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.vatRate).toBe(0.2);
  });

  it('refuses with a specific code when a partial payment has already been received', () => {
    const r = computeSubscriptionInvoiceReprice({
      newBase: 12999,
      existingFee: 20,
      amountReceived: 500,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('PARTIAL_PAYMENT_RECEIVED');
    expect(r.message).toContain('500');
  });

  it('refuses a non-positive new base rather than writing a zero/negative invoice', () => {
    const r = computeSubscriptionInvoiceReprice({
      newBase: 0,
      existingFee: 20,
      amountReceived: 0,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_NEW_BASE');
  });

  it('a missing/zero existing fee reprices to base only (no fee invented)', () => {
    const r = computeSubscriptionInvoiceReprice({
      newBase: 1000,
      existingFee: 0,
      amountReceived: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fee).toBe(0);
    expect(r.value.total).toBe(1000);
  });
});

describe('repriceSubscriptionInvoice — DB wrapper', () => {
  let invoiceRow: Record<string, unknown> | null;
  const updateCalls: { payload: Record<string, unknown>; eqCalls: unknown[][] }[] = [];

  function makeAdmin() {
    return {
      from: (table: string) => {
        if (table !== 'invoices') throw new Error(`unexpected table: ${table}`);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: invoiceRow, error: null }),
              }),
              maybeSingle: async () => ({ data: invoiceRow, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            const eqCalls: unknown[][] = [];
            const chain = {
              eq: (...args: unknown[]) => {
                eqCalls.push(args);
                return chain;
              },
              then: (ok: (v: { error: null }) => unknown) => {
                updateCalls.push({ payload, eqCalls });
                return Promise.resolve({ error: null }).then(ok);
              },
            };
            return chain;
          },
        };
      },
    } as unknown as Parameters<typeof repriceSubscriptionInvoice>[0];
  }

  beforeEach(() => {
    updateCalls.length = 0;
    invoiceRow = null;
  });

  function pendingSubscriptionInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inv-1',
      center_id: 'center-1',
      invoice_type: 'subscription',
      status: 'pending',
      amount_received: 0,
      processing_fee: 20,
      vat_rate: 0.14,
      metadata: { processing_fee: 20 },
      ...overrides,
    };
  }

  it('reprices a pending subscription invoice and clears the cached checkout', async () => {
    invoiceRow = pendingSubscriptionInvoice();
    const admin = makeAdmin();

    const res = await repriceSubscriptionInvoice(admin, {
      invoiceId: 'inv-1',
      centerId: 'center-1',
      newBase: 12999,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.total).toBe(13019);
    expect(res.fee).toBe(20);

    expect(updateCalls).toHaveLength(1);
    const { payload } = updateCalls[0];
    expect(payload).toMatchObject({
      base_amount: 12999,
      total_amount: 13019,
      processing_fee: 20,
      paymob_order_id: null,
      paymob_iframe_url: null,
    });
    expect((payload.metadata as Record<string, unknown>).processing_fee).toBe(20);
  });

  it('refuses when the invoice is not found', async () => {
    invoiceRow = null;
    const admin = makeAdmin();

    const res = await repriceSubscriptionInvoice(admin, {
      invoiceId: 'missing',
      centerId: 'center-1',
      newBase: 12999,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('INVOICE_NOT_FOUND');
    expect(updateCalls).toHaveLength(0);
  });

  it('refuses an invoice that is not invoice_type=subscription (e.g. the upgrade-difference invoice)', async () => {
    invoiceRow = pendingSubscriptionInvoice({ invoice_type: 'plan_upgrade_difference' });
    const admin = makeAdmin();

    const res = await repriceSubscriptionInvoice(admin, {
      invoiceId: 'inv-1',
      centerId: 'center-1',
      newBase: 12999,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('INVOICE_NOT_SUBSCRIPTION');
    expect(updateCalls).toHaveLength(0);
  });

  it('refuses an invoice that is already paid', async () => {
    invoiceRow = pendingSubscriptionInvoice({ status: 'paid' });
    const admin = makeAdmin();

    const res = await repriceSubscriptionInvoice(admin, {
      invoiceId: 'inv-1',
      centerId: 'center-1',
      newBase: 12999,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('INVOICE_NOT_PAYABLE');
    expect(updateCalls).toHaveLength(0);
  });

  it('refuses and does NOT write when amount_received > 0 (partial payment)', async () => {
    invoiceRow = pendingSubscriptionInvoice({ amount_received: 500 });
    const admin = makeAdmin();

    const res = await repriceSubscriptionInvoice(admin, {
      invoiceId: 'inv-1',
      centerId: 'center-1',
      newBase: 12999,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('PARTIAL_PAYMENT_RECEIVED');
    expect(updateCalls).toHaveLength(0);
  });

  it('falls back to metadata.processing_fee only if the processing_fee column is null', async () => {
    invoiceRow = pendingSubscriptionInvoice({ processing_fee: null, metadata: { processing_fee: 20 } });
    const admin = makeAdmin();

    const res = await repriceSubscriptionInvoice(admin, {
      invoiceId: 'inv-1',
      centerId: 'center-1',
      newBase: 1000,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fee).toBe(20);
    expect(res.total).toBe(1020);
  });
});
