/**
 * Tenant-scoping plan for the legacy /api/db proxy.
 *
 * The proxy executes via the Supabase service-role client (RLS bypassed), so
 * cross-tenant safety is enforced here: every (table, operation) is mapped to
 * a scoping rule that the route handler applies before the query runs.
 *
 * Rules:
 *   - direct(col)   → force .eq(col, actorCenterId) on WHERE; reject cross-
 *                     tenant filters on `col`; force data[col] = actorCenterId
 *                     on insert/update (except for `centers`).
 *   - indirect      → table has no direct center column; route handler runs a
 *                     per-table validator that checks parent rows belong to
 *                     the caller's center.
 *   - forbidden     → table is not safely scopable via the legacy proxy; deny
 *                     non-super-admin callers. Such callers must move to a
 *                     dedicated REST route.
 *
 * Super-admin callers bypass scoping entirely (cross-tenant access is
 * intentional for super-admins, mirroring centerAuth.ts:93-99).
 */
export type Filter = { column: string; op: string; value: unknown };

export type ScopeRule =
  | { kind: 'direct'; column: string }
  | { kind: 'indirect' }
  | { kind: 'forbidden' };

export const TABLE_SCOPE: Record<string, ScopeRule> = {
  payments:              { kind: 'direct', column: 'center_id' },
  students:              { kind: 'direct', column: 'center_id' },
  student_groups:        { kind: 'direct', column: 'center_id' },
  attendance_scans:      { kind: 'direct', column: 'center_id' },
  rooms:                 { kind: 'direct', column: 'center_id' },
  schedule_slots:        { kind: 'direct', column: 'center_id' },
  centers:               { kind: 'direct', column: 'id' },
  users:                 { kind: 'direct', column: 'center_id' },
  subjects:              { kind: 'direct', column: 'center_id' },
  subscriptions:         { kind: 'direct', column: 'center_id' },
  whatsapp_messages:     { kind: 'direct', column: 'center_id' },
  permissions:           { kind: 'direct', column: 'center_id' },
  center_invites:        { kind: 'direct', column: 'center_id' },
  wa_templates:          { kind: 'direct', column: 'center_id' },
  paid_parents:          { kind: 'direct', column: 'center_id' },
  reminder_settings:     { kind: 'direct', column: 'center_id' },
  card_orders:           { kind: 'direct', column: 'center_id' },
  // Join tables - center scope is via parent rows; validated in route handler.
  student_group_members: { kind: 'indirect' },
  attendance_overrides:  { kind: 'indirect' },
  // No center column / public intake - never safe via the legacy proxy.
  demo_requests:         { kind: 'forbidden' },
  whatsapp_incoming:     { kind: 'forbidden' },
};

export type ScopeCtx = {
  isSuperAdmin: boolean;
  actorCenterId: string | null;
  role?: string | null;
};

export type ScopePlan =
  | { kind: 'super_admin_bypass' }
  | { kind: 'direct'; column: string; centerId: string }
  | { kind: 'indirect'; centerId: string }
  | { kind: 'deny'; status: number; code: string; message: string };

export type ScopeInput = {
  table: string;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'count';
  filters: Filter[] | undefined;
  ctx: ScopeCtx;
};

/**
 * Pure scoping decision. Does NOT touch the database; the route handler
 * performs indirect validation when `kind === 'indirect'`.
 */
export function planScope(input: ScopeInput): ScopePlan {
  const { table, operation, filters, ctx } = input;
  const rule = TABLE_SCOPE[table];

  if (!rule) {
    return {
      kind: 'deny',
      status: 400,
      code: 'TABLE_NOT_ALLOWED',
      message: `Table '${table}' is not allowed`,
    };
  }

  // Teachers (Model B, centre-less) are intentionally NOT served by the legacy
  // /api/db proxy. The proxy's model is a single actorCenterId force-applied as
  // full read/write over that one centre. That cannot express teacher scope:
  // teachers span multiple centres, are read-only on a centre's groups, and may
  // only touch rows in their OWN groups, not the whole centre. Mapping a teacher
  // onto a centre here would over-share the centre's entire students, payments,
  // and attendance. Teacher data access is built as dedicated group-scoped routes
  // on requireTeacherAuth / requireCenterAuth with RLS underneath, never here.
  // Guarded by !isSuperAdmin so a super-admin always bypasses regardless of role.
  if (!ctx.isSuperAdmin && ctx.role === 'teacher') {
    return {
      kind: 'deny',
      status: 403,
      code: 'TEACHER_PROXY_UNSUPPORTED',
      message:
        'Teachers are not served by the legacy /api/db proxy; teacher data uses dedicated routes',
    };
  }

  if (rule.kind === 'forbidden') {
    if (ctx.isSuperAdmin) return { kind: 'super_admin_bypass' };
    return {
      kind: 'deny',
      status: 403,
      code: 'TABLE_NOT_PERMITTED_VIA_PROXY',
      message: `Table '${table}' is not permitted via the legacy /api/db proxy; use a dedicated REST route`,
    };
  }

  if (ctx.isSuperAdmin) return { kind: 'super_admin_bypass' };

  if (!ctx.actorCenterId) {
    return {
      kind: 'deny',
      status: 403,
      code: 'NO_CENTER',
      message: 'Caller has no associated center',
    };
  }

  if (rule.kind === 'indirect') {
    return { kind: 'indirect', centerId: ctx.actorCenterId };
  }

  // direct
  if (table === 'centers' && operation === 'insert') {
    return {
      kind: 'deny',
      status: 403,
      code: 'INSERT_FORBIDDEN',
      message: 'Creating centers via the proxy is not permitted',
    };
  }

  const crossTenant = findCrossTenantFilter(filters, rule.column, ctx.actorCenterId);
  if (crossTenant) {
    return {
      kind: 'deny',
      status: 403,
      code: 'CROSS_TENANT_FILTER_REJECTED',
      message: `Filter on '${rule.column}' must match caller's center (got ${JSON.stringify(crossTenant)})`,
    };
  }

  return { kind: 'direct', column: rule.column, centerId: ctx.actorCenterId };
}

function findCrossTenantFilter(
  filters: Filter[] | undefined,
  column: string,
  centerId: string,
): unknown {
  if (!filters || !Array.isArray(filters)) return null;
  for (const f of filters) {
    if (f.column !== column) continue;
    if (f.op === 'eq') {
      if (typeof f.value === 'string' && f.value !== centerId) return f.value;
    } else if (f.op === 'in' && Array.isArray(f.value)) {
      for (const v of f.value) {
        if (typeof v === 'string' && v !== centerId) return v;
      }
    } else if (f.op === 'neq') {
      // .neq('center_id', actor) would explicitly target other tenants
      if (typeof f.value === 'string' && f.value === centerId) return f.value;
    }
  }
  return null;
}

/**
 * For insert/update on direct-scope tables, force the scope column on the
 * payload so a malicious caller cannot reassign rows to another center.
 * `centers` is excluded - its scope column is the primary key.
 */
export function applyForcedData(
  data: unknown,
  table: string,
  operation: 'insert' | 'update' | 'select' | 'delete' | 'count',
  column: string,
  centerId: string,
): unknown {
  if (operation !== 'insert' && operation !== 'update') return data;
  if (table === 'centers') return data;
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.map((row) =>
      row && typeof row === 'object'
        ? { ...(row as Record<string, unknown>), [column]: centerId }
        : row,
    );
  }
  if (typeof data === 'object') {
    return { ...(data as Record<string, unknown>), [column]: centerId };
  }
  return data;
}
