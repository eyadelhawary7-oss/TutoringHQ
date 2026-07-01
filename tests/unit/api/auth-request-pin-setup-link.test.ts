import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

vi.mock('@/lib/validate', () => ({
  parseBodyWithLimit: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  resetPinPhoneRatelimit: null, // unconfigured: rate-limit short-circuits (fail-open OK)
  rateLimitedResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'too_many_requests' }), { status: 429 }) as never,
  ),
}));

const { mintForFallbackMock, sendPinSetupLinkMock } = vi.hoisted(() => ({
  mintForFallbackMock: vi.fn(),
  sendPinSetupLinkMock: vi.fn(),
}));

vi.mock('@/lib/pinSetupTokens', () => ({
  mintForFallback: mintForFallbackMock,
}));

vi.mock('@/lib/centerNotify', () => ({
  sendPinSetupLink: sendPinSetupLinkMock,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { POST } from '@/app/api/auth/request-pin-setup-link/route';
import { parseBodyWithLimit } from '@/lib/validate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

const VALID_PHONE = '+201012345678';

type UserShape = {
  id: string;
  pin_set_at: string | null;
  center_id: string | null;
  is_active: boolean;
};
type CenterShape = {
  id: string;
  status: string;
  billing_status: string | null;
  approved_at: string | null;
};

function makeAdmin(opts?: {
  user?: UserShape | null;
  center?: CenterShape | null;
}): SupabaseClient {
  const user = opts?.user === undefined ? null : opts.user;
  const center =
    opts?.center === undefined
      ? ({
          id: 'center-1',
          status: 'active',
          billing_status: 'active',
          approved_at: new Date().toISOString(),
        } as CenterShape)
      : opts.center;

  return {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: user, error: null }),
        };
      }
      if (table === 'centers') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: center, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  } as unknown as SupabaseClient;
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/request-pin-setup-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseBodyWithLimit).mockImplementation(async (req) =>
    JSON.parse(await (req as Request).text()),
  );
  mintForFallbackMock.mockResolvedValue({ rowId: 'row-1', plaintext: 'plaintext-token-abc' });
  sendPinSetupLinkMock.mockResolvedValue(true);
});

async function readSuccess(res: Response): Promise<{ success: boolean }> {
  return (await res.json()) as { success: boolean };
}

describe('POST /api/auth/request-pin-setup-link', () => {
  it('UNREGISTERED phone: returns { success: true } and does NOT mint or send', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(makeAdmin({ user: null }));
    const res = await POST(makeRequest({ phone: VALID_PHONE }));
    expect(res.status).toBe(200);
    expect((await readSuccess(res)).success).toBe(true);
    expect(mintForFallbackMock).not.toHaveBeenCalled();
    expect(sendPinSetupLinkMock).not.toHaveBeenCalled();
  });

  it('REGISTERED phone with PIN already set: returns { success: true } and does NOT mint or send', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeAdmin({
        user: {
          id: 'u-1',
          pin_set_at: '2026-06-01T00:00:00Z',
          center_id: 'center-1',
          is_active: true,
        },
      }),
    );
    const res = await POST(makeRequest({ phone: VALID_PHONE }));
    expect(res.status).toBe(200);
    expect((await readSuccess(res)).success).toBe(true);
    expect(mintForFallbackMock).not.toHaveBeenCalled();
    expect(sendPinSetupLinkMock).not.toHaveBeenCalled();
  });

  it('REGISTERED phone with NO PIN + center pending_payment: returns { success: true } and does NOT mint', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeAdmin({
        user: { id: 'u-1', pin_set_at: null, center_id: 'center-1', is_active: true },
        center: {
          id: 'center-1',
          status: 'pending_payment',
          billing_status: 'pending',
          approved_at: null,
        },
      }),
    );
    const res = await POST(makeRequest({ phone: VALID_PHONE }));
    expect(res.status).toBe(200);
    expect((await readSuccess(res)).success).toBe(true);
    expect(mintForFallbackMock).not.toHaveBeenCalled();
  });

  it('REGISTERED phone with NO PIN + paid+activated center: mints a fallback token + sends chq_pin_setup_link', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeAdmin({
        user: { id: 'u-1', pin_set_at: null, center_id: 'center-1', is_active: true },
      }),
    );
    const res = await POST(makeRequest({ phone: VALID_PHONE }));
    expect(res.status).toBe(200);
    expect((await readSuccess(res)).success).toBe(true);
    expect(mintForFallbackMock).toHaveBeenCalledWith(expect.anything(), { userId: 'u-1' });
    expect(sendPinSetupLinkMock).toHaveBeenCalledTimes(1);
    const [, setupUrl] = sendPinSetupLinkMock.mock.calls[0];
    expect(setupUrl).toContain('/set-pin?t=plaintext-token-abc');
  });

  it('ANTI-ENUMERATION: response shape identical between unregistered and registered+paid', async () => {
    // Unregistered.
    vi.mocked(getSupabaseAdmin).mockReturnValue(makeAdmin({ user: null }));
    const r1 = await POST(makeRequest({ phone: VALID_PHONE }));
    const b1 = await readSuccess(r1);

    // Registered + paid.
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeAdmin({
        user: { id: 'u-1', pin_set_at: null, center_id: 'center-1', is_active: true },
      }),
    );
    const r2 = await POST(makeRequest({ phone: VALID_PHONE }));
    const b2 = await readSuccess(r2);

    expect(r1.status).toBe(r2.status);
    expect(b1).toEqual(b2);
  });

  it('Invalid phone format: returns { success: true } and does NOT touch the database', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(makeAdmin({ user: null }));
    const res = await POST(makeRequest({ phone: 'not-a-phone' }));
    expect(res.status).toBe(200);
    expect((await readSuccess(res)).success).toBe(true);
    expect(mintForFallbackMock).not.toHaveBeenCalled();
    expect(sendPinSetupLinkMock).not.toHaveBeenCalled();
  });
});
