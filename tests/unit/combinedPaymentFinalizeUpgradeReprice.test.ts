import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tryFinalizeCombinedPaymentSession } from '@/lib/combinedPaymentFinalize';

// A mid-cycle tier upgrade keeps the renewal date (G7): the difference invoice
// pays for the rest of THIS period, but if the cron already created the
// upcoming renewal invoice (the next_payment_due - 7 window), it still bears
// the OLD tier's price. This proves that once the upgrade payment is
// finalized, that pending renewal invoice is repriced to the NEW tier — so
// the next renewal doesn't bill the plan the customer just paid to leave.
//
// Deliberately only happens at finalize (payment) time, not at request time:
// an upgrade activates only after payment (G6), and repricing the renewal
// invoice before the difference is actually paid would let a customer who
// never completes checkout see a higher renewal price they never paid for.

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: () => void; setLevel: () => void }) => void) =>
    fn({ setTag: () => undefined, setLevel: () => undefined }),
  captureException: () => undefined,
  captureMessage: () => undefined,
}));
vi.mock('@/lib/teacherReferral', () => ({
  grantReferralReward: vi.fn().mockResolvedValue(undefined),
}));

const NPD = '2027-01-15'; // matches meta.billingAnchorYmd below (a real future date)

const baseSession = {
  id: 'sess-upg-1',
  center_id: 'center-1',
  status: 'pending',
  session_type: 'upgrade',
  credit_amount: 0,
  invoice_ids: ['diff-inv-1'],
  paymob_order_id: 'ord-1',
  metadata: {
    newPlan: 'business',
    newBillingPeriod: 'monthly',
    previousPlan: 'pro',
    previousBillingPeriod: 'monthly',
    billingAnchorYmd: NPD,
  },
};

const baseCenter = {
  upgrade_count_this_period: 0,
  next_payment_due: NPD,
};

interface Harness {
  supabase: unknown;
  updateCalls: { table: string; payload: Record<string, unknown> }[];
  insertCalls: { table: string; payload: unknown }[];
  invoicesSelectCount: number;
}

function makeHarness(opts: {
  pendingRenewal: Record<string, unknown> | null;
  repriceInvoiceRow?: Record<string, unknown> | null;
}): Harness {
  const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];
  const insertCalls: { table: string; payload: unknown }[] = [];
  let invoicesSelectCount = 0;

  function makeChain(table: string, singleResult: unknown) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      limit: () => chain,
      order: () => chain,
      maybeSingle: async () => {
        if (table === 'invoices') {
          invoicesSelectCount += 1;
          // 1st invoices select in the upgrade branch = the pending-renewal lookup.
          // 2nd = repriceSubscriptionInvoice's own internal fetch.
          if (invoicesSelectCount === 1) return { data: opts.pendingRenewal, error: null };
          return { data: opts.repriceInvoiceRow ?? null, error: null };
        }
        return { data: singleResult, error: null };
      },
      single: async () => ({ data: singleResult, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: singleResult, error: null }).then(ok),
    };
    return chain;
  }

  const supabase = {
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'try_finalize_payment_session') return { data: true, error: null };
      if (fn === 'finalize_combined_session_paid') return { data: 'completed', error: null };
      return { data: null, error: null };
    }),
    from: (table: string) => {
      if (table === 'combined_payment_sessions') {
        return {
          select: () => makeChain(table, { ...baseSession }),
          update: (payload: Record<string, unknown>) => {
            updateCalls.push({ table, payload });
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'pricing_plans') {
        return { select: () => makeChain(table, { all_in_price: 12999, plan_key: 'business' }) };
      }
      if (table === 'centers') {
        return {
          select: () => makeChain(table, { ...baseCenter }),
          update: (payload: Record<string, unknown>) => {
            updateCalls.push({ table, payload });
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'upgrade_log') {
        return {
          // Idempotency check (upgradeAlreadyApplied): always "not found" here.
          select: () => makeChain(table, null),
          insert: (payload: unknown) => {
            insertCalls.push({ table, payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'invoices') {
        return {
          select: () => makeChain(table, null),
          update: (payload: Record<string, unknown>) => {
            updateCalls.push({ table, payload });
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { supabase, updateCalls, insertCalls, invoicesSelectCount: 0 };
}

beforeEach(() => vi.clearAllMocks());

describe('combinedPaymentFinalize — mid-cycle upgrade reprices a pending renewal invoice', () => {
  it('reprices the pending renewal invoice for the same period to the new tier', async () => {
    const h = makeHarness({
      pendingRenewal: { id: 'renewal-inv-1' },
      repriceInvoiceRow: {
        id: 'renewal-inv-1',
        center_id: 'center-1',
        invoice_type: 'subscription',
        status: 'pending',
        amount_received: 0,
        processing_fee: 20,
        vat_rate: 0.14,
        metadata: { processing_fee: 20 },
      },
    });

    const ok = await tryFinalizeCombinedPaymentSession('sess-upg-1', h.supabase as never, 'webhook', 'tx-1');
    expect(ok).toBe(true);

    const repriceUpdate = h.updateCalls.find(
      (u) => u.table === 'invoices' && u.payload.base_amount === 12999,
    );
    expect(repriceUpdate).toBeDefined();
    expect(repriceUpdate?.payload).toMatchObject({
      base_amount: 12999,
      paymob_order_id: null,
      paymob_iframe_url: null,
    });
  });

  it('no pending renewal invoice exists — no-op, the upgrade still succeeds', async () => {
    const h = makeHarness({ pendingRenewal: null });

    const ok = await tryFinalizeCombinedPaymentSession('sess-upg-1', h.supabase as never, 'webhook', 'tx-1');
    expect(ok).toBe(true);

    // The difference invoice (diff-inv-1) is still marked paid as usual — but
    // no REPRICE update (base_amount) happens, since there's nothing to reprice.
    expect(h.updateCalls.filter((u) => u.table === 'invoices' && 'base_amount' in u.payload)).toHaveLength(0);
  });

  it('reprice refusal (partial payment on the renewal invoice) is logged, not fatal — the upgrade still succeeds', async () => {
    const h = makeHarness({
      pendingRenewal: { id: 'renewal-inv-1' },
      repriceInvoiceRow: {
        id: 'renewal-inv-1',
        center_id: 'center-1',
        invoice_type: 'subscription',
        status: 'pending',
        amount_received: 500, // partial payment already on the renewal invoice
        processing_fee: 20,
        vat_rate: 0.14,
        metadata: { processing_fee: 20 },
      },
    });

    const ok = await tryFinalizeCombinedPaymentSession('sess-upg-1', h.supabase as never, 'webhook', 'tx-1');
    // The difference charge and plan flip already committed by this point —
    // a reprice refusal must not roll back money already collected.
    expect(ok).toBe(true);
    expect(h.updateCalls.filter((u) => u.table === 'invoices' && 'base_amount' in u.payload)).toHaveLength(0);
  });
});
