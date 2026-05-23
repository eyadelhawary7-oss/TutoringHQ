import { NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ errorKey: 'admin.export.unauthorized' }, { status: 401 });
  }
  const denied = requireAdminRole(ctx, ['super_admin', 'admin', 'internal_admin', 'accountant']);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const status = searchParams.get('status') ?? '';

  let query = ctx.supabaseAdmin
    .from('invoices')
    .select(
      `
      invoice_number, invoice_type, total_amount, base_amount,
      discount_amount, status, payment_method, payment_reference,
      billing_period_start, billing_period_end, due_date,
      paid_at, created_at,
      centers(center_code, name)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(100000);

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const flat = (data ?? []).map((inv: Record<string, unknown>) => {
    const center = inv.centers as { center_code: string; name: string } | null;
    const { centers: _c, ...rest } = inv;
    return {
      center_code: center?.center_code ?? '',
      center_name: center?.name ?? '',
      ...rest,
    };
  });

  const csv = toCSV(flat as Record<string, unknown>[]);
  const date = new Date().toISOString().split('T')[0];

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="invoices-${date}.csv"`,
    },
  });
}
