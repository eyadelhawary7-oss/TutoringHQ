import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
  rateLimitExceededResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
  ),
}));

vi.mock('@/lib/validate', () => ({
  parseBodyWithLimit: vi.fn(),
}));

import { PATCH } from '@/app/api/settings/staff/[userId]/permissions/route';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';
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

type MaybeSingleResult = { data: Record<string, unknown> | null; error: { message: string } | null };

// Rule 151 split: the route makes THREE maybeSingle calls per request in order:
// 1. CORE  — SELECT id, center_id, role
// 2. PERMS — SELECT the 8 permission columns
// 3. UPDATE — .update().eq().eq().select(PERMISSION_COLUMNS).maybeSingle()
function makeSupabaseMock(opts: {
  core?: MaybeSingleResult;
  perms?: MaybeSingleResult;
  update?: MaybeSingleResult;
} = {}) {
  const core: MaybeSingleResult = opts.core ?? { data: null, error: null };
  const perms: MaybeSingleResult = opts.perms ?? { data: null, error: null };
  const update: MaybeSingleResult = opts.update ?? { data: null, error: null };

  const maybySingleMock = vi
    .fn()
    .mockResolvedValueOnce(core)
    .mockResolvedValueOnce(perms)
    .mockResolvedValueOnce(update);

  const insertMock = vi.fn().mockResolvedValue({ error: null });

  const chain = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: insertMock,
    eq: vi.fn().mockReturnThis(),
    maybeSingle: maybySingleMock,
  };

  return {
    admin: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'audit_log') return { insert: insertMock };
        return chain;
      }),
    } as unknown as SupabaseClient,
    insertMock,
    maybySingleMock,
  };
}

function makeOwnerAuth(supabaseAdmin: SupabaseClient, role = 'owner'): CenterAuthOk {
  return {
    ok: true,
    userId: 'owner-user-id',
    centerId: 'center-1',
    role,
    isSuperAdmin: false,
    permissions: ALL_FALSE_PERMS,
    supabaseAdmin,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/settings/staff/target-user/permissions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

const TARGET_USER_CORE = {
  id: 'target-user',
  center_id: 'center-1',
  role: 'assistant',
};
const TARGET_USER_PERMS = {
  can_record_payments: false,
  can_view_payments: false,
  can_manage_billing: false,
  can_edit_center_profile: false,
  can_delete_students: false,
  can_manage_academic_calendar: false,
  can_place_card_orders: false,
  can_request_referral_payouts: false,
};

describe('PATCH /api/settings/staff/[userId]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseBodyWithLimit).mockImplementation(async (req) => {
      const text = await req.text();
      return JSON.parse(text);
    });
  });

  it('returns 403 when caller is not owner', async () => {
    const { admin } = makeSupabaseMock();
    vi.mocked(requireCenterAuth).mockResolvedValue(makeOwnerAuth(admin, 'assistant'));

    const res = await PATCH(makeRequest({ can_manage_billing: true }), {
      params: Promise.resolve({ userId: 'target-user' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('owner_required');
  });

  it('returns 404 when CORE returns null (genuine missing row)', async () => {
    const { admin } = makeSupabaseMock({ core: { data: null, error: null } });
    vi.mocked(requireCenterAuth).mockResolvedValue(makeOwnerAuth(admin));

    const res = await PATCH(makeRequest({ can_manage_billing: true }), {
      params: Promise.resolve({ userId: 'target-user' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('user_not_found');
  });

  it('returns 404 when target row belongs to a different center (cross-center guard)', async () => {
    const { admin } = makeSupabaseMock({
      core: {
        data: { id: 'target-user', center_id: 'OTHER-CENTER', role: 'assistant' },
        error: null,
      },
    });
    vi.mocked(requireCenterAuth).mockResolvedValue(makeOwnerAuth(admin));

    const res = await PATCH(makeRequest({ can_manage_billing: true }), {
      params: Promise.resolve({ userId: 'target-user' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('user_not_found');
  });

  it('returns 500 (NOT 404) when the CORE select errors (Rule 151 regression)', async () => {
    const { admin } = makeSupabaseMock({
      core: { data: null, error: { message: 'cache stale: column missing' } },
    });
    vi.mocked(requireCenterAuth).mockResolvedValue(makeOwnerAuth(admin));

    const res = await PATCH(makeRequest({ can_manage_billing: true }), {
      params: Promise.resolve({ userId: 'target-user' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('server_error');
  });

  it('proceeds when PERMISSIONS read errors: update runs, before snapshot defaults to false, 200', async () => {
    const updatedUser = { ...TARGET_USER_PERMS, can_manage_billing: true };
    const { admin, insertMock } = makeSupabaseMock({
      core: { data: TARGET_USER_CORE, error: null },
      perms: { data: null, error: { message: 'column "can_xyz" does not exist' } },
      update: { data: updatedUser, error: null },
    });
    vi.mocked(requireCenterAuth).mockResolvedValue(makeOwnerAuth(admin));

    const res = await PATCH(makeRequest({ can_manage_billing: true }), {
      params: Promise.resolve({ userId: 'target-user' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permissions.can_manage_billing).toBe(true);

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update_staff_permissions',
        details: expect.objectContaining({
          before: expect.objectContaining({ can_manage_billing: false }),
          after: expect.objectContaining({ can_manage_billing: true }),
        }),
      }),
    );
  });

  it('returns 200 with updated permission values on valid request', async () => {
    const updatedUser = { ...TARGET_USER_PERMS, can_manage_billing: true };
    const { admin } = makeSupabaseMock({
      core: { data: TARGET_USER_CORE, error: null },
      perms: { data: TARGET_USER_PERMS, error: null },
      update: { data: updatedUser, error: null },
    });
    vi.mocked(requireCenterAuth).mockResolvedValue(makeOwnerAuth(admin));

    const res = await PATCH(makeRequest({ can_manage_billing: true }), {
      params: Promise.resolve({ userId: 'target-user' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permissions.can_manage_billing).toBe(true);
    expect(body.permissions.can_delete_students).toBe(false);
  });

  it('writes an audit_log entry after a successful update', async () => {
    const updatedUser = { ...TARGET_USER_PERMS, can_place_card_orders: true };
    const { admin, insertMock } = makeSupabaseMock({
      core: { data: TARGET_USER_CORE, error: null },
      perms: { data: TARGET_USER_PERMS, error: null },
      update: { data: updatedUser, error: null },
    });
    vi.mocked(requireCenterAuth).mockResolvedValue(makeOwnerAuth(admin));

    await PATCH(makeRequest({ can_place_card_orders: true }), {
      params: Promise.resolve({ userId: 'target-user' }),
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update_staff_permissions',
        user_id: 'owner-user-id',
        center_id: 'center-1',
        details: expect.objectContaining({
          target_user_id: 'target-user',
          before: expect.objectContaining({ can_place_card_orders: false }),
          after: expect.objectContaining({ can_place_card_orders: true }),
        }),
      }),
    );
  });
});
