import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { getStudentBalances, sumOutstanding } from '@/lib/studentBalance';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const centerId = auth.centerId;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const monthEnd = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0, 23, 59, 59, 999);

    const todayISO = todayStart.toISOString().slice(0, 10);
    const monthStartISO = monthStart.toISOString().slice(0, 10);
    const monthEndISO = monthEnd.toISOString().slice(0, 10);

    // Collected today: (confirmed=true OR method IN ('cash','نقدي')) AND paid_at today
    const { data: todayPayments } = await auth.supabaseAdmin
      .from('payments')
      .select('amount, confirmed, method')
      .eq('center_id', centerId)
      .gte('paid_at', `${todayISO}T00:00:00.000Z`)
      .lte('paid_at', `${todayISO}T23:59:59.999Z`);

    const totalToday = (todayPayments || []).reduce((sum, p) => {
      const amt = Number(p.amount) || 0;
      const isCollected = p.confirmed === true || p.method === 'cash' || p.method === 'نقدي' || p.method === 'كاش';
      return isCollected ? sum + amt : sum;
    }, 0);

    // Collected this month: same logic
    const { data: monthPayments } = await auth.supabaseAdmin
      .from('payments')
      .select('amount, confirmed, method')
      .eq('center_id', centerId)
      .gte('paid_at', `${monthStartISO}T00:00:00.000Z`)
      .lte('paid_at', `${monthEndISO}T23:59:59.999Z`);

    const totalMonth = (monthPayments || []).reduce((sum, p) => {
      const amt = Number(p.amount) || 0;
      const isCollected = p.confirmed === true || p.method === 'cash' || p.method === 'نقدي' || p.method === 'كاش';
      return isCollected ? sum + amt : sum;
    }, 0);

    // Pending digital: confirmed=false AND method NOT IN ('cash','نقدي','كاش')
    const { data: pendingRaw } = await auth.supabaseAdmin
      .from('payments')
      .select('amount, method')
      .eq('center_id', centerId)
      .eq('confirmed', false);

    const cashMethods = ['cash', 'نقدي', 'كاش'];
    const pendingPayments = (pendingRaw || []).filter((p) => !cashMethods.includes(String(p.method || '').toLowerCase()));
    const pendingAmount = pendingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const pendingCount = pendingPayments.length;

    // Total balance due: computed (fee × attended − logged payments) per active
    // student, summing only positive balances (credits are not netted).
    const balancesMap = await getStudentBalances(auth.supabaseAdmin, {
      centerId,
      activeOnly: true,
    });
    const balanceDue = sumOutstanding(balancesMap.values());

    return NextResponse.json({
      totalToday,
      totalMonth,
      pendingCount,
      pendingAmount,
      balanceDue,
    });
  } catch (error) {
    console.error('[payments/stats] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
