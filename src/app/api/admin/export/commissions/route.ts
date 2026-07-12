import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { getInternalScope } from '@/lib/internalScope';

// Sentinel that matches no row - a scoped role with an EMPTY scope exports nothing.
const NO_MATCH_SENTINEL = '00000000-0000-0000-0000-000000000000';

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
  // Phase 6: the CEO exports everything; sales_manager / sales_rep export ONLY their
  // scoped commission lines (same fail-closed getInternalScope gate as the list API —
  // a rep gets their own rows, a manager their team's + their own override rows).
  // Every other role stays denied.
  const isCEO = ctx.internalRole === 'super_admin';
  const isSalesRole = ctx.adminRole === 'sales_manager' || ctx.adminRole === 'sales_rep';
  if (!isCEO && !isSalesRole) {
    return NextResponse.json(
      { error: 'insufficient_admin_role', required: ['super_admin'], current: ctx.internalRole },
      { status: 403 },
    );
  }
  const scope = await getInternalScope(ctx);

  let query = ctx.supabaseAdmin
    .from('commissions')
    .select(
      `
      owner_type, teacher_id,
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

  if (scope.level !== 'all') {
    query = query.in('staff_id', scope.staffIds.length ? scope.staffIds : [NO_MATCH_SENTINEL]);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Teacher-owned rows carry no centers embed — batch-load teacher display names.
  const rows = (data ?? []) as Record<string, unknown>[];
  const teacherIds = [
    ...new Set(
      rows
        .filter((r) => r.owner_type === 'teacher' && r.teacher_id)
        .map((r) => String(r.teacher_id)),
    ),
  ];
  const teacherNames = new Map<string, string>();
  if (teacherIds.length) {
    const { data: teachers } = await ctx.supabaseAdmin
      .from('users')
      .select('id, name')
      .in('id', teacherIds);
    for (const u of (teachers ?? []) as { id: string; name?: string | null }[]) {
      teacherNames.set(String(u.id), String(u.name ?? '').trim());
    }
  }

  const flat = rows.map((c: Record<string, unknown>) => {
    const center = c.centers as { center_code: string; name: string } | null;
    const staff = c.staff as { name: string; role: string } | null;
    const isTeacher = c.owner_type === 'teacher';
    const { centers: _c, staff: _s, teacher_id: _t, owner_type: _o, ...rest } = c;
    return {
      owner_type: String(c.owner_type ?? 'center'),
      owner_code: isTeacher ? '' : (center?.center_code ?? ''),
      owner_name: isTeacher ? (teacherNames.get(String(c.teacher_id)) ?? '') : (center?.name ?? ''),
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
