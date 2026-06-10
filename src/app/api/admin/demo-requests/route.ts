import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';

function isSuperAdmin(phone: string | null): boolean {
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return !!phone && admins.split(',').map((p: string) => p.trim()).includes(phone);
}

async function isAdminUser(supabaseAdmin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('admin_users').select('id').eq('id', userId).single();
  return !!data;
}

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const adminByTable = await isAdminUser(supabaseAdmin, user.id);
    const { data: userRecord } = await supabaseAdmin.from('users').select('phone').eq('id', user.id).single();
    const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);

    if (!adminByTable && !adminByPhone) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: requestsData, error } = await supabaseAdmin
      .from('demo_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ requests: requestsData || [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/demo-requests - update a demo request (mark handled, assign, etc.)
export async function PATCH(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin']);
  if (roleErr) return roleErr;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const allowedFields = ['status', 'notes', 'assigned_to', 'handled_at', 'handled_by'];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await adminClient
    .from('demo_requests')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ request: data });
}

// DELETE /api/admin/demo-requests?id=<request_id>
export async function DELETE(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin']);
  if (roleErr) return roleErr;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await adminClient.from('demo_requests').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
