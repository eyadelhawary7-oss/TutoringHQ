import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireCenterAuth = vi.fn();
const mockInquire = vi.fn();
const mockTryFinalize = vi.fn();

vi.mock('@/lib/centerAuth', () => ({ requireCenterAuth: (req: unknown) => mockRequireCenterAuth(req) }));
vi.mock('@/lib/paymobOrderInquiry', () => ({ inquirePaymobCardOrder: (...a: unknown[]) => mockInquire(...a) }));
vi.mock('@/lib/combinedPaymentFinalize', () => ({
  tryFinalizeCombinedPaymentSession: (...a: unknown[]) => mockTryFinalize(...a),
}));
vi.mock('@/lib/invoicePaymobPayment', () => ({
  finalizeInvoicePaymentSuccess: vi.fn(),
  finalizeInvoicePaymentFailure: vi.fn(),
}));

import { GET } from '@/app/api/paymob/invoice-status/route';

const CENTER_ID = 'center-xyz';

// Re-read status of the combined session AFTER finalize is configurable per test.
let sessionStatusAfter = 'pending';

function makeAdmin() {
  return {
    from: (table: string) => {
      if (table === 'combined_payment_sessions') {
        return {
          select: (cols: string) => ({
            eq: () => ({
              maybeSingle: () =>
                cols.includes('center_id')
                  ? Promise.resolve({ data: { id: 's1', status: 'pending', center_id: CENTER_ID }, error: null })
                  : Promise.resolve({ data: { status: sessionStatusAfter }, error: null }),
            }),
          }),
        };
      }
      if (table === 'invoices') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function makeRequest() {
  return new NextRequest('http://localhost/api/paymob/invoice-status?paymobOrderId=order-1');
}

beforeEach(() => {
  mockRequireCenterAuth.mockReset();
  mockInquire.mockReset();
  mockTryFinalize.mockReset();
  sessionStatusAfter = 'pending';
  mockRequireCenterAuth.mockResolvedValue({ ok: true, centerId: CENTER_ID, supabaseAdmin: makeAdmin() });
  mockInquire.mockResolvedValue({ state: 'paid', transactionId: 'tx-1' });
});

describe('GET /api/paymob/invoice-status — combined session never "paid" unless finalized', () => {
  it('does NOT report paid when the finalizer fails (returns false)', async () => {
    mockTryFinalize.mockResolvedValue(false);
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.paid).not.toBe(true);
    expect(json.status).toBe('pending');
  });

  it('does NOT report paid when finalize "succeeds" but the session rolled back (still pending)', async () => {
    mockTryFinalize.mockResolvedValue(true);
    sessionStatusAfter = 'pending'; // RPC rolled back: status never reached 'paid'
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.paid).not.toBe(true);
    expect(json.status).toBe('pending');
  });

  it('reports paid ONLY when the session is genuinely finalized (status flipped to paid)', async () => {
    mockTryFinalize.mockResolvedValue(true);
    sessionStatusAfter = 'paid';
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.paid).toBe(true);
    expect(json.status).toBe('paid');
  });
});
