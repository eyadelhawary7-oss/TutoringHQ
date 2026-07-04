import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// A center that pays a subscription renewal invoice must advance its
// next_payment_due by the RIGHT period — +12 months for an annual center, +1
// month for everyone else (monthly is the standard non-annual cadence; the
// quarterly clock is retired). We assert the value handed to
// finalize_subscription_invoice_paid (p_next_payment_due).

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
vi.mock('@/lib/pricingConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pricingConfig')>()),
  getIntervalConfig: vi.fn().mockResolvedValue({ annualMultiplier: 10 }),
}));

import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';

type RpcCapture = { calls: Array<{ fn: string; args: Record<string, unknown> }> };

function makeHarness(billingPeriod: string, capture: RpcCapture): SupabaseClient {
  const invoice = {
    id: 'inv-sub',
    owner_type: null,
    center_id: 'c1',
    teacher_id: null,
    status: 'pending',
    invoice_type: 'subscription',
    total_amount: 10000,
    amount_received: 0,
    metadata: null,
  };
  const center = {
    billing_status: 'active',
    status: 'active',
    subscription_status: 'active',
    next_payment_due: '2026-06-01',
    subscription_start_date: '2025-06-01', // anchor day = 1
    billing_cycle_start: null,
    approved_at: null,
    name: 'Centre',
    phone: '+201234567890',
    billing_amount: 3000,
    billing_period: billingPeriod,
    all_in_price: 1000,
    scheduled_plan: null,
    scheduled_billing_period: null,
  };
  return {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      capture.calls.push({ fn, args });
      return Promise.resolve({ data: 'completed', error: null });
    }),
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

function nextDueOf(capture: RpcCapture): string | undefined {
  const call = capture.calls.find((c) => c.fn === 'finalize_subscription_invoice_paid');
  return call?.args.p_next_payment_due as string | undefined;
}

beforeEach(() => vi.clearAllMocks());

describe('center annual renewal — period-aware next_payment_due', () => {
  it('annual center advances +12 months (2026-06-01 → 2027-06-01)', async () => {
    const capture: RpcCapture = { calls: [] };
    const res = await finalizeInvoicePaymentSuccess(makeHarness('annual', capture), 'order-1', 'tx-1');
    expect(res).toEqual({ invoiceId: 'inv-sub', settled: true });
    expect(nextDueOf(capture)).toBe('2027-06-01');
  });

  it('monthly center advances +1 month (2026-06-01 → 2026-07-01)', async () => {
    const capture: RpcCapture = { calls: [] };
    await finalizeInvoicePaymentSuccess(makeHarness('monthly', capture), 'order-1', 'tx-1');
    expect(nextDueOf(capture)).toBe('2026-07-01');
  });

  it('a stray quarterly value also advances +1 month (no 3-month clock remains)', async () => {
    const capture: RpcCapture = { calls: [] };
    await finalizeInvoicePaymentSuccess(makeHarness('quarterly', capture), 'order-1', 'tx-1');
    expect(nextDueOf(capture)).toBe('2026-07-01');
  });
});
