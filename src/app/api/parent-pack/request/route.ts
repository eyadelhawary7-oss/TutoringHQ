import { NextRequest, NextResponse } from 'next/server';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { supabaseAdmin, centerId } = ctx;

  const { data: center, error: fetchErr } = await supabaseAdmin
    .from('centers')
    .select('pack_request_status')
    .eq('id', centerId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[POST /api/parent-pack/request]', fetchErr);
    return NextResponse.json({ error: 'Failed to load center' }, { status: 500 });
  }

  const status = center?.pack_request_status as string | undefined;
  if (status === 'approved') {
    return NextResponse.json({ error: 'already_active' }, { status: 400 });
  }
  if (status === 'pending') {
    return NextResponse.json({ error: 'already_pending' }, { status: 400 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from('centers')
    .update({
      pack_request_status: 'pending',
      pack_requested_at: new Date().toISOString(),
      pack_rejection_reason: null,
    })
    .eq('id', centerId);

  if (updateErr) {
    console.error('[POST /api/parent-pack/request] update', updateErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
