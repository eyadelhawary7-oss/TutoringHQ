import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.SUPER_ADMIN_PHONES = '';

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
  users_teacher: [],
  admin_users: [],
  centers: [],
  teacher_center: [],
};

function resolveQuery(table: string, cols: string): AdminQueryResult {
  if (table === 'admin_users') {
    return adminQueue.admin_users.shift() ?? { data: null, error: null };
  }
  if (table === 'users') {
    if (cols.includes('can_record_payments')) {
      return adminQueue.users_perms.shift() ?? { data: null, error: null };
    }
    if (cols.includes('center_id')) {
      return adminQueue.users_core.shift() ?? { data: null, error: null };
    }
    // requireTeacherAuth core lookup selects only `id, role`.
    return adminQueue.users_teacher.shift() ?? { data: null, error: null };
  }
  if (table === 'centers') {
    return adminQueue.centers.shift() ?? { data: null, error: null };
  }
  if (table === 'teacher_center') {
    return adminQueue.teacher_center.shift() ?? { data: [], error: null };
  }
  return { data: null, error: null };
}

const mockGetSupabaseAdmin = vi.fn(() => ({
  from: (table: string) => ({
    select: (cols: string) => {
      // Builder supports both `.eq().maybeSingle()` (single-row lookups) and
      // `.eq().eq()` awaited directly (teacher_center membership list).
      const builder = {
        eq: () => builder,
        maybeSingle: async () => resolveQuery(table, cols),
        then: (
          onFulfilled: (v: AdminQueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(resolveQuery(table, cols)).then(onFulfilled, onRejected),
      };
      return builder;
    },
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

import { requireCenterAuth, requireTeacherAuth } from '@/lib/centerAuth';

const VALID_USER = { id: 'user-1' };
const CENTER_ID = 'center-1';

beforeEach(() => {
  mockGetUser.mockReset();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  adminQueue.users_core = [];
  adminQueue.users_perms = [];
  adminQueue.users_teacher = [];
  adminQueue.admin_users = [];
  adminQueue.centers = [];
  adminQueue.teacher_center = [];
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

  // Unchanged behaviour: an owner whose center_id is NULL and who names no
  // centre still gets 401 NO_CENTER_ID — the teacher branch must not intercept
  // a non-teacher role.
  it('returns 401 NO_CENTER_ID for owner with null center_id and no center_id param (unchanged)', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: null, role: 'owner' }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('NO_CENTER_ID');
  });

  // Teacher branch (Model B): a teacher names a centre they are an ACTIVE
  // member of via ?center_id= → resolves to that centre, role stays 'teacher'.
  it('teacher with ?center_id of an active teacher_center centre: ok with that centerId', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: null, role: 'teacher', phone: null }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.teacher_center = [
      { data: [{ center_id: 'center-A' }, { center_id: 'center-B' }], error: null },
    ];
    adminQueue.users_perms = [{ data: null, error: null }];

    const result = await requireCenterAuth(makeRequest({ centerIdQuery: 'center-A' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.centerId).toBe('center-A');
    expect(result.role).toBe('teacher');
    expect(result.isSuperAdmin).toBe(false);
  });

  // Teacher names a centre they are NOT an active member of → 403 TEACHER_NOT_MEMBER.
  it('teacher with ?center_id of a centre with no active membership: 403 TEACHER_NOT_MEMBER', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: null, role: 'teacher', phone: null }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    // Active memberships do not include center-victim (status-filtered in query).
    adminQueue.teacher_center = [
      { data: [{ center_id: 'center-A' }], error: null },
    ];

    const result = await requireCenterAuth(makeRequest({ centerIdQuery: 'center-victim' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('TEACHER_NOT_MEMBER');
  });

  // Teacher with no centre named is in their private context → 403
  // TEACHER_NO_CENTER_CONTEXT (route should fall back to requireTeacherAuth).
  it('teacher with no center_id param: 403 TEACHER_NO_CENTER_CONTEXT', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: null, role: 'teacher', phone: null }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('TEACHER_NO_CENTER_CONTEXT');
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
    expect(result.isSuperAdmin).toBe(true);
    expect(Object.values(result.permissions).every((v) => v === false)).toBe(true);
  });

  // Regression for the public.users.role privilege-escalation P0. The prior
  // implementation treated `users.role === 'super_admin'` as authority, letting
  // a tampered centre row pivot cross-tenant via `?center_id=` / `x-center-id`.
  it('regression: users.role="super_admin" without admin_users row does NOT confer super-admin', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      {
        data: {
          id: 'user-1',
          center_id: CENTER_ID,
          role: 'super_admin',
          phone: '+201000000000',
        },
        error: null,
      },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.users_perms = [{ data: null, error: null }];

    const result = await requireCenterAuth(
      makeRequest({ centerIdHeader: 'center-victim' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isSuperAdmin).toBe(false);
    // x-center-id MUST be ignored — caller is pinned to their own centre.
    expect(result.centerId).toBe(CENTER_ID);
  });

  it('regression: users.role="super_admin" cannot override centerId via ?center_id query', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      {
        data: {
          id: 'user-1',
          center_id: CENTER_ID,
          role: 'super_admin',
          phone: '+201000000000',
        },
        error: null,
      },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.users_perms = [{ data: null, error: null }];

    const result = await requireCenterAuth(
      makeRequest({ centerIdQuery: 'center-victim' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isSuperAdmin).toBe(false);
    expect(result.centerId).toBe(CENTER_ID);
  });

  it('phone-based super-admin (SUPER_ADMIN_PHONES) overrides centerId from x-center-id', async () => {
    const PREV_PHONES = process.env.SUPER_ADMIN_PHONES;
    process.env.SUPER_ADMIN_PHONES = '+201234567890';
    try {
      mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
      adminQueue.users_core = [
        {
          data: {
            id: 'user-1',
            center_id: CENTER_ID,
            role: 'owner',
            phone: '+201234567890',
          },
          error: null,
        },
      ];
      adminQueue.admin_users = [{ data: null, error: null }];
      adminQueue.users_perms = [{ data: null, error: null }];

      const result = await requireCenterAuth(
        makeRequest({ centerIdHeader: 'center-override' }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.isSuperAdmin).toBe(true);
      expect(result.centerId).toBe('center-override');
    } finally {
      process.env.SUPER_ADMIN_PHONES = PREV_PHONES;
    }
  });

  it('returns isSuperAdmin=false for ordinary owner with no admin_users row', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      {
        data: {
          id: 'user-1',
          center_id: CENTER_ID,
          role: 'owner',
          phone: '+201000000000',
        },
        error: null,
      },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.users_perms = [{ data: null, error: null }];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isSuperAdmin).toBe(false);
    expect(result.role).toBe('owner');
  });

  // Regression for FIX 1(b): isSuperAdmin must derive from the verified session
  // phone (auth.users.phone), not public.users.phone. Even if a centre owner
  // managed to write their public.users.phone to a SUPER_ADMIN_PHONES value
  // (defense-in-depth blocked separately by dbProxyProtectedColumns), the
  // session phone is unchanged so they remain non-super-admin.
  it('regression: SUPER_ADMIN match uses SESSION phone, not public.users.phone', async () => {
    const PREV = process.env.SUPER_ADMIN_PHONES;
    process.env.SUPER_ADMIN_PHONES = '+201234567890';
    try {
      // Session phone is a normal owner phone.
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'user-1', phone: '201000000000' } },
        error: null,
      });
      // public.users.phone has been tampered to the super-admin value.
      adminQueue.users_core = [
        {
          data: {
            id: 'user-1',
            center_id: CENTER_ID,
            role: 'owner',
            phone: '+201234567890',
          },
          error: null,
        },
      ];
      adminQueue.admin_users = [{ data: null, error: null }];
      adminQueue.users_perms = [{ data: null, error: null }];

      const result = await requireCenterAuth(
        makeRequest({ centerIdHeader: 'center-victim' }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Tampered public.users.phone MUST NOT confer super-admin.
      expect(result.isSuperAdmin).toBe(false);
      // x-center-id is therefore ignored , caller is pinned to their centre.
      expect(result.centerId).toBe(CENTER_ID);
    } finally {
      process.env.SUPER_ADMIN_PHONES = PREV;
    }
  });

  // Structural-layer regression (FIX 1b §10c follow-up): CenterHQ phone+PIN
  // auth creates auth.users with email = `<phonedigits>@centerhq.local` and
  // LEAVES auth.users.phone null (see signupPaymobAutoApprove.ts +
  // admin/centers/route.ts , `auth.admin.createUser({ email, password })`
  // never sets `phone`). So the verified super-admin phone must derive from
  // the email local-part, not from `user.phone` (always null in production).
  // Without this derivation the only signal would be `public.users.phone`,
  // which is centre-tenant data , the very class of bug FIX 1b set out to
  // close. This test deliberately leaves USERS_PROTECTED_COLUMNS out of the
  // picture: it asserts the structural source-of-truth, NOT the proxy block.
  it('regression: SUPER_ADMIN derives from auth EMAIL local-part when auth.users.phone is null (CenterHQ shape)', async () => {
    const PREV = process.env.SUPER_ADMIN_PHONES;
    process.env.SUPER_ADMIN_PHONES = '+201234567890';
    try {
      // CenterHQ-shape auth user: phone+PIN, email-as-identity, phone=null.
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-1',
            email: '201000000000@centerhq.local',
            phone: null,
          },
        },
        error: null,
      });
      // public.users.phone has been tampered to match SUPER_ADMIN_PHONES.
      // Without the email-derivation fix this would (silently) elevate.
      adminQueue.users_core = [
        {
          data: {
            id: 'user-1',
            center_id: CENTER_ID,
            role: 'owner',
            phone: '+201234567890',
          },
          error: null,
        },
      ];
      adminQueue.admin_users = [{ data: null, error: null }];
      adminQueue.users_perms = [{ data: null, error: null }];

      const result = await requireCenterAuth(
        makeRequest({ centerIdHeader: 'center-victim' }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The email local-part `201000000000` does NOT match the env entry
      // (`+201234567890` → digits `201234567890`), and the tampered public
      // users row is ignored. Caller stays pinned to their own centre.
      expect(result.isSuperAdmin).toBe(false);
      expect(result.centerId).toBe(CENTER_ID);
    } finally {
      process.env.SUPER_ADMIN_PHONES = PREV;
    }
  });

  it('regression: SUPER_ADMIN match SUCCEEDS via auth email local-part when env matches (CenterHQ shape)', async () => {
    const PREV = process.env.SUPER_ADMIN_PHONES;
    process.env.SUPER_ADMIN_PHONES = '+201234567890';
    try {
      // Auth email IS the SUPER_ADMIN_PHONES match , email local-part digits
      // equal the env value's digits. phone=null mirrors production shape.
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-1',
            email: '201234567890@centerhq.local',
            phone: null,
          },
        },
        error: null,
      });
      // public.users.phone is intentionally absent / unrelated.
      adminQueue.users_core = [
        {
          data: { id: 'user-1', center_id: CENTER_ID, role: 'owner', phone: null },
          error: null,
        },
      ];
      adminQueue.admin_users = [{ data: null, error: null }];
      adminQueue.users_perms = [{ data: null, error: null }];

      const result = await requireCenterAuth(
        makeRequest({ centerIdHeader: 'center-override' }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.isSuperAdmin).toBe(true);
      // Super-admin can target any centre via x-center-id.
      expect(result.centerId).toBe('center-override');
    } finally {
      process.env.SUPER_ADMIN_PHONES = PREV;
    }
  });

  // Regression for FIX 1(b): the session phone may be E.164 without `+`
  // (Supabase auth typical format) while SUPER_ADMIN_PHONES often carries `+`.
  // isSuperAdminPhone must normalise both sides.
  it('regression: SUPER_ADMIN match normalises digit-equivalent phones', async () => {
    const PREV = process.env.SUPER_ADMIN_PHONES;
    process.env.SUPER_ADMIN_PHONES = '+201234567890';
    try {
      // Session phone in Supabase auth format (no `+`).
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'user-1', phone: '201234567890' } },
        error: null,
      });
      adminQueue.users_core = [
        {
          data: {
            id: 'user-1',
            center_id: CENTER_ID,
            role: 'owner',
            phone: '+201234567890',
          },
          error: null,
        },
      ];
      adminQueue.admin_users = [{ data: null, error: null }];
      adminQueue.users_perms = [{ data: null, error: null }];

      const result = await requireCenterAuth(
        makeRequest({ centerIdHeader: 'center-override' }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.isSuperAdmin).toBe(true);
      expect(result.centerId).toBe('center-override');
    } finally {
      process.env.SUPER_ADMIN_PHONES = PREV;
    }
  });

  // Regression for FIX 3: a suspended centre's owner gets 403 CENTER_SUSPENDED
  // on a normal route, not silent passage. Previously only the middleware
  // enforced this and the middleware skipped all `/api/*` paths.
  it('regression: suspended centre gets 403 CENTER_SUSPENDED on default routes', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: CENTER_ID, role: 'owner', phone: null }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.centers = [
      { data: { status: 'suspended', is_blacklisted: false }, error: null },
    ];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('CENTER_SUSPENDED');
  });

  it('regression: blacklisted centre gets 403 CENTER_BLACKLISTED on default routes', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: CENTER_ID, role: 'owner', phone: null }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    adminQueue.centers = [
      // Active status, but blacklisted , blacklist takes precedence.
      { data: { status: 'active', is_blacklisted: true }, error: null },
    ];

    const result = await requireCenterAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('CENTER_BLACKLISTED');
  });

  it('regression: allowSuspended=true lets a suspended owner through (reactivation route)', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_core = [
      { data: { id: 'user-1', center_id: CENTER_ID, role: 'owner', phone: null }, error: null },
    ];
    adminQueue.admin_users = [{ data: null, error: null }];
    // No centers query is consumed when allowSuspended is true.
    adminQueue.users_perms = [{ data: null, error: null }];

    const result = await requireCenterAuth(makeRequest(), { allowSuspended: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.centerId).toBe(CENTER_ID);
    // Suspension lookup was skipped: the centers queue is untouched.
    expect(adminQueue.centers.length).toBe(0);
  });

  it('super-admin bypasses the suspension gate even when targeting a suspended centre', async () => {
    const PREV = process.env.SUPER_ADMIN_PHONES;
    process.env.SUPER_ADMIN_PHONES = '';
    try {
      mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
      adminQueue.users_core = [{ data: null, error: null }];
      adminQueue.admin_users = [{ data: { id: 'user-1' }, error: null }];

      const result = await requireCenterAuth(
        makeRequest({ centerIdHeader: 'center-suspended' }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.isSuperAdmin).toBe(true);
      // No centers lookup is needed for super-admin , gate skipped.
      expect(adminQueue.centers.length).toBe(0);
    } finally {
      process.env.SUPER_ADMIN_PHONES = PREV;
    }
  });
});

