import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await auth.supabaseAdmin
    .from('invoices')
    .select(
      'id, invoice_number, invoice_type, total_amount, billing_period_start, billing_period_end, status, created_at, due_date, metadata',
    )
    .eq('center_id', auth.centerId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('[billing/invoices]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ invoices: data ?? [] });
}
