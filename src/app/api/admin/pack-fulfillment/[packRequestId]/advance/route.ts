import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  nextPackFulfillmentStatus,
  type PackFulfillmentStatus,
} from '@/lib/packFulfillment';

export const dynamic = 'force-dynamic';

const PIPELINE = new Set<string>([
  'pending_approval',
  'approved',
  'in_production',
  'dispatched',
  'in_transit',
  'delivered',
  'issued',
]);

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ packRequestId: string }> },
) {
  const auth = await requireSuperAdminApi(_request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin } = auth;
  const { packRequestId } = await params;

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('pack_requests')
    .select('id, center_id, status')
    .eq('id', packRequestId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[POST /api/admin/pack-fulfillment/.../advance]', fetchErr);
    return NextResponse.json({ error: 'Failed to load pack request' }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const current = row.status as PackFulfillmentStatus;
  if (!PIPELINE.has(current)) {
    return NextResponse.json({ error: 'not_advanceable' }, { status: 400 });
  }

  const nextSt = nextPackFulfillmentStatus(current);
  if (!nextSt) {
    return NextResponse.json({ error: 'already_terminal' }, { status: 400 });
  }

  const { error: upErr } = await supabaseAdmin
    .from('pack_requests')
    .update({ status: nextSt })
    .eq('id', packRequestId)
    .eq('status', current);

  if (upErr) {
    console.error('[POST /api/admin/pack-fulfillment/.../advance] update', upErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    status: nextSt,
  });
}
