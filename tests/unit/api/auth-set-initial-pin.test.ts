import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

vi.mock('@/lib/validate', () => ({
  parseBodyWithLimit: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getUpstashRedis: vi.fn(),
  rateLimitedResponse: vi.fn(),
}));

vi.mock('@/lib/weakPins', () => ({
  isWeakPin: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/signupSessionCookie', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signupSessionCookie')>(
    '@/lib/signupSessionCookie',
  );
  return {
    ...actual,
    verifySignupSession: vi.fn(),
  };
});

const {
  claimTokenMock,
  findLiveTokenByPlaintextMock,
  findLiveTokenForUserMock,
  invalidateSiblingTokensMock,
} = vi.hoisted(() => ({
  claimTokenMock: vi.fn(),
  findLiveTokenByPlaintextMock: vi.fn(),
  findLiveTokenForUserMock: vi.fn(),
  invalidateSiblingTokensMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/pinSetupTokens', () => ({
  claimToken: claimTokenMock,
  findLiveTokenByPlaintext: findLiveTokenByPlaintextMock,
  findLiveTokenForUser: findLiveTokenForUserMock,
  invalidateSiblingTokens: invalidateSiblingTokensMock,
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('$2b$10$hashedpin') },
}));

const { ssrSignInMock, ssrState, cookieMap } = vi.hoisted(() => ({
  ssrSignInMock: vi.fn(),
  ssrState: {
    lastSetAllCallback: null as
      | ((cookies: Array<{ name: string; value: string; options?: unknown }>) => void)
      | null,
  },
  cookieMap: new Map<string, { value: string }>(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(
    (
      _url: string,
      _key: string,
      opts: {
        cookies: {
          getAll: () => Array<{ name: string; value: string }>;
          setAll: (
            cookies: Array<{ name: string; value: string; options?: unknown }>,
          ) => void;
        };
      },
    ) => {
      ssrState.lastSetAllCallback = opts.cookies.setAll;
      return {
        auth: { signInWithPassword: ssrSignInMock },
      };
    },
  ),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => cookieMap.get(name),
    getAll: () => Array.from(cookieMap.entries()).map(([name, v]) => ({ name, value: v.value })),
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { POST } from '@/app/api/auth/set-initial-pin/route';
import { rateLimit, getUpstashRedis } from '@/lib/ratelimit';
import { isWeakPin } from '@/lib/weakPins';
import { parseBodyWithLimit } from '@/lib/validate';
import { verifySignupSession } from '@/lib/signupSessionCookie';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

const VALID_PIN = '472918';
const VALID_USER_ID = 'user-uuid';
const VALID_CENTER_ID = 'center-uuid';
const VALID_TOKEN_ROW_ID = 'token-row-uuid';

type CenterShape = {
  id: string;
  status: string;
  billing_status: string;
  approved_at: string | null;
};
type UserShape = {
  id: string;
  pin_set_at: string | null;
  center_id: string;
};

function makeAdmin(opts?: {
  center?: CenterShape | null;
  user?: UserShape | null;
  ownerLookup?: { id: string; pin_set_at: string | null } | null;
  updateUserByIdError?: boolean;
  getUserByIdEmail?: string | null;
  adminUser?: { id: string } | null;
  auditInsertMock?: ReturnType<typeof vi.fn>;
}): SupabaseClient {
  const center: CenterShape | null =
    opts?.center ?? {
      id: VALID_CENTER_ID,
      status: 'active',
      billing_status: 'active',
      approved_at: new Date().toISOString(),
    };
  const user: UserShape | null =
    opts?.user === undefined
      ? { id: VALID_USER_ID, pin_set_at: null, center_id: VALID_CENTER_ID }
      : opts.user;
  const ownerLookup =
    opts?.ownerLookup === undefined
      ? { id: VALID_USER_ID, pin_set_at: null }
      : opts.ownerLookup;

  const from = vi.fn((table: string) => {
    if (table === 'centers') {
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: center, error: null }),
      };
      return builder;
    }
    if (table === 'users') {
      // Two distinct shapes: cookie-path owner lookup (by center_id + role)
      // and post-resolution user lookup (by id). Both end in maybeSingle.
      let mode: 'owner' | 'user' = 'owner';
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn().mockReturnThis();
      builder.eq = vi.fn((col: string, val: unknown) => {
        if (col === 'id' && val === VALID_USER_ID) mode = 'user';
        return builder;
      });
      builder.limit = vi.fn().mockReturnThis();
      builder.maybeSingle = vi.fn().mockImplementation(async () => {
        if (mode === 'owner') return { data: ownerLookup, error: null };
        return { data: user, error: null };
      });
      builder.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      return builder;
    }
    if (table === 'admin_users') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts?.adminUser ?? null, error: null }),
      };
    }
    if (table === 'audit_log') {
      return { insert: opts?.auditInsertMock ?? vi.fn().mockResolvedValue({ error: null }) };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  });

  return {
    from,
    auth: {
      admin: {
        updateUserById: vi.fn().mockResolvedValue(
          opts?.updateUserByIdError ? { error: new Error('update failed') } : { error: null },
        ),
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { email: opts?.getUserByIdEmail ?? `${VALID_USER_ID}@centerhq.local` } },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient;
}

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/auth/set-initial-pin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.5',
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieMap.clear();
  ssrState.lastSetAllCallback = null;

  vi.mocked(parseBodyWithLimit).mockImplementation(async (req) =>
    JSON.parse(await (req as Request).text()),
  );
  vi.mocked(rateLimit).mockResolvedValue({ success: true, remaining: 4, reset: 0 });
  vi.mocked(getUpstashRedis).mockReturnValue({} as ReturnType<typeof getUpstashRedis>);
  vi.mocked(isWeakPin).mockReturnValue(false);
  vi.mocked(verifySignupSession).mockReturnValue({
    centerId: VALID_CENTER_ID,
    expiresAt: Date.now() + 60_000,
  });

  claimTokenMock.mockReset();
  findLiveTokenByPlaintextMock.mockReset();
  findLiveTokenForUserMock.mockReset();
  invalidateSiblingTokensMock.mockResolvedValue(undefined);

  claimTokenMock.mockResolvedValue({ userId: VALID_USER_ID });
  findLiveTokenForUserMock.mockResolvedValue({
    id: VALID_TOKEN_ROW_ID,
    user_id: VALID_USER_ID,
    token_hash: null,
    source: 'webhook_paymob',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 14 * 60_000).toISOString(),
    used_at: null,
  });

  ssrSignInMock.mockResolvedValue({ data: { session: { access_token: 'a' } }, error: null });

  vi.mocked(getSupabaseAdmin).mockReturnValue(makeAdmin());

  // Default: cookie present and valid.
  cookieMap.set('chq_signup_session', { value: 'signed-token' });
});

