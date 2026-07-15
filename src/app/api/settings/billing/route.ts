// Force rebuild: 2026-02-15
import { NextRequest, NextResponse } from 'next/server';
import { validateCSRFRequest } from '@/lib/csrf';
import { requireCenterAuth } from '@/lib/centerAuth';
import { requirePermission } from '@/lib/centerPermissions';
import { normalizeBillingPeriod } from '@/lib/pricing';
import { getAnnouncementCap } from '@/lib/parentPack';
import { buildInvoiceTaxSnapshot } from '@/lib/processingFee';
import { parseBodyWithLimit } from '@/lib/validate';

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
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    // Permission gate added May 12 per docs/AUDIT_center_role_gating.md
    const permErr = requirePermission(auth, 'can_manage_billing');
    if (permErr) return permErr;

    const { data: center, error: centerError } = await auth.supabaseAdmin
      .from('centers')
      .select(`
        id, name, plan, pricing_type, weekly_student_limit,
        billing_type, billing_period, all_in_price,
        pending_plan_change, pending_billing_type,
        current_period_start, current_period_end, last_payment_date,
        is_early_adopter, early_adopter_price,
        parent_pack_active_parents, announcement_balance,
        next_payment_due, billing_status, billing_amount
      `)
      .eq('id', auth.centerId)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const billingType = (center as { billing_type?: string }).billing_type || center.pricing_type || 'fixed';
    const plan = center.plan || 'starter';

    let plans: unknown[] = [];
    try {
      const { data: plansData } = await auth.supabaseAdmin.from('pricing_plans').select('*').order('sort_order', { ascending: true });
      if (plansData) {
        const hiddenPlanKey = ['pro', '_plus'].join('');
        plans = plansData.filter((p: { id?: string; plan_key?: string }) => {
          const key = (p.plan_key ?? p.id) as string | undefined;
          return key !== hiddenPlanKey;
        });
      }
    } catch { /* pricing_plans query failed, using empty */ }

    const { start: monthStart, end: monthEnd } = getMonthBounds();

    const { data: scans } = await auth.supabaseAdmin
      .from('attendance_scans')
      .select('student_id, scanned_at')
      .eq('center_id', auth.centerId)
      .gte('scanned_at', `${monthStart}T00:00:00`)
      .lte('scanned_at', `${monthEnd}T23:59:59`);

    const totalCheckins = scans?.length ?? 0;
    const uniqueStudents = new Set((scans || []).map((s: { student_id: string }) => s.student_id));

    let invoices: unknown[] = [];
    try {
      const { data: invData } = await auth.supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('center_id', auth.centerId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (invData) invoices = invData;
    } catch { /* invoices query failed, using empty */ }

    let recentAnnouncementBlasts: {
      id: string;
      blast_type: string;
      parents_notified: number;
      total_amount: string | number;
      created_at: string;
    }[] = [];
    try {
      const { data: blasts } = await auth.supabaseAdmin
        .from('announcement_blasts')
        .select('id, blast_type, parents_notified, total_amount, created_at')
        .eq('center_id', auth.centerId)
        .order('created_at', { ascending: false })
        .limit(3);
      if (blasts) recentAnnouncementBlasts = blasts as typeof recentAnnouncementBlasts;
    } catch {
      /* table or RLS */
    }

    const currentPlanDetails = (plans || []).find((p) => (p as { id: string }).id === plan);

    const isEarlyAdopter = !!(center as { is_early_adopter?: boolean }).is_early_adopter;
    const earlyAdopterPrice = (center as { early_adopter_price?: number }).early_adopter_price;

    const billing_period = normalizeBillingPeriod((center as { billing_period?: string | null }).billing_period);
    const all_in_price =
      (center as { all_in_price?: number | string | null }).all_in_price != null
        ? Number((center as { all_in_price?: number | string | null }).all_in_price)
        : null;

    const parentPackActiveParents = Number(
      (center as { parent_pack_active_parents?: number | null }).parent_pack_active_parents ?? 0,
    );
    const announcementBalanceNum = Number(
      (center as { announcement_balance?: string | number | null }).announcement_balance ?? 0,
    );
    const announcementCap = getAnnouncementCap(plan);

    return NextResponse.json({
      plan,
      billing_type: billingType,
      pricing_type: billingType,
      billing_period,
      all_in_price,
      is_early_adopter: isEarlyAdopter,
      early_adopter_price: earlyAdopterPrice,
      weekly_student_limit: center.weekly_student_limit ?? 200,
      current_period_start: (center as { current_period_start?: string }).current_period_start,
      current_period_end: (center as { current_period_end?: string }).current_period_end,
      last_payment_date: (center as { last_payment_date?: string }).last_payment_date,
      next_payment_due: (center as { next_payment_due?: string | null }).next_payment_due ?? null,
      billing_status: (center as { billing_status?: string | null }).billing_status ?? null,
      billing_amount:
        (center as { billing_amount?: number | string | null }).billing_amount != null
          ? Number((center as { billing_amount?: number | string | null }).billing_amount)
          : null,
      pending_plan_change: (center as { pending_plan_change?: string }).pending_plan_change,
      pending_billing_type: (center as { pending_billing_type?: string }).pending_billing_type,
      center_name: (center as { name?: string }).name,
      plans: plans || [],
      current_plan_details: currentPlanDetails,
      invoices: invoices || [],
      current_usage: {
        total_checkins: totalCheckins,
        unique_students: uniqueStudents.size,
      },
      parent_pack_active_parents: parentPackActiveParents,
      announcement_balance: announcementBalanceNum,
      announcement_cap: announcementCap,
      recent_announcement_blasts: recentAnnouncementBlasts,
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
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!validateCSRFRequest(request, auth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = (await import('@/lib/validations')).settingsBillingPutSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { action, new_plan, new_billing_type, reference, amount } = parsed.data;

    if (action === 'request_change') {
      if (!new_plan && !new_billing_type) {
        return NextResponse.json({ error: 'new_plan or new_billing_type required' }, { status: 400 });
      }
      const updates: Record<string, unknown> = {};
      if (new_plan) updates.pending_plan_change = new_plan;
      if (new_billing_type) updates.pending_billing_type = new_billing_type;

      const { error } = await auth.supabaseAdmin
        .from('centers')
        .update(updates)
        .eq('id', auth.centerId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === 'cancel_change') {
      const { error } = await auth.supabaseAdmin
        .from('centers')
        .update({ pending_plan_change: null, pending_billing_type: null })
        .eq('id', auth.centerId);

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
        center_id: auth.centerId,
        invoice_type: 'payment_proof',
        payment_amount: numAmount,
        total_amount: numAmount,
        base_amount: numAmount,
        ...buildInvoiceTaxSnapshot({ total: numAmount, fee: 0 }),
        payment_method: 'instapay',
        payment_reference: String(reference!).trim(),
        status: 'pending',
        billing_period_start: today,
        billing_period_end: today,
        due_date: today,
        invoice_number: invoiceNumber,
      };

      const { data: insertData, error: insertErr } = await auth.supabaseAdmin
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
      const { data: pendingInvoice } = await auth.supabaseAdmin
        .from('invoices')
        .select('id')
        .eq('center_id', auth.centerId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (pendingInvoice) {
        await auth.supabaseAdmin
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
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!validateCSRFRequest(request, auth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = (await import('@/lib/validations')).settingsBillingPostSchema.safeParse({
      amount: body.amount,
      reference: body.reference,
      paymentMethod: body.paymentMethod,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { amount, reference, paymentMethod } = parsed.data;

    const today = new Date().toISOString().split('T')[0];
    const invoiceNumber = `PAYPROOF-${today}-${Date.now().toString(36)}`;

    const insertPayload = {
      center_id: auth.centerId,
      invoice_type: 'payment_proof',
      payment_amount: amount,
      total_amount: amount,
      base_amount: amount,
      ...buildInvoiceTaxSnapshot({ total: amount, fee: 0 }),
      payment_method: paymentMethod ?? 'instapay',
      payment_reference: reference,
      status: 'pending',
      billing_period_start: today,
      billing_period_end: today,
      due_date: today,
      invoice_number: invoiceNumber,
    };

    const { error: insertErr } = await auth.supabaseAdmin
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



