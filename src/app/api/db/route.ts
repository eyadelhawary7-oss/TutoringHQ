import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { NextResponse } from 'next/server';
import { dbInsertSchemas, studentUpdateSchema } from '@/lib/validations';
import { afterStudentWriteParentPackEffects } from '@/lib/studentParentPackWelcome';
import { validateCSRFRequest } from '@/lib/csrf';
import { scanRatelimit, rateLimitedResponse } from '@/lib/ratelimit';
import { getShippingFee, getShippingZone } from '@/lib/bostaShipping';
import { loadBostaShippingRates } from '@/lib/loadBostaShippingRates';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  TABLE_SCOPE,
  planScope,
  applyForcedData,
  type Filter,
} from '@/lib/dbProxyScope';
import { isSuperAdminPhone } from '@/lib/admin-access';
import {
  findProtectedCardOrdersWrite,
  findProtectedUsersWrite,
} from '@/lib/dbProxyProtectedColumns';

const VALID_OPERATIONS = ['select', 'insert', 'update', 'delete', 'count'] as const;
type Operation = (typeof VALID_OPERATIONS)[number];

function logError(context: string, err: unknown) {
  console.error(`[api/db] ${context}:`, err);
  if (err instanceof Error && err.stack) {
    console.error('[api/db] Stack:', err.stack);
  }
}

