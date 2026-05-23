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
  // PDPL: bulk centre PII export is accountant-and-above only. Roles
  // collapsing to internal_viewer (sales_rep / support_agent / custom)
  // must not read this dataset.
  const denied = requireAdminRole(ctx, ['super_admin', 'admin', 'internal_admin', 'accountant']);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') ?? '';
  const planFilter = searchParams.get('plan') ?? '';

  let query = ctx.supabaseAdmin
    .from('centers')
    .select(
      `
      center_code, name, owner_name, phone, email, city, governorate,
      plan, billing_period, billing_status, subscription_status,
      all_in_price, billing_amount, next_payment_due, auto_suspend_at,
      is_early_adopter, early_adopter_price, parent_pack_enabled,
      parent_pack_active_parents, health_score, health_score_band,
      onboarding_completed, is_blacklisted, created_at, approved_at
    `,
    )
    .neq('status', 'deleted')
    .order('center_code');

  if (statusFilter) query = query.eq('status', statusFilter);
  if (planFilter) query = query.eq('plan', planFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const csv = toCSV((data ?? []) as Record<string, unknown>[]);
  const date = new Date().toISOString().split('T')[0];

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="centers-${date}.csv"`,
    },
  });
}
