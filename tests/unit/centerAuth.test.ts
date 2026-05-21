import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

type AdminQueryResult = { data: unknown; error: { message: string } | null };

const adminQueue: Record<string, AdminQueryResult[]> = {
  users_core: [],
  users_perms: [],
  admin_users: [],
};

const mockGetSupabaseAdmin = vi.fn(() => ({
  from: (table: string) => ({
    select: (cols: string) => ({
      eq: () => ({
        maybeSingle: async () => {
          if (table === 'admin_users') {
            return adminQueue.admin_users.shift() ?? { data: null, error: null };
          }
          if (table === 'users') {
            const isCore = cols.includes('center_id') && !cols.includes('can_record_payments');
            const queue = isCore ? adminQueue.users_core : adminQueue.users_perms;
            return queue.shift() ?? { data: null, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
}));

const mockSentryCaptureException = vi.fn();
const mockSentryCaptureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: (err: unknown) => mockSentryCaptureException(err),
  captureMessage: (msg: string, level?: string) => mockSentryCaptureMessage(msg, level),
}));

function makeRequest(opts: {
  authHeader?: string | null;
  centerIdQuery?: string;
  centerIdHeader?: string;
} = {}): NextRequest {
  const headers = new Map<string, string>();
  if (opts.authHeader !== null) {
    headers.set('Authorization', opts.authHeader ?? 'Bearer fake-token');
  }
  if (opts.centerIdHeader) headers.set('x-center-id', opts.centerIdHeader);
  const searchParams = new URLSearchParams();
  if (opts.centerIdQuery) searchParams.set('center_id', opts.centerIdQuery);
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams },
  } as unknown as NextRequest;
}

import { requireCenterAuth } from '@/lib/centerAuth';

const VALID_USER = { id: 'user-1' };
const CENTER_ID = 'center-1';

beforeEach(() => {
  mockGetUser.mockReset();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  adminQueue.users_core = [];
  adminQueue.users_perms = [];
  adminQueue.admin_users = [];
});

describe('requireCenterAuth', () => {
  it('returns ok with all permission flags populated when core + permissions succeed', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: CENTER_ID, role: 'owner' }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.users_perms = [
      {
        data: {
          can_record_payments: true,
          can_view_payments: true,
          can_manage_billing: true,
          can_edit_center_profile: true,
          can_delete_students: false,
          can_manage_academic_calendar: true,
          can_place_card_orders: true,
          can_request_referral_payouts: false,
        },
        error: null,
      },
    ];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe('user-1');
    expect(result.centerId).toBe(CENTER_ID);
    expect(result.role).toBe('owner');
    expect(result.permissions.can_manage_billing).toBe(true);
    expect(result.permissions.can_delete_students).toBe(false);
    expect(mockSentryCaptureMessage).not.toHaveBeenCalled();
  });

  it('returns ok with all permission flags FALSE and Sentry warn when permissions query errors (regression: schema-drift no longer 401s real users)', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: CENTER_ID, role: 'owner' }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.users_perms = [
      { data: null, error: { message: 'column "can_manage_billing" does not exist' } },
    ];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe('user-1');
    expect(result.centerId).toBe(CENTER_ID);
    expect(result.role).toBe('owner');
    expect(Object.values(result.permissions).every((v) => v === false)).toBe(true);
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('centerAuth permission-column lookup failed'),
      'warning',
    );
  });

  it('returns 401 NO_USER_ROW + Sentry warn when neither users nor admin_users row exists', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [{ data: null, error: null }];
    adminQueue.admin_users = [{ data: null, error: null }];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('NO_USER_ROW');
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('no users or admin_users row'),
      'warning',
    );
  });

  it('returns 401 NO_BEARER when Authorization header is absent', async () => {
    const result = await requireCenterAuth(makeRequest({ authHeader: null }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('NO_BEARER');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('returns 401 TOKEN_INVALID + Sentry warn when getUser rejects', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'invalid JWT: token is expired' },
    });

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('TOKEN_INVALID');
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('token is expired'),
      'warning',
    );
  });

  it('returns 401 NO_CENTER_ID when user has no center_id and is not a super_admin', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: null, role: 'assistant' }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('NO_CENTER_ID');
  });

  it('returns 401 TOKEN_INVALID + Sentry exception when CORE users lookup itself errors', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: null, error: { message: 'database connection lost' } },
    ];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('TOKEN_INVALID');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('super-admin via admin_users with x-center-id header resolves to provided centerId', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [{ data: null, error: null }];
    adminQueue.admin_users = [{ data: { id: 'user-1' }, error: null }];

    const result = await requireCenterAuth(
      makeRequest({ centerIdHeader: 'center-override' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.centerId).toBe('center-override');
    expect(result.role).toBe('super_admin');
    expect(Object.values(result.permissions).every((v) => v === false)).toBe(true);
  });
});
