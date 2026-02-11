import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Server-side database proxy that bypasses RLS using the service role key.
 * All requests must include a valid Authorization header (Bearer token).
 * The user's identity is verified before executing any operation.
 * 
 * Supported operations: select, insert, update, delete
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Authenticate user
    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { operation, table, data, filters, select: selectColumns, order, limit: rowLimit, single } = body;

    // Whitelist allowed tables
    const allowedTables = [
      'centers', 'subjects', 'students', 'payments', 
      'attendance_scans', 'audit_log', 'subscriptions', 'users',
      'whatsapp_messages', 'whatsapp_incoming'
    ];

    if (!allowedTables.includes(table)) {
      return NextResponse.json({ error: `Table '${table}' not allowed` }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query: any;

    switch (operation) {
      case 'select': {
        query = supabaseAdmin.from(table).select(selectColumns || '*');
        break;
      }
      case 'insert': {
        query = supabaseAdmin.from(table).insert(data);
        if (selectColumns !== false) {
          query = query.select(selectColumns || '*');
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
        query = supabaseAdmin.from(table).select(selectColumns || '*', { count: 'exact', head: true });
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
    if (order) {
      const { column, ascending } = order;
      query = query.order(column, { ascending: ascending !== false });
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

    return NextResponse.json({
      data: result.data,
      error: result.error?.message || null,
      count: result.count ?? null,
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
