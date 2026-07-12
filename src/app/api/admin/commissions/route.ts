import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { getInternalScope } from '@/lib/internalScope';

// Sentinel that matches no row - a scoped role with an EMPTY scope sees nothing.
const NO_MATCH_SENTINEL = '00000000-0000-0000-0000-000000000000';

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ errorKey: 'commissions.errors.unauthorized' }, { status: 401 });
  }
  // Phase 4a: commissions are visible to the CEO (super_admin, all rows) and to
  // sales_manager / sales_rep (scoped to their team's / own commissions via
  // staff_id). Every other role is denied. The unlock + payout mutations stay
  // super_admin-only in their own routes.
  const isCEO = ctx.internalRole === 'super_admin';
  const isSalesRole = ctx.adminRole === 'sales_manager' || ctx.adminRole === 'sales_rep';
  if (!isCEO && !isSalesRole) {
    return NextResponse.json(
      { error: 'insufficient_admin_role', required: ['super_admin'], current: ctx.internalRole },
      { status: 403 },
    );
  }

  const scope = await getInternalScope(ctx);

  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get('staff_id');
  const plan = searchParams.get('plan');
  const t1Status = searchParams.get('t1_status');
  const t2Status = searchParams.get('t2_status');

  let query = ctx.supabaseAdmin
    .from('commissions')
    .select(
      `
      *,
      staff(id, name, role),
      centers(id, name, center_code, plan, billing_status, next_payment_due)
    `,
    )
    .order('created_at', { ascending: false });

  // Scope non-CEO sales roles to their own / team staff ids (fail closed when empty).
  if (scope.level !== 'all') {
    query = query.in(
      'staff_id',
      scope.staffIds.length ? scope.staffIds : [NO_MATCH_SENTINEL],
    );
  }

  if (staffId) query = query.eq('staff_id', staffId);
  if (plan) query = query.eq('plan_at_signing', plan);
  if (t1Status) query = query.eq('t1_status', t1Status);
  if (t2Status) query = query.eq('t2_status', t2Status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { errorKey: 'commissions.errors.listFailed', error: error.message },
      { status: 500 },
    );
  }

  const enriched = await Promise.all(
    (data ?? []).map(async (commission) => {
      const { data: activeDays } = await ctx.supabaseAdmin.rpc('compute_active_days', {
        p_commission_id: commission.id,
      });
      return { ...commission, active_days: activeDays ?? 0 };
    }),
  );

  return NextResponse.json({ commissions: enriched });
}
