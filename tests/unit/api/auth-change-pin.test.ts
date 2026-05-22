import { describe, it, expect, vi, beforeEach } from 'vitest';

// Env vars required by the route before it calls createClient
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 4, reset: 0 }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  rateLimitedResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'too_many_requests' }), { status: 429 }) as never,
  ),
}));

vi.mock('@/lib/validate', () => ({
  parseBodyWithLimit: vi.fn(),
}));

vi.mock('@/lib/weakPins', () => ({
  isWeakPin: vi.fn().mockReturnValue(false),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$10$hashedpin'),
  },
}));

// @supabase/supabase-js createClient is mocked per-test via the module mock below
const mockSignInWithPassword = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  })),
}));

import { POST } from '@/app/api/auth/change-pin/route';
import { requireCenterAuth } from '@/lib/centerAuth';
import { rateLimit, rateLimitedResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';
import { isWeakPin } from '@/lib/weakPins';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CenterAuthOk, CenterPermissions } from '@/lib/centerAuth';

const ALL_FALSE_PERMS: CenterPermissions = {
  can_record_payments: false,
  can_view_payments: false,
  can_manage_billing: false,
  can_edit_center_profile: false,
  can_delete_students: false,
  can_manage_academic_calendar: false,
  can_place_card_orders: false,
  can_request_referral_payouts: false,
};

function makeAdminMock(overrides?: {
  getUserByIdError?: boolean;
  updateUserByIdError?: boolean;
  auditInsertError?: boolean;
  dbUpdateError?: boolean;
}) {
  const getUserByIdMock = vi.fn().mockResolvedValue(
    overrides?.getUserByIdError
      ? { data: { user: null }, error: new Error('not found') }
      : { data: { user: { email: '201012345678@centerhq.local' } }, error: null },
  );
  const updateUserByIdMock = vi.fn().mockResolvedValue(
    overrides?.updateUserByIdError ? { error: new Error('update failed') } : { error: null },
  );
  const auditInsertMock = vi.fn().mockResolvedValue({ error: null });
  const dbUpdateMock = vi.fn().mockReturnThis();
  const dbEqMock = vi.fn().mockResolvedValue(
    overrides?.dbUpdateError ? { error: new Error('db error') } : { error: null },
  );

  const admin = {
    auth: {
      admin: {
        getUserById: getUserByIdMock,
        updateUserById: updateUserByIdMock,
      },
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'audit_log') return { insert: auditInsertMock };
      return { update: dbUpdateMock, eq: dbEqMock };
    }),
  } as unknown as SupabaseClient;

  return { admin, getUserByIdMock, updateUserByIdMock, auditInsertMock };
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from '@/lib/supabase-admin';

function setAdmin(admin: SupabaseClient) {
  vi.mocked(getSupabaseAdmin).mockReturnValue(admin);
}

function makeAuth(admin: SupabaseClient): CenterAuthOk {
  return {
    ok: true,
    userId: 'user-abc',
    centerId: 'center-xyz',
    role: 'owner',
    isSuperAdmin: false,
    permissions: ALL_FALSE_PERMS,
    supabaseAdmin: admin,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/change-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

const VALID_CURRENT = '987654';
const VALID_NEW = '246810';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: rateLimit passes
  vi.mocked(rateLimit).mockResolvedValue({ success: true, remaining: 4, reset: 0 });
  // Default: body parse succeeds with valid pins
  vi.mocked(parseBodyWithLimit).mockImplementation(async (req) => JSON.parse(await req.text()));
  // Default: isWeakPin returns false
  vi.mocked(isWeakPin).mockReturnValue(false);
  // Default: signInWithPassword succeeds
  mockSignInWithPassword.mockResolvedValue({ error: null });
});

describe('POST /api/auth/change-pin', () => {
  it('returns 401 when requireCenterAuth fails', async () => {
    vi.mocked(requireCenterAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) as never,
    });

    const res = await POST(makeRequest({ currentPin: VALID_CURRENT, newPin: VALID_NEW }));
    expect(res.status).toBe(401);
  });

  it('returns 400 invalid_format when newPin is not 6 digits', async () => {
    const { admin } = makeAdminMock();
    setAdmin(admin);
    vi.mocked(requireCenterAuth).mockResolvedValue(makeAuth(admin));

    const res = await POST(makeRequest({ currentPin: VALID_CURRENT, newPin: '123' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_format');
  });

  it('returns 400 invalid_format when currentPin is not 6 digits', async () => {
    const { admin } = makeAdminMock();
    setAdmin(admin);
    vi.mocked(requireCenterAuth).mockResolvedValue(makeAuth(admin));

    const res = await POST(makeRequest({ currentPin: 'abc', newPin: VALID_NEW }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_format');
  });

  it('returns 400 weak_pin when newPin === "123456"', async () => {
    const { admin } = makeAdminMock();
    setAdmin(admin);
    vi.mocked(requireCenterAuth).mockResolvedValue(makeAuth(admin));
    vi.mocked(isWeakPin).mockReturnValue(true);

    const res = await POST(makeRequest({ currentPin: VALID_CURRENT, newPin: '123456' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('weak_pin');
  });

  it('returns 401 wrong_current_pin when signInWithPassword fails', async () => {
    const { admin } = makeAdminMock();
    setAdmin(admin);
    vi.mocked(requireCenterAuth).mockResolvedValue(makeAuth(admin));
    mockSignInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') });

    const res = await POST(makeRequest({ currentPin: VALID_CURRENT, newPin: VALID_NEW }));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('wrong_current_pin');
  });

  it('returns 200 and writes audit_log entry on success', async () => {
    const { admin, auditInsertMock } = makeAdminMock();
    setAdmin(admin);
    vi.mocked(requireCenterAuth).mockResolvedValue(makeAuth(admin));

    const res = await POST(makeRequest({ currentPin: VALID_CURRENT, newPin: VALID_NEW }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'change_pin_self',
        user_id: 'user-abc',
        center_id: 'center-xyz',
        details: expect.objectContaining({ changed_at: expect.any(String) }),
      }),
    );
    // PIN values must NOT appear in the audit entry
    const call = auditInsertMock.mock.calls[0][0] as Record<string, unknown>;
    const callStr = JSON.stringify(call);
    expect(callStr).not.toContain(VALID_CURRENT);
    expect(callStr).not.toContain(VALID_NEW);
  });

  it('returns 429 after exceeding the rate limit (5 per 15 min cap)', async () => {
    const { admin } = makeAdminMock();
    setAdmin(admin);
    vi.mocked(requireCenterAuth).mockResolvedValue(makeAuth(admin));
    vi.mocked(rateLimit).mockResolvedValue({ success: false, remaining: 0, reset: Math.floor(Date.now() / 1000) + 900 });
    vi.mocked(rateLimitedResponse).mockReturnValue(
      new Response(JSON.stringify({ error: 'too_many_requests', retry_after: 900 }), { status: 429 }) as never,
    );

    const res = await POST(makeRequest({ currentPin: VALID_CURRENT, newPin: VALID_NEW }));
    expect(res.status).toBe(429);
  });

  it('returns 500 when updateUserById fails after PIN verification', async () => {
    const { admin } = makeAdminMock({ updateUserByIdError: true });
    setAdmin(admin);
    vi.mocked(requireCenterAuth).mockResolvedValue(makeAuth(admin));

    const res = await POST(makeRequest({ currentPin: VALID_CURRENT, newPin: VALID_NEW }));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('update_failed');
  });
});
