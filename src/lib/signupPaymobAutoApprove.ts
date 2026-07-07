import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { createAction } from '@/lib/ceo';
import { isTemplateApproved, sendWelcomeTemplate } from '@/lib/centerNotify';
import { generateReferralCode } from '@/lib/referral';
import { todayISO } from '@/lib/parentPack';
import { autoSuspendAtFromDue } from '@/lib/billingSchedule';
import { normalizePhone } from '@/lib/utils/phone';
import { issueForWebhook as issuePinSetupTokenForWebhook } from '@/lib/pinSetupTokens';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';

/** Gate pending-payment signup WhatsApp text on same registry row as welcome/signup templates. */
const PENDING_SIGNUP_PAYMENT_WA_TEMPLATE = 'chq_welcome';

const WHATSAPP_META_TEST_PHONE_NUMBER_ID = '1013787185158313';

function parseConfigBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function waApiPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

function waApiToken(): string | null {
  return process.env.WHATSAPP_TOKEN || null;
}

function shouldSkipWaForTestPhoneId(): boolean {
  const phoneId = waApiPhoneNumberId();
  return !phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID;
}

async function waSendingEnabled(client: SupabaseClient): Promise<boolean> {
  const { data: cfg } = await client
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  return cfg?.value !== false;
}

/** Prefer Arabic when owner/center names contain Arabic script; otherwise English. */
function inferPendingSignupWaLocale(c: {
  owner_name?: string | null;
  name?: string | null;
}): 'ar' | 'en' {
  const s = `${c.owner_name ?? ''} ${c.name ?? ''}`;
  if (!s.trim()) return 'ar';
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s) ? 'ar' : 'en';
}

function pendingPaymentConfirmationBody(ownerName: string, locale: 'ar' | 'en'): string {
  const name = ownerName.trim() || (locale === 'ar' ? 'عميلنا العزيز' : 'there');
  if (locale === 'ar') {
    return `مرحباً ${name}! تلقينا طلبك وتم استلام الدفع بنجاح. سيتم مراجعة طلبك وتفعيل حسابك خلال ساعات قليلة. شكراً لاختيارك TutoringHQ.`;
  }
  return `Hi ${name}! We received your application and payment. Your account will be reviewed and activated within a few hours. Thank you for choosing TutoringHQ.`;
}

/**
 * Plain-text WhatsApp (same env/credentials as centerNotify). Logs only; never throws.
 */
async function sendPendingSignupPaymentWhatsApp(
  supabase: SupabaseClient,
  opts: {
    toDigits: string;
    ownerName: string;
    locale: 'ar' | 'en';
  },
): Promise<void> {
  if (!(await isTemplateApproved(PENDING_SIGNUP_PAYMENT_WA_TEMPLATE, supabase))) {
    console.warn(
      `[signupInvoiceAutoApprove] skipped, template not approved: ${PENDING_SIGNUP_PAYMENT_WA_TEMPLATE}`,
    );
    return;
  }

  if (!(await waSendingEnabled(supabase))) {
    console.warn('[signupInvoiceAutoApprove] skipped, wa_sending_enabled is false');
    return;
  }

  if (shouldSkipWaForTestPhoneId()) {
    console.warn(
      '[signupInvoiceAutoApprove] skipped, Meta test PHONE_NUMBER_ID or missing phone number ID',
    );
    return;
  }

  const phoneId = waApiPhoneNumberId();
  const token = waApiToken();
  if (!phoneId || !token) {
    console.warn(
      '[signupInvoiceAutoApprove] pending payment WA skipped, missing PHONE_NUMBER_ID/WHATSAPP_PHONE_ID or WHATSAPP_TOKEN',
    );
    return;
  }
  const body = pendingPaymentConfirmationBody(opts.ownerName, opts.locale);
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: opts.toDigits,
        type: 'text',
        text: { body },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('[signupInvoiceAutoApprove] pending payment WA send failed:', res.status, txt);
      return;
    }
    console.info('[signupInvoiceAutoApprove] pending payment WA sent successfully', {
      to: `${opts.toDigits.slice(0, 4)}…`,
    });
  } catch (e) {
    console.error('[signupInvoiceAutoApprove] pending payment WA send error:', e);
  }
}

