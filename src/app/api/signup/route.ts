import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { signupRatelimit, getClientIp, rateLimitedResponse } from '@/lib/ratelimit';
import { normalizePhone } from '@/lib/utils/phone';
import {
  PLANS,
  getPlanPrice,
  normalizeBillingPeriod,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import {
  getPaymobAuthToken,
  createPaymobOrder,
  createPaymentKey,
  buildPaymobIframeUrl,
} from '@/lib/paymob';
import { isFeatureEnabled } from '@/lib/features';
import { todayISO } from '@/lib/parentPack';

const SIGNUP_PLAN_AMOUNTS = [
  { key: 'nano', allInPrice: 2000, monthlyPrice: 2500, annualPrice: 20399 },
  { key: 'starter', allInPrice: 4500, monthlyPrice: 5200, annualPrice: 45899 },
  { key: 'pro', allInPrice: 8000, monthlyPrice: 9200, annualPrice: 81599 },
  { key: 'business', allInPrice: 13000, monthlyPrice: 15000, annualPrice: 132599 },
  { key: 'enterprise', allInPrice: 18500, monthlyPrice: 21300, annualPrice: 188699 },
] as const;

function display99Price(price: number): number {
  if (!Number.isFinite(price) || price <= 1) return price;
  return price - 1;
}

function getTotalSignupAmount(planKey: string, period: string): number {
  const plan = SIGNUP_PLAN_AMOUNTS.find((p) => p.key === planKey);
  if (!plan) return 0;
  if (period === 'monthly') return display99Price(plan.monthlyPrice);
  if (period === 'annual') return display99Price(plan.annualPrice);
  return display99Price(plan.allInPrice * 3);
}

const CITY_ID_TO_DB: Record<string, string> = {
  cairo: 'Cairo',
  giza: 'Giza',
  alexandria: 'Alexandria',
  sixth_october: '6th October',
  sheikh_zayed: 'Sheikh Zayed',
  nasr_city: 'Nasr City',
  new_cairo: 'New Cairo',
  heliopolis: 'Heliopolis',
  maadi: 'Maadi',
  other: 'Other',
};

function mapCityToDb(city: unknown): string | null {
  if (city == null || typeof city !== 'string') return null;
  const t = city.trim();
  if (!t) return null;
  const lower = t.toLowerCase().replace(/\s+/g, '_');
  if (CITY_ID_TO_DB[lower]) return CITY_ID_TO_DB[lower];
  if (CITY_ID_TO_DB[t as keyof typeof CITY_ID_TO_DB]) return CITY_ID_TO_DB[t as keyof typeof CITY_ID_TO_DB];
  return t;
}

function addMonthsToYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function billingEndForPeriod(startYmd: string, period: BillingPeriod): string {
  if (period === 'monthly') return addMonthsToYmd(startYmd, 1);
  if (period === 'annual') return addMonthsToYmd(startYmd, 12);
  return addMonthsToYmd(startYmd, 3);
}

async function phoneHasActiveCenter(supabase: SupabaseClient, formattedPhone: string): Promise<boolean> {
  const { data: userRows } = await supabase
    .from('users')
    .select('center_id')
    .eq('phone', formattedPhone);

  if (!userRows?.length) return false;

  const centerIds = [
    ...new Set(
      userRows
        .map((u: { center_id: string | null }) => u.center_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!centerIds.length) return false;

  const { data: active } = await supabase
    .from('centers')
    .select('id')
    .in('id', centerIds)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  return !!active;
}

export async function POST(request: Request) {
  try {
    if (signupRatelimit) {
      const ip = getClientIp(request);
      const { success, reset } = await signupRatelimit.limit(ip);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return rateLimitedResponse(retryAfter);
      }
    }

    const body = await request.json();
    const {
      centerName,
      ownerName,
      phone,
      city,
      plan,
      notes,
      referralCode,
      email,
      initiatePayment: initiatePaymentRaw,
    } = body;

    const billingPeriodRaw =
      body.billingPeriod ?? body.billing_period ?? 'quarterly';
    const periodResolved: BillingPeriod = normalizeBillingPeriod(
      ['monthly', 'quarterly', 'annual'].includes(String(billingPeriodRaw))
        ? String(billingPeriodRaw)
        : 'quarterly',
    );

    const initiatePayment = initiatePaymentRaw === true;

    if (!centerName?.trim() || !ownerName?.trim() || !phone?.trim() || !plan) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validPlans = ['NANO', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'];
    const normalizedPlan = String(plan).toUpperCase();
    if (!validPlans.includes(normalizedPlan)) {
      return NextResponse.json({ error: 'Invalid plan selected' }, { status: 400 });
    }

    const planLower = normalizedPlan.toLowerCase() as PlanKey;
    const planKey: PlanKey = planLower in PLANS ? planLower : 'starter';

    const formattedPhone = normalizePhone(String(phone).trim());

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    if (initiatePayment) {
      if (!isFeatureEnabled('PAYMOB_ENABLED')) {
        return NextResponse.json({ error: 'payment_unavailable' }, { status: 503 });
      }

      const activeOwner = await phoneHasActiveCenter(supabase, formattedPhone);
      if (activeOwner) {
        return NextResponse.json({ error: 'phone_exists' }, { status: 400 });
      }

      const { data: blacklistedRow } = await supabase
        .from('centers')
        .select('id')
        .eq('is_blacklisted', true)
        .eq('phone', formattedPhone)
        .limit(1)
        .maybeSingle();

      if (blacklistedRow) {
        return NextResponse.json({ error: 'phone_blacklisted' }, { status: 400 });
      }
    } else {
      const { data: blacklistedMatch } = await supabase
        .from('centers')
        .select('id')
        .eq('is_blacklisted', true)
        .eq('phone', formattedPhone)
        .limit(1)
        .maybeSingle();

      if (blacklistedMatch) {
        return NextResponse.json(
          { error: 'Registration is not available for this phone number.' },
          { status: 403 },
        );
      }
    }

    const setupFees: Record<string, number> = {
      NANO: 500,
      STARTER: 1000,
      PRO: 2000,
      BUSINESS: 3000,
      ENTERPRISE: 5000,
    };
    const setup = setupFees[normalizedPlan] ?? 1000;

    const allInPerMonth = PLANS[planKey].quarterlyAllIn;
    const defaultQuarterlyInvoice = Math.round(allInPerMonth * 3);
    const periodAmount = getPlanPrice(planKey, periodResolved);

    const cityDb = mapCityToDb(city);

    let referrerCenterId: string | null = null;
    const cleanRefCode = typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';
    if (cleanRefCode) {
      const { data: refRow } = await supabase
        .from('referral_codes')
        .select('center_id')
        .eq('code', cleanRefCode)
        .limit(1)
        .maybeSingle();
      referrerCenterId = refRow?.center_id ?? null;
      if (!referrerCenterId) {
        const { data: centerByCode } = await supabase
          .from('centers')
          .select('id')
          .eq('referral_code', cleanRefCode)
          .maybeSingle();
        referrerCenterId = centerByCode?.id ?? null;
      }
    }

    const emailTrim = typeof email === 'string' ? email.trim() : '';

    const centerInsert: Record<string, unknown> = {
      name: centerName.trim(),
      owner_name: ownerName.trim(),
      phone: formattedPhone,
      email: emailTrim || null,
      city: cityDb,
      plan: planLower,
      signup_notes: typeof notes === 'string' ? notes.trim() || null : null,
      status: initiatePayment ? 'pending_payment' : 'pending',
      subscription_status: 'pending',
      billing_type: 'fixed',
      billing_period: periodResolved,
      billing_amount: defaultQuarterlyInvoice,
      all_in_price: allInPerMonth,
      requested_at: new Date().toISOString(),
    };

    if (initiatePayment) {
      centerInsert.billing_status = 'pending';
    }

    if (referrerCenterId) {
      centerInsert.referred_by = referrerCenterId;
      centerInsert.referral_code_used_at = new Date().toISOString();
    }

    const { data: center, error: centerError } = await supabase
      .from('centers')
      .insert(centerInsert)
      .select()
      .single();

    if (centerError) {
      console.error('[signup] Center creation error:', centerError);
      return NextResponse.json({ error: 'Failed to create signup request' }, { status: 500 });
    }

    if (referrerCenterId && center?.id && cleanRefCode) {
      const { error: refErr } = await supabase.from('referrals').insert({
        referrer_center_id: referrerCenterId,
        referred_center_id: center.id,
        referral_code: cleanRefCode,
        status: 'pending',
      });
      if (refErr) console.error('[signup] Referral link insert failed:', refErr);
    }

    if (initiatePayment && center?.id) {
      const amountEgp = getTotalSignupAmount(planLower, periodResolved);
      if (!Number.isFinite(amountEgp) || amountEgp <= 0) {
        return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 });
      }

      const startYmd = todayISO();
      const endYmd = billingEndForPeriod(startYmd, periodResolved);
      const dueYmd = addMonthsToYmd(startYmd, 0);
      const dueDateObj = new Date(`${dueYmd}T12:00:00.000Z`);
      dueDateObj.setUTCDate(dueDateObj.getUTCDate() + 1);
      const dueYmdPlus1 = dueDateObj.toISOString().slice(0, 10);

      const { data: codeRow } = await supabase
        .from('centers')
        .select('center_code')
        .eq('id', center.id)
        .maybeSingle();
      const code = (codeRow as { center_code?: string } | null)?.center_code ?? 'NEW';
      const yearMonth = startYmd.slice(0, 7);
      const invoiceNumber = `SIG-${code}-${yearMonth}-${Date.now().toString(36)}`;

      const amountCents = Math.round(amountEgp * 100);
      const payName = ownerName.trim() || centerName.trim();

      try {
        const authToken = await getPaymobAuthToken();
        const orderId = await createPaymobOrder({
          authToken,
          amountCents,
          centerId: center.id,
          centerName: centerName.trim(),
        });

        const { data: invRow, error: invErr } = await supabase
          .from('invoices')
          .insert({
            center_id: center.id,
            invoice_number: invoiceNumber,
            invoice_type: 'signup_first_payment',
            total_amount: amountEgp,
            base_amount: amountEgp,
            billing_period_start: startYmd,
            billing_period_end: endYmd,
            due_date: dueYmdPlus1,
            status: 'pending',
            discount_amount: 0,
            paymob_order_id: orderId,
          })
          .select('id')
          .single();

        if (invErr || !invRow) {
          console.error('[signup] Invoice insert', invErr);
          return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
        }

        const paymentToken = await createPaymentKey({
          authToken,
          orderId,
          amountCents,
          phone: formattedPhone.replace(/^\+/, '') || formattedPhone,
          name: payName,
        });

        const paymentUrl = buildPaymobIframeUrl(paymentToken);

        return NextResponse.json({
          success: true,
          paymentUrl,
          center_id: center.id,
        });
      } catch (payErr) {
        console.error('[signup] Paymob error:', payErr);
        return NextResponse.json(
          { error: payErr instanceof Error ? payErr.message : 'Payment initiation failed' },
          { status: 500 },
        );
      }
    }

    const firstPayment = periodAmount + setup;
    const whatsappMessage = `🆕 *NEW SIGNUP REQUEST*

📋 *Center Details:*
- Name: ${centerName}
- Owner: ${ownerName}
- Phone: ${formattedPhone}
- City: ${cityDb || '—'}
- Plan: ${normalizedPlan}
- Billing period: ${periodResolved}

💰 *Payment Required (all-inclusive):*
- Selected period total: EGP ${periodAmount.toLocaleString('en-US')}
- Setup Fee: EGP ${setup.toLocaleString('en-US')}
- *First Payment: EGP ${firstPayment.toLocaleString('en-US')}*

📝 Notes: ${notes || 'None'}

🔗 View in admin panel.`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://center-hq.vercel.app';
    const adminWhatsAppUrl = `https://wa.me/201220601410?text=${encodeURIComponent(whatsappMessage)}`;

    return NextResponse.json({
      success: true,
      message: 'Signup request submitted successfully',
      center_id: center.id,
      center,
      admin_whatsapp_url: adminWhatsAppUrl,
    });
  } catch (error) {
    console.error('[signup] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
