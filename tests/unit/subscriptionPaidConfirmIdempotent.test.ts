import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Phase 6 / Fix E: the centre-subscription "paid" WhatsApp confirmation must be
// sent EXACTLY ONCE per invoice, tied to the atomic finalize. Two finalizers can
// race for the same invoice (webhook + status-poll, or a retry):
// finalize_subscription_invoice_paid marks paid atomically and returns 'completed'
// to the single winner and 'already_paid' to everyone else. We assert the confirm
// fires on 'completed' and NOT on 'already_paid' (no double-send) — not relying on
// a soft time-window dedupe.

vi.mock('@/lib/centerNotify', () => ({
  sendChqPaymentConfirmedTemplate: vi.fn().mockResolvedValue({ success: true }),
  sendChqPaymentFailedTemplate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/billingAudit', () => ({
  logBillingEvent: vi.fn().mockResolvedValue(undefined),
  invoiceOwner: (row: { owner_type?: string | null; center_id?: string | null; teacher_id?: string | null }) =>
    row.owner_type === 'teacher'
      ? { ownerType: 'teacher', ownerId: row.teacher_id }
      : { ownerType: 'center', ownerId: row.center_id },
}));
vi.mock('@/lib/signupPaymobAutoApprove', () => ({
  processInvoiceSignupAfterPaymobSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { sendChqPaymentConfirmedTemplate } from '@/lib/centerNotify';

const confirmMock = sendChqPaymentConfirmedTemplate as unknown as ReturnType<typeof vi.fn>;

function makeHarness(rpcResult: { data: unknown; error: unknown }): SupabaseClient {
  const invoice = {
    id: 'inv-sub',
    owner_type: null,
    center_id: 'c1',
    teacher_id: null,
    status: 'pending',
    invoice_type: 'subscription',
    total_amount: 1000,
    amount_received: 0,
    metadata: null,
  };
  const center = {
    billing_status: 'active',
    status: 'active',
    subscription_status: 'active',
    next_payment_due: '2026-06-01',
    subscription_start_date: null,
    billing_cycle_start: null,
    approved_at: null,
    name: 'Centre',
    phone: '+201234567890',
    billing_amount: 1000,
  };
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    from: (table: string) => {
      if (table === 'invoices') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: invoice, error: null }) }) }),
          update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'centers') {
        return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: center, error: null }) }) }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => vi.clearAllMocks());

describe('Fix E — subscription paid confirmation is exactly-once', () => {
  it('sends ONE WhatsApp confirmation when this call wins the finalize (completed)', async () => {
    const admin = makeHarness({ data: 'completed', error: null });
    const res = await finalizeInvoicePaymentSuccess(admin, 'order-1', 'tx-1');

    expect(res).toEqual({ invoiceId: 'inv-sub', settled: true });
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-send when a concurrent finalize already won (already_paid)', async () => {
    const admin = makeHarness({ data: 'already_paid', error: null });
    const res = await finalizeInvoicePaymentSuccess(admin, 'order-1', 'tx-1');

    // Still reports settled (the invoice IS paid), but the confirm is suppressed —
    // the winning call already sent it. This is the no-double-send guarantee.
    expect(res).toEqual({ invoiceId: 'inv-sub', settled: true });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('two racing finalizers (one completed, one already_paid) yield exactly one send', async () => {
    await finalizeInvoicePaymentSuccess(makeHarness({ data: 'completed', error: null }), 'order-1', 'tx-1');
    await finalizeInvoicePaymentSuccess(makeHarness({ data: 'already_paid', error: null }), 'order-1', 'tx-2');
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