function addCalendarDaysFromToday(days: number): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function nextPaymentDueDaysForPeriod(bp: BillingPeriod): number {
  if (bp === 'monthly') return 30;
  if (bp === 'annual') return 365;
  return 90;
}

function addDaysToYmd(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function resolveBillingForAutoApprove(
  supabase: SupabaseClient,
  centerId: string,
  c: {
    name: string;
    plan: string | null;
    billing_period?: string | null;
    subscription_billing_period?: string | null;
    all_in_price?: number | null;
  },
): Promise<{
  billingAmount: number;
  allIn: number;
  period: BillingPeriod;
  planKey: string;
  nextPaymentDue: string;
  autoSuspendYmd: string;
} | null> {
  const planKey = c.plan ?? 'starter';
  const { data: priceByKey } = await supabase
    .from('pricing_plans')
    .select('all_in_price, monthly_fee, plan_key, id')
    .eq('plan_key', planKey)
    .maybeSingle();

  let priceRow = priceByKey;
  if (!priceRow) {
    const { data: byId } = await supabase
      .from('pricing_plans')
      .select('all_in_price, monthly_fee, plan_key, id')
      .eq('id', planKey)
      .maybeSingle();
    priceRow = byId ?? null;
  }

  let allIn = Number((priceRow as { all_in_price?: number | null } | null)?.all_in_price);
  const monthlyFee = Number((priceRow as { monthly_fee?: number | null } | null)?.monthly_fee);

  if (!Number.isFinite(allIn) || allIn <= 0) {
    const custom = Number(c.all_in_price);
    if (Number.isFinite(custom) && custom > 0) {
      allIn = custom;
    }
  }

  if (!Number.isFinite(allIn) || allIn <= 0 || !Number.isFinite(monthlyFee) || monthlyFee <= 0) {
    console.info(`[signupInvoiceAutoApprove] Cannot auto-approve: invalid pricing for plan ${planKey}`);
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: `Cannot auto-approve: invalid pricing for plan ${planKey}`,
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupInvoiceAutoApprove] ceo_action_queue invalid pricing', e);
    }
    return null;
  }

  const period = normalizeBillingPeriod(
    c.subscription_billing_period ?? c.billing_period,
  ) as BillingPeriod;
  const pk: PlanKey | undefined = isPlanKey(planKey) ? planKey : undefined;
  const billingAmount = getChargeFromQuarterlyAllIn(allIn, period, pk);

  if (!Number.isFinite(billingAmount) || billingAmount <= 0) {
    console.info(`[signupInvoiceAutoApprove] Cannot auto-approve: billing_amount invalid for plan ${planKey}`);
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: `Cannot auto-approve: invalid billing amount for plan ${planKey}`,
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupInvoiceAutoApprove] ceo_action_queue billing amount', e);
    }
    return null;
  }

  const startYmd = todayISO();
  const dueDays = nextPaymentDueDaysForPeriod(period);
  const nextPaymentDue = addDaysToYmd(startYmd, dueDays);
  // Single-day lock (2e): Cairo-midnight after the due date (ISO), not the old +8d grace.
  const autoSuspendYmd = autoSuspendAtFromDue(nextPaymentDue);

  return { billingAmount, allIn, period, planKey, nextPaymentDue, autoSuspendYmd };
}

/**
 * After Paymob marks a signup_first_payment invoice paid: pending_payment center → pending or active (+ owner user when auto-approved).
 */
