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

  if (!userRecord?.center_id || userRecord.role !== 'owner') return null;

  return { user: userRecord, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { requested_plan } = body;

    if (!requested_plan || !['starter', 'pro', 'pro_plus', 'enterprise', 'payg'].includes(requested_plan)) {
      return NextResponse.json({ error: 'requested_plan must be starter, pro, pro_plus, enterprise, or payg' }, { status: 400 });
    }

    const { data: center } = await ctx.supabaseAdmin
      .from('centers')
      .select('id, plan, pricing_type')
      .eq('id', ctx.user.center_id)
      .single();

    if (!center) return NextResponse.json({ error: 'Center not found' }, { status: 404 });

    const currentPlan = center.plan || 'starter';

    const { error: insertErr } = await ctx.supabaseAdmin.from('plan_requests').insert({
      center_id: ctx.user.center_id,
      current_plan: currentPlan,
      requested_plan,
      status: 'pending',
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'تم إرسال طلبك. سيتم مراجعته خلال 24 ساعة.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
