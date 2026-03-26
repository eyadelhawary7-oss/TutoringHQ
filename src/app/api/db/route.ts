import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { dbInsertSchemas } from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import { scanRatelimit, rateLimitedResponse } from '@/lib/ratelimit';

const ALLOWED_TABLES = [
  'payments', 'students', 'student_groups', 'attendance_scans',
  'rooms', 'schedule_slots', 'centers', 'users', 'subjects',
  'audit_log', 'subscriptions', 'whatsapp_messages', 'whatsapp_incoming',
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
      body = await request.json();
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
    const schema = dbInsertSchemas[table as keyof typeof dbInsertSchemas];
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