/**
 * Server-side database proxy that bypasses RLS using the service role key.
 *
 * Tenant isolation is enforced HERE (not by RLS): every request is mapped to a
 * scoping rule in `dbProxyScope.ts`. Non-super-admin callers cannot operate on
 * another center's rows; client-supplied `center_id` filters and payload
 * values are overwritten with the session-derived `actorCenterId`.
 *
 * See docs/DB_PROXY_SECURITY.md for the threat model.
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      logError('Missing Supabase config', 'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set');
      return NextResponse.json({
        error: 'Server configuration error',
        code: 'CONFIG_MISSING',
        details: { supabaseUrl: !!supabaseUrl, supabaseAnonKey: !!supabaseAnonKey },
      }, { status: 500 });
    }

    if (!supabaseServiceKey) {
      logError('Missing service role key', 'SUPABASE_SERVICE_ROLE_KEY not set');
      return NextResponse.json({
        error: 'Server configuration error',
        code: 'SERVICE_KEY_MISSING',
      }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch (parseErr) {
      logError('JSON parse failed', parseErr);
      return NextResponse.json({
        error: 'Invalid JSON in request body',
        code: 'INVALID_JSON',
      }, { status: 400 });
    }

    const { operation, table, data, filters, select: selectColumns, order, limit: rowLimit, single } = body;

    if (!table || typeof table !== 'string') {
      return NextResponse.json({ error: "Field 'table' is required and must be a string", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!VALID_OPERATIONS.includes(operation as Operation)) {
      return NextResponse.json({
        error: `Field 'operation' must be one of: ${VALID_OPERATIONS.join(', ')}`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }
    const op = operation as Operation;

    if (!(table in TABLE_SCOPE)) {
      return NextResponse.json({
        error: `Table '${table}' is not allowed`,
        code: 'TABLE_NOT_ALLOWED',
        allowedTables: Object.keys(TABLE_SCOPE),
      }, { status: 400 });
    }

    if ((op === 'insert' || op === 'update') && data === undefined) {
      return NextResponse.json({
        error: `Field 'data' is required for operation '${op}'`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    if (op === 'insert' && !(typeof data === 'object' && data !== null && !Array.isArray(data) || Array.isArray(data))) {
      return NextResponse.json({ error: "Field 'data' must be an object or array", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Validate insert/update data for tables with schemas
    let schema: z.ZodType | undefined = dbInsertSchemas[table as keyof typeof dbInsertSchemas];
    if (table === 'students' && op === 'update') {
      schema = studentUpdateSchema;
    }
    if ((op === 'insert' || op === 'update') && schema && data != null) {
      const items = Array.isArray(data) ? data : [data];
      for (let i = 0; i < items.length; i++) {
        const result = schema.safeParse(items[i]);
        if (!result.success) {
          const msg = result.error.issues[0]?.message ?? 'Invalid input';
          return NextResponse.json({
            error: `Validation failed for ${table} (item ${i + 1}): ${msg}`,
            details: result.error.flatten(),
            code: 'VALIDATION_ERROR',
          }, { status: 400 });
        }
        if (Array.isArray(data)) (data as unknown[])[i] = result.data;
        else {
          const obj = data as Record<string, unknown>;
          for (const k of Object.keys(obj)) delete obj[k];
          Object.assign(obj, result.data as object);
        }
      }
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      logError('Auth failed', authError);
      return NextResponse.json({ error: 'Not authenticated', code: 'AUTH_FAILED' }, { status: 401 });
    }
    const isStateChange = ['insert', 'update', 'delete'].includes(op);
    if (isStateChange && !validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Derive caller identity from session: users row + admin_users membership.
    // Mirrors centerAuth.ts for super-admin detection - `users.role` is NEVER a
    // source of super-admin authority (it is centre-tenant-writable). Only
    // `admin_users` membership and `SUPER_ADMIN_PHONES` confer the bypass.
    const [{ data: userRecord }, { data: adminRecord }] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('center_id, phone, role')
        .eq('id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('admin_users')
        .select('id')
        .eq('id', user.id)
        .maybeSingle(),
    ]);
    const actorCenterId =
      (userRecord as { center_id?: string | null } | null)?.center_id ?? null;
    const actorPhone =
      (userRecord as { phone?: string | null } | null)?.phone ?? null;
    const actorRole =
      (userRecord as { role?: string | null } | null)?.role ?? null;
    const isSuperAdmin = !!adminRecord || isSuperAdminPhone(actorPhone);

    // Defense-in-depth: block centre callers from writing authority-conferring
    // columns on `users` via the legacy proxy. Super-admins (admin_users/phone)
    // still need this path for tenant management.
    if (
      table === 'users' &&
      (op === 'insert' || op === 'update') &&
      !isSuperAdmin
    ) {
      const protectedKey = findProtectedUsersWrite(data);
      if (protectedKey) {
        return NextResponse.json(
          {
            error: `Writing column '${protectedKey}' on users is not permitted via the proxy`,
            code: 'USERS_PROTECTED_COLUMN',
          },
          { status: 403 },
        );
      }
    }

    // Defense-in-depth: block centre callers from writing card_orders columns
    // that drive payment / fulfillment lifecycle. The cardOrderState machine
    // is advisory and the table is direct-scope, so without this gate a centre
    // could PATCH status='paid' / payment_status='paid' via /api/db and skip
    // payment entirely. Legitimate writes (checkout, Paymob webhook, admin
    // transitions, Bosta webhook) all go through service-role clients on
    // dedicated routes, never the proxy.
    if (
      table === 'card_orders' &&
      (op === 'insert' || op === 'update') &&
      !isSuperAdmin
    ) {
      const protectedKey = findProtectedCardOrdersWrite(data);
      if (protectedKey) {
        return NextResponse.json(
          {
            error: `Writing column '${protectedKey}' on card_orders is not permitted via the proxy`,
            code: 'CARD_ORDERS_PROTECTED_COLUMN',
          },
          { status: 403 },
        );
      }
    }

    // Tenant scoping: pure decision based on table + caller identity.
    const filtersArr: Filter[] | undefined = Array.isArray(filters)
      ? (filters as Filter[])
      : undefined;
    const plan = planScope({
      table,
      operation: op,
      filters: filtersArr,
      ctx: { isSuperAdmin, actorCenterId, role: actorRole },
    });

    if (plan.kind === 'deny') {
      return NextResponse.json(
        { error: plan.message, code: plan.code },
        { status: plan.status },
      );
    }

    // Indirect-scope tables: validate parent rows belong to caller's center.
    if (plan.kind === 'indirect') {
      const indirectErr = await validateIndirectScope(
        supabaseAdmin,
        table,
        op,
        filtersArr,
        data,
        plan.centerId,
        user.id,
      );
      if (indirectErr) {
        return NextResponse.json(
          { error: indirectErr.message, code: indirectErr.code },
          { status: indirectErr.status },
        );
      }
    }

    // Preserve the legacy card_orders insert guard for clarity / explicit 403
    // even though applyForcedData now ensures data.center_id === actorCenterId.
    if (
      table === 'card_orders' &&
      op === 'insert' &&
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      !isSuperAdmin
    ) {
      const row = data as Record<string, unknown>;
      const targetCenterId = typeof row.center_id === 'string' ? row.center_id : '';
      if (targetCenterId && actorCenterId && targetCenterId !== actorCenterId) {
        return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
      }
      const deliveryGovRaw = row.delivery_governorate;
      const gov =
        typeof deliveryGovRaw === 'string' && deliveryGovRaw.trim() !== ''
          ? deliveryGovRaw.trim()
          : null;
      const bostaRates = await loadBostaShippingRates();
      const deliveryFee = getShippingFee(gov, bostaRates);
      const shippingZone = getShippingZone(gov, bostaRates);
      const qty = Math.round(Number(row.quantity ?? 0));
      const ppc = Number(row.price_per_card ?? 62);
      const total = Math.round((qty * ppc + deliveryFee) * 100) / 100;
      row.delivery_fee = deliveryFee;
      row.shipping_zone = shippingZone;
      row.total_amount = total;
      delete row.delivery_governorate;
    }

    // Force insert/update payload to caller's center on direct-scope tables.
    let effectiveData = data;
    if (plan.kind === 'direct' && (op === 'insert' || op === 'update')) {
      effectiveData = applyForcedData(
        data,
        table,
        op,
        plan.column,
        plan.centerId,
      );
    }

    // Guardian-consent gate for center-side student creates (direct add + bulk
    // import both land here as a students insert). The center is responsible for
    // holding the guardian's consent to process the student's data; this records
    // the confirmation as proof. The UI checkbox is NOT trusted on its own — the
    // SERVER is the gate: a center caller (direct scope) must send
    // `guardian_consent_confirmed === true` per row or the insert is rejected,
    // and on success the server stamps who confirmed and when. Existing students
    // are untouched (this only runs on insert). Super-admins (bypass scope) are
    // exempt from the requirement but still get the proof recorded if they send
    // the flag. The transient flag is always stripped before the DB write.
    if (table === 'students' && op === 'insert') {
      const nowIso = new Date().toISOString();
      const rows = Array.isArray(effectiveData) ? effectiveData : [effectiveData];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const confirmed = r.guardian_consent_confirmed === true;
        delete r.guardian_consent_confirmed;
        if (plan.kind === 'direct') {
          if (!confirmed) {
            return NextResponse.json(
              {
                error: 'Guardian consent confirmation is required to add a student',
                code: 'GUARDIAN_CONSENT_REQUIRED',
              },
              { status: 403 },
            );
          }
          r.guardian_consent_confirmed_at = nowIso;
          r.guardian_consent_confirmed_by = user.id;
        } else if (confirmed) {
          r.guardian_consent_confirmed_at = nowIso;
          r.guardian_consent_confirmed_by = user.id;
        }
      }
    }

    let prevStudentPack: { parent_pack_opted_in: boolean | null; parent_phone: string | null } | null = null;
    if (table === 'students' && op === 'update' && filtersArr) {
      const idFilter = filtersArr.find(
        (f) => f.column === 'id' && f.op === 'eq',
      );
      if (idFilter && typeof idFilter.value === 'string') {
        const { data: prevRow } = await supabaseAdmin
          .from('students')
          .select('parent_pack_opted_in, parent_phone')
          .eq('id', idFilter.value)
          .maybeSingle();
        prevStudentPack = prevRow ?? null;
      }
    }

    // Rate limiting - scanner posts attendance via insert; keyed by center_id
    if (
      scanRatelimit &&
      isStateChange &&
      op === 'insert' &&
      table === 'attendance_scans'
    ) {
      const rlCenterId = actorCenterId ?? user.id;
      const { success, reset } = await scanRatelimit.limit(rlCenterId);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return rateLimitedResponse(retryAfter);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder has complex chaining types
    let query: any;

    const selectStr: string = typeof selectColumns === 'string' ? selectColumns : '*';

    switch (op) {
      case 'select': {
        query = supabaseAdmin.from(table).select(selectStr);
        break;
      }
      case 'insert': {
        query = supabaseAdmin.from(table).insert(effectiveData);
        if (selectColumns !== false) {
          query = query.select(selectStr);
        }
        break;
      }
      case 'update': {
        query = supabaseAdmin.from(table).update(effectiveData);
        break;
      }
      case 'delete': {
        query = supabaseAdmin.from(table).delete();
        break;
      }
      case 'count': {
        query = supabaseAdmin.from(table).select(selectStr, { count: 'exact', head: true });
        break;
      }
    }

    // Apply client-supplied filters (already validated for cross-tenant safety).
    if (filtersArr) {
      for (const filter of filtersArr) {
        const { column, op: fop, value } = filter;
        switch (fop) {
          case 'eq': query = query.eq(column, value); break;
          case 'neq': query = query.neq(column, value); break;
          case 'gt': query = query.gt(column, value); break;
          case 'gte': query = query.gte(column, value); break;
          case 'lt': query = query.lt(column, value); break;
          case 'lte': query = query.lte(column, value); break;
          case 'like': query = query.like(column, value); break;
          case 'ilike': query = query.ilike(column, value); break;
          case 'is': query = query.is(column, value); break;
          case 'not_is': query = query.not(column, 'is', value); break;
          case 'in': query = query.in(column, value); break;
        }
      }
    }

    // Forced tenant filter - applied AFTER client filters so it always
    // constrains SELECT/UPDATE/DELETE/COUNT WHERE clauses for direct-scope
    // tables. INSERT carries the center_id in the row via applyForcedData.
    if (plan.kind === 'direct' && op !== 'insert') {
      query = query.eq(plan.column, plan.centerId);
    }

    // Apply ordering
    if (order && typeof order === 'object' && order !== null) {
      const o = order as { column?: string; ascending?: boolean };
      if (typeof o.column === 'string') {
        query = query.order(o.column, { ascending: o.ascending !== false });
      }
    }

    // Apply limit
    if (rowLimit) {
      query = query.limit(rowLimit);
    }

    // Single row
    if (single) {
      query = query.single();
    }

    const result = await query;

    if (isStateChange && !result.error) {
      const filterPreview =
        filtersArr && filtersArr.length > 0
          ? filtersArr.slice(0, 8).map((f) => `${f.column}:${f.op}`)
          : [];
      void supabaseAdmin
        .from('audit_log')
        .insert({
          center_id: actorCenterId,
          user_id: user.id,
          action: `db_proxy.${String(op)}.${String(table)}`,
          entity_type: 'db_proxy',
          details: {
            table,
            operation: op,
            filter_preview: filterPreview,
            super_admin: isSuperAdmin,
          },
        })
        .then(
          () => {},
          () => {},
        );
    }

    if (!result.error && table === 'students') {
      try {
        if (op === 'insert' && result.data) {
          const rows = Array.isArray(result.data) ? result.data : [result.data];
          for (const row of rows) {
            const r = row as {
              id: string;
              name: string;
              parent_phone: string | null;
              parent_pack_opted_in?: boolean | null;
              center_id: string;
            };
            if (r?.center_id) {
              await afterStudentWriteParentPackEffects(supabaseAdmin, {
                kind: 'insert',
                centerId: r.center_id,
                row: r,
              });
            }
          }
        }
        if (op === 'update' && filtersArr) {
          const idFilter = filtersArr.find(
            (f) => f.column === 'id' && f.op === 'eq',
          );
          if (idFilter && typeof idFilter.value === 'string') {
            const { data: row } = await supabaseAdmin
              .from('students')
              .select('id, name, parent_phone, parent_pack_opted_in, center_id')
              .eq('id', idFilter.value)
              .maybeSingle();
            if (row?.center_id) {
              await afterStudentWriteParentPackEffects(supabaseAdmin, {
                kind: 'update',
                centerId: row.center_id,
                studentId: row.id,
                body: (effectiveData ?? {}) as Record<string, unknown>,
                prev: prevStudentPack,
                row,
              });
            }
          }
        }
      } catch (packErr) {
        console.error('[api/db] parent pack side effects:', packErr);
      }
    }

    // Include full error details for debugging (Supabase returns code, details, hint)
    const errorPayload = result.error
      ? {
          message: result.error.message,
          code: result.error.code,
          details: result.error.details,
          hint: result.error.hint,
        }
      : null;

    return NextResponse.json({
      data: result.data,
      error: errorPayload?.message || null,
      errorDetails: errorPayload,
      count: result.count ?? null,
    });

  } catch (error) {
    logError('Unhandled error', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    return NextResponse.json({
      error: message,
      code: code || 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' && error instanceof Error
        ? { name: error.name, stack: error.stack }
        : undefined,
    }, { status: 500 });
  }
}

type IndirectErr = { status: number; code: string; message: string };

/**
 * Per-table validation for tables whose center scope is via a parent row.
 * Returns null on success.
 */
