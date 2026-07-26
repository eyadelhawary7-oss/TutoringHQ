import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor';

// A center that pays a subscription renewal invoice must advance its
// next_payment_due by the RIGHT period — +12 months for an annual center, +1
// month for everyone else (monthly is the standard non-annual cadence; the
// quarterly clock is retired). We assert the value handed to
// finalize_subscription_invoice_paid (p_next_payment_due).
//
// Dates are computed relative to Date.now(), not hardcoded: computeNextPaymentDue
// now catches up a next_payment_due that is more than one period stale (see
// subscriptionAnchor.ts's computeNextPaymentDueCatchUp), so a fixed historical
// literal here would silently drift into "more than one period stale" as real
// time passes and start asserting catch-up behaviour instead of the plain
// period-math this file is actually about.

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
vi.mock('@/lib/pricingConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pricingConfig')>()),
  getIntervalConfig: vi.fn().mockResolvedValue({ annualMultiplier: 10 }),
}));
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: () => void; setLevel: () => void }) => void) =>
    fn({ setTag: () => undefined, setLevel: () => undefined }),
  captureMessage: () => undefined,
  captureException: () => undefined,
}));

import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/** Same month/day, one year earlier — Date handles Feb-29 rollover correctly. */
function oneYearEarlier(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return ymd(d);
}

type RpcCapture = { calls: Array<{ fn: string; args: Record<string, unknown> }> };

function makeHarness(
  billingPeriod: string,
  capture: RpcCapture,
  overrides: { next_payment_due?: string; subscription_start_date?: string | null } = {},
): SupabaseClient {
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
  const due = overrides.next_payment_due ?? daysFromNow(-3);
  const center = {
    billing_status: 'active',
    status: 'active',
    subscription_status: 'active',
    next_payment_due: due,
    subscription_start_date:
      overrides.subscription_start_date !== undefined
        ? overrides.subscription_start_date
        : oneYearEarlier(due), // anchor day matches `due`'s day-of-month
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
  it('annual center advances +12 months (barely stale, no catch-up)', async () => {
    const capture: RpcCapture = { calls: [] };
    const due = daysFromNow(-3);
    const res = await finalizeInvoicePaymentSuccess(
      makeHarness('annual', capture, { next_payment_due: due }),
      'order-1',
      'tx-1',
    );
    expect(res).toEqual({ invoiceId: 'inv-sub', settled: true });
    expect(nextDueOf(capture)).toBe(addMonthsToDateStr(due, 12));
  });

  it('monthly center advances +1 month (barely stale, no catch-up)', async () => {
    const capture: RpcCapture = { calls: [] };
    const due = daysFromNow(-3);
    await finalizeInvoicePaymentSuccess(makeHarness('monthly', capture, { next_payment_due: due }), 'order-1', 'tx-1');
    expect(nextDueOf(capture)).toBe(addMonthsToDateStr(due, 1));
  });

  it('a stray quarterly value also advances +1 month (no 3-month clock remains)', async () => {
    const capture: RpcCapture = { calls: [] };
    const due = daysFromNow(-3);
    await finalizeInvoicePaymentSuccess(makeHarness('quarterly', capture, { next_payment_due: due }), 'order-1', 'tx-1');
    expect(nextDueOf(capture)).toBe(addMonthsToDateStr(due, 1));
  });

  it('catch-up anchor: a monthly center stale by several missed cycles lands on/after today, not still in the past', async () => {
    // 72 days stale: a single +1-month advance would still be ~41 days in the
    // past (the exact exposure this file's neighbor, subscriptionAnchor.ts's
    // computeNextPaymentDueCatchUp, closes). End-to-end through the real
    // payment path, not just the pure function.
    const capture: RpcCapture = { calls: [] };
    const staleDue = daysFromNow(-72);
    await finalizeInvoicePaymentSuccess(
      makeHarness('monthly', capture, { next_payment_due: staleDue }),
      'order-1',
      'tx-1',
    );
    const newDue = nextDueOf(capture);
    expect(newDue).toBeDefined();
    expect(newDue! >= daysFromNow(0)).toBe(true);
  });
});
