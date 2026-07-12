/**
 * Regression tests for the requireAdminRole gates added to the 8 admin GET
 * routes that previously exposed PII / financials without role discrimination.
 *
 * Each route is exercised with several mocked admin contexts:
 *   - super_admin                  , must pass (non-403)
 *   - admin (raw)                  , must pass (collapses to internal_admin)
 *   - internal_admin (raw)         , must pass
 *   - accountant                   , passes the broader gate, denied by the tighter one
 *   - sales_rep / support_agent    , must be denied with 403 insufficient_admin_role
 *   - custom (unknown role)        , must fail CLOSED with 403
 *   - internal_viewer              , must be denied
 *
 * The fail-closed property for custom/unknown roles comes from
 * `requireAdminRole` , not from the routes' allowlists. The internalRole for
 * 'custom' collapses to 'internal_viewer'; the raw adminRole='custom' is not
 * in any permitted list; therefore the gate returns 403. No route can be
 * accidentally opened by adding a new role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminContext, InternalRole } from '@/lib/admin-auth';

// ── Module mocks ────────────────────────────────────────────────────────────

// Keep the real requireAdminRole / ROLE_HIERARCHY; mock only getAdminContext.
const mockedGetAdminContext = vi.fn();
vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>(
    '@/lib/admin-auth',
  );
  return {
    ...actual,
    getAdminContext: (req: Request) => mockedGetAdminContext(req),
  };
});

// generateInvoicePdf is heavy; stub it so the "passes" path on the PDF route
// short-circuits with a small Buffer instead of running puppeteer.
vi.mock('@/lib/generateInvoicePdf', () => ({
  generateInvoicePdf: vi.fn(async () => Buffer.from('PDF', 'utf-8')),
}));

// ── Chainable Supabase admin stub ────────────────────────────────────────────

type Then<T> = (resolve: (v: T) => unknown) => unknown;

interface QueryBuilder {
  select: (..._args: unknown[]) => QueryBuilder;
  eq: (..._args: unknown[]) => QueryBuilder;
  neq: (..._args: unknown[]) => QueryBuilder;
  in: (..._args: unknown[]) => QueryBuilder;
  gte: (..._args: unknown[]) => QueryBuilder;
  lte: (..._args: unknown[]) => QueryBuilder;
  order: (..._args: unknown[]) => QueryBuilder;
  limit: (..._args: unknown[]) => QueryBuilder;
  single: () => Promise<{ data: unknown; error: null }>;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: Then<{ data: unknown[]; error: null }>;
}

function makeFakeSupa() {
  const builder: QueryBuilder = {} as QueryBuilder;
  // Every chain method returns the same builder so all of supabase-js's
  // fluent paths resolve to the empty list / null below.
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.neq = () => builder;
  builder.in = () => builder;
  builder.gte = () => builder;
  builder.lte = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.single = async () => ({ data: null, error: null });
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.then = (resolve) => resolve({ data: [], error: null });
  return {
    from: () => builder,
    rpc: async () => ({ data: 0, error: null }),
  };
}

function makeCtx(
  internalRole: InternalRole,
  adminRole: string | null,
): AdminContext {
  return {
    userId: 'user-1',
    internalRole,
    adminRole,
    // Cast so we don't need the real SupabaseClient type
    supabaseAdmin: makeFakeSupa() as unknown as AdminContext['supabaseAdmin'],
  };
}

function reqWithSearch(search = ''): Request {
  return new Request(`https://centerhq.test/api/admin/x${search}`);
}

beforeEach(() => {
  mockedGetAdminContext.mockReset();
});

// ── Per-route imports ────────────────────────────────────────────────────────

import * as exportCentersRoute from '@/app/api/admin/export/centers/route';
import * as exportCommissionsRoute from '@/app/api/admin/export/commissions/route';
import * as exportInvoicesRoute from '@/app/api/admin/export/invoices/route';
import * as commissionsRoute from '@/app/api/admin/commissions/route';
import * as referralsRoute from '@/app/api/admin/referrals/route';
import * as securityRoute from '@/app/api/admin/security/route';
import * as invoicePdfRoute from '@/app/api/admin/invoices/[id]/pdf/route';
import * as auditLogRoute from '@/app/api/admin/centers/[id]/audit-log/route';

// ── Shared role matrices ────────────────────────────────────────────────────

/** Broader gate: super_admin / admin / internal_admin / accountant. */
type Case = {
  label: string;
  ctx: AdminContext | null;
  expectAllowed: boolean;
};

