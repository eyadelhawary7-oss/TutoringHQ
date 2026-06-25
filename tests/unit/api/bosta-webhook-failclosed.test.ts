import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

// Keep the route's side-effect deps inert; the fail-closed checks return before
// any of them are reached, but mocking keeps module import clean + isolated.
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: null }));
vi.mock('@/lib/centerNotify', () => ({ sendOrderShipped: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendFreeformMessage: vi.fn() }));
vi.mock('@/lib/ceo', () => ({ createAction: vi.fn() }));
vi.mock('@/lib/vendorNotify', () => ({ notifyVendorOfNewOrder: vi.fn() }));
vi.mock('@/lib/ownerPhone', () => ({ ownerContactByCenterId: vi.fn(), resolveOwnerWaPhone: vi.fn() }));

import { POST } from '@/app/api/bosta/webhook/route';

function makeRequest(body: string, sig?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== undefined) headers['Bosta-Signature'] = sig;
  return new Request('http://localhost/api/bosta/webhook', { method: 'POST', headers, body });
}

const ORIGINAL_SECRET = process.env.BOSTA_WEBHOOK_SECRET;
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

beforeEach(() => {
  delete process.env.BOSTA_WEBHOOK_SECRET;
  // Explicitly a NON-production environment (preview-like) to prove fail-closed
  // is not gated on prod.
  process.env.VERCEL_ENV = 'preview';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BOSTA_WEBHOOK_SECRET;
  else process.env.BOSTA_WEBHOOK_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
});

describe('Bosta webhook — fail CLOSED', () => {
  it('REJECTS (401) when the secret is missing, even in a non-production (preview) env', async () => {
    const res = await POST(makeRequest(JSON.stringify({ order_id: 'x', state: { code: 45 } }), 'deadbeef'));
    expect(res.status).toBe(401);
  });

  it('REJECTS (401) when the signature header is absent (secret present)', async () => {
    process.env.BOSTA_WEBHOOK_SECRET = 'shh';
    const res = await POST(makeRequest(JSON.stringify({ order_id: 'x' })));
    expect(res.status).toBe(401);
  });

  it('REJECTS (401) when the signature does not match', async () => {
    process.env.BOSTA_WEBHOOK_SECRET = 'shh';
    const res = await POST(makeRequest(JSON.stringify({ order_id: 'x' }), 'not-the-right-hmac'));
    expect(res.status).toBe(401);
  });

  it('does NOT 401 a correctly-signed callback on the signature check (secret present)', async () => {
    process.env.BOSTA_WEBHOOK_SECRET = 'shh';
    const body = JSON.stringify({ order_id: 'x', trackingNumber: 'TR1' });
    const sig = createHmac('sha256', 'shh').update(body).digest('hex');
    const res = await POST(makeRequest(body, sig));
    // With a valid signature the request passes verification (supabaseAdmin is
    // null in this test, so it processes and returns 200 received) — the point
    // is it is NOT rejected at the signature gate.
    expect(res.status).not.toBe(401);
  });
});
