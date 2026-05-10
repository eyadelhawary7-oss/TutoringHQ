import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { getImpliedMonthlyMrr } from '@/lib/pricing';

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (ctx.internalRole === 'internal_viewer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      const error = 'Missing Supabase credentials';
      console.error('[admin/debug] ❌', error);
      return NextResponse.json(
        {
          error,
          hasUrl: !!supabaseUrl,
          hasServiceKey: !!serviceKey,
        },
        { status: 500 }
      );
    }

    const supabase = ctx.supabaseAdmin;

    // Query centers
    const { data: centers, error: centersError } = await supabase
      .from('centers')
      .select('id, name, phone, plan, status, billing_type, billing_period, all_in_price, is_early_adopter, early_adopter_price, created_at, is_test')
      .order('created_at', { ascending: false });

    if (centersError) {
      console.error('[admin/debug] ❌ Centers query error:', centersError);
      return NextResponse.json(
        {
          error: centersError.message,
          code: centersError.code,
          details: centersError.details,
          hint: centersError.hint,
        },
        { status: 500 }
      );
    }

    // Calculate counts
    const counts = {
      total: centers?.length || 0,
      active: centers?.filter((c) => c.status === 'active').length || 0,
      pending: centers?.filter((c) => c.status === 'pending').length || 0,
    };

    const activeCenters =
      centers?.filter(
        (c) =>
          c.status === 'active' &&
          (c.billing_type || 'fixed') === 'fixed' &&
          (c as { is_test?: boolean | null }).is_test !== true,
      ) || [];

    const totalMRR = activeCenters.reduce(
      (sum, center) =>
        sum +
        getImpliedMonthlyMrr({
          plan: center.plan,
          all_in_price: center.all_in_price,
          billing_period: (center as { billing_period?: string | null }).billing_period,
          status: center.status,
          billing_type: center.billing_type,
          is_early_adopter: center.is_early_adopter,
          early_adopter_price: center.early_adopter_price,
          id: center.id,
          is_test: (center as { is_test?: boolean | null }).is_test,
        }),
      0,
    );

    const response = {
      centers,
      counts,
      revenue: { total_mrr: totalMRR },
      note: 'Debug endpoint - for diagnostics only',
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('==========================================');
    console.error('[admin/debug] 💥 CAUGHT ERROR:', error);
    console.error('[admin/debug] Error type:', error?.constructor?.name);
    console.error('[admin/debug] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[admin/debug] Error stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('==========================================');

    return NextResponse.json(
      { error: 'Internal error', message: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
