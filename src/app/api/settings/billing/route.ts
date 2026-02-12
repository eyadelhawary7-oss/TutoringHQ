import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { billingPeriodSchema } from '@/lib/validations';

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
      .select('plan, billing_period, billing_amount, next_billing_date, billing_cycle_start')
      .eq('id', ctx.user.center_id)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    // Current month WhatsApp charges from whatsapp_subscriptions
    const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const { data: waSub } = await ctx.supabaseAdmin
      .from('whatsapp_subscriptions')
      .select('individual_monthly_charge, group_monthly_charge, parent_monthly_charge, individual_overage_charge, group_overage_charge')
      .eq('center_id', ctx.user.center_id)
      .eq('billing_month', thisMonth)
      .single();

    const whatsappIndividual = Number(waSub?.individual_monthly_charge ?? 0) + Number(waSub?.individual_overage_charge ?? 0);
    const whatsappGroup = Number(waSub?.group_monthly_charge ?? 0) + Number(waSub?.group_overage_charge ?? 0);
    const whatsappParentCheckup = Number(waSub?.parent_monthly_charge ?? 0);
    const whatsappMonthlyTotal = whatsappIndividual + whatsappGroup + whatsappParentCheckup;

    return NextResponse.json({
      plan: center.plan || 'starter',
      billing_period: center.billing_period || 'quarterly',
      billing_amount: Number(center.billing_amount ?? 0),
      next_billing_date: center.next_billing_date,
      billing_cycle_start: center.billing_cycle_start,
      whatsapp_monthly_charges: {
        individual: whatsappIndividual,
        group: whatsappGroup,
        parent_checkup: whatsappParentCheckup,
        total: whatsappMonthlyTotal,
      },
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

    // Only owners can update billing period (not assistants or admins - spec says "only owners")
    if (ctx.user.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const validation = billingPeriodSchema.safeParse(body);
    if (!validation.success) {
      const msg = validation.error.issues[0]?.message || 'Invalid input';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { billing_period } = validation.data;

    const { error } = await ctx.supabaseAdmin
      .from('centers')
      .update({ billing_period })
      .eq('id', ctx.user.center_id);

    if (error) throw error;

    // Fetch updated values (trigger will have updated billing_amount and next_billing_date)
    const { data: updated } = await ctx.supabaseAdmin
      .from('centers')
      .select('billing_amount, next_billing_date')
      .eq('id', ctx.user.center_id)
      .single();

    return NextResponse.json({
      success: true,
      billing_amount: Number(updated?.billing_amount ?? 0),
      next_billing_date: updated?.next_billing_date,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
