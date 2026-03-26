import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isFeatureEnabled } from '@/lib/features';
import {
  getPaymobAuthToken,
  createPaymobOrder,
  createPaymentKey,
  buildPaymobIframeUrl,
} from '@/lib/paymob';

import { getChargeFromQuarterlyAllIn, normalizeBillingPeriod, PLANS, type BillingPeriod, type PlanKey } from '@/lib/pricing';

const MONTHLY_MULTIPLIER = 4.333;

function getBracketRate(students: number): number {
  if (students <= 150) return 4;
  if (students <= 500) return 3;
  if (students <= 1000) return 2.5;
  if (students <= 2000) return 2;
  return 1.75;
}

function calculatePaygMonthly(studentsPerWeek: number): number {
  const rate = getBracketRate(studentsPerWeek);
  return Math.round(studentsPerWeek * rate * MONTHLY_MULTIPLIER);
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
    .select('id, center_id, role, phone')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled('PAYMOB_ENABLED')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (ctx.user.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: center, error: centerError } = await ctx.supabaseAdmin
      .from('centers')
      .select('id, name, plan, pricing_type, weekly_student_limit, billing_period, all_in_price, is_early_adopter, early_adopter_price')
      .eq('id', ctx.user.center_id)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const centerName = (center as { name?: string }).name || 'Center';
    const plan = center.plan || 'starter';
    const pricingType = (center as { pricing_type?: string }).pricing_type || 'fixed';
    const isEarlyAdopter = !!(center as { is_early_adopter?: boolean }).is_early_adopter;
    const earlyAdopterPrice = (center as { early_adopter_price?: number }).early_adopter_price;

    let billingAmountEgp: number;
    if (pricingType === 'payg') {
      const weeklyLimit = (center as { weekly_student_limit?: number }).weekly_student_limit ?? 200;
      billingAmountEgp = calculatePaygMonthly(weeklyLimit);
    } else {
      const planKey = (plan in PLANS ? plan : 'starter') as PlanKey;
      const period = normalizeBillingPeriod((center as { billing_period?: string | null }).billing_period);
      const qBase =
        isEarlyAdopter && typeof earlyAdopterPrice === 'number'
          ? earlyAdopterPrice
          : (center as { all_in_price?: number | null }).all_in_price != null
            ? Number((center as { all_in_price?: number | null }).all_in_price)
            : PLANS[planKey].quarterlyAllIn;
      billingAmountEgp = getChargeFromQuarterlyAllIn(qBase, period as BillingPeriod);
    }

    if (billingAmountEgp <= 0) {
      return NextResponse.json({ error: 'No amount due' }, { status: 400 });
    }

    const amountCents = Math.round(billingAmountEgp * 100);
    const phone = (ctx.user as { phone?: string }).phone || '';
    const name = (ctx.user as { name?: string }).name || 'Customer';

    if (!phone.trim()) {
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
    }

    const authToken = await getPaymobAuthToken();
    const orderId = await createPaymobOrder({
      authToken,
      amountCents,
      centerId: center.id,
      centerName,
    });
    const paymentToken = await createPaymentKey({
      authToken,
      orderId,
      amountCents,
      phone: phone.trim(),
      name: name.trim(),
    });

    const paymentUrl = buildPaymobIframeUrl(paymentToken);

    return NextResponse.json({ payment_url: paymentUrl });
  } catch (err) {
    console.error('Paymob initiate-payment error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payment initiation failed' },
      { status: 500 }
    );
  }
}