export async function processInvoiceSignupAfterPaymobSuccess(
  supabase: SupabaseClient,
  centerId: string,
  paymobTransactionId: string,
): Promise<void> {
  const { data: center, error: centerErr } = await supabase
    .from('centers')
    .select(
      'id, name, owner_name, plan, billing_period, subscription_billing_period, all_in_price, status, phone, email',
    )
    .eq('id', centerId)
    .eq('status', 'pending_payment')
    .maybeSingle();

  if (centerErr || !center) return;

  const c = center as {
    id: string;
    name: string;
    owner_name?: string | null;
    plan: string | null;
    billing_period?: string | null;
    subscription_billing_period?: string | null;
    all_in_price?: number | null;
    status?: string | null;
    phone?: string | null;
    email?: string | null;
  };

  const { data: existingOwner } = await supabase
    .from('users')
    .select('id')
    .eq('center_id', centerId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  if (existingOwner) return;

  const { data: autoRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'auto_approve_signups')
    .maybeSingle();
  const { data: pauseRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'pause_new_signups')
    .maybeSingle();

  const autoApprove = parseConfigBool(autoRow?.value);
  const pauseIntake = parseConfigBool(pauseRow?.value);

  if (pauseIntake) {
    const { error: updErr } = await supabase
      .from('centers')
      .update({
        status: 'paid_pending_activation',
        billing_status: 'paid',
      })
      .eq('id', centerId)
      .eq('status', 'pending_payment');

    if (updErr) {
      console.error('[signupInvoiceAutoApprove] paid_pending_activation', updErr);
      return;
    }

    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: 'Signup paid but intake paused',
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupInvoiceAutoApprove] ceo_action_queue intake paused', e);
    }
    return;
  }

  if (!autoApprove) {
    const { error: pendErr } = await supabase
      .from('centers')
      .update({ status: 'pending' })
      .eq('id', centerId)
      .eq('status', 'pending_payment');
    if (pendErr) {
      console.error('[signupInvoiceAutoApprove] set pending', pendErr);
      return;
    }
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: 'Signup payment received, manual approval required',
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupInvoiceAutoApprove] ceo pending notify', e);
    }

    try {
      const phoneRaw = (c.phone ?? '').trim();
      const normalizedPhone = normalizePhone(phoneRaw);
      const phoneDigits = normalizedPhone.replace(/\D/g, '');
      if (!phoneDigits) {
        console.warn('[signupInvoiceAutoApprove] pending payment WA skipped, no valid phone', centerId);
      } else {
        const locale = inferPendingSignupWaLocale(c);
        const ownerDisplay =
          (c.owner_name ?? '').trim() || (c.name ?? '').trim() || (locale === 'ar' ? 'عميلنا العزيز' : 'there');
        await sendPendingSignupPaymentWhatsApp(supabase, {
          toDigits: phoneDigits,
          ownerName: ownerDisplay,
          locale,
        });
      }
    } catch (e) {
      console.error('[signupInvoiceAutoApprove] pending payment WA block error:', e);
    }

    return;
  }

  const resolved = await resolveBillingForAutoApprove(supabase, centerId, c);
  if (!resolved) return;

  const { billingAmount, allIn, period, planKey, nextPaymentDue, autoSuspendYmd } = resolved;
  const phoneRaw = (c.phone ?? '').trim();
  if (!phoneRaw) {
    console.error('[signupInvoiceAutoApprove] no phone on center', centerId);
    return;
  }

  const normalizedPhone = normalizePhone(phoneRaw);
  const phoneDigits = normalizedPhone.replace(/\D/g, '');
  if (!phoneDigits) {
    console.error('[signupInvoiceAutoApprove] invalid phone', centerId);
    return;
  }

  // Placeholder password - 256 bits of entropy, never told to anyone. Overwritten
  // by /api/auth/set-initial-pin once the owner chooses their own PIN. Until
  // then, public.users.pin_set_at stays NULL, which is the "no PIN yet" gate.
  const placeholderPassword = randomBytes(32).toString('base64url');
  const authEmail = `${phoneDigits}@centerhq.local`;

  const { data: authData, error: createAuthError } = await supabase.auth.admin.createUser({
    email: authEmail,
    password: placeholderPassword,
    email_confirm: true,
  });

  if (createAuthError || !authData?.user?.id) {
    const msg = createAuthError?.message ?? '';
    console.error('[signupInvoiceAutoApprove] auth create', createAuthError);
    await supabase.from('centers').update({ status: 'pending' }).eq('id', centerId);
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'red',
        center_id: centerId,
        title: `Auto-approve blocked: auth error ${msg.slice(0, 80)}`,
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupInvoiceAutoApprove] ceo auth error', e);
    }
    return;
  }

  const userId = authData.user.id;

  const { error: userInsErr } = await supabase.from('users').insert({
    id: userId,
    center_id: centerId,
    role: 'owner',
    phone: normalizedPhone,
    name: (c.owner_name as string) ?? c.name ?? null,
    // pin_set_at is left NULL (column default) until the owner sets their PIN via
    // /set-pin. Routes gate on it to distinguish "owner has not yet set a PIN"
    // from "owner has a PIN and wants to change it" (change-pin's job).
    preferred_locale: 'ar',
    can_scan: true,
    can_view_payments: true,
    can_record_payments: true,
    can_view_dashboard: true,
    can_view_revenue: true,
    can_manage_students: true,
    can_manage_groups: true,
    can_manage_rooms: true,
    can_view_schedule: true,
    can_view_settings: true,
    can_allow_late_entry: true,
    is_active: true,
  });

  if (userInsErr) {
    console.error('[signupInvoiceAutoApprove] users insert', userInsErr);
    await supabase.auth.admin.deleteUser(userId);
    await supabase.from('centers').update({ status: 'pending' }).eq('id', centerId);
    return;
  }

  // Set-PIN grant: webhook-issued row marks the user as eligible for the
  // owner-chooses-their-own-PIN onboarding flow. Idempotent against webhook
  // replays via the pin_setup_tokens_one_live_webhook_per_user_idx unique
  // index. Failure here MUST NOT roll back the user / activation - the owner
  // can recover via /api/auth/request-pin-setup-link - but it MUST surface to
  // Sentry so ops sees a degraded onboarding state.
  try {
    await issuePinSetupTokenForWebhook(supabase, { userId });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'signupPaymobAutoApprove', step: 'issuePinSetupToken' },
      extra: { centerId, userId },
    });
    console.error('[signupInvoiceAutoApprove] issuePinSetupToken', e);
  }

  const pkTyped = isPlanKey(planKey) ? planKey : 'starter';
  const weeklyLimit = PLANS[pkTyped]?.weeklyStudentLimit ?? null;

  const centerUpdates: Record<string, unknown> = {
    status: 'active',
    subscription_status: 'active',
    billing_status: 'active',
    approved_at: new Date().toISOString(),
    billing_amount: billingAmount,
    all_in_price: allIn,
    // Column vocabulary is {monthly, yearly} — canonical 'annual' must not be
    // echoed back verbatim or the CHECK rejects the activation write.
    subscription_billing_period: period === 'annual' ? 'yearly' : 'monthly',
    next_payment_due: nextPaymentDue,
    subscription_start_date: todayISO(),
    auto_suspend_at: autoSuspendYmd,
  };
  if (weeklyLimit != null) centerUpdates.weekly_student_limit = weeklyLimit;

  const { error: actErr } = await supabase.from('centers').update(centerUpdates).eq('id', centerId);

  if (actErr) {
    console.error('[signupInvoiceAutoApprove] center activation', actErr);
    return;
  }

  let generatedCode = generateReferralCode(c.name);
  for (let attempts = 0; attempts < 5; attempts++) {
    const { error: rcError } = await supabase
      .from('referral_codes')
      .insert({ center_id: centerId, code: generatedCode });
    if (!rcError) {
      await supabase.from('centers').update({ referral_code: generatedCode }).eq('id', centerId);
      break;
    }
    generatedCode = generateReferralCode(c.name);
  }

  try {
    const { data: waCfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (waCfg?.value !== false) {
      try {
        await sendWelcomeTemplate(supabase, { id: centerId, name: c.name, phone: c.phone ?? null });
      } catch (waErr) {
        console.error('[signupInvoiceAutoApprove] WA send error:', waErr);
      }
    }
  } catch (e) {
    console.error('[signupInvoiceAutoApprove] chq_welcome', e);
  }

  try {
    await supabase.from('cron_log').insert({
      cron_name: 'auto_approve',
      status: 'success',
      records_processed: 1,
      metadata: { center_id: centerId, paymob_txn: paymobTransactionId, source: 'signup_invoice' },
    });
  } catch (e) {
    console.error('[signupInvoiceAutoApprove] cron_log', e);
  }

  try {
    await createAction(supabase, {
      type: 'ops',
      priority: 'green',
      center_id: centerId,
      title: `Signup auto-approved (Paymob): ${c.name}`,
      revenue_at_risk: 0,
      auto_generated: true,
    });
  } catch (e) {
    console.error('[signupInvoiceAutoApprove] ceo briefing', e);
  }
}

