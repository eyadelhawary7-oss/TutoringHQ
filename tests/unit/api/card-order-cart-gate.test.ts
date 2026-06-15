/**
 * Defense-in-depth: card-order mutation routes must refuse a direct request
 * when the center has card ordering disabled (centers.card_orders_enabled =
 * false / NULL). The dashboard nav + /orders page hide the flow, but these
 * routes run on the service-role client (RLS bypassed), so the flag is enforced
 * in the TS route gate too.
 *
 * Covers:
 *   - cardOrdersDisabledResponse: enabled -> null; disabled/missing/error -> 403
 *     (fail CLOSED).
 *   - A direct POST to /api/card-order-cart/checkout with cards disabled is
 *     refused with a clean 403 and NO card_orders insert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks for the checkout route's heavy imports (none are reached once the
//    gate returns 403, but they must not run real side effects at import). ──
const requireCenterAuth = vi.fn();
vi.mock('@/lib/paymobProductionGuard', () => ({}));
vi.mock('@/lib/centerAuth', () => ({ requireCenterAuth: (...a: unknown[]) => requireCenterAuth(...a) }));
vi.mock('@/lib/centerPermissions', () => ({ requirePermission: vi.fn(() => null) }));
vi.mock('@/lib/card-order-cart/server', () => ({
  buildCartPayload: vi.fn(),
  fetchActorName: vi.fn(),
  getCardOrderMinimumQty: vi.fn(),
  purgeStaleCartItemsForCart: vi.fn(),
}));
vi.mock('@/lib/paymob/issueCardOrderIframe', () => ({ issueCardOrderIframePayment: vi.fn() }));
vi.mock('@/lib/loadBostaShippingRates', () => ({ loadBostaShippingRates: vi.fn(async () => null) }));
vi.mock('@/lib/bostaShipping', () => ({ getShippingFee: vi.fn(() => 0), getShippingZone: vi.fn(() => '') }));

import { cardOrdersDisabledResponse } from '@/lib/card-order-cart/cardOrdersGate';
import { POST as checkoutPOST } from '@/app/api/card-order-cart/checkout/route';

const CENTER_ID = 'center-xyz';

/** Minimal supabase-admin stub: records from() tables and returns a fixed centers row. */
function makeSupabaseAdmin(centerResult: { data: unknown; error: unknown }) {
  const fromTables: string[] = [];
  const insertCalls: string[] = [];
  const client = {
    fromTables,
    insertCalls,
    from(table: string) {
      fromTables.push(table);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => centerResult }) }),
        insert: () => {
          insertCalls.push(table);
          return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
        },
      };
    },
  };
  return client;
}

beforeEach(() => {
  requireCenterAuth.mockReset();
});

describe('cardOrdersDisabledResponse (fail-closed gate)', () => {
  it('returns null when card ordering is enabled', async () => {
    const admin = makeSupabaseAdmin({ data: { card_orders_enabled: true }, error: null });
    const res = await cardOrdersDisabledResponse(admin as never, CENTER_ID);
    expect(res).toBeNull();
  });

  it('returns 403 when disabled', async () => {
    const admin = makeSupabaseAdmin({ data: { card_orders_enabled: false }, error: null });
    const res = await cardOrdersDisabledResponse(admin as never, CENTER_ID);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: 'card_orders_disabled' });
  });

  it('fails CLOSED on a missing center row', async () => {
    const admin = makeSupabaseAdmin({ data: null, error: null });
    const res = await cardOrdersDisabledResponse(admin as never, CENTER_ID);
    expect(res?.status).toBe(403);
  });

  it('fails CLOSED on a read error', async () => {
    const admin = makeSupabaseAdmin({ data: null, error: { message: 'boom' } });
    const res = await cardOrdersDisabledResponse(admin as never, CENTER_ID);
    expect(res?.status).toBe(403);
  });
});

describe('POST /api/card-order-cart/checkout — disabled center is refused', () => {
  it('a direct POST with cards disabled returns 403 and never inserts an order', async () => {
    const admin = makeSupabaseAdmin({ data: { card_orders_enabled: false }, error: null });
    requireCenterAuth.mockResolvedValue({
      ok: true,
      supabaseAdmin: admin,
      centerId: CENTER_ID,
      userId: 'user-abc',
    });

    const res = await checkoutPOST({} as never);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'card_orders_disabled' });
    // The gate ran before any card_orders write.
    expect(admin.insertCalls).not.toContain('card_orders');
    expect(admin.fromTables).toContain('centers');
  });
});