function broaderGateCases(): Case[] {
  return [
    { label: 'super_admin allowed', ctx: makeCtx('super_admin', 'super_admin'), expectAllowed: true },
    { label: 'admin (raw) allowed', ctx: makeCtx('internal_admin', 'admin'), expectAllowed: true },
    { label: 'internal_admin allowed', ctx: makeCtx('internal_admin', 'internal_admin'), expectAllowed: true },
    { label: 'accountant allowed', ctx: makeCtx('internal_viewer', 'accountant'), expectAllowed: true },
    { label: 'support_agent denied', ctx: makeCtx('internal_viewer', 'support_agent'), expectAllowed: false },
    { label: 'sales_rep denied', ctx: makeCtx('internal_viewer', 'sales_rep'), expectAllowed: false },
    { label: 'internal_viewer denied', ctx: makeCtx('internal_viewer', 'internal_viewer'), expectAllowed: false },
    { label: 'custom (unknown) denied fail-CLOSED', ctx: makeCtx('internal_viewer', 'custom'), expectAllowed: false },
    { label: 'no ctx (unauth) → 401', ctx: null, expectAllowed: false },
  ];
}

/** Tighter gate: no accountant. */
function tighterGateCases(): Case[] {
  return [
    { label: 'super_admin allowed', ctx: makeCtx('super_admin', 'super_admin'), expectAllowed: true },
    { label: 'admin (raw) allowed', ctx: makeCtx('internal_admin', 'admin'), expectAllowed: true },
    { label: 'internal_admin allowed', ctx: makeCtx('internal_admin', 'internal_admin'), expectAllowed: true },
    { label: 'accountant DENIED (tighter gate)', ctx: makeCtx('internal_viewer', 'accountant'), expectAllowed: false },
    { label: 'support_agent denied', ctx: makeCtx('internal_viewer', 'support_agent'), expectAllowed: false },
    { label: 'sales_rep denied', ctx: makeCtx('internal_viewer', 'sales_rep'), expectAllowed: false },
    { label: 'custom (unknown) denied fail-CLOSED', ctx: makeCtx('internal_viewer', 'custom'), expectAllowed: false },
    { label: 'no ctx (unauth) → 401', ctx: null, expectAllowed: false },
  ];
}

/**
 * Runs a route's GET against a matrix of mocked admin contexts.
 * `expectAllowed=true` asserts non-403 (pass), false asserts 403 / 401.
 */
async function expectGate(
  routeLabel: string,
  invoke: () => Promise<Response>,
  cases: Case[],
) {
  for (const c of cases) {
    mockedGetAdminContext.mockReset();
    mockedGetAdminContext.mockResolvedValueOnce(c.ctx);
    const res = await invoke();
    if (c.expectAllowed) {
      expect(res.status, `${routeLabel} [${c.label}] expected non-403, got ${res.status}`)
        .not.toBe(403);
      expect(res.status, `${routeLabel} [${c.label}] expected non-401, got ${res.status}`)
        .not.toBe(401);
    } else if (c.ctx === null) {
      expect(res.status, `${routeLabel} [${c.label}] expected 401`).toBe(401);
    } else {
      expect(res.status, `${routeLabel} [${c.label}] expected 403`).toBe(403);
      const body = (await res.clone().json()) as { error?: string };
      expect(body.error).toBe('insufficient_admin_role');
    }
  }
}

// ── Per-route tests ──────────────────────────────────────────────────────────

describe('/api/admin/export/centers GET — broader gate', () => {
  for (const c of broaderGateCases()) {
    it(c.label, async () => {
      mockedGetAdminContext.mockResolvedValueOnce(c.ctx);
      const res = await exportCentersRoute.GET(reqWithSearch());
      if (c.expectAllowed) expect(res.status).not.toBe(403);
      else if (c.ctx === null) expect(res.status).toBe(401);
      else expect(res.status).toBe(403);
    });
  }
});

