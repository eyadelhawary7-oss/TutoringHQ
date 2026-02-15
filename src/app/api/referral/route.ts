import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    .select('id, center_id, role')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: center } = await ctx.supabaseAdmin
      .from('centers')
      .select('referral_code')
      .eq('id', ctx.user.center_id)
      .single();

    // Earned: from referral_rewards (created only when admin approves referred center's first payment)
    const { data: rewards } = await ctx.supabaseAdmin
      .from('referral_rewards')
      .select(`
        id,
        referred_center_id,
        referred_center_plan,
        first_month_fee,
        reward_amount,
        reward_status,
        created_at
      `)
      .eq('referring_center_id', ctx.user.center_id)
      .order('created_at', { ascending: false });

    const referredCenterIds = (rewards || [])
      .map((r: { referred_center_id: string }) => r.referred_center_id)
      .filter(Boolean);
    const centerNames: Record<string, string> = {};

    if (referredCenterIds.length > 0) {
      const { data: centers } = await ctx.supabaseAdmin
        .from('centers')
        .select('id, name')
        .in('id', referredCenterIds);
      (centers || []).forEach((c: { id: string; name: string }) => {
        centerNames[c.id] = c.name || '—';
      });
    }

    const rewardsWithNames = (rewards || []).map((r: { id: string; referred_center_id: string; referred_center_plan: string; first_month_fee: number; reward_amount: number; reward_status: string; created_at: string }) => ({
      ...r,
      referred_center_name: centerNames[r.referred_center_id] ?? '—',
      status: 'earned' as const,
    }));

    // Pending: centers that signed up with our code but have no approved payment yet
    const { data: pendingCenters } = await ctx.supabaseAdmin
      .from('centers')
      .select('id, name, plan, subscription_status, created_at')
      .eq('referred_by', ctx.user.center_id)
      .neq('status', 'deleted');

    const earnedCenterIds = new Set(referredCenterIds);
    const pending = (pendingCenters || [])
      .filter((c: { id: string }) => !earnedCenterIds.has(c.id))
      .filter((c: { subscription_status?: string }) => (c.subscription_status ?? 'active') === 'active')
      .map((c: { id: string; name: string; plan: string; created_at: string }) => ({
        id: c.id,
        referred_center_id: c.id,
        referred_center_name: c.name || '—',
        referred_center_plan: c.plan || '—',
        reward_amount: 0,
        reward_status: 'pending',
        created_at: c.created_at,
        status: 'pending' as const,
      }));

    const totalEarned = (rewards || []).reduce(
      (sum: number, r: { reward_amount: number; reward_status: string }) =>
        sum + (r.reward_status === 'paid' || r.reward_status === 'approved' || r.reward_status === 'pending' ? Number(r.reward_amount) : 0),
      0
    );

    return NextResponse.json({
      referralCode: center?.referral_code ?? '',
      rewards: rewardsWithNames,
      pending,
      totalEarned,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
