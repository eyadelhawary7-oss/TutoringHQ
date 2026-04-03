import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  center_id: string;
  credits_deducted: number | string | null;
  cash_amount: number | string | null;
  fee_amount: number | string | null;
  instapay_number: string | null;
  status: string | null;
  requested_at: string | null;
  processed_at: string | null;
  processed_by: string | null;
  notes: string | null;
  centers: { name: string | null } | { name: string | null }[] | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const statusRaw = searchParams.get('status');
  const status =
    statusRaw === 'pending' || statusRaw === 'paid' || statusRaw === 'rejected' ? statusRaw : null;

  let q = auth.supabaseAdmin.from('withdrawal_requests').select(
    `
    id,
    center_id,
    credits_deducted,
    cash_amount,
    fee_amount,
    instapay_number,
    status,
    requested_at,
    processed_at,
    processed_by,
    notes,
    centers ( name )
  `,
  );

  if (status) {
    q = q.eq('status', status);
  }

  const { data, error } = await q.order('requested_at', { ascending: false });

  if (error) {
    console.error('[admin/withdrawals GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];
  const withdrawals = rows.map((r) => {
    const c = r.centers;
    const centerName = Array.isArray(c) ? (c[0]?.name ?? null) : (c?.name ?? null);
    return {
      id: r.id,
      center_id: r.center_id,
      center_name: centerName,
      credits_deducted: Number(r.credits_deducted ?? 0),
      cash_amount: Number(r.cash_amount ?? 0),
      fee_amount: Number(r.fee_amount ?? 0),
      instapay_number: r.instapay_number,
      status: r.status,
      requested_at: r.requested_at,
      processed_at: r.processed_at,
      processed_by: r.processed_by,
      notes: r.notes,
    };
  });

  return NextResponse.json({ withdrawals });
}
