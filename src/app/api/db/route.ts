import { createClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { NextResponse } from 'next/server';
import { dbInsertSchemas, studentUpdateSchema } from '@/lib/validations';
import { afterStudentWriteParentPackEffects } from '@/lib/studentParentPackWelcome';
import { validateCSRFRequest } from '@/lib/csrf';
import { scanRatelimit, rateLimitedResponse } from '@/lib/ratelimit';
import { getShippingFee, getShippingZone } from '@/lib/bostaShipping';
import { loadBostaShippingRates } from '@/lib/loadBostaShippingRates';
import { parseBodyWithLimit } from '@/lib/validate';

const ALLOWED_TABLES = [
  'payments', 'students', 'student_groups', 'attendance_scans', 'attendance_overrides',
  'rooms', 'schedule_slots', 'centers', 'users', 'subjects',
  'subscriptions', 'whatsapp_messages', 'whatsapp_incoming',
  'permissions', 'demo_requests', 'center_invites', 'student_group_members',
  'wa_templates', 'paid_parents', 'reminder_settings',
  'card_orders',
] as const;

const VALID_OPERATIONS = ['select', 'insert', 'update', 'delete', 'count'] as const;

function logError(context: string, err: unknown) {
  console.error(`[api/db] ${context}:`, err);
  if (err instanceof Error && err.stack) {
    console.error('[api/db] Stack:', err.stack);
  }
}

/**
 * Server-side database proxy that bypasses RLS using the service role key.
 * All requests must include a valid Authorization header (Bearer token).
 * The user's identity is verified before executing any operation.
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

    if (!VALID_OPERATIONS.includes(operation as (typeof VALID_OPERATIONS)[number])) {
      return NextResponse.json({
        error: `Field 'operation' must be one of: ${VALID_OPERATIONS.join(', ')}`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    if (!ALLOWED_TABLES.includes(table as (typeof ALLOWED_TABLES)[number])) {
      return NextResponse.json({
        error: `Table '${table}' is not allowed`,
        code: 'TABLE_NOT_ALLOWED',
        allowedTables: [...new Set(ALLOWED_TABLES)],
      }, { status: 400 });
    }

    if ((operation === 'insert' || operation === 'update') && data === undefined) {
      return NextResponse.json({
        error: `Field 'data' is required for operation '${operation}'`,
        code: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    if (operation === 'insert' && !(typeof data === 'object' && data !== null && !Array.isArray(data) || Array.isArray(data))) {
      return NextResponse.json({ error: "Field 'data' must be an object or array", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Validate insert/update data for tables with schemas
    let schema: z.ZodType | undefined = dbInsertSchemas[table as keyof typeof dbInsertSchemas];
    if (table === 'students' && operation === 'update') {
      schema = studentUpdateSchema;
    }
    if ((operation === 'insert' || operation === 'update') && schema && data != null) {
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
    const isStateChange = ['insert', 'update', 'delete'].includes(operation as string);
    if (isStateChange && !validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: actorRow } = await supabaseAdmin
      .from('users')
      .select('center_id, role')
      .eq('id', user.id)
      .maybeSingle();
    const actorCenterId = (actorRow as { center_id?: string | null } | null)?.center_id ?? null;

    if (
      table === 'card_orders' &&
      operation === 'insert' &&
      data &&
      typeof data === 'object' &&
      !Array.isArray(data)
    ) {
      const row = data as Record<string, unknown>;
      const targetCenterId = typeof row.center_id === 'string' ? row.center_id : '';
      if (!targetCenterId) {
        return NextResponse.json({ error: 'center_id required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .maybeSingle();
      const userCenterId = (userRow as { center_id?: string | null } | null)?.center_id ?? null;
      if (!userCenterId || userCenterId !== targetCenterId) {
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

    let prevStudentPack: { parent_pack_opted_in: boolean | null; parent_phone: string | null } | null = null;
    if (table === 'students' && operation === 'update' && filters && Array.isArray(filters)) {
      const idFilter = filters.find(
        (f: { column: string; op: string; value: unknown }) => f.column === 'id' && f.op === 'eq',
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

    // Rate limiting — scanner posts attendance via insert; keyed by center_id
    if (
      scanRatelimit &&
      isStateChange &&
      operation === 'insert' &&
      table === 'attendance_scans'
    ) {
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .maybeSingle();
      const centerId = userRow?.center_id ?? user.id;
      const { success, reset } = await scanRatelimit.limit(centerId);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return rateLimitedResponse(retryAfter);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder has complex chaining types
    let query: any;

    const selectStr: string = typeof selectColumns === 'string' ? selectColumns : '*';

    switch (operation) {
      case 'select': {
        query = supabaseAdmin.from(table).select(selectStr);
        break;
      }
      case 'insert': {
        query = supabaseAdmin.from(table).insert(data);
        if (selectColumns !== false) {
          query = query.select(selectStr);
        }
        break;
      }
      case 'update': {
        query = supabaseAdmin.from(table).update(data);
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
      default:
        return NextResponse.json({ error: `Invalid operation: ${operation}` }, { status: 400 });
    }

    // Apply filters
    if (filters && Array.isArray(filters)) {
      for (const filter of filters) {
        const { column, op, value } = filter;
        switch (op) {
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
        Array.isArray(filters) && filters.length > 0
          ? filters.slice(0, 8).map((f: { column?: string; op?: string }) => `${f.column}:${f.op}`)
          : [];
      void supabaseAdmin
        .from('audit_log')
        .insert({
          center_id: actorCenterId,
          user_id: user.id,
          action: `db_proxy.${String(operation)}.${String(table)}`,
          entity_type: 'db_proxy',
          details: {
            table,
            operation,
            filter_preview: filterPreview,
          },
        })
        .then(
          () => {},
          () => {},
        );
    }

    if (!result.error && table === 'students') {
      try {
        if (operation === 'insert' && result.data) {
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
        if (operation === 'update' && filters && Array.isArray(filters)) {
          const idFilter = filters.find(
            (f: { column: string; op: string; value: unknown }) => f.column === 'id' && f.op === 'eq',
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
                body: (data ?? {}) as Record<string, unknown>,
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
