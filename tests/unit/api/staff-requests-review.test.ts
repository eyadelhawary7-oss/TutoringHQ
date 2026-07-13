/**
 * /api/admin/staff-requests  and  /api/admin/staff-requests/[id]
 *
 * The CEO-approval boundary. Mocks only getAdminContext + CSRF + provisionStaffLogin; the
 * role-freeze, self-approval guard, claim-first provisioning, and existing-member handling
 * are the REAL route.
 *
 *   1. Only super_admin may list the queue or act on it (others 401/403).
 *   2. APPROVE claims the request atomically, then provisions via the EXISTING primitive
 *      (provisionStaffLogin) and writes an admin_users row whose role is the request's FROZEN
 *      role, then returns the set-PIN link.
 *   3. An existing INTERNAL team member (admin_users row, no public.users row) is detected by
 *      PHONE and retired as already-in-team — never re-provisioned (regression: the
 *      users-only lookup used to 500 on the duplicate auth email).
 *   4. If the atomic claim is lost to a concurrent decline/approve, nothing is provisioned (409).
 *   5. DECLINE provisions NOTHING and 409s if the row is no longer pending.
 *   6. A user cannot approve their OWN request (phone match → 403, no provisioning).
 *   7. A non-assignable role (e.g. super_admin) can never be provisioned (400).
 *   8. A non-pending request is 409; a missing request is 404.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { AdminContext, InternalRole } from '@/lib/admin-auth';

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://staffreq-test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service';

  let maybeSingle: Record<string, unknown[]> = {};
  let list: Record<string, unknown[]> = {};
  let userEmail = '';
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const updates: { table: string; values: Record<string, unknown> }[] = [];

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'gt', 'limit']) b[m] = () => b;
    b.insert = (values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return b;
    };
    b.update = (values: Record<string, unknown>) => {
      updates.push({ table, values });
      return b;
    };
    b.maybeSingle = async () => {
      const q = maybeSingle[table];
      const data = q && q.length ? q.shift() : null;
      return { data: data ?? null, error: null };
    };
    b.single = async () => ({ data: maybeSingle[table]?.shift() ?? null, error: null });
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: list[table] ?? [], error: null });
    return b;
  }

  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const client = {
    from: (t: string) => builder(t),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: userEmail } }, error: null })),
        deleteUser,
      },
    },
  };

  return {
    client,
    inserts,
    updates,
    deleteUser,
    set: (cfg: { maybeSingle?: Record<string, unknown[]>; list?: Record<string, unknown[]>; userEmail?: string }) => {
      maybeSingle = cfg.maybeSingle ?? {};
      list = cfg.list ?? {};
      userEmail = cfg.userEmail ?? '';
    },
    reset: () => {
      maybeSingle = {};
      list = {};
      userEmail = '';
      inserts.length = 0;
      updates.length = 0;
    },
  };
});

const mockedGetAdminContext = vi.fn();
vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, getAdminContext: (req: Request) => mockedGetAdminContext(req) };
});
vi.mock('@/lib/csrf', () => ({ validateCSRFRequest: () => true }));

const provisionMock = vi.fn();
vi.mock('@/lib/staffLoginProvision', () => ({ provisionStaffLogin: (...a: unknown[]) => provisionMock(...a) }));

import * as listRoute from '@/app/api/admin/staff-requests/route';
import * as idRoute from '@/app/api/admin/staff-requests/[id]/route';

function makeCtx(internalRole: InternalRole, adminRole: string | null, userId = 'ceo-user'): AdminContext {
  return {
    userId,
    internalRole,
    adminRole,
    supabaseAdmin: h.client as unknown as AdminContext['supabaseAdmin'],
  };
}
const CEO = () => makeCtx('super_admin', 'super_admin');
const VIEWER = () => makeCtx('internal_viewer', 'accountant', 'acct-user');

function jsonReq(method: string, body: unknown): NextRequest {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(body);
  return new Request('https://t.test/api/admin/staff-requests', init) as unknown as NextRequest;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// A pending request keyed by a phone distinct from the approver's.
const pendingReq = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Rep One',
  phone: '201000000001',
  email: null,
  role: 'sales_rep',
  custom_permissions: [],
  status: 'pending',
  ...over,
});

beforeEach(() => {
  mockedGetAdminContext.mockReset();
  provisionMock.mockReset();
  h.reset();
});

describe('GET /api/admin/staff-requests', () => {
  it('super_admin sees the pending queue (200)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ list: { staff_requests: [{ id: 'r1', status: 'pending' }] } });
    const res = await listRoute.GET(jsonReq('GET', {}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: unknown[] };
    expect(body.requests).toHaveLength(1);
  });

  it('a non-super_admin is denied (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(VIEWER());
    const res = await listRoute.GET(jsonReq('GET', {}));
    expect(res.status).toBe(403);
  });

  it('unauthenticated is denied (401)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(null);
    const res = await listRoute.GET(jsonReq('GET', {}));
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/admin/staff-requests/[id] — approve', () => {
  it('claims, provisions via provisionStaffLogin with the FROZEN role, returns the set-PIN link', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    provisionMock.mockResolvedValue({ userId: 'new-uid', setupUrl: 'https://app/ar/set-pin?t=TOK' });
    h.set({
      userEmail: '201888888888@centerhq.local', // approver phone (≠ request phone)
      maybeSingle: {
        staff_requests: [pendingReq(), { id: 'r1' }], // load, then the atomic claim
        admin_users: [{ phone: '201888888888' }, null, null], // approverPhoneKeys, existingByPhone, existingAdmin-by-id
        users: [],
        staff: [],
      },
    });

    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('r1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setupUrl?: string; provisioned?: boolean };
    expect(body.provisioned).toBe(true);
    expect(body.setupUrl).toBe('https://app/ar/set-pin?t=TOK');

    expect(provisionMock).toHaveBeenCalledTimes(1);
    const au = h.inserts.find((i) => i.table === 'admin_users')!.values;
    expect(au.role).toBe('sales_rep'); // FROZEN from the request
    expect(au.id).toBe('new-uid');
    // Claimed (status→approved) and the provisioned identity stamped on.
    expect(h.updates.some((u) => u.table === 'staff_requests' && u.values.status === 'approved')).toBe(true);
    expect(h.updates.some((u) => u.table === 'staff_requests' && u.values.provisioned_user_id === 'new-uid')).toBe(true);
  });

  it('an EXISTING internal member (matched by phone) is retired as already-in-team — NO re-provision', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({
      userEmail: '201888888888@centerhq.local',
      maybeSingle: {
        staff_requests: [pendingReq(), { id: 'r1' }], // load, then the guarded claim in the existingByPhone branch
        admin_users: [{ phone: '201888888888' }, { id: 'existing-admin' }], // approverPhoneKeys, existingByPhone HIT
      },
    });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('r1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyInTeam?: boolean };
    expect(body.alreadyInTeam).toBe(true);
    expect(provisionMock).not.toHaveBeenCalled();
    expect(h.inserts.find((i) => i.table === 'admin_users')).toBeUndefined();
  });

  it('a LOST atomic claim (concurrent decline) provisions nothing (409)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({
      userEmail: '201888888888@centerhq.local',
      maybeSingle: {
        staff_requests: [pendingReq(), null], // load ok, but the claim matches 0 rows
        admin_users: [{ phone: '201888888888' }, null], // approverPhoneKeys, existingByPhone null
        users: [],
      },
    });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('r1'));
    expect(res.status).toBe(409);
    expect(provisionMock).not.toHaveBeenCalled();
    expect(h.inserts.find((i) => i.table === 'admin_users')).toBeUndefined();
  });

  it('BLOCKS approving your own request (phone match) — no provisioning', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({
      userEmail: '201000000001@centerhq.local', // approver phone == request phone
      maybeSingle: {
        staff_requests: [pendingReq({ name: 'Me' })],
        admin_users: [{ phone: '201000000001' }],
      },
    });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('r1'));
    expect(res.status).toBe(403);
    expect(provisionMock).not.toHaveBeenCalled();
    expect(h.inserts.find((i) => i.table === 'admin_users')).toBeUndefined();
  });

  it('refuses to provision a non-assignable role (super_admin) — 400', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ maybeSingle: { staff_requests: [pendingReq({ role: 'super_admin', phone: '201000000002' })] } });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('r1'));
    expect(res.status).toBe(400);
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('a non-super_admin cannot approve (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(VIEWER());
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('r1'));
    expect(res.status).toBe(403);
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('a missing request is 404', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ maybeSingle: { staff_requests: [] } });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('nope'));
    expect(res.status).toBe(404);
  });

  it('an already-reviewed request is 409', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ maybeSingle: { staff_requests: [pendingReq({ status: 'approved' })] } });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('r1'));
    expect(res.status).toBe(409);
    expect(provisionMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/staff-requests/[id] — decline', () => {
  it('marks declined and provisions NOTHING', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({
      maybeSingle: { staff_requests: [pendingReq(), { id: 'r1' }] }, // load, then the guarded decline update
    });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'decline', decline_reason: 'not now' }), params('r1'));
    expect(res.status).toBe(200);
    expect(provisionMock).not.toHaveBeenCalled();
    expect(h.inserts.find((i) => i.table === 'admin_users')).toBeUndefined();
    const upd = h.updates.find((u) => u.table === 'staff_requests')!.values;
    expect(upd.status).toBe('declined');
    expect(upd.decline_reason).toBe('not now');
  });

  it('409s when the row is no longer pending (lost race)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ maybeSingle: { staff_requests: [pendingReq(), null] } }); // load ok, decline matches 0 rows
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'decline' }), params('r1'));
    expect(res.status).toBe(409);
  });
});
