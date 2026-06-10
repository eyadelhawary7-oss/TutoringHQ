import * as Sentry from '@sentry/nextjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import {
  SIGNUP_SESSION_COOKIE,
  SIGNUP_SESSION_COOKIE_OPTIONS,
  signSignupSession,
} from '@/lib/signupSessionCookie';
import { getSupportWhatsAppWaMeWithText } from '@/lib/supportWhatsApp';
import { normalizePhone } from '@/lib/utils/phone';
import {
  PLANS,
  getPlanPrice,
  isPlanKey,
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
import { formatNumber } from '@/lib/formatNumber';
import { parseBodyWithLimit } from '@/lib/validate';
import { validatePromoCodeServerSide } from '@/lib/promoCode';

function getTotalSignupAmount(planKey: PlanKey, period: BillingPeriod): number {
  return getPlanPrice(planKey, period);
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

/** Best-effort mapping from Paymob/third-party error text for client-side i18n. */
function mapPaymobFailureCode(msg: string): 'invalid_card' | 'insufficient_funds' | '3ds_failed' | 'generic' {
  const m = msg.toLowerCase();
  if (m.includes('insufficient') || m.includes('not enough') || m.includes('balance')) {
    return 'insufficient_funds';
  }
  if (m.includes('3ds') || m.includes('3-d') || m.includes('secure') || m.includes('authentication')) {
    return '3ds_failed';
  }
  if (
    m.includes('declin') ||
    m.includes('reject') ||
    (m.includes('invalid') && m.includes('card')) ||
    m.includes('card') ||
    m.includes('cvv') ||
    m.includes('expired')
  ) {
    return 'invalid_card';
  }
  return 'generic';
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
    type SignupJson = {
      centerName?: string;
      ownerName?: string;
      phone?: string;
      city?: unknown;
      plan?: string;
      notes?: string;
      referralCode?: string;
      promoCode?: unknown;
      email?: string;
      initiatePayment?: unknown;
      billingPeriod?: unknown;
      billing_period?: unknown;
      termsAccepted?: unknown;
    };

    let body: SignupJson;
    try {
      body = (await parseBodyWithLimit(request, 65536)) as SignupJson;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const ip = getClientIp(request);
    const normalizedForKey = rawPhone ? normalizePhone(rawPhone) : '';
    const signupKey =
      normalizedForKey.length > 0 ? `signup:${normalizedForKey}` : `signup:${ip}`;
    const signupWindowSec = 3600;
    const { success } = await rateLimit(signupKey, 3, signupWindowSec);
    if (!success) {
      return rateLimitExceededResponse(signupWindowSec);
    }

    const {
      centerName,
      ownerName,
      phone,
      city,
      plan,
      notes,
      referralCode,
      promoCode: promoCodeRaw,
      email,
      initiatePayment: initiatePaymentRaw,
      termsAccepted: termsAcceptedRaw,
    } = body;

    const rawPromoCode =
      typeof promoCodeRaw === 'string' ? promoCodeRaw.trim().toUpperCase() : '';

    if (termsAcceptedRaw !== true) {
      return NextResponse.json({ error: 'Terms of Service must be accepted' }, { status: 400 });
    }

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

    const normalizedPlan = String(plan).toUpperCase();
    const planLower = normalizedPlan.toLowerCase();
    if (!isPlanKey(planLower) || planLower === 'top_centers') {
      return NextResponse.json({ error: 'Invalid plan selected' }, { status: 400 });
    }

    const planKey = planLower as PlanKey;

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
      SOLO: 200,
      NANO: 500,
      STARTER: 1000,
      PRO: 2000,
      BUSINESS: 3000,
      ENTERPRISE: 5000,
    };
    const setup = setupFees[normalizedPlan] ?? 1000;

    const allInPerMonth = PLANS[planKey].quarterlyAllIn;
    const defaultQuarterlyInvoice = allInPerMonth * 3;
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

    const termsAcceptedAt = new Date().toISOString();
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
      terms_accepted_at: termsAcceptedAt,
      terms_version: 'v1-2026-05',
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
      const baseAmountEgp = getTotalSignupAmount(planKey, periodResolved);
      if (!Number.isFinite(baseAmountEgp) || baseAmountEgp <= 0) {
        return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 });
      }

      // Server-side promo validation (do not trust client-side validation).
      let promoResult: Awaited<ReturnType<typeof validatePromoCodeServerSide>> | null = null;
      if (rawPromoCode) {
        promoResult = await validatePromoCodeServerSide(supabase, {
          code: rawPromoCode,
          planKey,
          billingInterval: periodResolved,
        });
        if (!promoResult.valid) {
          return NextResponse.json(
            { error: 'promo_code_invalid', promoError: promoResult.error },
            { status: 400 },
          );
        }
      }

      const amountEgp =
        promoResult?.valid ? promoResult.discountedAmountEgp : baseAmountEgp;
      const invoiceDiscountAmount =
        promoResult?.valid ? promoResult.savingsEgp : 0;

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

        const invoiceInsert: Record<string, unknown> = {
          center_id: center.id,
          invoice_number: invoiceNumber,
          invoice_type: 'signup_first_payment',
          total_amount: amountEgp,
          base_amount: baseAmountEgp,
          billing_period_start: startYmd,
          billing_period_end: endYmd,
          due_date: dueYmdPlus1,
          status: 'pending',
          discount_amount: invoiceDiscountAmount,
          paymob_order_id: orderId,
        };
        if (promoResult?.valid) {
          invoiceInsert.promo_code = promoResult.code;
          invoiceInsert.promo_original_amount = promoResult.originalAmountEgp;
        }

        const { data: invRow, error: invErr } = await supabase
          .from('invoices')
          .insert(invoiceInsert)
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

        // chq_signup_session - proves the browser arriving back at /set-pin is
        // the same browser that initiated THIS signup. The cookie alone is NOT
        // sufficient authority to set a PIN; /api/auth/set-initial-pin AND-s it
        // against webhook-confirmed paid+activated state.
        const signed = signSignupSession(center.id);
        const response = NextResponse.json({
          success: true,
          paymentUrl,
          center_id: center.id,
        });
        if (signed) {
          response.cookies.set({
            name: SIGNUP_SESSION_COOKIE,
            value: signed,
            ...SIGNUP_SESSION_COOKIE_OPTIONS,
          });
        } else {
          // CSRF_SECRET missing / malformed - set-PIN cookie path will silently
          // not work. Surface loudly so ops sees the misconfig instead of
          // discovering it via broken onboarding.
          Sentry.captureMessage(
            'signup: chq_signup_session cookie not signed - CSRF_SECRET unset/malformed; cross-device fallback still works',
            {
              level: 'error',
              tags: { route: 'signup', reason: 'signup_session_secret_missing' },
            },
          );
        }
        return response;
      } catch (payErr) {
        console.error('[signup] Paymob error:', payErr);
        const msg = payErr instanceof Error ? payErr.message : 'Payment initiation failed';
        const paymob_code = mapPaymobFailureCode(msg);
        return NextResponse.json(
          { error: 'payment_unavailable', paymob_code, detail: msg },
          { status: 502 },
        );
      }
    }

    const firstPayment = periodAmount + setup;
    const whatsappMessage = `🆕 *NEW SIGNUP REQUEST*

📋 *Center Details:*
- Name: ${centerName}
- Owner: ${ownerName}
- Phone: ${formattedPhone}
- City: ${cityDb || ','}
- Plan: ${normalizedPlan}
- Billing period: ${periodResolved}

💰 *Payment Required (all-inclusive):*
- Selected period total: EGP ${formatNumber(periodAmount, 'en')}
- Setup Fee: EGP ${formatNumber(setup, 'en')}
- *First Payment: EGP ${formatNumber(firstPayment, 'en')}*

📝 Notes: ${notes || 'None'}

🔗 View in admin panel.`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://centerhq.app';
    const adminWhatsAppUrl = getSupportWhatsAppWaMeWithText(whatsappMessage) || '';

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
