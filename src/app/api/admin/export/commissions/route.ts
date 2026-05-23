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
  // Pre-launch gate: commission CSV export is super_admin only, matching the
  // prior restriction (admin.role !== 'super_admin' → 403). The broader
  // 'accountant'-allowed gate was a regression in the previous round.
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;

  const { data, error } = await ctx.supabaseAdmin
    .from('commissions')
    .select(
      `
      commission_type, role_at_time, plan_at_signing,
      total_commission, t1_amount, t1_status, t1_paid_at,
      t2_amount, t2_status, t2_eligible_at, t2_paid_at,
      loyalty_bonus_amount, loyalty_bonus_status,
      center_first_payment_date, created_at,
      centers(center_code, name),
      staff(name, role)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(100000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const flat = (data ?? []).map((c: Record<string, unknown>) => {
    const center = c.centers as { center_code: string; name: string } | null;
    const staff = c.staff as { name: string; role: string } | null;
    const { centers: _c, staff: _s, ...rest } = c;
    return {
      center_code: center?.center_code ?? '',
      center_name: center?.name ?? '',
      staff_name: staff?.name ?? '',
      staff_role: staff?.role ?? '',
      ...rest,
    };
  });

  const csv = toCSV(flat as Record<string, unknown>[]);
  const date = new Date().toISOString().split('T')[0];

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="commissions-${date}.csv"`,
    },
  });
}
