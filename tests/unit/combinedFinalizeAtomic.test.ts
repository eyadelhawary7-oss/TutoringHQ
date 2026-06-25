import { describe, it, expect } from 'vitest';
import { tryFinalizeCombinedPaymentSession } from '@/lib/combinedPaymentFinalize';

/**
 * Fix C — the combined wallet+card finalize must be all-or-nothing:
 *  - the wallet credit is consumed ONLY inside finalize_combined_session_paid
 *    (the atomic RPC), never via a standalone spend earlier in the flow;
 *  - if that atomic step fails, the session is marked 'failed' and finalized_at
 *    is NEVER set, so the stuck-payment cron can recover it (credit intact).
 *
 * vitest has no Postgres, so we fake the Supabase client and assert the
 * ORCHESTRATION contract (which RPC is called, in which order, and what the
 * failure path writes). The atomic rollback itself is proven live against prod
 * (DB-level) in the Phase 1 verification.
 */

type RpcResponder = (args: Record<string, unknown>) => { data: unknown; error: unknown };

interface FakeOpts {
  rows: Record<string, unknown>;
  rpc?: Record<string, RpcResponder | { data: unknown; error: unknown }>;
}

function makeFakeSupabase(opts: FakeOpts) {
  const calls = {
    rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    inserts: [] as Array<{ table: string; payload: unknown }>,
  };

  function makeChain(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: opts.rows[table] ?? null, error: null }),
      update: (payload: Record<string, unknown>) => {
        calls.updates.push({ table, payload });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (payload: unknown) => {
        calls.inserts.push({ table, payload });
        return Promise.resolve({ error: null });
      },
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
    return chain;
  }

  const supabase = {
    from: (table: string) => makeChain(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      const r = opts.rpc?.[name];
      const out = typeof r === 'function' ? r(args) : (r ?? { data: null, error: null });
      return Promise.resolve(out);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, calls };
}

const baseSession = {
  id: 'sess-1',
  center_id: 'center-1',
  status: 'pending',
  session_type: 'reactivation_tier1',
  credit_amount: 100,
  invoice_ids: [],
  paymob_order_id: 'ord-1',
  metadata: {},
};

const baseCenter = {
  next_payment_due: '2999-01-01',
  subscription_start_date: '2026-01-01',
  billing_cycle_start: '2026-01-01',
  approved_at: '2026-01-01',
  subscription_billing_period: 'quarterly',
  billing_period: 'quarterly',
};

function rowsFor() {
  return {
    combined_payment_sessions: { ...baseSession },
    centers: { ...baseCenter },
  };
}

describe('tryFinalizeCombinedPaymentSession (Fix C all-or-nothing)', () => {
  it('consumes credit ONLY via the atomic RPC — never a standalone spend_credits_atomic', async () => {
    const { supabase, calls } = makeFakeSupabase({
      rows: rowsFor(),
      rpc: {
        try_finalize_payment_session: { data: true, error: null },
        finalize_combined_session_paid: { data: 'completed', error: null },
      },
    });

    const ok = await tryFinalizeCombinedPaymentSession('sess-1', supabase, 'cron', 'tx-1');
    expect(ok).toBe(true);

    const rpcNames = calls.rpc.map((c) => c.name);
    // The standalone credit spend was removed; credit is consumed inside the RPC.
    expect(rpcNames).not.toContain('spend_credits_atomic');
    expect(rpcNames).toContain('finalize_combined_session_paid');

    const finalizeCall = calls.rpc.find((c) => c.name === 'finalize_combined_session_paid');
    expect(finalizeCall?.args.p_credit_amount).toBe(100);
    expect(finalizeCall?.args.p_finalized_by).toBe('cron');

    // Success path must NOT mark the session failed.
    expect(calls.updates.find((u) => u.payload.status === 'failed')).toBeUndefined();
  });

  it('on atomic-step error: marks session failed, sets NO finalized_at, spends NO credit', async () => {
    const { supabase, calls } = makeFakeSupabase({
      rows: rowsFor(),
      rpc: {
        try_finalize_payment_session: { data: true, error: null },
        finalize_combined_session_paid: { data: null, error: { message: 'card leg failed' } },
      },
    });

    const ok = await tryFinalizeCombinedPaymentSession('sess-1', supabase, 'webhook', 'tx-1');
    expect(ok).toBe(false);

    const rpcNames = calls.rpc.map((c) => c.name);
    expect(rpcNames).not.toContain('spend_credits_atomic');

    // Session is marked failed so the cron re-attempts it…
    const failedUpdate = calls.updates.find(
      (u) => u.table === 'combined_payment_sessions' && u.payload.status === 'failed',
    );
    expect(failedUpdate).toBeDefined();

    // …and TS never writes status='paid' nor finalized_at (only the RPC does, atomically).
    const writesPaidOrFinalized = calls.updates.some(
      (u) =>
        u.table === 'combined_payment_sessions' &&
        (u.payload.status === 'paid' || 'finalized_at' in u.payload),
    );
    expect(writesPaidOrFinalized).toBe(false);
  });

  it('on a non-terminal atomic status (e.g. not_found): marks failed, returns false', async () => {
    const { supabase, calls } = makeFakeSupabase({
      rows: rowsFor(),
      rpc: {
        try_finalize_payment_session: { data: true, error: null },
        finalize_combined_session_paid: { data: 'not_found', error: null },
      },
    });

    const ok = await tryFinalizeCombinedPaymentSession('sess-1', supabase, 'cron', 'tx-1');
    expect(ok).toBe(false);
    expect(
      calls.updates.find((u) => u.payload.status === 'failed'),
    ).toBeDefined();
  });

  it('treats already_done as success (idempotent replay)', async () => {
    const { supabase } = makeFakeSupabase({
      rows: rowsFor(),
      rpc: {
        try_finalize_payment_session: { data: true, error: null },
        finalize_combined_session_paid: { data: 'already_done', error: null },
      },
    });
    const ok = await tryFinalizeCombinedPaymentSession('sess-1', supabase, 'cron', 'tx-1');
    expect(ok).toBe(true);
  });
});
