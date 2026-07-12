/**
 * Phase 4a — real access scoping for Manager/Rep + salary privacy.
 *
 * Proves, against a recording Supabase stub and the REAL getInternalScope:
 *  1. base_salary (salary) is stripped from every non-CEO response and kept for CEO
 *     (payouts list, staff list).
 *  2. The four scoped READ routes apply the correct fail-closed filters:
 *       - commissions / payouts  -> .in('staff_id', <own | self+reps | sentinel>)
 *       - card-orders            -> .in('center_id', <assigned | sentinel>)
 *     A CEO (super_admin) gets NO filter (sees everything).
 *  3. Non-CEO / non-sales roles are denied (403); card-order status mutations stay
 *     CEO-only (managers are view-only).
 *
 * Phase 5 refinements also covered here:
 *  - Card Orders: a sales_rep gets NOTHING (403); only super_admin + sales_manager read.
 *  - Payouts: a non-CEO caller never receives base_salary OR the salary-inclusive
 *    total_amount (nor adjustment/breakdown) — only commission components, status, and a
 *    derived commission_total. The CEO still gets the full shape.
 *
 * The recording stub is shared by the route's own client (module-level createClient,
 * mocked) and by getInternalScope (ctx.supabaseAdmin), so the assertions exercise the
 * genuine scope-resolution path end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminContext, InternalRole } from '@/lib/admin-auth';

const SENTINEL = '00000000-0000-0000-0000-000000000000';

// ── Recording Supabase stub + env, hoisted so it exists before route imports ──
type TableResponses = { maybeSingle?: unknown; single?: unknown; list?: unknown[] };

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://phase4a-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'phase4a-test-service-key';

  let responses: Record<string, TableResponses> = {};
  const inCalls: { table: string; column: string; values: unknown[] }[] = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'order', 'limit', 'range']) {
      b[m] = () => b;
    }
    b.in = (column: string, values: unknown[]) => {
      inCalls.push({ table, column, values });
      return b;
    };
    b.single = async () => ({ data: responses[table]?.single ?? null, error: null });
    b.maybeSingle = async () => ({ data: responses[table]?.maybeSingle ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: responses[table]?.list ?? [], error: null });
    return b;
  }

  const fakeClient = {
    from: (table: string) => makeBuilder(table),
    rpc: async () => ({ data: 0, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  };

  return {
    fakeClient,
    inCalls,
    setResponses: (r: Record<string, TableResponses>) => {
      responses = r;
    },
    reset: () => {
      responses = {};
      inCalls.length = 0;
    },
  };
});

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>(
    '@supabase/supabase-js',
  );
  return { ...actual, createClient: () => h.fakeClient };
});

// Keep the real requireAdminRole / getInternalScope; mock only getAdminContext.
const mockedGetAdminContext = vi.fn();
vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, getAdminContext: (req: Request) => mockedGetAdminContext(req) };
});

// ── Routes under test ─────────────────────────────────────────────────────────
import * as commissionsRoute from '@/app/api/admin/commissions/route';
import * as payoutsRoute from '@/app/api/admin/payouts/route';
import * as staffRoute from '@/app/api/admin/staff/route';
import * as cardOrdersRoute from '@/app/api/admin/card-orders/route';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeCtx(internalRole: InternalRole, adminRole: string | null): AdminContext {
  return {
    userId: 'user-1',
    internalRole,
    adminRole,
    supabaseAdmin: h.fakeClient as unknown as AdminContext['supabaseAdmin'],
  };
}

function req(path = 'https://phase4a.test/api/admin/x'): Request {
  return new Request(path);
}

function inCallFor(table: string, column: string) {
  return h.inCalls.find((c) => c.table === table && c.column === column);
}

beforeEach(() => {
  mockedGetAdminContext.mockReset();
  h.reset();
});

// ── Commissions: staff_id scoping ─────────────────────────────────────────────
describe('/api/admin/commissions GET — staff_id scoping', () => {
  it('CEO (super_admin) is unrestricted — no staff_id filter', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('super_admin', 'super_admin'));
    h.setResponses({ commissions: { list: [] } });
    const res = await commissionsRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('commissions', 'staff_id')).toBeUndefined();
  });

  it('sales_rep sees only their own staff id', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_rep'));
    h.setResponses({
      staff: { maybeSingle: { id: 'staff-rep', role: 'sr' } },
      commissions: { list: [] },
    });
    const res = await commissionsRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('commissions', 'staff_id')?.values).toEqual(['staff-rep']);
  });

  it('sales_manager sees self + reporting reps', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager'));
    h.setResponses({
      staff: { maybeSingle: { id: 'staff-mgr', role: 'sm' }, list: [{ id: 'r1' }, { id: 'r2' }] },
      commissions: { list: [] },
    });
    const res = await commissionsRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('commissions', 'staff_id')?.values).toEqual(['staff-mgr', 'r1', 'r2']);
  });

  it('UNLINKED sales role fails closed — sentinel that matches nothing', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_rep'));
    h.setResponses({ staff: { maybeSingle: null }, commissions: { list: [] } });
    const res = await commissionsRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('commissions', 'staff_id')?.values).toEqual([SENTINEL]);
  });

  it('non-sales, non-CEO role is denied (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'accountant'));
    const res = await commissionsRoute.GET(req());
    expect(res.status).toBe(403);
  });

  it('unauthenticated is denied (401)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(null);
    const res = await commissionsRoute.GET(req());
    expect(res.status).toBe(401);
  });
});

// ── Payouts: staff_id scoping + base_salary strip ─────────────────────────────
describe('/api/admin/payouts GET — scope + salary privacy', () => {
  it('CEO keeps base_salary + total_amount and gets no staff_id filter', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('super_admin', 'super_admin'));
    h.setResponses({
      commission_payouts: {
        list: [{ id: 'p1', staff_id: 's1', base_salary: 5000, total_amount: 5000 }],
      },
    });
    const res = await payoutsRoute.GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payouts: { base_salary?: number; total_amount?: number }[] };
    expect(body.payouts[0].base_salary).toBe(5000);
    expect(body.payouts[0].total_amount).toBe(5000);
    expect(inCallFor('commission_payouts', 'staff_id')).toBeUndefined();
  });

  it('sales_rep: base_salary AND total_amount stripped, commission_total added, scoped to own staff id', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_rep'));
    h.setResponses({
      staff: { maybeSingle: { id: 'staff-rep', role: 'sr' } },
      commission_payouts: {
        list: [
          {
            id: 'p1',
            staff_id: 'staff-rep',
            period: '2026-06',
            status: 'draft',
            base_salary: 5000,
            total_amount: 8000,
            adjustment_amount: 500,
            adjustment_reason: 'bonus',
            breakdown: { secret: 1 },
            requires_review: true,
            t1_commissions: 1000,
            t2_commissions: 500,
            loyalty_bonuses: 200,
            override_commissions: 300,
            commission_count: 4,
            paid_at: null,
          },
        ],
      },
    });
    const res = await payoutsRoute.GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      payouts: Record<string, unknown>[];
    };
    const row = body.payouts[0];
    // Salary and every salary-inclusive / adjustment field is absent.
    expect(row.base_salary).toBeUndefined();
    expect(row.total_amount).toBeUndefined();
    expect(row.adjustment_amount).toBeUndefined();
    expect(row.adjustment_reason).toBeUndefined();
    expect(row.breakdown).toBeUndefined();
    expect(row.requires_review).toBeUndefined();
    // Commission components + status + derived commission_total are present.
    expect(row.status).toBe('draft');
    expect(row.t1_commissions).toBe(1000);
    expect(row.t2_commissions).toBe(500);
    expect(row.loyalty_bonuses).toBe(200);
    expect(row.override_commissions).toBe(300);
    expect(row.commission_count).toBe(4);
    expect(row.commission_total).toBe(2000);
    expect(inCallFor('commission_payouts', 'staff_id')?.values).toEqual(['staff-rep']);
  });

  it('sales_manager: no base_salary / total_amount, commission_total present, scoped to team', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager'));
    h.setResponses({
      staff: { maybeSingle: { id: 'staff-mgr', role: 'sm' }, list: [{ id: 'r1' }] },
      commission_payouts: {
        list: [
          {
            id: 'p2',
            staff_id: 'r1',
            period: '2026-06',
            status: 'paid',
            base_salary: 9000,
            total_amount: 12000,
            t1_commissions: 700,
            t2_commissions: 300,
            loyalty_bonuses: 0,
            override_commissions: 0,
            commission_count: 2,
            paid_at: '2026-06-30T00:00:00.000Z',
          },
        ],
      },
    });
    const res = await payoutsRoute.GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payouts: Record<string, unknown>[] };
    const row = body.payouts[0];
    expect(row.base_salary).toBeUndefined();
    expect(row.total_amount).toBeUndefined();
    expect(row.commission_total).toBe(1000);
    expect(row.status).toBe('paid');
    expect(inCallFor('commission_payouts', 'staff_id')?.values).toEqual(['staff-mgr', 'r1']);
  });

  it('UNLINKED sales role fails closed — sentinel', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager'));
    h.setResponses({ staff: { maybeSingle: null }, commission_payouts: { list: [] } });
    const res = await payoutsRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('commission_payouts', 'staff_id')?.values).toEqual([SENTINEL]);
  });
});

// ── Staff list: base_salary strip ─────────────────────────────────────────────
describe('/api/admin/staff GET — salary privacy', () => {
  it('CEO keeps base_salary', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('super_admin', 'super_admin'));
    h.setResponses({
      staff: { list: [{ id: 's1', name: 'A', base_salary: 30000 }] },
      commission_payouts: { list: [] },
    });
    const res = await staffRoute.GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { staff: { base_salary?: number }[] };
    expect(body.staff[0].base_salary).toBe(30000);
  });

  it('non-CEO admin: base_salary stripped from every row', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'accountant'));
    h.setResponses({
      staff: { list: [{ id: 's1', name: 'A', base_salary: 30000 }] },
      commission_payouts: { list: [] },
    });
    const res = await staffRoute.GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { staff: { base_salary?: number }[] };
    expect(body.staff[0].base_salary).toBeUndefined();
  });
});

// ── Card orders: center_id scoping + view-only mutations ──────────────────────
describe('/api/admin/card-orders GET — center scoping', () => {
  it('CEO is unrestricted — no center_id filter', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('super_admin', 'super_admin'));
    h.setResponses({ card_orders: { list: [] } });
    const res = await cardOrdersRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('card_orders', 'center_id')).toBeUndefined();
  });

  it('sales_manager is scoped to their approved assignments', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager'));
    h.setResponses({
      staff: { maybeSingle: { id: 'staff-mgr', role: 'sm' }, list: [{ id: 'r1' }] },
      center_assignments: { list: [{ center_id: 'c1' }, { center_id: 'c2' }] },
      card_orders: { list: [] },
    });
    const res = await cardOrdersRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('card_orders', 'center_id')?.values).toEqual(['c1', 'c2']);
  });

  it('UNLINKED manager fails closed — sentinel', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager'));
    h.setResponses({ staff: { maybeSingle: null }, card_orders: { list: [] } });
    const res = await cardOrdersRoute.GET(req());
    expect(res.status).toBe(200);
    expect(inCallFor('card_orders', 'center_id')?.values).toEqual([SENTINEL]);
  });

  it('Phase 5: sales_rep gets NOTHING — denied (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_rep'));
    const res = await cardOrdersRoute.GET(req());
    expect(res.status).toBe(403);
    // Fail closed: no center_id query is ever issued for a rep.
    expect(inCallFor('card_orders', 'center_id')).toBeUndefined();
  });

  it('non-sales, non-CEO role is denied (403)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'accountant'));
    const res = await cardOrdersRoute.GET(req());
    expect(res.status).toBe(403);
  });
});

describe('/api/admin/card-orders PATCH — status transitions stay CEO-only', () => {
  it('sales_manager cannot mutate (403, view-only)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('internal_viewer', 'sales_manager'));
    const res = await cardOrdersRoute.PATCH(
      new Request('https://phase4a.test/api/admin/card-orders', { method: 'PATCH' }),
    );
    expect(res.status).toBe(403);
  });

  it('CEO passes the role gate', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(makeCtx('super_admin', 'super_admin'));
    const res = await cardOrdersRoute.PATCH(
      new Request('https://phase4a.test/api/admin/card-orders', { method: 'PATCH' }),
    );
    // Passes the CEO gate; then fails on missing body (400), never 401/403.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
