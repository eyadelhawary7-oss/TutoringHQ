import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: { action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.action !== 'mark_paid') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await auth.supabaseAdmin
    .from('referral_commissions')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Commission not found' }, { status: 404 });
  }

  if ((row as { status: string }).status !== 'withdrawable') {
    return NextResponse.json({ error: 'Only withdrawable commissions can be marked paid' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await auth.supabaseAdmin
    .from('referral_commissions')
    .update({ status: 'paid', paid_at: now })
    .eq('id', id)
    .eq('status', 'withdrawable');

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
