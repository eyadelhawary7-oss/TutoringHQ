import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Risk 1 mitigation: a cached Paymob checkout (paymob_order_id/paymob_iframe_url)
// must never be handed back to the customer for an amount that no longer matches
// total_amount — e.g. after repriceSubscriptionInvoice changes the total. This
// guards the comparison itself: presence of the cached fields is not proof they
// still match what's owed; only a matching metadata.paymob_cached_total snapshot is.

process.env.PAYMOB_API_KEY = 'test-key';
process.env.PAYMOB_INTEGRATION_ID = '12345';
process.env.PAYMOB_IFRAME_ID = '999';

const CENTER_AUTH = {
  ok: true as const,
  role: 'owner' as const,
  userId: 'user-1',
  centerId: 'center-1',
};

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: vi.fn(async () => ({ ...CENTER_AUTH, supabaseAdmin: mockAdmin })),
}));

vi.mock('@/lib/savedCard/consent', () => ({
  optInToCardTokenization: vi.fn(async () => false),
}));
vi.mock('@/lib/savedCard/store', () => ({
  createSupabaseSavedCardStore: vi.fn(() => ({})),
}));

let invoiceRow: Record<string, unknown>;
const updateCalls: Record<string, unknown>[] = [];

const mockAdmin = {
  from: (table: string) => {
    if (table === 'invoices') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: invoiceRow, error: null }) }),
        }),
        update: (payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return {
            eq: () => ({
              eq: () => ({
                in: async () => ({ error: null }),
              }),
            }),
          };
        },
      };
    }
    if (table === 'centers') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { name: 'Center', phone: '01000000000' }, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

import { POST as invoicePayPOST } from '@/app/api/invoices/[id]/pay/route';

function makeRequest(): NextRequest {
  return {
    headers: { get: () => null },
    json: async () => ({}),
  } as unknown as NextRequest;
}

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    center_id: 'center-1',
    status: 'pending',
    invoice_type: 'subscription',
    total_amount: 1020,
    amount_received: 0,
    paymob_order_id: 'po-cached',
    paymob_iframe_url: 'https://pay/cached',
    metadata: { processing_fee: 20, paymob_cached_total: 1020 },
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  updateCalls.length = 0;
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/auth/tokens')) {
      return { ok: true, json: async () => ({ token: 'auth-token' }) };
    }
    if (url.includes('/ecommerce/orders')) {
      return { ok: true, json: async () => ({ id: 555 }) };
    }
    if (url.includes('/acceptance/payment_keys')) {
      return { ok: true, json: async () => ({ token: 'pay-token' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/invoices/[id]/pay — cached checkout reuse guard', () => {
  it('reuses the cached iframe when the snapshot matches total_amount', async () => {
    invoiceRow = baseInvoice();

    const res = await invoicePayPOST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = (await res.json()) as { iframeUrl?: string; orderId?: string };

    expect(res.status).toBe(200);
    expect(body.iframeUrl).toBe('https://pay/cached');
    expect(body.orderId).toBe('po-cached');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('mints a fresh order when the cached snapshot no longer matches total_amount (post-reprice)', async () => {
    // Simulates exactly the repriceSubscriptionInvoice sequence: total_amount
    // changed to 1200 but the snapshot (and the cached fields) are stale here
    // to prove the GUARD itself catches a mismatch, not just the fields being null.
    invoiceRow = baseInvoice({ total_amount: 1200, metadata: { processing_fee: 20, paymob_cached_total: 1020 } });

    const res = await invoicePayPOST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = (await res.json()) as { iframeUrl?: string; orderId?: string };

    expect(res.status).toBe(200);
    // A FRESH order was minted (id 555 from the mocked Paymob response), not the cached one.
    expect(body.orderId).toBe('555');
    expect(body.iframeUrl).not.toBe('https://pay/cached');
    expect(fetchMock).toHaveBeenCalled();

    // The fresh order was minted for the CURRENT total (1200), and the new
    // snapshot persisted matches it — the next request would correctly reuse.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      paymob_order_id: '555',
      metadata: expect.objectContaining({ paymob_cached_total: 1200 }),
    });
  });

  it('fails closed and mints fresh when the snapshot is missing entirely', async () => {
    // No paymob_cached_total at all (e.g. a checkout minted by a different code
    // path that doesn't yet write the snapshot) — must NOT be trusted by default.
    invoiceRow = baseInvoice({ metadata: { processing_fee: 20 } });

    const res = await invoicePayPOST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = (await res.json()) as { orderId?: string };

    expect(res.status).toBe(200);
    expect(body.orderId).toBe('555');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('never reuses once a partial payment exists, regardless of a matching snapshot', async () => {
    invoiceRow = baseInvoice({ amount_received: 500 }); // snapshot still says 1020, matches total_amount

    const res = await invoicePayPOST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = (await res.json()) as { orderId?: string };

    expect(res.status).toBe(200);
    expect(body.orderId).toBe('555'); // fresh order for the remaining balance, never the cached one
    expect(fetchMock).toHaveBeenCalled();
  });
});
