/**
 * Phase 4b — two-level (CEO -> Manager -> Rep) assignment API.
 *
 * Proves the security-critical behaviours against a recording Supabase stub and the REAL
 * requireAdminRole (only getAdminContext is mocked):
 *   1. CEO batch-assign to a manager rejects a non-'sm' target (400) and, on success,
 *      inserts rows with manager_staff_id set / staff_id NULL / pending_sm_approval / 'sm'.
 *   2. Manager sub-assign (PATCH) may only touch rows they own (manager_staff_id === their
 *      staff id) and may only target a rep who reports_to them — otherwise 403.
 *   3. Non-CEO / non-manager callers cannot list assignments (403).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminContext, InternalRole } from '@/lib/admin-auth';

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://phase4b-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'phase4b-test-service-key';

  // Per-table FIFO queue for .maybeSingle(), single value for .single(), list for thenable.
  let maybeSingle: Record<string, unknown[]> = {};
  let single: Record<string, unknown> = {};
  let list: Record<string, unknown[]> = {};
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const inserts: { table: string; values: unknown }[] = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'or', 'neq', 'not', 'gte', 'lte', 'limit', 'range', 'in', 'eq']) {
      b[m] = () => b;
    }
    b.update = (values: Record<string, unknown>) => {
      updates.push({ table, values });
      return b;
    };
    b.insert = (values: unknown) => {
      inserts.push({ table, values });
      return b;
    };
    b.delete = () => b;
    b.maybeSingle = async () => {
      const q = maybeSingle[table];
      const data = q && q.length ? q.shift() : null;
      return { data: data ?? null, error: null };
    };
    b.single = async () => ({ data: single[table] ?? null, error: null });
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: list[table] ?? [], error: null });
    return b;
  }

  const fakeClient = { from: (t: string) => makeBuilder(t) };

  return {
    fakeClient,
    updates,
    inserts,
    set: (cfg: {
      maybeSingle?: Record<string, unknown[]>;
      single?: Record<string, unknown>;
      list?: Record<string, unknown[]>;
    }) => {
      maybeSingle = cfg.maybeSingle ?? {};
      single = cfg.single ?? {};
      list = cfg.list ?? {};
    },
    reset: () => {
      maybeSingle = {};
      single = {};
      list = {};
      updates.length = 0;
      inserts.length = 0;
    },
  };
});

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: () => h.fakeClient };
});

const mockedGetAdminContext = vi.fn();
vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, getAdminContext: (req: Request) => mockedGetAdminContext(req) };
});

import * as centerRoute from '@/app/api/admin/center-assignments/route';
import * as centerIdRoute from '@/app/api/admin/center-assignments/[id]/route';

function makeCtx(internalRole: InternalRole, adminRole: string | null, userId = 'user-1'): AdminContext {
  return {
    userId,
    internalRole,
    adminRole,
    supabaseAdmin: h.fakeClient as unknown as AdminContext['supabaseAdmin'],
  };
}

function jsonReq(method: string, body: unknown): Request {
  return new Request('https://phase4b.test/api/admin/center-assignments', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mockedGetAdminContext.mockReset();
  h.reset();
});

describe('POST /center-assignments — CEO batch-assign to a manager', () => {
  it('rejects a target staff that is not a sales manager (400)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('super_admin', 'super_admin'));
    h.set({ maybeSingle: { staff: [{ id: 'x', role: 'sr' }] } });
    const res = await centerRoute.POST(jsonReq('POST', { center_ids: ['c1'], manager_staff_id: 'x' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorKey?: string };
    expect(body.errorKey).toBe('centerAssignments.errors.manager_not_sm');
  });

  it('inserts pending manager-level rows on success', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('super_admin', 'super_admin', 'ceo-1'));
    h.set({
      maybeSingle: { staff: [{ id: 'm1', role: 'sm' }] },
      list: { center_assignments: [] }, // no existing primary rows -> all inserts
    });
    const res = await centerRoute.POST(
      jsonReq('POST', { center_ids: ['c1', 'c2'], manager_staff_id: 'm1' }),
    );
    expect(res.status).toBe(201);
    expect(h.inserts).toHaveLength(1);
    const rows = h.inserts[0].values as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.manager_staff_id).toBe('m1');
      expect(r.staff_id).toBeNull();
      expect(r.assignment_status).toBe('pending_sm_approval');
      expect(r.sourced_by).toBe('sm');
      expect(r.assigned_by).toBe('ceo-1');
    }
  });

  it('non-super-admin cannot batch-assign (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_admin', 'admin'));
    const res = await centerRoute.POST(jsonReq('POST', { center_ids: ['c1'], manager_staff_id: 'm1' }));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /center-assignments/[id] — manager sub-assign', () => {
  it('rejects a rep who does not report to the manager (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager', 'u1'));
    h.set({
      maybeSingle: {
        center_assignments: [
          { center_id: 'c1', sourced_by: 'sm', staff_id: null, manager_staff_id: 'm1' },
        ],
        staff: [{ id: 'm1' }, { id: 'rep-x', role: 'sr', reports_to: 'OTHER-MGR' }],
      },
    });
    const res = await centerIdRoute.PATCH(jsonReq('PATCH', { staff_id: 'rep-x' }), params('a1'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { errorKey?: string };
    expect(body.errorKey).toBe('centerAssignments.errors.rep_not_your_report');
    expect(h.updates).toHaveLength(0);
  });

  it('rejects a manager acting on a row that is not theirs (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager', 'u1'));
    h.set({
      maybeSingle: {
        center_assignments: [
          { center_id: 'c1', sourced_by: 'sm', staff_id: null, manager_staff_id: 'm2' },
        ],
        staff: [{ id: 'm1' }],
      },
    });
    const res = await centerIdRoute.PATCH(jsonReq('PATCH', { staff_id: 'rep-1' }), params('a1'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { errorKey?: string };
    expect(body.errorKey).toBe('centerAssignments.errors.forbidden_not_your_assignment');
    expect(h.updates).toHaveLength(0);
  });

  it('assigns a valid reporting rep and flips status to approved (200)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager', 'u1'));
    h.set({
      maybeSingle: {
        center_assignments: [
          { center_id: 'c1', sourced_by: 'sm', staff_id: null, manager_staff_id: 'm1' },
        ],
        staff: [{ id: 'm1' }, { id: 'rep-1', role: 'sr', reports_to: 'm1' }],
      },
      single: { center_assignments: { id: 'a1', staff_id: 'rep-1', assignment_status: 'approved' } },
    });
    const res = await centerIdRoute.PATCH(jsonReq('PATCH', { staff_id: 'rep-1' }), params('a1'));
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].values).toEqual({ staff_id: 'rep-1', assignment_status: 'approved' });
  });

  it('an unlinked manager (no staff row) is denied (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager', 'u1'));
    h.set({
      maybeSingle: {
        center_assignments: [
          { center_id: 'c1', sourced_by: 'sm', staff_id: null, manager_staff_id: 'm1' },
        ],
        staff: [], // caller not linked -> maybeSingle yields null
      },
    });
    const res = await centerIdRoute.PATCH(jsonReq('PATCH', { staff_id: 'rep-1' }), params('a1'));
    expect(res.status).toBe(403);
    expect(h.updates).toHaveLength(0);
  });
});

describe('GET /center-assignments — role gate', () => {
  it('a non-CEO / non-manager admin cannot list (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'accountant'));
    const res = await centerRoute.GET(new Request('https://phase4b.test/api/admin/center-assignments'));
    expect(res.status).toBe(403);
  });

  it('unauthenticated is denied (401)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(null);
    const res = await centerRoute.GET(new Request('https://phase4b.test/api/admin/center-assignments'));
    expect(res.status).toBe(401);
  });
});
