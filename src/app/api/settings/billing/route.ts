// Force rebuild: 2026-02-15
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MONTHLY_MULTIPLIER = 4.333;

/** Flat rate per bracket: entire student count uses the rate of the bracket it falls into. 5 brackets matching fixed plans. */
function getBracketRate(students: number): number {
  if (students <= 200) return 6;
  if (students <= 600) return 3.75;
  if (students <= 1000) return 2.5;
  if (students <= 1500) return 2;
  return 1.25;
}

function calculatePaygCost(studentsPerWeek: number) {
  const rate = getBracketRate(studentsPerWeek);
  const weeklyCost = studentsPerWeek * rate;
  const monthly = Math.round(weeklyCost * MONTHLY_MULTIPLIER);
  const effectiveRate = rate;
  const tiers = studentsPerWeek > 0 ? [{ students: studentsPerWeek, rate, subtotal: weeklyCost }] : [];
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

  console.log('getUserContext debug:', { authUserId: user.id, userRecord });
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
  console.log('Billing GET handler called');
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: center, error: centerError } = await ctx.supabaseAdmin
      .from('centers')
      .select(`
        id, name, plan, pricing_type, weekly_student_limit,
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

    let plans: unknown[] = [];
    try {
      const { data: plansData } = await ctx.supabaseAdmin.from('pricing_plans').select('*').order('sort_order', { ascending: true });
      if (plansData) plans = plansData;
    } catch (e) { console.log('pricing_plans query failed, using empty'); }

    let paygRates: unknown[] = [];
    try {
      const { data: paygData } = await ctx.supabaseAdmin.from('payg_rates').select('*').order('sort_order', { ascending: true });
      if (paygData) paygRates = paygData;
    } catch (e) { console.log('payg_rates query failed, using empty'); }

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
    try {
      const { data: invData } = await ctx.supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('center_id', ctx.user.center_id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (invData) invoices = invData;
    } catch (e) { console.log('invoices query failed, using empty'); }
    console.log('Billing GET invoices:', invoices?.length ?? 0);

    const currentPlanDetails = (plans || []).find((p) => (p as { id: string }).id === plan);

    return NextResponse.json({
      plan,
      billing_type: billingType,
      pricing_type: billingType,
      weekly_student_limit: center.weekly_student_limit ?? 200,
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

      const today = new Date().toISOString().split('T')[0];
      const invoiceNumber = `PAYPROOF-${today}-${Date.now().toString(36)}`;

      const insertPayload = {
        center_id: ctx.user.center_id,
        invoice_type: 'payment_proof',
        payment_amount: numAmount,
        total_amount: numAmount,
        base_amount: numAmount,
        payment_method: 'instapay',
        payment_reference: String(reference).trim(),
        payment_proof_url: proof_url || null,
        status: 'pending',
        billing_period_start: today,
        billing_period_end: today,
        due_date: today,
        invoice_number: invoiceNumber,
      };

      const { data: insertData, error: insertErr } = await ctx.supabaseAdmin
        .from('invoices')
        .insert(insertPayload)
        .select('id');

      if (insertErr) {
        console.error('Invoice insert error:', insertErr);
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
      console.log('Invoice insert result:', { data: insertData, error: null });
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

/** POST handler for submitting payment proof (alternative to PUT) */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (ctx.user.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const amount = Number(body.amount);
    const reference = body.reference?.trim();
    const proofUrl = body.proofUrl ?? body.proof_url;
    const paymentMethod = body.paymentMethod ?? 'instapay';

    if (!reference) {
      return NextResponse.json({ error: 'Reference is required' }, { status: 400 });
    }
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    const today = new Date().toISOString().split('T')[0];
    const invoiceNumber = `PAYPROOF-${today}-${Date.now().toString(36)}`;

    const insertPayload = {
      center_id: ctx.user.center_id,
      invoice_type: 'payment_proof',
      payment_amount: amount,
      total_amount: amount,
      base_amount: amount,
      payment_method: paymentMethod,
      payment_reference: reference,
      payment_proof_url: proofUrl || null,
      status: 'pending',
      billing_period_start: today,
      billing_period_end: today,
      due_date: today,
      invoice_number: invoiceNumber,
    };

    const { error: insertErr } = await ctx.supabaseAdmin
      .from('invoices')
      .insert(insertPayload)
      .select('id');

    if (insertErr) {
      console.error('Billing POST invoice insert error:', insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}



