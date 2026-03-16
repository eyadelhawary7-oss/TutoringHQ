// Force rebuild: 2026-02-15
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateCSRFRequest } from '@/lib/csrf';

const MONTHLY_MULTIPLIER = 4.333;

/** Flat rate per bracket: entire student count uses the rate of the bracket it falls into. 5 brackets matching fixed plans. */
function getBracketRate(students: number): number {
  if (students <= 150) return 4;
  if (students <= 500) return 3;
  if (students <= 1000) return 2.5;
  if (students <= 2000) return 2;
  return 1.75;
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
        id, name, plan, pricing_type, weekly_student_limit,
        billing_type, pending_plan_change, pending_billing_type,
        current_period_start, current_period_end, last_payment_date,
        is_early_adopter, early_adopter_price
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
    } catch { /* pricing_plans query failed, using empty */ }

    let paygRates: unknown[] = [];
    try {
      const { data: paygData } = await ctx.supabaseAdmin.from('payg_rates').select('*').order('sort_order', { ascending: true });
      if (paygData) paygRates = paygData;
    } catch { /* payg_rates query failed, using empty */ }

    const { start: monthStart, end: monthEnd } = getMonthBounds();

    const { data: scans } = await ctx.supabaseAdmin
      .from('attendance_scans')
      .select('student_id, scanned_at')
      .eq('center_id', ctx.user.center_id)
      .gte('scanned_at', `${monthStart}T00:00:00`)
      .lte('scanned_at', `${monthEnd}T23:59:59`);

    const totalCheckins = scans?.length ?? 0;
    const uniqueStudents = new Set((scans || []).map((s: { student_id: string }) => s.student_id));
    const weeklyAverage = Math.round((uniqueStudents.size / MONTHLY_MULTIPLIER) * 100) / 100;
    const paygEstimate = calculatePaygCost(weeklyAverage);

    // This week's unique students (for PAYG centers)
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = now.toISOString().slice(0, 10);
    const { data: thisWeekScans } = await ctx.supabaseAdmin
      .from('attendance_scans')
      .select('student_id')
      .eq('center_id', ctx.user.center_id)
      .gte('scanned_at', `${weekStartStr}T00:00:00`)
      .lte('scanned_at', `${weekEndStr}T23:59:59`);
    const thisWeekUnique = new Set((thisWeekScans || []).map((s: { student_id: string }) => s.student_id)).size;
    const thisWeekPayg = calculatePaygCost(thisWeekUnique);

    // Last 4 weeks PAYG charges from payg_weekly_charges
    let paygWeeklyCharges: { week_start_date: string; week_end_date: string; student_count: number; total_charge: number; paid: boolean }[] = [];
    try {
      const fourWeeksAgo = new Date(now);
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const { data: charges } = await ctx.supabaseAdmin
        .from('payg_weekly_charges')
        .select('week_start_date, week_end_date, student_count, total_charge, paid')
        .eq('center_id', ctx.user.center_id)
        .gte('week_start_date', fourWeeksAgo.toISOString().slice(0, 10))
        .order('week_start_date', { ascending: false })
        .limit(4);
      paygWeeklyCharges = (charges || []) as typeof paygWeeklyCharges;
    } catch {
      // table may not exist
    }

    const fixedPlanComparison = { plan: '', price: 0, savings: 0 };
    if (thisWeekPayg.monthly > 0) {
      const FIXED: Record<string, number> = { nascent: 1200, nano: 1200, starter: 2000, pro: 4500, business: 6500, enterprise: 9000 };
      for (const [p, price] of Object.entries(FIXED)) {
        if (price < thisWeekPayg.monthly) {
          fixedPlanComparison.plan = p;
          fixedPlanComparison.price = price;
          fixedPlanComparison.savings = thisWeekPayg.monthly - price;
          break;
        }
      }
    }

    let invoices: unknown[] = [];
    try {
      const { data: invData } = await ctx.supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('center_id', ctx.user.center_id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (invData) invoices = invData;
    } catch { /* invoices query failed, using empty */ }

    const currentPlanDetails = (plans || []).find((p) => (p as { id: string }).id === plan);

    const isEarlyAdopter = !!(center as { is_early_adopter?: boolean }).is_early_adopter;
    const earlyAdopterPrice = (center as { early_adopter_price?: number }).early_adopter_price;

    return NextResponse.json({
      plan,
      billing_type: billingType,
      pricing_type: billingType,
      is_early_adopter: isEarlyAdopter,
      early_adopter_price: earlyAdopterPrice,
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
      payg_this_week: {
        students_scanned: thisWeekUnique,
        weekly_cost: thisWeekPayg.weekly,
        monthly_estimate: thisWeekPayg.monthly,
        rate_per_student: thisWeekPayg.effectiveRate,
      },
      payg_weekly_charges: paygWeeklyCharges,
      payg_fixed_plan_savings: fixedPlanComparison,
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
    if (!validateCSRFRequest(request, ctx.user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = (await import('@/lib/validations')).settingsBillingPutSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { action, new_plan, new_billing_type, reference, amount, proof_url } = parsed.data;

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
      if (!reference || !reference.trim()) {
        return NextResponse.json({ error: 'Reference is required' }, { status: 400 });
      }
      const numAmount = amount != null ? Number(amount) : NaN;
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
        payment_reference: String(reference!).trim(),
        payment_proof_url: (proof_url && proof_url !== '') ? proof_url : null,
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
    if (!validateCSRFRequest(request, ctx.user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = (await import('@/lib/validations')).settingsBillingPostSchema.safeParse({
      amount: body.amount,
      reference: body.reference,
      proofUrl: body.proofUrl ?? body.proof_url,
      proof_url: body.proof_url,
      paymentMethod: body.paymentMethod,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { amount, reference, proofUrl, proof_url, paymentMethod } = parsed.data;
    const proofUrlResolved = proofUrl ?? proof_url;

    const today = new Date().toISOString().split('T')[0];
    const invoiceNumber = `PAYPROOF-${today}-${Date.now().toString(36)}`;

    const insertPayload = {
      center_id: ctx.user.center_id,
      invoice_type: 'payment_proof',
      payment_amount: amount,
      total_amount: amount,
      base_amount: amount,
      payment_method: paymentMethod ?? 'instapay',
      payment_reference: reference,
      payment_proof_url: proofUrlResolved || null,
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



