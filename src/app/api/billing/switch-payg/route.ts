import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { isPaygCenter } from '@/lib/billingEngine';
import { firstDayNextMonthCairoYmd } from '@/lib/paygBilling';
import { normalizeBillingPeriod, type BillingPeriod } from '@/lib/pricing';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { action?: string; newPeriod?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, status, billing_type, pricing_type, payg_pending_switch, subscription_billing_period, billing_period',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    status?: string;
    billing_type?: string | null;
    pricing_type?: string | null;
    payg_pending_switch?: string | null;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
  };

  if (String(c.status ?? '').toLowerCase() !== 'active') {
    return NextResponse.json({ error: 'Center must be active' }, { status: 400 });
  }

  const effectiveDate = firstDayNextMonthCairoYmd();

  if (action === 'cancel') {
    if (!c.payg_pending_switch) {
      return NextResponse.json({ error: 'No pending PAYG switch' }, { status: 400 });
    }
    const { error: uErr } = await supabaseAdmin
      .from('centers')
      .update({
        payg_pending_switch: null,
        payg_switch_effective_date: null,
        payg_pending_target_period: null,
      })
      .eq('id', centerId);
    if (uErr) {
      console.error('[switch-payg] cancel', uErr);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, cancelled: true });
  }

  if (action === 'enable') {
    if (isPaygCenter(c)) {
      return NextResponse.json({ error: 'Already on Pay As You Go' }, { status: 400 });
    }
    if (c.payg_pending_switch) {
      return NextResponse.json({ error: 'A billing switch is already scheduled' }, { status: 400 });
    }

    const { data: pendingReq } = await supabaseAdmin
      .from('plan_requests')
      .select('id')
      .eq('center_id', centerId)
      .in('status', ['pending', 'pending_downgrade', 'pending_payment'])
      .limit(1)
      .maybeSingle();

    if (pendingReq) {
      return NextResponse.json(
        { error: 'Complete or cancel pending plan change requests first' },
        { status: 400 },
      );
    }

    const { error: uErr } = await supabaseAdmin
      .from('centers')
      .update({
        payg_pending_switch: 'to_payg',
        payg_switch_effective_date: effectiveDate,
        payg_pending_target_period: null,
      })
      .eq('id', centerId);

    if (uErr) {
      console.error('[switch-payg] enable', uErr);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      payg_pending_switch: 'to_payg',
      payg_switch_effective_date: effectiveDate,
    });
  }

  if (action === 'disable') {
    if (!isPaygCenter(c)) {
      return NextResponse.json({ error: 'Not on Pay As You Go' }, { status: 400 });
    }
    if (c.payg_pending_switch) {
      return NextResponse.json({ error: 'A billing switch is already scheduled' }, { status: 400 });
    }

    const newPeriodRaw = typeof body.newPeriod === 'string' ? body.newPeriod.trim() : '';
    const newPeriod = normalizeBillingPeriod(newPeriodRaw || 'quarterly') as BillingPeriod;
    if (!['monthly', 'quarterly', 'annual'].includes(newPeriod)) {
      return NextResponse.json({ error: 'newPeriod must be monthly, quarterly, or annual' }, { status: 400 });
    }

    const { error: uErr } = await supabaseAdmin
      .from('centers')
      .update({
        payg_pending_switch: 'from_payg',
        payg_switch_effective_date: effectiveDate,
        payg_pending_target_period: newPeriod,
      })
      .eq('id', centerId);

    if (uErr) {
      console.error('[switch-payg] disable', uErr);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      payg_pending_switch: 'from_payg',
      payg_switch_effective_date: effectiveDate,
      payg_pending_target_period: newPeriod,
    });
  }

  return NextResponse.json({ error: 'action must be enable, disable, or cancel' }, { status: 400 });
}
