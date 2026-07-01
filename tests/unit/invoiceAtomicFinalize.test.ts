import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// FIX 3: the invoice "paid" side-effects must be atomic. The centre-subscription
// and teacher recurring paths now mark the invoice paid AND apply their
// dependent writes inside a SINGLE RPC. We assert: (a) the side-effects go
// through one rpc() call, NOT separate table writes, and (b) on an RPC error the
// finalizer returns null and never marks the invoice paid out-of-band (the whole
// unit rolls back — no paid-but-not-extended state can survive).

vi.mock('@/lib/centerNotify', () => ({
  sendChqPaymentConfirmedTemplate: vi.fn().mockResolvedValue(undefined),
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

type Harness = {
  admin: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
  invoicesUpdateEq: ReturnType<typeof vi.fn>;
};

function makeHarness(opts: {
  invoice: Record<string, unknown>;
  center?: Record<string, unknown> | null;
  rpcResult: { data: unknown; error: unknown };
}): Harness {
  const invoiceSelectMaybeSingle = vi.fn().mockResolvedValue({ data: opts.invoice, error: null });
  const centerSelectMaybeSingle = vi.fn().mockResolvedValue({ data: opts.center ?? null, error: null });
  const invoicesUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult);

  const admin = {
    rpc,
    from: (table: string) => {
      if (table === 'invoices') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: invoiceSelectMaybeSingle }) }),
          update: () => ({ eq: invoicesUpdateEq }),
        };
      }
      if (table === 'centers') {
        return { select: () => ({ eq: () => ({ maybeSingle: centerSelectMaybeSingle }) }) };
      }
      if (table === 'teacher_subscriptions') {
        // Interval lookup before the advance RPC (annual → 12-month period).
        return {
          select: () => ({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { billing_interval: 'monthly' }, error: null }) }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { admin, rpc, invoicesUpdateEq };
}

const SUB_INVOICE = {
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

const CENTER_ROW = {
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

const TEACHER_INVOICE = {
  id: 'inv-teach',
  owner_type: 'teacher',
  center_id: null,
  teacher_id: 't1',
  status: 'pending',
  invoice_type: 'subscription',
  total_amount: 500,
  amount_received: 0,
  metadata: null,
};

beforeEach(() => vi.clearAllMocks());

describe('finalizeInvoicePaymentSuccess — centre subscription is atomic', () => {
  it('routes the paid side-effects through ONE rpc and does not write the invoice separately', async () => {
    const h = makeHarness({ invoice: SUB_INVOICE, center: CENTER_ROW, rpcResult: { data: 'completed', error: null } });
    const res = await finalizeInvoicePaymentSuccess(h.admin, 'order-1', 'tx-1');

    expect(res).toEqual({ invoiceId: 'inv-sub', settled: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls[0][0]).toBe('finalize_subscription_invoice_paid');
    // Mark-paid happens INSIDE the RPC — no standalone invoices.update.
    expect(h.invoicesUpdateEq).not.toHaveBeenCalled();
  });

  it('on a simulated mid-step failure (RPC error) returns null and never marks the invoice paid out-of-band', async () => {
    const h = makeHarness({ invoice: SUB_INVOICE, center: CENTER_ROW, rpcResult: { data: null, error: { message: 'centers update blew up' } } });
    const res = await finalizeInvoicePaymentSuccess(h.admin, 'order-1', 'tx-1');

    expect(res).toBeNull();
    // The atomic RPC rolled back; no out-of-band invoice paid write leaked.
    expect(h.invoicesUpdateEq).not.toHaveBeenCalled();
  });
});

describe('finalizeInvoicePaymentSuccess — teacher subscription is atomic', () => {
  it('routes the paid + subscription-advance through ONE rpc', async () => {
    const h = makeHarness({ invoice: TEACHER_INVOICE, rpcResult: { data: 'completed', error: null } });
    const res = await finalizeInvoicePaymentSuccess(h.admin, 'order-2', 'tx-2');

    expect(res).toEqual({ invoiceId: 'inv-teach', settled: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls[0][0]).toBe('finalize_teacher_invoice_paid');
    expect(h.invoicesUpdateEq).not.toHaveBeenCalled();
  });

  it('rolls back fully on RPC error (returns null, invoice not separately marked paid)', async () => {
    const h = makeHarness({ invoice: TEACHER_INVOICE, rpcResult: { data: null, error: { message: 'sub advance failed' } } });
    const res = await finalizeInvoicePaymentSuccess(h.admin, 'order-2', 'tx-2');

    expect(res).toBeNull();
    expect(h.invoicesUpdateEq).not.toHaveBeenCalled();
  });
});
