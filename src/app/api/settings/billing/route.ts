import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MONTHLY_MULTIPLIER = 4.333;
const PAYG_TIERS = [
  { upTo: 200, rate: 6.0 },
  { upTo: 600, rate: 3.75 },
  { upTo: 1500, rate: 2.0 },
  { upTo: Infinity, rate: 1.25 },
];

function calculatePaygCost(studentsPerWeek: number) {
  let weeklyCost = 0;
  let remaining = studentsPerWeek;
  let prevLimit = 0;
  const tiers: { students: number; rate: number; subtotal: number }[] = [];

  for (const tier of PAYG_TIERS) {
    const studentsInTier = Math.min(remaining, tier.upTo - prevLimit);
    if (studentsInTier <= 0) break;
    const subtotal = studentsInTier * tier.rate;
    weeklyCost += subtotal;
    tiers.push({ students: studentsInTier, rate: tier.rate, subtotal });
    remaining -= studentsInTier;
    prevLimit = tier.upTo;
  }

  const monthly = Math.round(weeklyCost * MONTHLY_MULTIPLIER);
  const effectiveRate = studentsPerWeek > 0 ? Math.round((weeklyCost / studentsPerWeek) * 100) / 100 : 0;
  return { weekly: weeklyCost, monthly, effectiveRate, tiers };
}

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

function getMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: center, error: centerError } = await ctx.supabaseAdmin
      .from('centers')
      .select(`
        id, name, plan, pricing_type, weekly_student_limit, max_students,
        billing_type, pending_plan_change, pending_billing_type,
        current_period_start, current_period_end, last_payment_date
      `)
      .eq('id', ctx.user.center_id)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const billingType = (center as { billing_type?: string }).billing_type || center.pricing_type || 'fixed';
    const plan = center.plan || 'starter';

    const { data: plans, error: plansError } = await ctx.supabaseAdmin
      .from('pricing_plans')
      .select('*')
      .order('sort_order', { ascending: true });

    const { data: paygRates, error: paygError } = await ctx.supabaseAdmin
      .from('payg_rates')
      .select('*')
      .order('sort_order', { ascending: true });

    const { start: monthStart, end: monthEnd } = getMonthBounds();

    const { data: scans } = await ctx.supabaseAdmin
      .from('attendance_scans')
      .select('student_id')
      .eq('center_id', ctx.user.center_id)
      .gte('scanned_at', `${monthStart}T00:00:00`)
      .lte('scanned_at', `${monthEnd}T23:59:59`);

    const totalCheckins = scans?.length ?? 0;
    const uniqueStudents = new Set((scans || []).map((s: { student_id: string }) => s.student_id));
    const weeklyAverage = Math.round((uniqueStudents.size / MONTHLY_MULTIPLIER) * 100) / 100;
    const paygEstimate = calculatePaygCost(weeklyAverage);

    let invoices: unknown[] = [];
    const { data: invData, error: invErr } = await ctx.supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('center_id', ctx.user.center_id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!invErr && invData) invoices = invData;

    const currentPlanDetails = (plans || []).find((p: { id: string }) => p.id === plan);

    return NextResponse.json({
      plan,
      billing_type: billingType,
      pricing_type: billingType,
      weekly_student_limit: center.weekly_student_limit ?? center.max_students ?? 200,
      current_period_start: (center as { current_period_start?: string }).current_period_start,
      current_period_end: (center as { current_period_end?: string }).current_period_end,
      last_payment_date: (center as { last_payment_date?: string }).last_payment_date,
      pending_plan_change: (center as { pending_plan_change?: string }).pending_plan_change,
      pending_billing_type: (center as { pending_billing_type?: string }).pending_billing_type,
      center_name: (center as { name?: string }).name,
      plans: plans || [],
      payg_rates: paygRates || [],
      current_plan_details: currentPlanDetails,
      invoices: invoices || [],
      current_usage: {
        total_checkins: totalCheckins,
        unique_students: uniqueStudents.size,
        weekly_average: weeklyAverage,
        estimated_bill: paygEstimate.monthly,
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
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (ctx.user.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { action, new_plan, new_billing_type, reference } = body;

    if (action === 'request_change') {
      if (!new_plan && !new_billing_type) {
        return NextResponse.json({ error: 'new_plan or new_billing_type required' }, { status: 400 });
      }
      const updates: Record<string, unknown> = {};
      if (new_plan) updates.pending_plan_change = new_plan;
      if (new_billing_type) updates.pending_billing_type = new_billing_type;

      const { error } = await ctx.supabaseAdmin
        .from('centers')
        .update(updates)
        .eq('id', ctx.user.center_id);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === 'cancel_change') {
      const { error } = await ctx.supabaseAdmin
        .from('centers')
        .update({ pending_plan_change: null, pending_billing_type: null })
        .eq('id', ctx.user.center_id);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === 'submit_payment_proof') {
      const { amount, reference, proof_url } = body;
      if (!reference || !reference.trim()) {
        return NextResponse.json({ error: 'Reference is required' }, { status: 400 });
      }
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
      }

      const { data: pendingInvoice } = await ctx.supabaseAdmin
        .from('invoices')
        .select('id')
        .eq('center_id', ctx.user.center_id)
        .in('status', ['pending', 'overdue'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (pendingInvoice) {
        const { error: updateErr } = await ctx.supabaseAdmin
          .from('invoices')
          .update({
            payment_reference: String(reference).trim(),
            payment_amount: numAmount,
            payment_proof_url: proof_url || null,
          })
          .eq('id', (pendingInvoice as { id: string }).id);
        if (updateErr) throw updateErr;
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'submit_payment_reference' && reference) {
      const { data: pendingInvoice } = await ctx.supabaseAdmin
        .from('invoices')
        .select('id')
        .eq('center_id', ctx.user.center_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (pendingInvoice) {
        await ctx.supabaseAdmin
          .from('invoices')
          .update({ payment_reference: String(reference).trim() })
          .eq('id', (pendingInvoice as { id: string }).id);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
