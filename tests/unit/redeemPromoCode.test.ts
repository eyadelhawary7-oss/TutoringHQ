/**
 * Regression tests for FIX 3 (atomic promo redemption + expiry recheck).
 *
 * The real atomicity guarantee lives in the SQL function
 * `redeem_promo_code` (migration 20260523000000_atomic_promo_redemption.sql).
 * These unit tests verify the TypeScript side of the contract:
 *
 *   - Webhook calls the RPC with the right arguments.
 *   - Empty RPC result (denied: inactive / expired / exhausted, OR already
 *     redeemed) is treated as a no-op, NOT an error and NOT a separate
 *     redemption insert.
 *   - Non-empty RPC result is treated as a successful redemption , the
 *     function does NOT separately insert into promo_code_redemptions or
 *     call the legacy increment_promo_uses RPC.
 *   - Inputs (discount amount, original amount) are derived server-side
 *     from the invoice, never trusted from the request body.
 *
 * The SQL-level race resistance is asserted by simulating the
 * pre-incremented state: a second concurrent caller sees an empty RPC
 * result (the WHERE clause `uses_count < max_uses_total` failed) and the
 * webhook performs no further writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redeemPromoCodeForPaymobOrder } from '@/lib/redeemPromoCode';

type SupaResult = { data: unknown; error: { message: string } | null };

interface FakeSupa {
  fromCalls: Array<{ table: string; op: string; payload?: unknown }>;
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
  invoiceRow: SupaResult;
  promoRow: SupaResult;
  ownerRow: SupaResult;
  rpcResult: SupaResult;
  // Underlying impl
  from: (table: string) => unknown;
  rpc: (name: string, params: Record<string, unknown>) => Promise<SupaResult>;
}

function makeFakeSupa(opts: {
  invoice: unknown;
  promo: unknown;
  owner?: unknown;
  rpcResult: SupaResult;
}): FakeSupa {
  const fake: FakeSupa = {
    fromCalls: [],
    rpcCalls: [],
    invoiceRow: { data: opts.invoice, error: null },
    promoRow: { data: opts.promo, error: null },
    ownerRow: { data: opts.owner ?? null, error: null },
    rpcResult: opts.rpcResult,
    from(table: string) {
      const self = this;
      self.fromCalls.push({ table, op: 'from' });
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle: async () => {
          if (table === 'invoices') return self.invoiceRow;
          if (table === 'promo_codes') return self.promoRow;
          if (table === 'users') return self.ownerRow;
          // Any direct promo_code_redemptions insert would be a bug post-FIX-3.
          return { data: null, error: null };
        },
        insert(payload: unknown) {
          self.fromCalls.push({ table, op: 'insert', payload });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
    async rpc(name: string, params: Record<string, unknown>) {
      this.rpcCalls.push({ name, params });
      return this.rpcResult;
    },
  };
  return fake;
}

const INVOICE = {
  id: 'inv-1',
  center_id: 'centre-1',
  promo_code: 'LAUNCH50',
  promo_original_amount: 12000,
  total_amount: 6000,
};
const PROMO = { id: 'promo-1' };
const OWNER = { id: 'user-1' };

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('redeemPromoCodeForPaymobOrder (FIX 3)', () => {
  it('happy path: calls redeem_promo_code RPC with server-derived amounts and reports redeemed=true', async () => {
    const fake = makeFakeSupa({
      invoice: INVOICE,
      promo: PROMO,
      owner: OWNER,
      rpcResult: {
        data: [{ redemption_id: 'red-1', discount_pct: 50, uses_count: 1 }],
        error: null,
      },
    });

    const result = await redeemPromoCodeForPaymobOrder(
      fake as unknown as never,
      { paymobOrderId: 'paymob-1' },
    );

    expect(result.redeemed).toBe(true);
    if (!result.redeemed) return;
    expect(result.redemptionId).toBe('red-1');
    expect(result.discountPct).toBe(50);
    expect(result.usesCount).toBe(1);

    // RPC called exactly once, with the right contract.
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].name).toBe('redeem_promo_code');
    expect(fake.rpcCalls[0].params).toMatchObject({
      p_code_id: 'promo-1',
      p_user_id: 'user-1',
      p_center_id: 'centre-1',
      p_paymob_order_id: 'paymob-1',
      // discount = original - paid total = 12000 - 6000 = 6000
      p_original_amount_egp: 12000,
      p_discount_amount_egp: 6000,
    });

    // The function must NOT perform a separate INSERT into promo_code_redemptions
    // or call the legacy increment_promo_uses , the SQL RPC is the only path.
    const inserts = fake.fromCalls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(0);
    expect(fake.rpcCalls.some((c) => c.name === 'increment_promo_uses')).toBe(false);
  });

  // Simulates the over-redemption race: SQL UPDATE WHERE uses_count < max
  // returns 0 rows because another concurrent caller already incremented.
  it('regression: empty RPC result (max_uses race) is treated as denied no-op', async () => {
    const fake = makeFakeSupa({
      invoice: INVOICE,
      promo: PROMO,
      owner: OWNER,
      rpcResult: { data: [], error: null },
    });

    const result = await redeemPromoCodeForPaymobOrder(
      fake as unknown as never,
      { paymobOrderId: 'paymob-2' },
    );

    expect(result.redeemed).toBe(false);
    if (result.redeemed) return;
    expect(result.reason).toBe('denied_or_duplicate');

    // No follow-up writes attempted.
    const inserts = fake.fromCalls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(0);
    expect(fake.rpcCalls.some((c) => c.name === 'increment_promo_uses')).toBe(false);
  });

  // Same shape as the race case , the SQL function returns no rows when
  // is_active=false or expires_at < now() at increment time.
  it('regression: expired / inactive code denied at REDEMPTION time (not just validate)', async () => {
    const fake = makeFakeSupa({
      invoice: INVOICE,
      promo: PROMO,
      owner: OWNER,
      // Simulates `WHERE is_active = true AND (expires_at IS NULL OR expires_at > now())`
      // matching zero rows when the code expired between signup and webhook fire.
      rpcResult: { data: [], error: null },
    });

    const result = await redeemPromoCodeForPaymobOrder(
      fake as unknown as never,
      { paymobOrderId: 'paymob-3' },
    );

    expect(result.redeemed).toBe(false);
    if (result.redeemed) return;
    expect(result.reason).toBe('denied_or_duplicate');
  });

  it('skips when invoice has no promo_code (not an error)', async () => {
    const fake = makeFakeSupa({
      invoice: { ...INVOICE, promo_code: null },
      promo: PROMO,
      owner: OWNER,
      rpcResult: { data: [], error: null },
    });
    const result = await redeemPromoCodeForPaymobOrder(
      fake as unknown as never,
      { paymobOrderId: 'paymob-4' },
    );
    expect(result.redeemed).toBe(false);
    if (result.redeemed) return;
    expect(result.reason).toBe('no_promo_on_invoice');
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('skips when promo code row is missing (e.g. deleted)', async () => {
    const fake = makeFakeSupa({
      invoice: INVOICE,
      promo: null,
      owner: OWNER,
      rpcResult: { data: [], error: null },
    });
    const result = await redeemPromoCodeForPaymobOrder(
      fake as unknown as never,
      { paymobOrderId: 'paymob-5' },
    );
    expect(result.redeemed).toBe(false);
    if (result.redeemed) return;
    expect(result.reason).toBe('code_not_found');
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('surfaces rpc_error when the RPC itself errors', async () => {
    const fake = makeFakeSupa({
      invoice: INVOICE,
      promo: PROMO,
      owner: OWNER,
      rpcResult: { data: null, error: { message: 'connection lost' } },
    });
    const result = await redeemPromoCodeForPaymobOrder(
      fake as unknown as never,
      { paymobOrderId: 'paymob-6' },
    );
    expect(result.redeemed).toBe(false);
    if (result.redeemed) return;
    expect(result.reason).toBe('rpc_error');
  });

  it('falls back to total_amount when promo_original_amount is null (no client trust)', async () => {
    const fake = makeFakeSupa({
      invoice: { ...INVOICE, promo_original_amount: null, total_amount: 6000 },
      promo: PROMO,
      owner: OWNER,
      rpcResult: {
        data: [{ redemption_id: 'red-2', discount_pct: 10, uses_count: 1 }],
        error: null,
      },
    });
    await redeemPromoCodeForPaymobOrder(
      fake as unknown as never,
      { paymobOrderId: 'paymob-7' },
    );
    expect(fake.rpcCalls[0].params).toMatchObject({
      p_original_amount_egp: 6000,
      p_discount_amount_egp: 0,
    });
  });
});
