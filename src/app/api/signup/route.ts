import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { signupRatelimit, getClientIp, rateLimitedResponse } from '@/lib/ratelimit';
import { normalizePhone } from '@/lib/utils/phone';
import { PLANS, getPlanPrice, normalizeBillingPeriod, type BillingPeriod, type PlanKey } from '@/lib/pricing';

export async function POST(request: Request) {
  try {
    // Rate limiting — check before any DB operations
    if (signupRatelimit) {
      const ip = getClientIp(request);
      const { success, reset } = await signupRatelimit.limit(ip);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return rateLimitedResponse(retryAfter);
      }
    }
    const body = await request.json();
    const { centerName, ownerName, phone, city, plan, notes, billing_period, referralCode } = body;

    if (!centerName?.trim() || !ownerName?.trim() || !phone?.trim() || !plan) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validPlans = ['NANO', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'];
    const normalizedPlan = String(plan).toUpperCase();
    if (!validPlans.includes(normalizedPlan)) {
      return NextResponse.json({ error: 'Invalid plan selected' }, { status: 400 });
    }

    const formattedPhone = normalizePhone(String(phone).trim());

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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

    const setupFees: Record<string, number> = {
      NANO: 500,
      STARTER: 1000,
      PRO: 2000,
      BUSINESS: 3000,
      ENTERPRISE: 5000,
    };
    const setup = setupFees[normalizedPlan] ?? 1000;

    const planLower = normalizedPlan.toLowerCase() as PlanKey;
    const planKey: PlanKey = planLower in PLANS ? planLower : 'starter';
    const allInPerMonth = PLANS[planKey].quarterlyAllIn;
    const defaultQuarterlyInvoice = Math.round(allInPerMonth * 3);
    const periodResolved: BillingPeriod = normalizeBillingPeriod(
      ['monthly', 'quarterly', 'annual'].includes(String(billing_period)) ? String(billing_period) : 'quarterly',
    );
    const periodAmount = getPlanPrice(planKey, periodResolved);

    // Resolve referral code to referrer center_id (if provided)
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

    const centerInsert: Record<string, unknown> = {
      name: centerName.trim(),
      owner_name: ownerName.trim(),
      phone: formattedPhone,
      city: city?.trim() || null,
      plan: planLower,
      signup_notes: notes?.trim() || null,
      status: 'pending',
      subscription_status: 'pending',
      billing_type: 'fixed',
      billing_period: periodResolved,
      billing_amount: defaultQuarterlyInvoice,
      all_in_price: allInPerMonth,
      requested_at: new Date().toISOString(),
    };
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
      return NextResponse.json(
        { error: 'Failed to create signup request' },
        { status: 500 }
      );
    }

    // Link referral (non-blocking - do not fail signup if insert fails)
    if (referrerCenterId && center?.id && cleanRefCode) {
      const { error: refErr } = await supabase.from('referrals').insert({
        referrer_center_id: referrerCenterId,
        referred_center_id: center.id,
        referral_code: cleanRefCode,
        status: 'pending',
      });
      if (refErr) console.error('[signup] Referral link insert failed:', refErr);
    }

    const firstPayment = periodAmount + setup;
    const whatsappMessage = `🆕 *NEW SIGNUP REQUEST*

📋 *Center Details:*
- Name: ${centerName}
- Owner: ${ownerName}
- Phone: ${formattedPhone}
- City: ${city || '—'}
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
      { status: 500 }
    );
  }
}
