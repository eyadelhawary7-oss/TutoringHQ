/**
 * Phase 4c — Manager promo-code request flow.
 *
 * Proves the security-critical behaviours against a recording Supabase stub and the REAL
 * requireAdminRole / cap-validation (only getAdminContext + CSRF are mocked):
 *   1. A sales_manager can request a code within the caps -> 201, pending row with
 *      requested_by = ctx.userId and requested_by_staff_id resolved from staff.user_id.
 *   2. An over-cap request (discount > cap, uses > cap, or unlimited) is rejected 400 and
 *      inserts nothing. platform_config overrides raise the cap.
 *   3. A sales_rep is denied on both POST and GET (403); unauth -> 401.
 *   4. CEO approve creates a promo_codes row and flips the request to approved with
 *      created_promo_code_id; already-approved is idempotent (no double create).
 *   5. CEO reject requires a non-empty reason (400 without) and records rejection_reason.
 *   6. A manager GET is scoped to their own requests (eq requested_by = ctx.userId); a CEO
 *      GET is not scoped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { AdminContext, InternalRole } from '@/lib/admin-auth';

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://phase4c-test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'phase4c-test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'phase4c-test-service-key';

  let maybeSingle: Record<string, unknown[]> = {};
  let single: Record<string, unknown> = {};
  let list: Record<string, unknown[]> = {};
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const eqCalls: { table: string; col: string; val: unknown }[] = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'or', 'neq', 'not', 'gte', 'lte', 'limit', 'range', 'in']) {
      b[m] = () => b;
    }
    b.eq = (col: string, val: unknown) => {
      eqCalls.push({ table, col, val });
      return b;
    };
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
    inserts,
    updates,
    eqCalls,
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
      inserts.length = 0;
      updates.length = 0;
      eqCalls.length = 0;
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

vi.mock('@/lib/csrf', () => ({ validateCSRFRequest: () => true }));

import * as listRoute from '@/app/api/admin/promo-code-requests/route';
import * as idRoute from '@/app/api/admin/promo-code-requests/[id]/route';

function makeCtx(internalRole: InternalRole, adminRole: string | null, userId = 'user-1'): AdminContext {
  return {
    userId,
    internalRole,
    adminRole,
    supabaseAdmin: h.fakeClient as unknown as AdminContext['supabaseAdmin'],
  };
}

function jsonReq(method: string, body: unknown): NextRequest {
  return new Request('https://phase4c.test/api/admin/promo-code-requests', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const MANAGER = () => makeCtx('internal_viewer', 'sales_manager', 'mgr-user');
const CEO = () => makeCtx('super_admin', 'super_admin', 'ceo-user');
const REP = () => makeCtx('internal_viewer', 'sales_rep', 'rep-user');

beforeEach(() => {
  mockedGetAdminContext.mockReset();
  h.reset();
});

describe('POST /promo-code-requests — manager requests', () => {
  it('a manager can request a code within the caps (201) with own requested_by + staff id', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(MANAGER());
    h.set({
      maybeSingle: { staff: [{ id: 'staff-1' }] },
      single: { promo_code_requests: { id: 'req-1', status: 'pending' } },
    });
    const res = await listRoute.POST(
      jsonReq('POST', { code: 'summer20', discountPct: 20, maxUsesTotal: 100, targetType: 'center' }),
    );
    expect(res.status).toBe(201);
    expect(h.inserts.filter((i) => i.table === 'promo_code_requests')).toHaveLength(1);
    const values = h.inserts.find((i) => i.table === 'promo_code_requests')!.values as Record<string, unknown>;
    expect(values.requested_by).toBe('mgr-user');
    expect(values.requested_by_staff_id).toBe('staff-1');
    expect(values.status).toBe('pending');
    expect(values.discount_pct).toBe(20);
    expect(values.max_uses_total).toBe(100);
    expect(values.target_type).toBe('center');
    expect(values.code).toBe('SUMMER20');
  });

  it('rejects an over-cap discount (400) and inserts nothing', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(MANAGER());
    h.set({ maybeSingle: { staff: [{ id: 'staff-1' }] } });
    const res = await listRoute.POST(jsonReq('POST', { discountPct: 90, maxUsesTotal: 100 }));
    expect(res.status).toBe(400);
    expect(h.inserts.filter((i) => i.table === 'promo_code_requests')).toHaveLength(0);
  });

  it('rejects over-cap max uses (400)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(MANAGER());
    h.set({ maybeSingle: { staff: [{ id: 'staff-1' }] } });
    const res = await listRoute.POST(jsonReq('POST', { discountPct: 10, maxUsesTotal: 100000 }));
    expect(res.status).toBe(400);
    expect(h.inserts.filter((i) => i.table === 'promo_code_requests')).toHaveLength(0);
  });

  it('rejects an unlimited (missing max uses) request (400)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(MANAGER());
    h.set({ maybeSingle: { staff: [{ id: 'staff-1' }] } });
    const res = await listRoute.POST(jsonReq('POST', { discountPct: 10 }));
    expect(res.status).toBe(400);
  });

  it('a platform_config override raises the discount cap', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(MANAGER());
    h.set({
      maybeSingle: { staff: [{ id: 'staff-1' }] },
      single: { promo_code_requests: { id: 'req-2', status: 'pending' } },
      list: { platform_config: [{ key: 'promo_request.max_discount_pct', value: 60 }] },
    });
    const res = await listRoute.POST(jsonReq('POST', { discountPct: 50, maxUsesTotal: 100 }));
    expect(res.status).toBe(201);
  });

  it('a sales_rep cannot request (403), inserts nothing', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(REP());
    const res = await listRoute.POST(jsonReq('POST', { discountPct: 10, maxUsesTotal: 10 }));
    expect(res.status).toBe(403);
    expect(h.inserts).toHaveLength(0);
  });

  it('unauthenticated is denied (401)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(null);
    const res = await listRoute.POST(jsonReq('POST', { discountPct: 10, maxUsesTotal: 10 }));
    expect(res.status).toBe(401);
  });
});

describe('GET /promo-code-requests — scoping', () => {
  it('a manager GET is scoped to their own requests (eq requested_by)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(MANAGER());
    h.set({ list: { promo_code_requests: [] } });
    const res = await listRoute.GET(new Request('https://phase4c.test/api/admin/promo-code-requests') as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(
      h.eqCalls.some((e) => e.table === 'promo_code_requests' && e.col === 'requested_by' && e.val === 'mgr-user'),
    ).toBe(true);
  });

  it('a CEO GET is NOT scoped to a single requester', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ list: { promo_code_requests: [] } });
    const res = await listRoute.GET(new Request('https://phase4c.test/api/admin/promo-code-requests') as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(h.eqCalls.some((e) => e.table === 'promo_code_requests' && e.col === 'requested_by')).toBe(false);
  });

  it('a sales_rep cannot list (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(REP());
    const res = await listRoute.GET(new Request('https://phase4c.test/api/admin/promo-code-requests') as unknown as NextRequest);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /promo-code-requests/[id] — CEO approve/reject', () => {
  it('approve creates a promo_codes row and marks the request approved', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({
      maybeSingle: {
        promo_code_requests: [
          { status: 'pending', code: 'SUMMER20', discount_pct: 20, max_uses_total: 100, expires_at: null },
          { id: 'req-1', status: 'approved', created_promo_code_id: 'promo-1' },
        ],
      },
      single: { promo_codes: { id: 'promo-1', code: 'SUMMER20' } },
    });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('req-1'));
    expect(res.status).toBe(200);
    const promoInsert = h.inserts.find((i) => i.table === 'promo_codes');
    expect(promoInsert).toBeTruthy();
    const pv = promoInsert!.values as Record<string, unknown>;
    expect(pv.code).toBe('SUMMER20');
    expect(pv.discount_pct).toBe(20);
    expect(pv.max_uses_total).toBe(100);
    expect(pv.is_active).toBe(true);
    const reqUpdate = h.updates.find((u) => u.table === 'promo_code_requests');
    expect(reqUpdate?.values.status).toBe('approved');
    expect(reqUpdate?.values.created_promo_code_id).toBe('promo-1');
    expect(reqUpdate?.values.reviewed_by).toBe('ceo-user');
  });

  it('approve is idempotent — an already-approved request does not double-create', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({
      maybeSingle: {
        promo_code_requests: [{ status: 'approved', code: 'SUMMER20', created_promo_code_id: 'promo-1' }],
      },
    });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('req-1'));
    expect(res.status).toBe(200);
    expect(h.inserts.find((i) => i.table === 'promo_codes')).toBeUndefined();
  });

  it('reject requires a reason (400)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ maybeSingle: { promo_code_requests: [{ status: 'pending' }] } });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'reject' }), params('req-1'));
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it('reject with a reason records rejection_reason (200)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({
      maybeSingle: {
        promo_code_requests: [
          { status: 'pending' },
          { id: 'req-1', status: 'rejected', rejection_reason: 'too generous' },
        ],
      },
    });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'reject', reason: 'too generous' }), params('req-1'));
    expect(res.status).toBe(200);
    const reqUpdate = h.updates.find((u) => u.table === 'promo_code_requests');
    expect(reqUpdate?.values.status).toBe('rejected');
    expect(reqUpdate?.values.rejection_reason).toBe('too generous');
  });

  it('a manager cannot approve/reject (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(MANAGER());
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('req-1'));
    expect(res.status).toBe(403);
    expect(h.inserts).toHaveLength(0);
  });

  it('a missing request is 404', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(CEO());
    h.set({ maybeSingle: { promo_code_requests: [] } });
    const res = await idRoute.PATCH(jsonReq('PATCH', { action: 'approve' }), params('nope'));
    expect(res.status).toBe(404);
  });
});
