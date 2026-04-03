import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextResponse } from 'next/server';

/** GET — list all pricing_plans for super-admin pricing panel */
export async function GET(request: Request) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from('pricing_plans')
    .select(
      'id, name_en, name_ar, students_per_week_limit, monthly_fee, all_in_price, is_custom, sort_order, is_active',
    )
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[GET /api/admin/pricing/plans]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ plans: data ?? [] });
}
