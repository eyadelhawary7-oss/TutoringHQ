import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, can_view_payments')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const centerId = ctx.user.center_id as string;

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
    const { data: todayPayments } = await ctx.supabaseAdmin
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
    const { data: monthPayments } = await ctx.supabaseAdmin
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
    const { data: pendingRaw } = await ctx.supabaseAdmin
      .from('payments')
      .select('amount, method')
      .eq('center_id', centerId)
      .eq('confirmed', false);

    const cashMethods = ['cash', 'نقدي', 'كاش'];
    const pendingPayments = (pendingRaw || []).filter((p) => !cashMethods.includes(String(p.method || '').toLowerCase()));
    const pendingAmount = pendingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const pendingCount = pendingPayments.length;

    // Total balance due: SUM balance_due from students WHERE center_id AND is_active
    const { data: students } = await ctx.supabaseAdmin
      .from('students')
      .select('balance_due')
      .eq('center_id', centerId)
      .or('is_active.is.null,is_active.eq.true');

    const balanceDue = (students || []).reduce((sum, s) => sum + (Number(s.balance_due) || 0), 0);

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
