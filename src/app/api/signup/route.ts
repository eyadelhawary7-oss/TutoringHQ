import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import {
  SIGNUP_SESSION_COOKIE,
  SIGNUP_SESSION_COOKIE_OPTIONS,
  signSignupSession,
} from '@/lib/signupSessionCookie';
import { normalizePhone } from '@/lib/utils/phone';
import {
  PLANS,
  getPlanPrice,
  isPlanKey,
  normalizeBillingPeriod,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import { parseBodyWithLimit } from '@/lib/validate';
import { getIntervalConfig } from '@/lib/pricingConfig';
import { getSummerConfig, summerModeActive } from '@/lib/summer/config';
import { computeSummerSchedule } from '@/lib/summer/dates';
import { cairoDateKey } from '@/lib/cairo/day';
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor';
import { autoSuspendAtFromDue } from '@/lib/billingSchedule';
import { provisionCenterOwner } from '@/lib/centerOwnerProvision';

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

/**
 * POST /api/signup — center signup. The provisioning path forks on the summer
 * master switch (summer.promo.enabled):
 *
 *   Summer ON  → TRIAL-FIRST: the center is created ACTIVE and enrolled in the
 *   14-day free trial (billing-neutral: no next_payment_due, no auto_suspend). The
 *   first invoice is issued at trial-end by the summer-billing engine (Aug 30 for
 *   the launch cohort, signup+14 thereafter).
 *
 *   Summer OFF → NORMAL billing (no trial): the center is created ACTIVE with a
 *   next_payment_due ~30 days out and a single-day lock, so the standard renewal
 *   cron owns the first invoice. summer_status stays NULL. Charge AMOUNTS are
 *   identical to the trial path — only the provisioning path differs.
 *
 * Either way, signup provisions the owner login immediately (no Paymob webhook
 * needed) and hands the browser to /set-pin. Invoices are paid through Paymob by
 * any method — only customers who saved a card are auto-charged.
 *
 * Abuse control: one free trial per phone, enforced atomically via the durable
 * `trial_claims` ledger (the UNIQUE insert is the lock).
 */
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
      email?: string;
      billingPeriod?: unknown;
      billing_period?: unknown;
      termsAccepted?: unknown;
      privacyAccepted?: unknown;
      // Accepted for client compatibility; ignored — signup never charges now.
      initiatePayment?: unknown;
      promoCode?: unknown;
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
    const signupKey = normalizedForKey.length > 0 ? `signup:${normalizedForKey}` : `signup:${ip}`;
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
      email,
      termsAccepted: termsAcceptedRaw,
      privacyAccepted: privacyAcceptedRaw,
    } = body;

    // PDPL consent: terms acceptance and data-processing consent are distinct and
    // both mandatory. Enforced server-side so a bypassed checkbox (direct API call)
    // is rejected before any center row is created.
    if (termsAcceptedRaw !== true || privacyAcceptedRaw !== true) {
      return NextResponse.json(
        { error: 'Consent required', code: 'CONSENT_REQUIRED' },
        { status: 400 },
      );
    }

    // Centers are billed monthly or annual only; monthly is the default.
    const billingPeriodRaw = body.billingPeriod ?? body.billing_period ?? 'monthly';
    const periodResolved: BillingPeriod = normalizeBillingPeriod(
      ['monthly', 'annual'].includes(String(billingPeriodRaw)) ? String(billingPeriodRaw) : 'monthly',
    );

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

    // One free trial per phone — reserve the phone atomically. The UNIQUE constraint
    // on trial_claims.phone is the lock: a second signup for the same phone (even a
    // deleted/rejected past center) fails the insert with 23505.
    const { error: claimErr } = await supabase.from('trial_claims').insert({ phone: formattedPhone });
    if (claimErr) {
      if ((claimErr as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'phone_exists' }, { status: 400 });
      }
      console.error('[signup] trial_claims insert', claimErr);
      return NextResponse.json({ error: 'Failed to create signup request' }, { status: 500 });
    }

    const releasePhoneClaim = async () => {
      try {
        await supabase.from('trial_claims').delete().eq('phone', formattedPhone);
      } catch {
        /* best-effort release */
      }
    };

    // Blacklisted phones may not register.
    const { data: blacklistedRow } = await supabase
      .from('centers')
      .select('id')
      .eq('is_blacklisted', true)
      .eq('phone', formattedPhone)
      .limit(1)
      .maybeSingle();
    if (blacklistedRow) {
      await releasePhoneClaim();
      return NextResponse.json({ error: 'phone_blacklisted' }, { status: 400 });
    }

    // Pricing snapshot for the (post-trial) subscription. No money moves now.
    const allInPerMonth = PLANS[planKey].quarterlyAllIn;
    const intervalCfg = await getIntervalConfig();
    const periodAmount = getPlanPrice(planKey, periodResolved, intervalCfg.annualMultiplier);
    const weeklyLimit = PLANS[planKey]?.weeklyStudentLimit ?? null;
    const cityDb = mapCityToDb(city);

    // Referral attribution (best-effort).
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

    // Provisioning fork keyed off the summer master switch (summer.promo.enabled):
    //  - Summer ON  → 14-day trial enrollment via the shared summer schedule (same
    //    math the summer-billing cron uses): trial_start = max(signup, free_until),
    //    first_invoice_at = max(trial_start+14, first_charge_floor). Billing is
    //    neutralised (next_payment_due/auto_suspend NULL) so the normal crons skip
    //    the center; the summer engine owns the trial-end invoice + lock.
    //  - Summer OFF → NORMAL billing, no trial. Mirrors the admin "approve"
    //    activation: active now, first invoice issued by the standard renewal cron
    //    ~30 days out, single-day lock keyed off next_payment_due. summer_status
    //    stays NULL so the center is never treated as a trial signup. No charge
    //    AMOUNT changes — only which provisioning path a new signup takes.
    const summerCfg = await getSummerConfig();
    const summerActive = summerModeActive(summerCfg);
    const signupCairo = cairoDateKey(new Date());

    const nowIso = new Date().toISOString();
    const emailTrim = typeof email === 'string' ? email.trim() : '';
    const centerInsert: Record<string, unknown> = {
      name: centerName.trim(),
      owner_name: ownerName.trim(),
      phone: formattedPhone,
      email: emailTrim || null,
      city: cityDb,
      plan: planLower,
      signup_notes: typeof notes === 'string' ? notes.trim() || null : null,
      // Active with full access immediately in both paths.
      status: 'active',
      subscription_status: 'active',
      billing_status: 'active',
      // approved_at is the "provisioned" signal /set-pin AND-s with status='active'
      // to authorise the owner's PIN choice (isCenterPaidAndActivated).
      approved_at: nowIso,
      billing_type: 'fixed',
      billing_period: periodResolved,
      billing_amount: periodAmount,
      all_in_price: allInPerMonth,
      // CHECK allows {'monthly','yearly'}; annual is spelled 'yearly' here.
      subscription_billing_period: periodResolved === 'annual' ? 'yearly' : 'monthly',
      requested_at: nowIso,
      terms_accepted_at: nowIso,
      terms_version: 'v1-2026-05',
      policy_accepted_at: nowIso,
      policy_version: '1.0',
    };

    if (summerActive) {
      // Trial enrollment (mirrors summerBillingCron.runCenters enroll action).
      const schedule = computeSummerSchedule(signupCairo, summerCfg);
      centerInsert.next_payment_due = null;
      centerInsert.auto_suspend_at = null;
      centerInsert.summer_status = 'enrolled';
      centerInsert.summer_trial_start = schedule.trialStart;
      centerInsert.summer_first_invoice_at = schedule.firstInvoiceAt;
      centerInsert.summer_lock_at = schedule.lockAtIso;
      centerInsert.summer_enrolled_at = nowIso;
    } else {
      // Normal billing: no trial. First invoice on the standard renewal cron ~30
      // days out; the cron re-anchors subsequent cadence per centers.billing_period.
      const firstDueYmd = addMonthsToDateStr(signupCairo, 1);
      centerInsert.subscription_start_date = signupCairo;
      centerInsert.billing_cycle_start = signupCairo;
      centerInsert.next_payment_due = firstDueYmd;
      centerInsert.auto_suspend_at = autoSuspendAtFromDue(firstDueYmd);
      // summer_status intentionally left NULL — not a trial center.
    }
    if (weeklyLimit != null) centerInsert.weekly_student_limit = weeklyLimit;
    if (referrerCenterId) {
      centerInsert.referred_by = referrerCenterId;
      centerInsert.referral_code_used_at = nowIso;
    }

    const { data: center, error: centerError } = await supabase
      .from('centers')
      .insert(centerInsert)
      .select('id')
      .single();

    if (centerError || !center?.id) {
      console.error('[signup] Center creation error:', centerError);
      await releasePhoneClaim();
      return NextResponse.json({ error: 'Failed to create signup request' }, { status: 500 });
    }

    const centerId = center.id as string;

    if (referrerCenterId && cleanRefCode) {
      const { error: refErr } = await supabase.from('referrals').insert({
        referrer_center_id: referrerCenterId,
        referred_center_id: centerId,
        referral_code: cleanRefCode,
        status: 'pending',
      });
      if (refErr) console.error('[signup] Referral link insert failed:', refErr);
    }

    // Provision the owner login immediately (auth user + owner row + PIN rails +
    // referral code + welcome). No payment / webhook required.
    try {
      await provisionCenterOwner(supabase, {
        centerId,
        centerName: centerName.trim(),
        ownerName: ownerName.trim(),
        phone: formattedPhone,
      });
    } catch (provErr) {
      console.error('[signup] owner provisioning failed:', provErr);
      Sentry.captureException(provErr, {
        tags: { route: 'signup', step: 'provisionCenterOwner' },
        extra: { centerId },
      });
      // Roll back so the phone can retry a clean trial.
      try {
        await supabase.from('centers').delete().eq('id', centerId);
      } catch {
        /* best-effort rollback */
      }
      await releasePhoneClaim();
      return NextResponse.json({ error: 'Failed to create signup request' }, { status: 500 });
    }

    // Record which center consumed the phone's free trial (audit; best-effort).
    await supabase.from('trial_claims').update({ center_id: centerId }).eq('phone', formattedPhone);

    // chq_signup_session proves the browser arriving at /set-pin initiated THIS
    // signup. It is not sufficient authority alone — /api/auth/set-initial-pin
    // AND-s it against the center's active+approved state and a live PIN token.
    const signed = signSignupSession(centerId);
    const response = NextResponse.json({ success: true, center_id: centerId, pinSetup: true });
    if (signed) {
      response.cookies.set({
        name: SIGNUP_SESSION_COOKIE,
        value: signed,
        ...SIGNUP_SESSION_COOKIE_OPTIONS,
      });
    } else {
      Sentry.captureMessage(
        'signup: chq_signup_session cookie not signed - CSRF_SECRET unset/malformed; owner can recover a PIN link via fallback',
        { level: 'error', tags: { route: 'signup', reason: 'signup_session_secret_missing' } },
      );
    }
    return response;
  } catch (error) {
    console.error('[signup] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
