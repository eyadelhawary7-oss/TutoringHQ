import { createServerClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminContext } from '@/lib/admin-auth';
import { customPermissionsToKeys, fetchAdminAccessFlags } from '@/lib/admin-access';
import { getAdminPermissions } from '@/lib/admin-roles';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { formatDate } from '@/lib/formatNumber';
import { createCommissionsForCenter, clawbackCommissions } from '@/lib/commissions';

const STRIP = [
  'action',
  'id',
  'created_at',
  'updated_at',
  'approved_at',
  'approved_by',
  'requested_at',
  'referral_code_used_at',
  'student_sequence',
  'referral_code',
] as const;

const VALID_INVOICE_TYPES = [
  'base_subscription',
  'subscription',
  'whatsapp_addon',
  'setup_fee',
  'payment_proof',
  'announcement_settlement',
  'announcement_cap',
  'plan_upgrade_difference',
  'pack_billing',
  'late_payment_fee',
  'reactivation_fee',
] as const;

const VALID_PLANS = ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const;

const PATCH_ACTIONS = new Set([
  'update_invoice',
  'create_invoice',
  'record_payment',
  'approve_plan_request',
  'reject_plan_request',
  'override_plan',
  'mark_commission_paid',
  'blacklist',
  'unblacklist',
  'approve_cancellation',
  'reject_cancellation',
]);

