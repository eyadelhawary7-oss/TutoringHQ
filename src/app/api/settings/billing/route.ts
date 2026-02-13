import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return null;
  }

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

    const { data: center, error: centerError } = await ctx.supabaseAdmin
      .from('centers')
      .select('plan, pricing_type, weekly_student_limit, max_students')
      .eq('id', ctx.user.center_id)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const { data: plans, error: plansError } = await ctx.supabaseAdmin
      .from('pricing_plans')
      .select('*')
      .order('sort_order', { ascending: true });

    if (plansError) {
      return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
    }

    const { data: paygRates, error: paygError } = await ctx.supabaseAdmin
      .from('payg_rates')
      .select('*')
      .order('sort_order', { ascending: true });

    if (paygError) {
      return NextResponse.json({ error: 'Failed to fetch PAYG rates' }, { status: 500 });
    }

    const currentPlan = (plans || []).find(
      (p: { id: string }) => p.id === (center.plan || 'starter')
    );

    return NextResponse.json({
      plan: center.plan || 'starter',
      pricing_type: center.pricing_type || 'fixed',
      weekly_student_limit: center.weekly_student_limit ?? center.max_students ?? 200,
      plans: plans || [],
      payg_rates: paygRates || [],
      current_plan_details: currentPlan,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (ctx.user.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { plan, pricing_type, weekly_student_limit } = body;

    const updates: Record<string, unknown> = {};

    if (plan !== undefined) {
      if (!['starter', 'pro', 'enterprise', 'top_centers'].includes(plan)) {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
      }
      updates.plan = plan;
    }

    if (pricing_type !== undefined) {
      if (!['fixed', 'payg'].includes(pricing_type)) {
        return NextResponse.json({ error: 'Invalid pricing_type' }, { status: 400 });
      }
      updates.pricing_type = pricing_type;
    }

    if (weekly_student_limit !== undefined) {
      const limit = Number(weekly_student_limit);
      if (isNaN(limit) || limit < 0 || limit > 10000) {
        return NextResponse.json({ error: 'Invalid weekly_student_limit' }, { status: 400 });
      }
      updates.weekly_student_limit = limit;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await ctx.supabaseAdmin
      .from('centers')
      .update(updates)
      .eq('id', ctx.user.center_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
