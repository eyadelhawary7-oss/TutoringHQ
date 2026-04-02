import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin } = auth;
  const { id } = await params;

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 1) {
    return NextResponse.json({ error: 'reason_required' }, { status: 400 });
  }

  const { data: center, error: fetchErr } = await supabaseAdmin
    .from('centers')
    .select('id, pack_request_status')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    console.error('[POST /api/admin/pack-requests/[id]/reject]', fetchErr);
    return NextResponse.json({ error: 'Failed to load center' }, { status: 500 });
  }
  if (!center) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (center.pack_request_status !== 'pending') {
    return NextResponse.json({ error: 'not_pending' }, { status: 400 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from('centers')
    .update({
      pack_request_status: 'rejected',
      pack_rejection_reason: reason,
    })
    .eq('id', id);

  if (updateErr) {
    console.error('[POST /api/admin/pack-requests/[id]/reject] update', updateErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