describe('/api/admin/export/commissions GET — CEO + scoped sales roles (Phase 6)', () => {
  it('matrix', async () => {
    // Phase 6 relaxed the export from super_admin-only to the SAME gate as the
    // commissions list API: CEO exports all rows; sales_manager / sales_rep export
    // only their scoped rows (fail-closed via getInternalScope). All other roles 403.
    await expectGate(
      'export/commissions',
      () => exportCommissionsRoute.GET(reqWithSearch()),
      commissionsScopedCases(),
    );
  });
});

describe('/api/admin/export/invoices GET — broader gate', () => {
  it('matrix', async () => {
    await expectGate(
      'export/invoices',
      () => exportInvoicesRoute.GET(reqWithSearch()),
      broaderGateCases(),
    );
  });
});

// Phase 4a relaxed commissions from super_admin-only to CEO + scoped sales roles.
// super_admin (all) and sales_manager / sales_rep (scoped by staff_id) may read;
// every other internal role is denied. The unlock mutation stays super_admin-only.
function commissionsScopedCases(): Case[] {
  return [
    { label: 'super_admin allowed', ctx: makeCtx('super_admin', 'super_admin'), expectAllowed: true },
    { label: 'sales_manager allowed (scoped)', ctx: makeCtx('internal_viewer', 'sales_manager'), expectAllowed: true },
    { label: 'sales_rep allowed (scoped)', ctx: makeCtx('internal_viewer', 'sales_rep'), expectAllowed: true },
    { label: 'admin (raw) DENIED', ctx: makeCtx('internal_admin', 'admin'), expectAllowed: false },
    { label: 'internal_admin DENIED', ctx: makeCtx('internal_admin', 'internal_admin'), expectAllowed: false },
    { label: 'accountant DENIED', ctx: makeCtx('internal_viewer', 'accountant'), expectAllowed: false },
    { label: 'support_agent DENIED', ctx: makeCtx('internal_viewer', 'support_agent'), expectAllowed: false },
    { label: 'internal_viewer DENIED', ctx: makeCtx('internal_viewer', 'internal_viewer'), expectAllowed: false },
    { label: 'custom (unknown) denied fail-CLOSED', ctx: makeCtx('internal_viewer', 'custom'), expectAllowed: false },
    { label: 'no ctx (unauth) → 401', ctx: null, expectAllowed: false },
  ];
}

describe('/api/admin/commissions GET — CEO + scoped sales roles (Phase 4a)', () => {
  it('matrix', async () => {
    await expectGate(
      'commissions',
      () => commissionsRoute.GET(reqWithSearch()),
      commissionsScopedCases(),
    );
  });
});

describe('/api/admin/referrals GET — broader gate', () => {
  it('matrix', async () => {
    // referralsRoute.GET expects NextRequest; the regular Request works at
    // runtime because the handler only calls request.headers.get / nextUrl.
    await expectGate(
      'referrals',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => referralsRoute.GET(reqWithSearch() as any),
      broaderGateCases(),
    );
  });
});

describe('/api/admin/security GET — tighter gate (no accountant)', () => {
  it('matrix', async () => {
    await expectGate(
      'security',
      () => securityRoute.GET(reqWithSearch()),
      tighterGateCases(),
    );
  });
});

describe('/api/admin/invoices/[id]/pdf GET — broader gate', () => {
  it('matrix', async () => {
    await expectGate(
      'invoices/[id]/pdf',
      () =>
        invoicePdfRoute.GET(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          reqWithSearch() as any,
          { params: Promise.resolve({ id: 'inv-1' }) },
        ),
      broaderGateCases(),
    );
  });
});

describe('/api/admin/centers/[id]/audit-log GET — tighter gate (no accountant)', () => {
  it('matrix', async () => {
    await expectGate(
      'centers/[id]/audit-log',
      () =>
        auditLogRoute.GET(reqWithSearch(), {
          params: Promise.resolve({ id: 'center-1' }),
        }),
      tighterGateCases(),
    );
  });
});