describe('POST /api/auth/set-initial-pin', () => {
  it('HAPPY PATH (cookie + paid+activated + webhook token): sets PIN, establishes SSR session', async () => {
    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN }));
    // SSR setAll should have been wired up. Simulate Supabase delivering session cookies.
    ssrState.lastSetAllCallback?.([
      { name: 'sb-test-auth-token', value: 'tok', options: { httpOnly: false, path: '/' } },
    ]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; autoLogin: boolean };
    expect(body.ok).toBe(true);
    expect(body.autoLogin).toBe(true);

    // Auth cookie set on the response.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('sb-test-auth-token');

    // signup-session cookie was cleared (Max-Age=0).
    expect(setCookie).toMatch(/chq_signup_session=;?.*Max-Age=0/);

    // The atomic claim ran with the correct row id.
    expect(claimTokenMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rowId: VALID_TOKEN_ROW_ID }),
    );

    // Sibling tokens invalidated.
    expect(invalidateSiblingTokensMock).toHaveBeenCalledWith(
      expect.anything(),
      VALID_USER_ID,
    );
  });

  it('REFUSES when cookie is present but center is NOT paid+activated (e.g. status=pending_payment)', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeAdmin({
        center: {
          id: VALID_CENTER_ID,
          status: 'pending_payment',
          billing_status: 'pending',
          approved_at: null,
        },
      }),
    );

    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_finalized');
    expect(claimTokenMock).not.toHaveBeenCalled();
  });

  it('REFUSES when no cookie AND no URL token (browser arrived without proof)', async () => {
    cookieMap.delete('chq_signup_session');
    vi.mocked(verifySignupSession).mockReturnValue(null);

    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('token_invalid_or_used');
    expect(claimTokenMock).not.toHaveBeenCalled();
  });

  it('REFUSES token replay: claim returns null on second use', async () => {
    claimTokenMock.mockResolvedValueOnce(null); // race lost
    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('token_invalid_or_used');
  });

  it('REFUSES expired/missing live token (webhook has not minted one yet)', async () => {
    findLiveTokenForUserMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_finalized');
  });

  it('REFUSES an account that already has a PIN (must use change-pin)', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeAdmin({
        ownerLookup: { id: VALID_USER_ID, pin_set_at: '2026-06-01T00:00:00Z' },
      }),
    );
    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('pin_already_set');
    expect(claimTokenMock).not.toHaveBeenCalled();
  });

  it('REJECTS a weak PIN server-side even if the client allowed it', async () => {
    vi.mocked(isWeakPin).mockReturnValue(true);
    const res = await POST(makeRequest({ pin: '123456', pinConfirm: '123456' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('weak_pin');
    expect(claimTokenMock).not.toHaveBeenCalled();
  });

  it('REJECTS PIN mismatch on double-entry', async () => {
    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: '999999' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('mismatch');
    expect(claimTokenMock).not.toHaveBeenCalled();
  });

  it('FALLBACK PATH: URL token from chq_pin_setup_link succeeds when row is fresh', async () => {
    cookieMap.delete('chq_signup_session');
    vi.mocked(verifySignupSession).mockReturnValue(null);

    findLiveTokenByPlaintextMock.mockResolvedValueOnce({
      id: VALID_TOKEN_ROW_ID,
      user_id: VALID_USER_ID,
      token_hash: 'somehash',
      source: 'fallback_link',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 29 * 60_000).toISOString(),
      used_at: null,
    });

    const res = await POST(
      makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN, token: 'plaintext-from-whatsapp' }),
    );
    ssrState.lastSetAllCallback?.([
      { name: 'sb-test-auth-token', value: 'tok2', options: { httpOnly: false, path: '/' } },
    ]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; autoLogin: boolean };
    expect(body.ok).toBe(true);
    expect(body.autoLogin).toBe(true);
    expect(findLiveTokenByPlaintextMock).toHaveBeenCalledWith(
      expect.anything(),
      'plaintext-from-whatsapp',
    );
  });

  it('INTERNAL ADMIN fallback: no public.users row but an admin_users row → sets PIN, skips the center gate', async () => {
    cookieMap.delete('chq_signup_session');
    vi.mocked(verifySignupSession).mockReturnValue(null);
    findLiveTokenByPlaintextMock.mockResolvedValueOnce({
      id: VALID_TOKEN_ROW_ID,
      user_id: VALID_USER_ID,
      token_hash: 'somehash',
      source: 'fallback_link',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 29 * 60_000).toISOString(),
      used_at: null,
    });
    // Center-less internal admin: no users row, has an admin_users row, and NO center
    // anywhere — proving the center-paid gate is not consulted for internal admins.
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeAdmin({ user: null, center: null, adminUser: { id: VALID_USER_ID }, auditInsertMock: auditInsert }),
    );

    const res = await POST(
      makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN, token: 'plaintext-from-whatsapp' }),
    );
    ssrState.lastSetAllCallback?.([
      { name: 'sb-test-auth-token', value: 'tok3', options: { httpOnly: false, path: '/' } },
    ]);

    expect(res.status).toBe(200);
    expect(claimTokenMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rowId: VALID_TOKEN_ROW_ID }),
    );
    expect(invalidateSiblingTokensMock).toHaveBeenCalledWith(expect.anything(), VALID_USER_ID);
    // Audit row IS written for the center-less internal admin (center_id null) — the
    // null-safe access must not throw and drop it.
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'set_initial_pin', user_id: VALID_USER_ID, center_id: null }),
    );
  });

  it('REFUSES a fallback token whose user has NEITHER a users row NOR an admin_users row', async () => {
    cookieMap.delete('chq_signup_session');
    vi.mocked(verifySignupSession).mockReturnValue(null);
    findLiveTokenByPlaintextMock.mockResolvedValueOnce({
      id: VALID_TOKEN_ROW_ID,
      user_id: VALID_USER_ID,
      token_hash: 'somehash',
      source: 'fallback_link',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 29 * 60_000).toISOString(),
      used_at: null,
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(makeAdmin({ user: null, adminUser: null }));

    const res = await POST(
      makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN, token: 'plaintext-from-whatsapp' }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('token_invalid_or_used');
    expect(claimTokenMock).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED with 503 when Upstash is not configured', async () => {
    vi.mocked(getUpstashRedis).mockReturnValue(null);
    const res = await POST(makeRequest({ pin: VALID_PIN, pinConfirm: VALID_PIN }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('auth_system_error');
    expect(claimTokenMock).not.toHaveBeenCalled();
  });
});
