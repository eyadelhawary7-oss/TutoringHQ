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

  let body: { customInvoiceMinimum?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data: center, error: fetchErr } = await supabaseAdmin
    .from('centers')
    .select('id, plan, pack_request_status')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    console.error('[POST /api/admin/pack-requests/[id]/approve]', fetchErr);
    return NextResponse.json({ error: 'Failed to load center' }, { status: 500 });
  }
  if (!center) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (center.pack_request_status !== 'pending') {
    return NextResponse.json({ error: 'not_pending' }, { status: 400 });
  }

  const plan = String(center.plan ?? '');
  if (plan === 'top_centers') {
    const min = body.customInvoiceMinimum;
    if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) {
      return NextResponse.json({ error: 'custom_invoice_minimum_required' }, { status: 400 });
    }
  }

  const customMin =
    typeof body.customInvoiceMinimum === 'number' && Number.isFinite(body.customInvoiceMinimum)
      ? body.customInvoiceMinimum
      : null;

  const { error: updateErr } = await supabaseAdmin
    .from('centers')
    .update({
      parent_pack_enabled: true,
      pack_request_status: 'approved',
      pack_approved_at: new Date().toISOString(),
      pack_custom_invoice_minimum: customMin,
      pack_rejection_reason: null,
    })
    .eq('id', id);

  if (updateErr) {
    console.error('[POST /api/admin/pack-requests/[id]/approve] update', updateErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