/** (b) Cookie session + getUser → admin_users.id; any failure → null */
async function resolveAdminUserIdViaCookieSession(supabaseAdmin: SupabaseClient): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return null;

    const { data: adminRow } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    return (adminRow?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const flags = await fetchAdminAccessFlags(ctx.supabaseAdmin, ctx.userId);
  const { data: au } = await ctx.supabaseAdmin
    .from('admin_users')
    .select('role, custom_permissions')
    .eq('id', ctx.userId)
    .maybeSingle();
  const effRole = flags.isSuperAdmin ? 'super_admin' : (au?.role ?? 'internal_viewer');
  const keys = customPermissionsToKeys(au?.custom_permissions);
  const perms = getAdminPermissions(effRole, keys);
  if (!flags.isSuperAdmin && !flags.canApproveSignups && !perms.includes('centers')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: centerId } = await params;
  const supabaseAdmin = ctx.supabaseAdmin;

  const { data: center, error: centerError } = await supabaseAdmin
    .from('centers')
    .select('*')
    .eq('id', centerId)
    .maybeSingle();

  if (centerError || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const [
    invoicesRes,
    renewalRes,
    planRequestsRes,
    referralsMadeRes,
    pricingPlansRes,
    adminUsersRes,
  ] = await Promise.all([
    supabaseAdmin.from('invoices').select('*').eq('center_id', centerId).order('created_at', { ascending: false }),
    supabaseAdmin
      .from('renewal_history')
      .select('*')
      .eq('center_id', centerId)
      .order('renewal_date', { ascending: false }),
    supabaseAdmin
      .from('plan_requests')
      .select('*')
      .eq('center_id', centerId)
      .order('requested_at', { ascending: false }),
    supabaseAdmin
      .from('centers')
      .select('id, name, plan, status, created_at')
      .eq('referred_by', centerId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('pricing_plans')
      .select('plan_key, arabic_name, english_name, monthly_fee, all_in_price, weekly_student_limit')
      .eq('is_active', true)
      .neq('plan_key', ['pro', '_plus'].join(''))
      .order('all_in_price', { ascending: true, nullsFirst: false }),
    supabaseAdmin.from('admin_users').select('id, name').order('name', { ascending: true }),
  ]);

  let referralCommissions: unknown[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('referral_commissions')
      .select('*')
      .eq('center_id', centerId);
    if (error) throw error;
    referralCommissions = data ?? [];
  } catch {
    referralCommissions = [];
  }

  let payoutRequests: unknown[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('payout_requests')
      .select('*')
      .eq('center_id', centerId);
    if (error) throw error;
    payoutRequests = data ?? [];
  } catch {
    payoutRequests = [];
  }

  return NextResponse.json({
    center,
    invoices: invoicesRes.data ?? [],
    renewalHistory: renewalRes.data ?? [],
    planRequests: planRequestsRes.data ?? [],
    referralsMade: referralsMadeRes.data ?? [],
    pricingPlans: pricingPlansRes.data ?? [],
    adminUsers: adminUsersRes.data ?? [],
    referralCommissions,
    payoutRequests,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseAdmin = ctx.supabaseAdmin;
  const { id: centerId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const rawAction = body.action;
  if (rawAction !== undefined && rawAction !== null && rawAction !== '') {
    if (typeof rawAction !== 'string' || !PATCH_ACTIONS.has(rawAction)) {
      return NextResponse.json({ error: `Unknown action: ${String(rawAction)}` }, { status: 400 });
    }
  }

  const action = typeof rawAction === 'string' ? rawAction : undefined;

  const flags = await fetchAdminAccessFlags(supabaseAdmin, ctx.userId);
  if (action === undefined || action === 'approve_plan_request') {
    if (!flags.isSuperAdmin && !flags.canApproveSignups) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (action === 'blacklist' || action === 'unblacklist') {
    if (!flags.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (!flags.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── action = 'update_invoice' ──
  if (action === 'update_invoice') {
    const invoiceId = body.invoiceId;
    if (typeof invoiceId !== 'string' || !invoiceId) {
      return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });
    }

    const upd: Record<string, unknown> = {};
    if (body.status !== undefined) upd.status = body.status;
    if (body.discountAmount !== undefined) upd.discount_amount = body.discountAmount;
    if (body.paymentMethod !== undefined) upd.payment_method = body.paymentMethod;
    if (body.paymentReference !== undefined) upd.payment_reference = body.paymentReference;
    if (body.paidAt !== undefined) upd.paid_at = body.paidAt;
    upd.updated_at = new Date().toISOString();
    if (body.status === 'paid' && body.paidAt === undefined) {
      upd.paid_at = new Date().toISOString();
    }

    const { data: updatedRow, error } = await supabaseAdmin
      .from('invoices')
      .update(upd)
      .eq('id', invoiceId)
      .eq('center_id', centerId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ invoice: updatedRow });
  }

  // ── action = 'create_invoice' ──
  if (action === 'create_invoice') {
    const invoiceType = body.invoiceType;
    const totalAmount = body.totalAmount;
    const billingPeriodStart = body.billingPeriodStart;
    const billingPeriodEnd = body.billingPeriodEnd;
    const dueDate = body.dueDate;

    if (typeof invoiceType !== 'string' || !VALID_INVOICE_TYPES.includes(invoiceType as (typeof VALID_INVOICE_TYPES)[number])) {
      return NextResponse.json({ error: 'Invalid invoiceType' }, { status: 400 });
    }
    if (isNaN(Number(totalAmount)) || Number(totalAmount) <= 0) {
      return NextResponse.json({ error: 'totalAmount must be > 0' }, { status: 400 });
    }
    if (typeof billingPeriodStart !== 'string' || !billingPeriodStart) {
      return NextResponse.json({ error: 'billingPeriodStart required' }, { status: 400 });
    }
    if (typeof billingPeriodEnd !== 'string' || !billingPeriodEnd) {
      return NextResponse.json({ error: 'billingPeriodEnd required' }, { status: 400 });
    }
    if (typeof dueDate !== 'string' || !dueDate) {
      return NextResponse.json({ error: 'dueDate required' }, { status: 400 });
    }

    const { data: codeRow } = await supabaseAdmin
      .from('centers')
      .select('center_code')
      .eq('id', centerId)
      .maybeSingle();
    const code = (codeRow as { center_code?: string } | null)?.center_code ?? 'XXX';
    const yearMonth = billingPeriodStart.slice(0, 7);

    let invoiceNumber: string;
    if (invoiceType === 'pack_billing') {
      invoiceNumber = `PACK-${code}-${yearMonth}`;
    } else if (invoiceType === 'plan_upgrade_difference') {
      invoiceNumber = `UPG-${code}-${yearMonth}`;
    } else {
      invoiceNumber = `INV-${code}-${yearMonth}`;
    }

    const insertRow: Record<string, unknown> = {
      center_id: centerId,
      invoice_number: invoiceNumber,
      invoice_type: invoiceType,
      total_amount: Number(totalAmount),
      base_amount: Number(totalAmount),
      billing_period_start: billingPeriodStart,
      billing_period_end: billingPeriodEnd,
      due_date: dueDate,
      status: 'pending',
      discount_amount: 0,
    };

    const { data: newRow, error } = await supabaseAdmin.from('invoices').insert(insertRow).select().single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ invoice: newRow });
  }

  // ── action = 'record_payment' ──
  if (action === 'record_payment') {
    const renewalDate = body.renewalDate;
    const amountPaid = body.amountPaid;

    if (typeof renewalDate !== 'string' || !renewalDate) {
      return NextResponse.json({ error: 'renewalDate required' }, { status: 400 });
    }
    if (isNaN(Number(amountPaid)) || Number(amountPaid) <= 0) {
      return NextResponse.json({ error: 'amountPaid must be > 0' }, { status: 400 });
    }

    let adminUserId: string | null = null;
    const { data: adminByBearer } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('id', ctx.userId)
      .maybeSingle();
    if (adminByBearer?.id) {
      adminUserId = adminByBearer.id as string;
    } else {
      adminUserId = await resolveAdminUserIdViaCookieSession(supabaseAdmin);
    }

    const { data: newRow, error } = await supabaseAdmin
      .from('renewal_history')
      .insert({
        center_id: centerId,
        renewal_date: renewalDate,
        amount_paid: Number(amountPaid),
        payment_method: body.paymentMethod ?? null,
        recorded_by: adminUserId ?? null,
        notes: body.notes ?? null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ renewal: newRow });
  }

  // ── action = 'approve_plan_request' ──
  if (action === 'approve_plan_request') {
    const planRequestId = body.planRequestId;
    const newPlan = body.newPlan;
    const newBillingAmount = body.newBillingAmount;
    const newAllInPrice = body.newAllInPrice;

    if (typeof newPlan !== 'string' || !VALID_PLANS.includes(newPlan as (typeof VALID_PLANS)[number])) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    if (isNaN(Number(newBillingAmount)) || Number(newBillingAmount) < 0) {
      return NextResponse.json({ error: 'Invalid billing amount' }, { status: 400 });
    }
    if (isNaN(Number(newAllInPrice)) || Number(newAllInPrice) < 0) {
      return NextResponse.json({ error: 'Invalid all-in price' }, { status: 400 });
    }
    if (typeof planRequestId !== 'string' || !planRequestId) {
      return NextResponse.json({ error: 'planRequestId required' }, { status: 400 });
    }

    const { error: step1Error } = await supabaseAdmin
      .from('plan_requests')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', planRequestId)
      .eq('center_id', centerId);

    if (step1Error) {
      return NextResponse.json({ error: step1Error.message }, { status: 500 });
    }

    const { error: step2Error } = await supabaseAdmin
      .from('centers')
      .update({
        plan: newPlan,
        billing_amount: Number(newBillingAmount),
        all_in_price: Number(newAllInPrice),
      })
      .eq('id', centerId);

    if (step2Error) {
      await supabaseAdmin
        .from('plan_requests')
        .update({ status: 'pending', approved_at: null })
        .eq('id', planRequestId)
        .eq('center_id', centerId);
      return NextResponse.json(
        { error: 'Failed to update center plan — plan request rolled back' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  }

  // ── action = 'reject_plan_request' ──
  if (action === 'reject_plan_request') {
    const planRequestId = body.planRequestId;
    const notes = typeof body.notes === 'string' ? body.notes : '';
    if (!notes.trim()) {
      return NextResponse.json({ error: 'notes required' }, { status: 400 });
    }
    if (typeof planRequestId !== 'string' || !planRequestId) {
      return NextResponse.json({ error: 'planRequestId required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('plan_requests')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        notes: notes.trim(),
      })
      .eq('id', planRequestId)
      .eq('center_id', centerId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // ── action = 'override_plan' ──
  if (action === 'override_plan') {
    const newPlan = body.newPlan;
    const newBillingAmount = body.newBillingAmount;
    const newAllInPrice = body.newAllInPrice;

    if (typeof newPlan !== 'string' || !VALID_PLANS.includes(newPlan as (typeof VALID_PLANS)[number])) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    if (isNaN(Number(newBillingAmount)) || Number(newBillingAmount) < 0) {
      return NextResponse.json({ error: 'Invalid billing amount' }, { status: 400 });
    }
    if (isNaN(Number(newAllInPrice)) || Number(newAllInPrice) < 0) {
      return NextResponse.json({ error: 'Invalid all-in price' }, { status: 400 });
    }

    const { data: updatedRow, error } = await supabaseAdmin
      .from('centers')
      .update({
        plan: newPlan,
        billing_amount: Number(newBillingAmount),
        all_in_price: Number(newAllInPrice),
      })
      .eq('id', centerId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ center: updatedRow });
  }

  // ── action = 'mark_commission_paid' ──
  if (action === 'mark_commission_paid') {
    const commissionId = body.commissionId;
    if (typeof commissionId !== 'string' || !commissionId) {
      return NextResponse.json({ error: 'commissionId required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('referral_commissions').update({ status: 'paid' }).eq('id', commissionId);

    if (error) {
      const msg = error.message;
      if (msg.includes('does not exist') || msg.includes('relation')) {
        return NextResponse.json({ error: 'referral_commissions table not found' }, { status: 404 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // ── action = 'blacklist' ──
  if (action === 'blacklist') {
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (reason.trim().length < 10) {
      return NextResponse.json({ error: 'Reason must be at least 10 characters' }, { status: 400 });
    }

    const { data: updatedRow, error } = await supabaseAdmin
      .from('centers')
      .update({
        is_blacklisted: true,
        blacklisted_at: new Date().toISOString(),
        blacklist_reason: reason.trim(),
        status: 'suspended',
        subscription_status: 'suspended',
        billing_status: 'suspended',
      })
      .eq('id', centerId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await clawbackCommissions(
      centerId,
      ctx.userId,
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Blacklisted by admin',
    );
    return NextResponse.json({ center: updatedRow });
  }

  // ── action = 'unblacklist' ──
  if (action === 'unblacklist') {
    const { data: updatedRow, error } = await supabaseAdmin
      .from('centers')
      .update({
        is_blacklisted: false,
        blacklisted_at: null,
        blacklist_reason: null,
      })
      .eq('id', centerId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ center: updatedRow });
  }

  // ── action = 'approve_cancellation' ──
  if (action === 'approve_cancellation') {
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('centers')
      .select('id, status, phone, name, current_period_end, next_payment_due')
      .eq('id', centerId)
      .maybeSingle();

    if (fetchErr || !row) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }
    const st = String((row as { status?: string }).status ?? '');
    if (st !== 'pending_cancellation') {
      return NextResponse.json({ error: 'Center is not pending cancellation' }, { status: 400 });
    }

    const { data: updatedRow, error } = await supabaseAdmin
      .from('centers')
      .update({
        status: 'cancelled',
        subscription_status: 'cancelled',
        cancellation_approved_at: new Date().toISOString(),
      })
      .eq('id', centerId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const r = row as {
      phone?: string | null;
      current_period_end?: string | null;
      next_payment_due?: string | null;
    };
    const peRaw =
      (r.current_period_end && String(r.current_period_end).slice(0, 10)) ||
      (r.next_payment_due && String(r.next_payment_due).slice(0, 10)) ||
      null;
    const peLabel = peRaw
      ? (() => {
          const d = new Date(`${peRaw}T12:00:00`);
          return Number.isNaN(d.getTime()) ? peRaw : formatDate(d, 'ar');
        })()
      : '—';
    const phone = String(r.phone ?? '').trim();
    if (phone) {
      try {
        await sendFreeformMessage(
          centerId,
          phone,
          `تم قبول طلب إلغاء اشتراكك. يمكنك استخدام المنصة حتى ${peLabel}.`,
        );
      } catch (e) {
        console.error('[admin/centers] approve_cancellation WA:', e);
      }
    }

    return NextResponse.json({ success: true, center: updatedRow });
  }

  // ── action = 'reject_cancellation' ──
  if (action === 'reject_cancellation') {
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('centers')
      .select('id, status, phone')
      .eq('id', centerId)
      .maybeSingle();

    if (fetchErr || !row) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }
    const st = String((row as { status?: string }).status ?? '');
    if (st !== 'pending_cancellation') {
      return NextResponse.json({ error: 'Center is not pending cancellation' }, { status: 400 });
    }

    const { data: updatedRow, error } = await supabaseAdmin
      .from('centers')
      .update({
        status: 'active',
        cancellation_reason: null,
        cancellation_requested_at: null,
        cancellation_approved_at: null,
      })
      .eq('id', centerId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const phone = String((row as { phone?: string | null }).phone ?? '').trim();
    if (phone) {
      try {
        await sendFreeformMessage(
          centerId,
          phone,
          'تم رفض طلب إلغاء اشتراكك. سيستمر اشتراكك كالمعتاد.',
        );
      } catch (e) {
        console.error('[admin/centers] reject_cancellation WA:', e);
      }
    }

    return NextResponse.json({ success: true, center: updatedRow });
  }

  // ── DEFAULT (no action) ──
  const cleanBody = { ...body } as Record<string, unknown>;
  for (const k of STRIP) {
    delete cleanBody[k];
  }

  const { data: updatedRow, error } = await supabaseAdmin
    .from('centers')
    .update(cleanBody)
    .eq('id', centerId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const activated = (updatedRow as { status?: string | null }).status === 'active';
  if (activated) {
    await createCommissionsForCenter(centerId);
  }
  return NextResponse.json({ center: updatedRow });
}
