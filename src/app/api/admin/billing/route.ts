import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { derivePaymentProofColumns } from '@/lib/paymentProofDisplay';
import { adminBillingRecordSchema, adminBillingInvoiceSchema } from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import {
  verifyPasswordForSensitiveAction,
  SENSITIVE_PAYMENT_THRESHOLD,
} from '@/lib/verify-password';
import {
  getChargeFromQuarterlyAllIn,
  getImpliedMonthlyMrr,
  getQuarterlyAllInMonthlyRateFromCenter,
  normalizeBillingPeriod,
  planKeyOrStarter,
  type PlanKey,
} from '@/lib/pricing';
import { parseBodyWithLimit } from '@/lib/validate';
import { parseIncludeTestCenters } from '@/lib/adminIncludeTest';
import { computeSubscriptionTotalMrrRounded } from '@/lib/adminSubscriptionMrr';

function adminCycleAmount(periodRaw: string, baseQ: number, plan: string): number {
  const p = normalizeBillingPeriod(periodRaw);
  const pk = planKeyOrStarter(plan);
  if (periodRaw === 'semi_annual' || periodRaw === 'half_yearly') {
    return Math.round(baseQ * 6);
  }
  return getChargeFromQuarterlyAllIn(baseQ, p, pk);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { supabaseAdmin } = ctx;

    const planFilter = new URL(request.url).searchParams.get('plan') || '';
    const includeTest = parseIncludeTestCenters(request);

    let centersQuery = supabaseAdmin
      .from('centers')
      .select('id, name, plan, phone, billing_period, all_in_price, next_payment_due, billing_status, status, payment_due_date, auto_suspend_at, is_early_adopter, early_adopter_price, billing_type, is_test')
      .neq('status', 'deleted');
    if (!includeTest) {
      centersQuery = centersQuery.eq('is_test', false);
    }
    const { data: centers, error: centersError } = await centersQuery;

    if (centersError) {
      return NextResponse.json({ error: centersError.message }, { status: 500 });
    }

    const centerIds = (centers || []).map((c: { id: string }) => c.id);

    const { data: referralCredits } = centerIds.length > 0
      ? await supabaseAdmin.from('referral_rewards').select('referring_center_id, reward_amount, reward_status').in('referring_center_id', centerIds)
      : { data: [] };
    const creditsByCenter: Record<string, number> = {};
    (referralCredits || []).forEach((r: { referring_center_id: string; reward_amount: number; reward_status: string }) => {
      if (r.reward_status === 'approved' || r.reward_status === 'paid' || r.reward_status === 'pending') {
        creditsByCenter[r.referring_center_id] = (creditsByCenter[r.referring_center_id] ?? 0) + Number(r.reward_amount);
      }
    });
    let billingRows = centers || [];
    let paygMRR = 0;
    const mrrByPlan: Record<string, number> = {};

    for (const row of billingRows) {
      const bp = (row as { billing_period?: string }).billing_period || 'quarterly';
      const nextDue = (row as { next_payment_due?: string }).next_payment_due;
      const billingType = (row as { billing_type?: string }).billing_type || 'fixed';

      if (billingType === 'payg') {
        (row as Record<string, unknown>).amount = 0;
        (row as Record<string, unknown>).monthlyEquivalent = 0;
      } else {
        const baseQ = getQuarterlyAllInMonthlyRateFromCenter(
          row as Parameters<typeof getQuarterlyAllInMonthlyRateFromCenter>[0],
        );
        const planStr = (row as { plan?: string }).plan || 'starter';
        const amount = adminCycleAmount(bp, baseQ, planStr);
        (row as Record<string, unknown>).amount = amount;
        const monthlyEquiv = getImpliedMonthlyMrr({
          plan: (row as { plan?: string }).plan,
          all_in_price: (row as { all_in_price?: number | null }).all_in_price,
          billing_period: bp,
          status: (row as { status?: string }).status,
          billing_type: billingType,
          is_early_adopter: (row as { is_early_adopter?: boolean }).is_early_adopter,
          early_adopter_price: (row as { early_adopter_price?: number | null }).early_adopter_price,
          id: (row as { id: string }).id,
          is_test: (row as { is_test?: boolean | null }).is_test,
        });
        (row as Record<string, unknown>).monthlyEquivalent = Math.round(monthlyEquiv);
        const planKey = (row.plan as string) || 'starter';
        mrrByPlan[planKey] = (mrrByPlan[planKey] ?? 0) + monthlyEquiv;
      }
      const canon = normalizeBillingPeriod(bp);
      const discount =
        bp === 'semi_annual' || bp === 'half_yearly'
          ? 5
          : canon === 'annual' || bp === 'yearly'
            ? 15
            : canon === 'monthly'
              ? -15
              : 0;
      (row as Record<string, unknown>).discount = discount;
      (row as Record<string, unknown>).nextDue = nextDue;
      (row as Record<string, unknown>).referralCredits = creditsByCenter[(row as { id: string }).id] ?? 0;
      const dueDate = (row as { payment_due_date?: string }).payment_due_date || nextDue;
      const suspendAt = (row as { auto_suspend_at?: string }).auto_suspend_at;
      if (dueDate) {
        const due = new Date(dueDate);
        const daysUntil = Math.ceil((due.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        (row as Record<string, unknown>).daysUntilDue = daysUntil;
      }
      (row as Record<string, unknown>).autoSuspendAt = suspendAt;
    }

    // PAYG centers: get recent weekly charges for MRR estimate
    const paygCenterIds = billingRows
      .filter((r: { billing_type?: string }) => (r.billing_type || 'fixed') === 'payg')
      .map((r: { id: string }) => r.id);
    if (paygCenterIds.length > 0) {
      const fourWeeksAgo = new Date();
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const { data: paygCharges } = await supabaseAdmin
        .from('payg_weekly_charges')
        .select('center_id, total_charge')
        .in('center_id', paygCenterIds)
        .gte('week_start_date', fourWeeksAgo.toISOString().slice(0, 10));
      const paygByCenter: Record<string, number[]> = {};
      (paygCharges || []).forEach((c: { center_id: string; total_charge: number }) => {
        if (!paygByCenter[c.center_id]) paygByCenter[c.center_id] = [];
        paygByCenter[c.center_id].push(Number(c.total_charge));
      });
      const MONTHLY_WEEKS = 4.333;
      Object.entries(paygByCenter).forEach(([cid, charges]) => {
        const avgWeekly = charges.length > 0 ? charges.reduce((a, b) => a + b, 0) / charges.length : 0;
        const mrr = avgWeekly * MONTHLY_WEEKS;
        paygMRR += mrr;
        mrrByPlan['payg'] = (mrrByPlan['payg'] ?? 0) + mrr;
        const row = billingRows.find((r: { id: string }) => r.id === cid) as Record<string, unknown> | undefined;
        if (row) {
          row.monthlyEquivalent = Math.round(mrr);
          row.paygWeeklyAvg = avgWeekly;
        }
      });
    }

    if (planFilter) {
      billingRows = billingRows.filter((r: { plan?: string; billing_type?: string }) => {
        if (planFilter === 'payg') return (r.billing_type || 'fixed') === 'payg';
        return (r.plan || 'starter') === planFilter;
      });
    }

    const { data: payments, error: payError } = await supabaseAdmin
      .from('admin_payments')
      .select(`
        id, center_id, amount, billing_period, period_start, period_end, paid_at, notes,
        recorded_by
      `)
      .order('paid_at', { ascending: false })
      .limit(100);

    if (payError) {
      return NextResponse.json({ error: payError.message }, { status: 500 });
    }

    const paymentRows = (payments || []).map((p: { center_id: string; notes?: string | null; [k: string]: unknown }) => {
      const notes = p.notes != null ? String(p.notes) : '';
      const proof = derivePaymentProofColumns({
        payment_proof_url: null,
        payment_reference: notes || null,
        source: 'admin_payment',
      });
      return {
        ...p,
        centerName: billingRows.find((c: { id: string }) => c.id === p.center_id)?.name ?? '—',
        source: 'admin_payment' as const,
        proof_type: proof.proofType,
        proof_reference: proof.proofReference,
      };
    });

    const { data: allInvoices } = await supabaseAdmin
      .from('invoices')
      .select('id, center_id, payment_amount, payment_reference, payment_proof_url, status, paid_at, updated_at')
      .in('status', ['approved', 'rejected'])
      .order('updated_at', { ascending: false })
      .limit(50);

    const invoiceRows = (allInvoices || []).map((inv: { center_id: string; [k: string]: unknown }) => {
      const proof = derivePaymentProofColumns({
        payment_proof_url: inv.payment_proof_url as string | null | undefined,
        payment_reference: inv.payment_reference as string | null | undefined,
        source: 'invoice',
      });
      return {
        id: inv.id,
        center_id: inv.center_id,
        centerName: billingRows.find((c: { id: string }) => c.id === inv.center_id)?.name ?? '—',
        amount: inv.payment_amount ?? 0,
        billing_period: 'payment_proof',
        paid_at: inv.paid_at ?? inv.updated_at,
        notes: `Invoice ${inv.payment_reference ?? inv.id}`,
        source: 'invoice' as const,
        invoiceStatus: inv.status,
        payment_proof_url: inv.payment_proof_url ?? null,
        payment_reference: inv.payment_reference ?? null,
        proof_type: proof.proofType,
        proof_reference: proof.proofReference,
      };
    });

    const { data: pendingInvoices } = await supabaseAdmin
      .from('invoices')
      .select('id, center_id, payment_amount, payment_reference, payment_proof_url, payment_method, created_at, invoice_number')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Get center status for each pending invoice (billingRows may be plan-filtered, so fetch from full centers)
    const pendingCenterIds = [...new Set((pendingInvoices || []).map((inv: { center_id: string }) => inv.center_id))];
    const { data: pendingCentersData } = pendingCenterIds.length > 0
      ? await supabaseAdmin.from('centers').select('id, name, status, plan, billing_period').in('id', pendingCenterIds)
      : { data: [] };
    const centerById = Object.fromEntries(((pendingCentersData || []) as { id: string; name: string; status: string; plan?: string; billing_period?: string }[]).map((c) => [c.id, c]));

    const pendingInvoiceRows = (pendingInvoices || []).map((inv: { center_id: string; [k: string]: unknown }) => {
      const center = centerById[inv.center_id];
      return {
        ...inv,
        centerName: center?.name ?? billingRows.find((c: { id: string }) => c.id === inv.center_id)?.name ?? '—',
        centerStatus: center?.status ?? '—',
        centerPlan: center?.plan ?? '—',
        centerBillingPeriod: center?.billing_period ?? '—',
      };
    });

    const totalMRR = computeSubscriptionTotalMrrRounded(billingRows as Parameters<typeof computeSubscriptionTotalMrrRounded>[0]);
    const activeFixedCount = (centers || []).filter((c: { billing_type?: string }) => (c.billing_type || 'fixed') === 'fixed').length;
    const revenueProjection = (totalMRR + paygMRR) * 12;

    return NextResponse.json({
      centers: billingRows,
      paymentHistory: [...paymentRows, ...invoiceRows].sort((a, b) => {
        const aPaid = (a as { paid_at?: string }).paid_at;
        const bPaid = (b as { paid_at?: string }).paid_at;
        const aT = aPaid ? new Date(aPaid).getTime() : 0;
        const bT = bPaid ? new Date(bPaid).getTime() : 0;
        return bT - aT;
      }),
      pendingInvoices: pendingInvoiceRows,
      mrrByPlan,
      totalMRR,
      fixedMRR: totalMRR,
      paygMRR,
      revenueProjection,
      activeFixedCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { supabaseAdmin, userId } = ctx;
    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = adminBillingRecordSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { center_id, amount: numAmount, billing_period: period, period_start, period_end, notes } = parsed.data;
    const periodMap: Record<string, number> = {
      monthly: 1,
      quarterly: 3,
      semi_annual: 6,
      annual: 12,
      half_yearly: 6,
      yearly: 12,
    };
    const months = periodMap[period ?? 'monthly'] ?? 1;

    const start = period_start ? new Date(period_start) : new Date();
    const end = period_end ? new Date(period_end) : addMonths(start, months);
    const nextDueDate = addMonths(start, months);

    const { error: insertErr } = await supabaseAdmin.from('admin_payments').insert({
      center_id,
      amount: numAmount,
      billing_period: period,
      period_start: start.toISOString().slice(0, 10),
      period_end: end.toISOString().slice(0, 10),
      paid_at: new Date().toISOString(),
      notes: notes || null,
      recorded_by: userId,
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const nextDueStr = nextDueDate.toISOString().slice(0, 10);
    const nextSuspend = new Date(nextDueDate);
    nextSuspend.setDate(nextSuspend.getDate() + 1);
    await supabaseAdmin
      .from('centers')
      .update({
        next_payment_due: nextDueStr,
        payment_due_date: nextDueStr,
        auto_suspend_at: nextSuspend.toISOString(),
        billing_status: 'paid',
        last_payment_date: new Date().toISOString().slice(0, 10),
        status: 'active',
      })
      .eq('id', center_id);

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id,
        user_id: userId,
        action: 'admin_payment_recorded',
        entity_type: 'admin_payments',
        details: { amount: numAmount, billing_period: period, period_start: start.toISOString().slice(0, 10), period_end: end.toISOString().slice(0, 10) },
      });
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { supabaseAdmin, userId } = ctx;
    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = adminBillingInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { invoiceId, action, password } = parsed.data;

    const { data: inv } = await supabaseAdmin
      .from('invoices')
      .select('id, center_id, status, payment_amount, payment_reference')
      .eq('id', invoiceId)
      .single();

    if (!inv || (inv as { status: string }).status !== 'pending') {
      return NextResponse.json({ error: 'Invoice not found or not pending' }, { status: 404 });
    }

    const centerId = (inv as { center_id: string }).center_id;

    if (action === 'approve') {
      const amount = Number((inv as { payment_amount?: number }).payment_amount ?? 0);
      if (amount > SENSITIVE_PAYMENT_THRESHOLD) {
        const accessToken = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!accessToken || !supabaseUrl || !supabaseAnonKey) {
          return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        const verify = await verifyPasswordForSensitiveAction(
          supabaseUrl,
          supabaseAnonKey,
          accessToken,
          password || ''
        );
        if (!verify.ok) {
          return NextResponse.json({ error: verify.error }, { status: 401 });
        }
      }

      const { error: updErr } = await supabaseAdmin
        .from('invoices')
        .update({
          status: 'approved',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoiceId);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }

      const { data: centerRow } = await supabaseAdmin
        .from('centers')
        .select('status, billing_period, plan, referred_by, subscription_status')
        .eq('id', centerId)
        .single();
      const centerStatus = (centerRow as { status?: string })?.status;
      const billingPeriod = (centerRow as { billing_period?: string })?.billing_period ?? 'quarterly';
      const periodMonths: Record<string, number> = {
        monthly: 1,
        quarterly: 3,
        half_yearly: 6,
        yearly: 12,
        semi_annual: 6,
        annual: 12,
      };
      const months = periodMonths[billingPeriod] ?? 3;
      const nextDue = addMonths(new Date(), months);

      const centerUpdates: Record<string, unknown> = {
        billing_status: 'paid',
        last_payment_date: new Date().toISOString().slice(0, 10),
        next_payment_due: nextDue.toISOString().slice(0, 10),
        payment_due_date: nextDue.toISOString().slice(0, 10),
      };
      if (centerStatus === 'suspended') {
        centerUpdates.status = 'active';
        (centerUpdates as Record<string, string>).subscription_status = 'active';
      }

      await supabaseAdmin
        .from('centers')
        .update(centerUpdates)
        .eq('id', centerId);

      const ref = (inv as { payment_reference?: string }).payment_reference ?? '';
      await supabaseAdmin.from('admin_payments').insert({
        center_id: centerId,
        amount,
        billing_period: billingPeriod === 'half_yearly' ? 'semi_annual' : billingPeriod === 'yearly' ? 'annual' : billingPeriod,
        paid_at: new Date().toISOString(),
        notes: `Payment proof approved - Ref: ${ref}`,
        recorded_by: userId,
      });

      // Referral reward: only when referred center's first payment is approved
      const referredBy = (centerRow as { referred_by?: string })?.referred_by;
      const plan = (centerRow as { plan?: string })?.plan ?? 'starter';
      const subscriptionStatus = (centerRow as { subscription_status?: string })?.subscription_status ?? 'active';
      if (referredBy && subscriptionStatus === 'active') {
        const { data: existingReward } = await supabaseAdmin
          .from('referral_rewards')
          .select('id')
          .eq('referring_center_id', referredBy)
          .eq('referred_center_id', centerId)
          .maybeSingle();
        if (!existingReward) {
          const { data: referringCenter } = await supabaseAdmin
            .from('centers')
            .select('name, is_early_adopter, early_adopter_referral_count')
            .eq('id', referredBy)
            .single();
          const isEA = !!(referringCenter as { is_early_adopter?: boolean })?.is_early_adopter;
          const eaCount = Number((referringCenter as { early_adopter_referral_count?: number })?.early_adopter_referral_count ?? 0) || 0;
          const use60Percent = isEA && eaCount < 10;
          const rewardAmount = Math.round(amount * (use60Percent ? 0.6 : 0.4));
          await supabaseAdmin.from('referral_rewards').insert({
            referring_center_id: referredBy,
            referred_center_id: centerId,
            referred_center_plan: plan,
            first_month_fee: amount,
            reward_amount: rewardAmount,
            reward_status: 'approved',
          });
          if (isEA && eaCount < 10) {
            await supabaseAdmin.from('centers').update({
              early_adopter_referral_count: (eaCount || 0) + 1,
            }).eq('id', referredBy);
          }
          try {
            await supabaseAdmin.from('audit_log').insert({
              center_id: referredBy,
              user_id: userId,
              action: 'referral_reward_created',
              entity_type: 'referral_rewards',
              details: { referred_center_id: centerId, amount, reward_amount: rewardAmount, referring_center_name: (referringCenter as { name?: string })?.name },
            });
          } catch {
            // ignore
          }
        }
      }
    } else {
      const { error: updErr } = await supabaseAdmin
        .from('invoices')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', invoiceId);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: centerId,
        user_id: userId,
        action: action === 'approve' ? 'admin_invoice_approved' : 'admin_invoice_rejected',
        entity_type: 'invoices',
        details: { invoice_id: invoiceId, action },
      });
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