async function validateIndirectScope(
  admin: SupabaseClient,
  table: string,
  operation: Operation,
  filters: Filter[] | undefined,
  data: unknown,
  centerId: string,
  actorUserId: string,
): Promise<IndirectErr | null> {
  if (table === 'student_group_members') {
    return validateStudentGroupMembers(admin, operation, filters, data, centerId);
  }
  if (table === 'attendance_overrides') {
    return validateAttendanceOverrides(admin, operation, data, centerId, actorUserId);
  }
  return {
    status: 500,
    code: 'INDIRECT_SCOPE_UNHANDLED',
    message: `No indirect-scope validator for table '${table}'`,
  };
}

async function validateStudentGroupMembers(
  admin: SupabaseClient,
  operation: Operation,
  filters: Filter[] | undefined,
  data: unknown,
  centerId: string,
): Promise<IndirectErr | null> {
  if (operation === 'insert') {
    const rows = Array.isArray(data) ? data : [data];
    for (const r of rows) {
      if (!r || typeof r !== 'object') {
        return { status: 400, code: 'INVALID_DATA', message: 'insert row must be an object' };
      }
      const row = r as Record<string, unknown>;
      const groupId = typeof row.group_id === 'string' ? row.group_id : null;
      const studentId = typeof row.student_id === 'string' ? row.student_id : null;
      if (!groupId || !studentId) {
        return {
          status: 400,
          code: 'INDIRECT_SCOPE_MISSING_PARENT',
          message: 'student_group_members.insert requires both group_id and student_id',
        };
      }
      const parentErr = await checkParents(admin, [
        { table: 'student_groups', id: groupId, label: 'group_id' },
        { table: 'students', id: studentId, label: 'student_id' },
      ], centerId);
      if (parentErr) return parentErr;
    }
    return null;
  }

  // select / update / delete / count - require a filter on group_id or student_id.
  const fs = filters ?? [];
  const groupFilter = fs.find((f) => f.column === 'group_id' && (f.op === 'eq' || f.op === 'in'));
  const studentFilter = fs.find((f) => f.column === 'student_id' && (f.op === 'eq' || f.op === 'in'));
  if (!groupFilter && !studentFilter) {
    return {
      status: 403,
      code: 'INDIRECT_SCOPE_FILTER_REQUIRED',
      message: 'student_group_members requires a group_id or student_id filter',
    };
  }
  if (groupFilter) {
    const ids = filterIds(groupFilter);
    if (!ids) {
      return { status: 400, code: 'INDIRECT_SCOPE_INVALID_FILTER', message: 'group_id filter must contain string IDs' };
    }
    const { data: rows } = await admin
      .from('student_groups')
      .select('id, center_id')
      .in('id', ids);
    const arr = (rows ?? []) as Array<{ id: string; center_id: string | null }>;
    if (arr.some((r) => r.center_id !== centerId)) {
      return { status: 403, code: 'CROSS_TENANT_PARENT_REJECTED', message: 'group_id refers to another center' };
    }
  }
  if (studentFilter) {
    const ids = filterIds(studentFilter);
    if (!ids) {
      return { status: 400, code: 'INDIRECT_SCOPE_INVALID_FILTER', message: 'student_id filter must contain string IDs' };
    }
    const { data: rows } = await admin
      .from('students')
      .select('id, center_id')
      .in('id', ids);
    const arr = (rows ?? []) as Array<{ id: string; center_id: string | null }>;
    if (arr.some((r) => r.center_id !== centerId)) {
      return { status: 403, code: 'CROSS_TENANT_PARENT_REJECTED', message: 'student_id refers to another center' };
    }
  }
  return null;
}

