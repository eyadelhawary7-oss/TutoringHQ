import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

/** First unpaid subscription invoice for Paymob "pay now" UIs (owner). */
export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: inv } = await auth.supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('center_id', auth.centerId)
    .eq('invoice_type', 'subscription')
    .in('status', ['pending', 'overdue'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const id = inv && typeof (inv as { id?: string }).id === 'string' ? (inv as { id: string }).id : null;

  return NextResponse.json({ invoiceId: id });
}