describe('requireTeacherAuth', () => {
  it('returns ok with the active membership set for a teacher', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_teacher = [
      { data: { id: 'user-1', role: 'teacher' }, error: null },
    ];
    adminQueue.teacher_center = [
      {
        data: [
          { center_id: 'center-A' },
          { center_id: 'center-B' },
          // Duplicate must be deduped by the Set.
          { center_id: 'center-A' },
        ],
        error: null,
      },
    ];

    const result = await requireTeacherAuth(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe('user-1');
    expect(result.centerIds.sort()).toEqual(['center-A', 'center-B']);
    expect(result.supabaseAdmin).toBeDefined();
  });

  it('returns 403 NOT_A_TEACHER when the user role is owner', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_teacher = [
      { data: { id: 'user-1', role: 'owner' }, error: null },
    ];

    const result = await requireTeacherAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('NOT_A_TEACHER');
  });

  it('returns ok with an empty membership set for a pure private teacher', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_teacher = [
      { data: { id: 'user-1', role: 'teacher' }, error: null },
    ];
    adminQueue.teacher_center = [{ data: [], error: null }];

    const result = await requireTeacherAuth(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.centerIds).toEqual([]);
  });

  it('returns 401 NO_USER_ROW when no users row exists', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_teacher = [{ data: null, error: null }];

    const result = await requireTeacherAuth(makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string; code: string };
    expect(body.code).toBe('NO_USER_ROW');
  });
});
