import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

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
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
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

  const { error: prErr } = await supabaseAdmin
    .from('pack_requests')
    .update({ status: 'cancelled' })
    .eq('center_id', id)
    .eq('status', 'pending_approval');

  if (prErr) {
    console.error('[POST /api/admin/pack-requests/[id]/reject] pack_requests', prErr);
  }

  return NextResponse.json({ success: true });
}