/**
 * After Paymob success: finalize signup combined session (invoices + session row), then apply platform_config auto-approval rules.
 */
export async function processSignupAutoApprovalAfterPaymobSuccess(
  supabase: SupabaseClient,
  orderId: string,
  paymobTransactionId: string,
): Promise<void> {
  const { data: session } = await supabase
    .from('combined_payment_sessions')
    .select('id, center_id, status, session_type, invoice_ids')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  const row = session as {
    id: string;
    center_id: string;
    status: string;
    session_type: string;
    invoice_ids: string[] | null;
  } | null;

  if (!row || row.session_type !== 'signup') return;

  const invIds = Array.isArray(row.invoice_ids) ? row.invoice_ids : [];
  for (const invId of invIds) {
    const { error: invErr } = await supabase
      .from('invoices')
      .update({
        status: 'paid',
        payment_method: 'paymob',
        payment_reference: paymobTransactionId,
        paymob_transaction_id: paymobTransactionId,
        paid_at: new Date().toISOString(),
      })
      .eq('id', invId)
      .eq('center_id', row.center_id)
      .neq('status', 'paid');
    if (invErr) {
      console.error('[signupAutoApprove] invoice mark paid', invErr);
    }
  }

  const { data: sessionWinner } = await supabase
    .from('combined_payment_sessions')
    .update({
      status: 'paid',
      finalized_at: new Date().toISOString(),
      finalized_by: 'webhook',
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id, center_id')
    .maybeSingle();

  if (!sessionWinner) return;

  const centerId = sessionWinner.center_id as string;

  const { data: autoRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'auto_approve_signups')
    .maybeSingle();
  const { data: pauseRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'pause_new_signups')
    .maybeSingle();

  const autoApprove = parseConfigBool(autoRow?.value);
  const pauseIntake = parseConfigBool(pauseRow?.value);

  if (!autoApprove) {
    console.info('[signupAutoApprove] auto_approve_signups disabled, manual review needed');
    return;
  }

  const { data: center, error: centerErr } = await supabase
    .from('centers')
    .select(
      'id, name, plan, billing_period, subscription_billing_period, all_in_price, status, phone',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (centerErr || !center) {
    console.error('[signupAutoApprove] center load', centerErr);
    return;
  }

  const c = center as {
    id: string;
    name: string;
    plan: string | null;
    billing_period?: string | null;
    subscription_billing_period?: string | null;
    all_in_price?: number | null;
    status?: string | null;
    phone?: string | null;
  };

  if (pauseIntake) {
    const { error: updErr } = await supabase
      .from('centers')
      .update({
        status: 'paid_pending_activation',
        billing_status: 'paid',
      })
      .eq('id', centerId);

    if (updErr) {
      console.error('[signupAutoApprove] paid_pending_activation', updErr);
      return;
    }

    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: 'Center paid but intake paused',
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupAutoApprove] ceo_action_queue intake paused', e);
    }
    return;
  }

  const planKey = c.plan ?? 'starter';
  const { data: priceByKey } = await supabase
    .from('pricing_plans')
    .select('all_in_price, monthly_fee, plan_key, id')
    .eq('plan_key', planKey)
    .maybeSingle();

  let priceRow = priceByKey;
  if (!priceRow) {
    const { data: byId } = await supabase
      .from('pricing_plans')
      .select('all_in_price, monthly_fee, plan_key, id')
      .eq('id', planKey)
      .maybeSingle();
    priceRow = byId ?? null;
  }

  let allIn = Number((priceRow as { all_in_price?: number | null } | null)?.all_in_price);
  const monthlyFee = Number((priceRow as { monthly_fee?: number | null } | null)?.monthly_fee);

  if (!Number.isFinite(allIn) || allIn <= 0) {
    const custom = Number(c.all_in_price);
    if (Number.isFinite(custom) && custom > 0) {
      allIn = custom;
    }
  }

  if (!Number.isFinite(allIn) || allIn <= 0 || !Number.isFinite(monthlyFee) || monthlyFee <= 0) {
    console.info(`[signupAutoApprove] Cannot auto-approve: invalid pricing for plan ${planKey}`);
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: `Cannot auto-approve: invalid pricing for plan ${planKey}`,
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupAutoApprove] ceo_action_queue invalid pricing', e);
    }
    return;
  }

  const period = normalizeBillingPeriod(
    c.subscription_billing_period ?? c.billing_period,
  ) as BillingPeriod;
  const pk: PlanKey | undefined = isPlanKey(planKey) ? planKey : undefined;
  const billingAmount = getChargeFromQuarterlyAllIn(allIn, period, pk);

  if (!Number.isFinite(billingAmount) || billingAmount <= 0) {
    console.info(`[signupAutoApprove] Cannot auto-approve: billing_amount would be invalid for plan ${planKey}`);
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: `Cannot auto-approve: invalid billing amount for plan ${planKey}`,
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupAutoApprove] ceo_action_queue billing amount', e);
    }
    return;
  }

  const dueDays = nextPaymentDueDaysForPeriod(period);
  const nextPaymentDue = addCalendarDaysFromToday(dueDays);
  // Single-day lock (2e): Cairo-midnight after the due date (ISO), not +6d grace.
  const autoSuspendYmd = autoSuspendAtFromDue(nextPaymentDue);

  const { error: actErr } = await supabase
    .from('centers')
    .update({
      status: 'active',
      subscription_status: 'active',
      billing_status: 'active',
      approved_at: new Date().toISOString(),
      billing_amount: billingAmount,
      all_in_price: allIn,
      next_payment_due: nextPaymentDue,
      auto_suspend_at: autoSuspendYmd,
    })
    .eq('id', centerId);

  if (actErr) {
    console.error('[signupAutoApprove] center activation', actErr);
    return;
  }

  try {
    const { data: waCfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (waCfg?.value !== false) {
      try {
        await sendWelcomeTemplate(supabase, { id: centerId, name: c.name, phone: c.phone ?? null });
      } catch (waErr) {
        console.error('[signupAutoApprove] WA send error:', waErr);
      }
    }
  } catch (e) {
    console.error('[signupAutoApprove] chq_welcome', e);
  }

  try {
    await supabase.from('cron_log').insert({
      cron_name: 'auto_approve',
      status: 'success',
      records_processed: 1,
      metadata: { center_id: centerId, order_id: orderId },
    });
  } catch (e) {
    console.error('[signupAutoApprove] cron_log', e);
  }

  try {
    await createAction(supabase, {
      type: 'ops',
      priority: 'green',
      center_id: centerId,
      title: `1 center auto-approved: ${c.name}`,
      revenue_at_risk: 0,
      auto_generated: true,
    });
  } catch (e) {
    console.error('[signupAutoApprove] ceo briefing', e);
  }
}
