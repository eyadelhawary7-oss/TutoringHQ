import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';
import { getAdminContext, requireAdminRole, requireSuperAdminApi } from '@/lib/admin-auth';

export async function GET(request: Request) {
  // CEO-only (Phase 1 rebuild): the Demo Requests screen is restricted to super_admin.
  // The public demo-intake form (/api/demo-request) is unchanged.
  const gate = await requireSuperAdminApi(request);
  if (!gate.ok) return gate.response;

  const { data: requestsData, error } = await gate.supabaseAdmin
    .from('demo_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: requestsData || [] });
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
  // CEO-only (Phase 1 rebuild): Demo Requests screen mutations are super_admin-only.
  const roleErr = requireAdminRole(ctx, ['super_admin']);
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
  // CEO-only (Phase 1 rebuild): Demo Requests screen mutations are super_admin-only.
  const roleErr = requireAdminRole(ctx, ['super_admin']);
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
