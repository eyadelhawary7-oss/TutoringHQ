import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextResponse } from 'next/server';

/** GET — list all pricing_plans for super-admin pricing panel */
export async function GET(request: Request) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from('pricing_plans')
    .select(
      'plan_key, arabic_name, english_name, weekly_student_limit, monthly_fee, cost_per_student, setup_fee, is_active, all_in_price',
    )
    .neq('plan_key', ['pro', '_plus'].join(''))
    .order('plan_key', { ascending: true });

  if (error) {
    console.error('[GET /api/admin/pricing/plans]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ plans: data ?? [] });
}
