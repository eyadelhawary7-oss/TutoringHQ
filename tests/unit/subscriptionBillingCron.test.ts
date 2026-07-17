import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeSupabase, type Row } from './billingFakeSupabase';

// The cron pulls in several IO/config leaves. Mock exactly those; keep the pure
// billing math (centerRenewal, processingFee, subscriptionAnchor, taxMath,
// topCentersPrice) real so the test exercises the actual amounts + guards.
const createActionSpy = vi.hoisted(() =>
  vi.fn<(supabase: unknown, input: unknown) => Promise<unknown>>(async () => ({})),
);

vi.mock('@/lib/pricingConfig', () => ({
  getProcessingFeeConfig: async () => ({ enabled: true, amount: 20 }),
  getIntervalConfig: async () => ({ annualMultiplier: 10 }),
}));
vi.mock('@/lib/ceo', () => ({ createAction: createActionSpy }));
vi.mock('@/lib/commissions', () => ({ pauseCommissionClocks: async () => {} }));
vi.mock('@/lib/centerNotify', () => ({
  sendChqRenewalOverdueTemplate: async () => ({ success: false }),
}));
vi.mock('@/lib/billingAudit', () => ({
  logBillingEvent: async () => {},
  invoiceOwner: () => ({}),
}));
vi.mock('@/lib/scheduledDowngrade', () => ({
  resolveScheduledCenterDowngrade: async () => null,
}));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: () => {},
  withScope: (cb: (scope: { setTag: () => void; setLevel: () => void }) => void) =>
    cb({ setTag: () => {}, setLevel: () => {} }),
}));

import { runSubscriptionBillingCron } from '@/lib/subscriptionBillingCron';
import { todayISO } from '@/lib/parentPack';

function addDaysYmd(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const today = todayISO();
const in7 = addDaysYmd(today, 7);
const past3 = addDaysYmd(today, -3);
const future30 = addDaysYmd(today, 30);

function baseCenter(over: Partial<Row>): Row {
  return {
    status: 'active',
    subscription_status: 'active',
    billing_status: 'active',
    billing_type: 'fixed',
    pricing_type: null,
    billing_period: 'monthly',
    plan: 'starter',
    billing_amount: 1000,
    all_in_price: 1000,
    center_code: null,
    referral_code: null,
    scheduled_plan: null,
    scheduled_billing_period: null,
    name: 'C',
    phone: null,
    ...over,
  };
}

describe('runSubscriptionBillingCron (B-H2 / B-H3 / B-H4)', () => {
  beforeEach(() => {
    createActionSpy.mockClear();
    // The B-H2 auto-suspend is now gated by the auto-charge interlock (PR A). Give it a
    // real recurring credential so the existing suspend assertions exercise that path;
    // the interlock skip is covered by its own test below.
    process.env.PAYMOB_RECURRING_INTEGRATION_ID = 'test-recurring-id';
  });

  it('B-H3: creates the renewal invoice for a MISSED overdue center (not only exactly due+7)', async () => {
    const tables: Record<string, Row[]> = {
      centers: [baseCenter({ id: 'missed', next_payment_due: past3 })],
      invoices: [],
    };
    const out = await runSubscriptionBillingCron(makeFakeSupabase(tables));
    const inv = tables.invoices.find((i) => i.center_id === 'missed');
    expect(inv, 'catch-up invoice should be created for the overdue center').toBeTruthy();
    expect(inv?.invoice_type).toBe('subscription');
    expect(out.invoicesCreated).toBeGreaterThanOrEqual(1);
  });

  it('B-H3: is idempotent — no duplicate invoice when one already exists for the period', async () => {
    const tables: Record<string, Row[]> = {
      centers: [baseCenter({ id: 'dup', next_payment_due: in7 })],
      invoices: [
        { id: 'existing', center_id: 'dup', invoice_type: 'subscription', billing_period_start: in7 },
      ],
    };
    await runSubscriptionBillingCron(makeFakeSupabase(tables));
    const subs = tables.invoices.filter((i) => i.center_id === 'dup' && i.invoice_type === 'subscription');
    expect(subs).toHaveLength(1);
  });

  it('B-H2: suspends an overdue unpaid center, but NOT one due today or one paid ahead', async () => {
    const tables: Record<string, Row[]> = {
      centers: [
        baseCenter({ id: 'overdue', next_payment_due: past3, billing_status: 'active' }),
        baseCenter({ id: 'due_today', next_payment_due: today, billing_status: 'active' }),
        baseCenter({ id: 'paid_ahead', next_payment_due: future30, billing_status: 'paid' }),
      ],
      invoices: [],
    };
    const out = await runSubscriptionBillingCron(makeFakeSupabase(tables));
    const byId = (id: string) => tables.centers.find((c) => c.id === id)!;
    expect(byId('overdue').status, 'overdue → locked').toBe('suspended');
    expect(byId('due_today').status, 'due today keeps full access').toBe('active');
    expect(byId('paid_ahead').status, 'paid-ahead untouched').toBe('active');
    expect(out.autoSuspended).toBe(1);
  });

  it('B-H2 interlock: does NOT suspend while auto-charge is inert (placeholder credential)', async () => {
    // While PAYMOB_RECURRING_INTEGRATION_ID is a placeholder the saved-card engine
    // cannot charge, so suspending an unpaid center would paywall it with no automated
    // way to have paid. The suspend must be skipped and the center left active.
    process.env.PAYMOB_RECURRING_INTEGRATION_ID = 'placeholder';
    const tables: Record<string, Row[]> = {
      centers: [baseCenter({ id: 'overdue', next_payment_due: past3, billing_status: 'active' })],
      invoices: [],
    };
    const out = await runSubscriptionBillingCron(makeFakeSupabase(tables));
    const overdue = tables.centers.find((c) => c.id === 'overdue')!;
    expect(overdue.status, 'stays active while auto-charge is inert').toBe('active');
    expect(out.autoSuspended).toBe(0);
  });

  it('B-H4: skips a top_centers renewal with NULL all_in_price and enqueues a CEO action', async () => {
    const tables: Record<string, Row[]> = {
      centers: [
        baseCenter({ id: 'top_null', plan: 'top_centers', billing_period: 'annual', all_in_price: null, next_payment_due: in7 }),
      ],
      invoices: [],
    };
    await runSubscriptionBillingCron(makeFakeSupabase(tables));
    expect(tables.invoices.find((i) => i.center_id === 'top_null'), 'no 0 EGP invoice').toBeUndefined();
    expect(createActionSpy).toHaveBeenCalledTimes(1);
    expect(createActionSpy.mock.calls[0]?.[1]).toMatchObject({ type: 'billing_blocked', center_id: 'top_null' });
  });

  it('B-H4: a top_centers center WITH a valid all_in_price still bills normally', async () => {
    const tables: Record<string, Row[]> = {
      centers: [
        baseCenter({ id: 'top_ok', plan: 'top_centers', billing_period: 'annual', all_in_price: 5000, next_payment_due: in7 }),
      ],
      invoices: [],
    };
    await runSubscriptionBillingCron(makeFakeSupabase(tables));
    const inv = tables.invoices.find((i) => i.center_id === 'top_ok');
    expect(inv, 'top_centers with price bills').toBeTruthy();
    expect(Number(inv?.total_amount)).toBeGreaterThan(0);
    expect(createActionSpy).not.toHaveBeenCalled();
  });
});
