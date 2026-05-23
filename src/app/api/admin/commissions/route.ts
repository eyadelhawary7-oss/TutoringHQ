import { NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ errorKey: 'commissions.errors.unauthorized' }, { status: 401 });
  }
  // Pre-launch gate: commissions are sales/staff payouts , super_admin only,
  // matching the prior restriction (admin.role !== 'super_admin' → 403). The
  // broader 'accountant'-allowed gate was a regression in the previous round.
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;

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
