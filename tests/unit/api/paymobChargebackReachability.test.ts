/**
 * FIX A — a genuine chargeback (is_voided / is_refunded) must reach finalizeInvoiceChargeback
 * (and therefore the commission clawback) EVEN THOUGH the invoice / combined session is already
 * status='paid'. Chargebacks arrive after capture, so the paid-status idempotency guards must
 * not short-circuit them. Before the fix, the guards returned first and the reversal never ran.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

const H = vi.hoisted(() => {
  const state: { maybeSingle: Record<string, unknown> } = { maybeSingle: {} };
  const fakeClient = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.maybeSingle = async () => ({ data: state.maybeSingle[table] ?? null, error: null });
      return b;
    },
  };
  const finalizeChargebackMock = vi.fn().mockResolvedValue(undefined);
  return { state, fakeClient, finalizeChargebackMock };
});

vi.mock('@/lib/invoicePaymobPayment', () => ({
  finalizeInvoiceChargeback: (...a: unknown[]) => H.finalizeChargebackMock(...a),
  finalizeInvoicePaymentSuccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => H.fakeClient,
  supabaseAdmin: H.fakeClient,
}));

import { processPaymobEvent } from '@/app/api/paymob/webhook/route';

const payload = (obj: Record<string, unknown>) => ({ obj });

beforeEach(() => {
  H.finalizeChargebackMock.mockClear();
  H.state.maybeSingle = {};
});

describe('paymob webhook — chargeback reachability (FIX A)', () => {
  it('routes a REFUND chargeback to finalizeInvoiceChargeback even though the invoice is already paid', async () => {
    H.state.maybeSingle = {
      combined_payment_sessions: { id: 's1', status: 'paid' },
      invoices: { id: 'i1', status: 'paid' },
    };
    await processPaymobEvent(payload({ order: { id: 123 }, id: 'txn1', is_refunded: true }));
    expect(H.finalizeChargebackMock).toHaveBeenCalledWith(H.fakeClient, '123', 'txn1');
  });

  it('routes a VOID chargeback (string "true") to finalizeInvoiceChargeback', async () => {
    H.state.maybeSingle = { invoices: { id: 'i1', status: 'paid' } };
    await processPaymobEvent(payload({ order: { id: 456 }, id: 'txn2', is_voided: 'true' }));
    expect(H.finalizeChargebackMock).toHaveBeenCalledWith(H.fakeClient, '456', 'txn2');
  });

  it('a normal PAID (non-chargeback) event does NOT hit the chargeback path — the paid guard still returns', async () => {
    H.state.maybeSingle = { combined_payment_sessions: { id: 's1', status: 'paid' } };
    await processPaymobEvent(payload({ order: { id: 789 }, id: 'txn3', success: true }));
    expect(H.finalizeChargebackMock).not.toHaveBeenCalled();
  });
});