async function validateAttendanceOverrides(
  admin: SupabaseClient,
  operation: Operation,
  data: unknown,
  centerId: string,
  actorUserId: string,
): Promise<IndirectErr | null> {
  if (operation !== 'insert') {
    return {
      status: 403,
      code: 'OPERATION_NOT_PERMITTED',
      message: 'attendance_overrides only supports insert via the proxy',
    };
  }
  const rows = Array.isArray(data) ? data : [data];
  for (const r of rows) {
    if (!r || typeof r !== 'object') {
      return { status: 400, code: 'INVALID_DATA', message: 'insert row must be an object' };
    }
    const row = r as Record<string, unknown>;
    const studentId = typeof row.student_id === 'string' ? row.student_id : null;
    if (!studentId) {
      return { status: 400, code: 'MISSING_STUDENT_ID', message: 'student_id required' };
    }
    const parentErr = await checkParents(
      admin,
      [{ table: 'students', id: studentId, label: 'student_id' }],
      centerId,
    );
    if (parentErr) return parentErr;
    // Force override_by_user_id to caller - payload value is ignored.
    row.override_by_user_id = actorUserId;
  }
  return null;
}

function filterIds(f: Filter): string[] | null {
  if (f.op === 'eq') {
    return typeof f.value === 'string' ? [f.value] : null;
  }
  if (f.op === 'in' && Array.isArray(f.value)) {
    const out = f.value.filter((v): v is string => typeof v === 'string');
    return out.length > 0 ? out : null;
  }
  return null;
}

async function checkParents(
  admin: SupabaseClient,
  parents: Array<{ table: string; id: string; label: string }>,
  centerId: string,
): Promise<IndirectErr | null> {
  for (const p of parents) {
    const { data: row } = await admin
      .from(p.table)
      .select('center_id')
      .eq('id', p.id)
      .maybeSingle();
    const rowCenter = (row as { center_id?: string | null } | null)?.center_id ?? null;
    if (rowCenter !== centerId) {
      return {
        status: 403,
        code: 'CROSS_TENANT_PARENT_REJECTED',
        message: `${p.label} does not belong to caller center`,
      };
    }
  }
  return null;
}
