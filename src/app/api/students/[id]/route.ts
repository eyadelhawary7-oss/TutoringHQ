import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { requirePermission } from '@/lib/centerPermissions';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { supabaseAdmin, centerId } = auth;

  const { data: scoped } = await supabaseAdmin
    .from('students')
    .select('id')
    .eq('id', id)
    .eq('center_id', centerId)
    .maybeSingle();

  if (!scoped) {
    return new Response(null, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const allowed = new Set([
    'name',
    'phone',
    'parent_phone',
    'lifecycle_status',
    'is_active',
    'notes',
    'group_id',
    'parent_pack_opted_in',
    'notify_on_scan',
    'notify_on_absence',
    'notify_on_balance',
  ]);

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { error: upErr } = await supabaseAdmin
    .from('students')
    .update(updates)
    .eq('id', id)
    .eq('center_id', centerId);

  if (upErr) {
    console.error('[PATCH /api/students/[id]]', upErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // Permission gate added May 12 per docs/AUDIT_center_role_gating.md
  const permErr = requirePermission(auth, 'can_delete_students');
  if (permErr) return permErr;

  const { id } = await params;
  const { supabaseAdmin, centerId } = auth;

  const { data: scoped } = await supabaseAdmin
    .from('students')
    .select('id')
    .eq('id', id)
    .eq('center_id', centerId)
    .maybeSingle();

  if (!scoped) {
    return new Response(null, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('students')
    .update({ is_active: false })
    .eq('id', id)
    .eq('center_id', centerId);

  if (error) {
    console.error('[DELETE /api/students/[id]]', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  return new Response(null, { status: 405 });
}
