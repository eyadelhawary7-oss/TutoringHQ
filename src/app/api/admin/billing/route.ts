import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';

const PLAN_MONTHLY: Record<string, number> = {
  starter: 4000,
  pro: 7200,
  pro_plus: 8000,
  enterprise: 9000,
  payg: 0,
  top_centers: 0,
};

function calcAmount(plan: string, period: string): number {
  const monthly = PLAN_MONTHLY[plan] ?? 4000;
  switch (period) {
    case 'quarterly': return monthly * 3;
    case 'semi_annual': return Math.round(monthly * 6 * 0.95);
    case 'annual': return Math.round(monthly * 12 * 0.90);
    default: return monthly;
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { supabaseAdmin } = ctx;

    const { data: centers, error: centersError } = await supabaseAdmin
      .from('centers')
      .select('id, name, plan, phone, billing_period, next_payment_due, next_billing_date, billing_status, status, payment_due_date, auto_suspend_at')
      .in('status', ['active', 'suspended']);

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
    const billingRows = centers || [];
    for (const row of billingRows) {
      const bp = (row as { billing_period?: string }).billing_period || 'monthly';
      const nextDue = (row as { next_payment_due?: string }).next_payment_due
        || (row as { next_billing_date?: string }).next_billing_date;
      const monthly = PLAN_MONTHLY[row.plan as string] ?? 4000;
      const amount = calcAmount(row.plan as string || 'starter', bp === 'half_yearly' ? 'semi_annual' : bp === 'yearly' ? 'annual' : bp);
      const discount = bp === 'semi_annual' || bp === 'half_yearly' ? 5 : bp === 'annual' || bp === 'yearly' ? 10 : bp === 'quarterly' ? 0 : 0;
      const monthlyEquiv = bp === 'quarterly' ? monthly : bp === 'semi_annual' || bp === 'half_yearly' ? monthly * 0.95 : bp === 'annual' || bp === 'yearly' ? monthly * 0.9 : monthly;
      (row as Record<string, unknown>).amount = amount;
      (row as Record<string, unknown>).monthlyEquivalent = Math.round(monthlyEquiv);
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

    const paymentRows = (payments || []).map((p: { center_id: string; [k: string]: unknown }) => ({
      ...p,
      centerName: billingRows.find((c: { id: string }) => c.id === p.center_id)?.name ?? '—',
    }));

    return NextResponse.json({
      centers: billingRows,
      paymentHistory: paymentRows,
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
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { supabaseAdmin, userId } = ctx;
    const body = await request.json();
    const { center_id, amount, billing_period, period_start, period_end, notes } = body;

    if (!center_id || !amount) {
      return NextResponse.json({ error: 'center_id and amount required' }, { status: 400 });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const period = billing_period || 'monthly';
    const periodMap: Record<string, number> = {
      monthly: 1,
      quarterly: 3,
      semi_annual: 6,
      annual: 12,
      half_yearly: 6,
      yearly: 12,
    };
    const months = periodMap[period] ?? 1;

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
        next_billing_date: nextDueStr,
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
