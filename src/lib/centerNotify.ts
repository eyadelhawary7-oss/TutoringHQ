import type { SupabaseClient } from '@supabase/supabase-js';
import { dateInNDays } from '@/lib/parentPack';
import { formatDate, formatNumber, formatCurrency } from '@/lib/formatNumber';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCourierDisplayName } from '@/lib/courierDisplayName';

const PLATFORM_URL = 'https://tutoringhq.app';

function publicAppBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? PLATFORM_URL).replace(/\/$/, '');
}

/** Arabic billing page for dormant centers (Paymob reactivation). */
export function reactivationBillingUrl(): string {
  return `${publicAppBase()}/ar/settings/billing`;
}

function formatDateArEg(ymd: string): string {
  const ymd10 = ymd.slice(0, 10);
  const d = new Date(`${ymd10}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd10;
  return formatDate(d, 'ar', { year: 'numeric', month: 'long', day: 'numeric' });
}

function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Result for all exported WA helpers - never throws to callers. */
export type CenterNotifyResult = {
  success?: boolean;
  skipped?: boolean;
  error?: boolean;
};

export async function isTemplateApproved(
  templateName: string,
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data } = await supabase
    .from('wa_meta_templates')
    .select('status')
    .eq('template_name', templateName)
    .maybeSingle();
  return data?.status === 'APPROVED';
}

function waPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

function waToken(): string | null {
  return process.env.WHATSAPP_TOKEN || null;
}

/** Meta test / sandbox phone number ID: do not send production freeform messages. */
const WHATSAPP_META_TEST_PHONE_NUMBER_ID = '1013787185158313';

const TEMPLATE_ONBOARDING_STEP2 = 'chq_onboarding_step2';
const TEMPLATE_ONBOARDING_STEP3 = 'chq_onboarding_step3';
const TEMPLATE_ONBOARDING_STEP4 = 'chq_onboarding_step4';
const TEMPLATE_TEAM_INVITE = 'chq_team_invite';
const TEMPLATE_ORDER_SHIPPED = 'chq_order_shipped';
const TEMPLATE_REFERRAL_COMMISSION = 'chq_referral_commission';
const TEMPLATE_WITHDRAWAL_PROCESSED = 'chq_withdrawal_processed';
const TEMPLATE_VENDOR_NEW_ORDER = 'chq_vendor_new_order';
const TEMPLATE_PARENT_ANNOUNCEMENT_PROMO = 'chq_parent_announcement_promo';
const TEMPLATE_PARENT_ANNOUNCEMENT_OPS = 'chq_parent_announcement_ops';
const TEMPLATE_PARENT_TERM_SUMMARY = 'chq_parent_term_summary';
const TEMPLATE_PIN_DELIVERY = 'chq_pin_delivery';
const TEMPLATE_PIN_SETUP_LINK = 'chq_pin_setup_link';

function serviceSupabase(): SupabaseClient | null {
  return supabaseAdmin;
}

export async function waSendingEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  return cfg?.value !== false;
}

/** Meta test / sandbox phone number ID: skip production template sends. */
function shouldSkipWaForTestPhoneId(): boolean {
  const phoneId = waPhoneNumberId();
  return !phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID;
}

async function canSendApprovedTemplate(
  supabase: SupabaseClient,
  templateName: string,
): Promise<boolean> {
  if (!(await waSendingEnabled(supabase))) return false;
  const approved = await isTemplateApproved(templateName, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${templateName}, not approved`);
    return false;
  }
  return true;
}

function onboardingTemplateLang(_locale?: string): 'ar_EG' {
  return 'ar_EG';
}

function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

function cairoDateFromTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

type WhatsappTemplateButtonComponent = {
  type: 'button';
  sub_type: 'quick_reply';
  index: string;
  parameters: { type: 'payload'; payload: string }[];
};

async function postWhatsappTemplate(opts: {
  templateName: string;
  languageCode: 'ar' | 'ar_EG';
  toDigits: string;
  bodyParameters: string[];
  /** Optional quick_reply button components (appended after body). */
  buttonsPayload?: WhatsappTemplateButtonComponent[];
}): Promise<boolean> {
  const phoneId = waPhoneNumberId();
  const token = waToken();
  if (!phoneId || !token) {
    console.warn('[centerNotify] Missing PHONE_NUMBER_ID/WHATSAPP_PHONE_ID or WHATSAPP_TOKEN');
    return false;
  }

  const components: (
    | { type: 'body'; parameters: { type: 'text'; text: string }[] }
    | WhatsappTemplateButtonComponent
  )[] = [
    {
      type: 'body',
      parameters: opts.bodyParameters.map((text) => ({ type: 'text', text })),
    },
  ];
  if (opts.buttonsPayload?.length) {
    components.push(...opts.buttonsPayload);
  }

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
        type: 'template',
        template: {
          name: opts.templateName,
          language: { code: opts.languageCode },
          components,
        },
      }),
    });

    if (!res.ok) {
      console.error('[centerNotify] Template send failed:', opts.templateName, res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[centerNotify] Template send error:', opts.templateName, err);
    return false;
  }
}

async function postWhatsappTextMessage(opts: { toDigits: string; body: string }): Promise<boolean> {
  const phoneId = waPhoneNumberId();
  const token = waToken();
  if (!phoneId || !token) {
    console.warn('[centerNotify] Missing PHONE_NUMBER_ID/WHATSAPP_PHONE_ID or WHATSAPP_TOKEN');
    return false;
  }

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
        text: { preview_url: true, body: opts.body },
      }),
    });

    if (!res.ok) {
      console.error('[centerNotify] Text send failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[centerNotify] Text send error:', err);
    return false;
  }
}

/** Outbound freeform text from the platform WhatsApp number (no center context). Never throws. */
export async function sendOperationalWhatsappText(toPhone: string, body: string): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const to = digitsOnly(toPhone);
    if (!to) return false;
    const text = body.trim();
    if (!text) return false;
    return await postWhatsappTextMessage({ toDigits: to, body: text });
  } catch (err) {
    console.error('[centerNotify] sendOperationalWhatsappText:', err);
    return false;
  }
}

/**
 * Onboarding stall nudge (freeform Arabic + deep link). Never throws.
 * Skips when Meta phone ID is the known test ID or WA is disabled.
 */
export async function sendOnboardingNudge(
  supabase: SupabaseClient,
  centerId: string,
  step: 1 | 2 | 3 | 4,
  ownerPhone: string | null,
  centerName: string,
): Promise<CenterNotifyResult> {
  try {
    const phoneId = waPhoneNumberId();
    if (!phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID) {
      return { skipped: true };
    }

    const { data: cfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (cfg?.value === false) return { skipped: true };

    const to = digitsOnly(ownerPhone ?? '');
    if (!to) return { skipped: true };

    const base = publicAppBase();
    const links: Record<1 | 2 | 3 | 4, string> = {
      1: `${base}/ar/students`,
      2: `${base}/ar/groups`,
      3: `${base}/ar/settings`,
      4: `${base}/ar/scan`,
    };
    const lines: Record<1 | 2 | 3 | 4, string> = {
      1: 'أضف أول طالب لك في المنصة',
      2: 'أنشئ أول مجموعة دراسية',
      3: 'فعّل إشعارات الواتساب',
      4: 'سجّل أول حضور QR',
    };

    const body = `${lines[step]}\n${links[step]}`;
    const ok = await postWhatsappTextMessage({ toDigits: to, body });
    if (ok) {
      console.info('[centerNotify] Onboarding nudge step', step, centerId, centerName);
      return { success: true };
    }
    return { error: true };
  } catch (err) {
    console.error('[centerNotify] sendOnboardingNudge:', centerId, err);
    return { error: true };
  }
}

/**
 * Upgrade nudge at ~80% student cap (freeform Arabic). Never throws.
 */
export async function sendUpgradeNudge(
  supabase: SupabaseClient,
  centerId: string,
  ownerPhone: string | null,
  ownerName: string,
  centerName: string,
  currentPlan: string,
  studentCount: string,
  cap: string,
  nextPlan: string,
  nextPlanPrice: string,
): Promise<CenterNotifyResult> {
  try {
    const phoneId = waPhoneNumberId();
    if (!phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID) {
      return { skipped: true };
    }

    const { data: cfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (cfg?.value === false) return { skipped: true };

    const to = digitsOnly(ownerPhone ?? '');
    if (!to) return { skipped: true };

    const greet = ownerName.trim() || centerName.trim();
    const body = `مرحباً ${greet}، وصل مركز ${centerName} إلى ${studentCount} طالب من أصل ${cap}.
فكّر في الترقية إلى خطة ${nextPlan} بـ ${nextPlanPrice}/شهر
لاستيعاب المزيد من الطلاب. تواصل معنا للترقية.`;

    const ok = await postWhatsappTextMessage({ toDigits: to, body });
    if (ok) {
      console.info('[centerNotify] Upgrade nudge', centerId, currentPlan, centerName);
      return { success: true };
    }
    return { error: true };
  } catch (err) {
    console.error('[centerNotify] sendUpgradeNudge:', centerId, err);
    return { error: true };
  }
}

const CHQ_INACTIVITY_LOGIN_LINK = `${publicAppBase()}/ar/login`;

/**
 * chq_inactivity_alert (owner re-engagement): owner name, center name, days inactive, login link.
 * Never throws.
 */
export async function sendInactivityAlert(
  supabase: SupabaseClient,
  centerId: string,
  ownerPhone: string | null,
  ownerName: string,
  centerName: string,
  daysInactive: number,
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_inactivity_alert';
  try {
    const { data: cfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (cfg?.value === false) return { skipped: true };

    const to = digitsOnly(ownerPhone ?? '');
    if (!to) return { skipped: true };

    const approved = await isTemplateApproved(TEMPLATE, supabase);
    if (!approved) {
      console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
      return { skipped: true };
    }

    const owner = ownerName.trim() || centerName.trim() || '-';
    const center = centerName.trim() || '-';
    const daysStr = formatNumber(daysInactive, 'ar');

    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar',
      toDigits: to,
      bodyParameters: [owner, center, daysStr, CHQ_INACTIVITY_LOGIN_LINK],
    });
    if (ok) {
      console.info('[centerNotify] chq_inactivity_alert re-engage', centerId, centerName);
      return { success: true };
    }
    console.error(`[centerNotify] ${TEMPLATE} send failed`, centerId);
    return { error: true };
  } catch (err) {
    console.error('[centerNotify] sendInactivityAlert:', centerId, err);
    return { error: true };
  }
}

const TEMPLATE_PAYMENT_RETRY = 'chq_payment_retry';

/**
 * First payment-retry nudge: chq_payment_retry if approved, else Arabic freeform with link.
 * Second (urgent): chq_renewal_overdue plus a follow-up text with the Paymob link. Never throws.
 */
export async function sendPaymentRetry(
  supabase: SupabaseClient,
  centerId: string,
  ownerPhone: string | null,
  ownerName: string,
  centerName: string,
  amount: number,
  paymentLink: string,
  isUrgent: boolean,
): Promise<CenterNotifyResult> {
  try {
    const phoneId = waPhoneNumberId();
    if (!phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID) {
      return { skipped: true };
    }

    const { data: cfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (cfg?.value === false) return { skipped: true };

    const to = digitsOnly(ownerPhone ?? '');
    if (!to) return { skipped: true };

    const amountStr = formatCurrency(amount, 'ar');

    if (isUrgent) {
      try {
        const r = await sendChqRenewalOverdueTemplate(supabase, {
          name: ownerName || centerName || ',',
          phone: ownerPhone,
          daysLate: '2',
          amountStr,
        });
        if (r.error) {
          return { error: true };
        }
      } catch (e) {
        console.error('[centerNotify] sendPaymentRetry urgent template:', centerId, e);
      }
      try {
        const ok = await postWhatsappTextMessage({
          toDigits: to,
          body:
            `تنبيه عاجل: يرجى السداد خلال يومين لتجنب إيقاف الخدمة.\n` +
            `المبلغ: ${amountStr}\n` +
            `رابط الدفع:\n${paymentLink}`,
        });
        return ok ? { success: true } : { error: true };
      } catch (e) {
        console.error('[centerNotify] sendPaymentRetry urgent link:', centerId, e);
        return { error: true };
      }
    }

    const approved = await isTemplateApproved(TEMPLATE_PAYMENT_RETRY, supabase);
    if (approved) {
      try {
        const ok = await postWhatsappTemplate({
          templateName: TEMPLATE_PAYMENT_RETRY,
          languageCode: 'ar_EG',
          toDigits: to,
          bodyParameters: [ownerName || ',', centerName || ',', amountStr, paymentLink],
        });
        if (!ok) {
          console.error(`[centerNotify] ${TEMPLATE_PAYMENT_RETRY} send failed:`, centerId);
          return { error: true };
        }
        return { success: true };
      } catch (e) {
        console.error(`[centerNotify] ${TEMPLATE_PAYMENT_RETRY}:`, centerId, e);
        return { error: true };
      }
    }

    const body = `مرحباً ${ownerName || ','}، فاتورة مركز ${centerName || ','} بقيمة ${amountStr} لم تُسدَّد بعد. اضغط هنا للدفع: ${paymentLink}`;
    try {
      const ok = await postWhatsappTextMessage({ toDigits: to, body });
      return ok ? { success: true } : { error: true };
    } catch (e) {
      console.error('[centerNotify] sendPaymentRetry freeform:', centerId, e);
      return { error: true };
    }
  } catch (err) {
    console.error('[centerNotify] sendPaymentRetry:', centerId, err);
    return { error: true };
  }
}

/** chq_renewal_overdue - used by subscription billing cron (Items 2–3). */
export async function sendChqRenewalOverdueTemplate(
  supabase: SupabaseClient,
  opts: {
    name: string;
    phone: string | null;
    daysLate: string;
    amountStr: string;
  },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_renewal_overdue';
  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return { skipped: true };
  }

  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name ?? ',', opts.daysLate, opts.amountStr],
    });
    if (!ok) {
      console.error(`[centerNotify] ${TEMPLATE} send failed:`, opts.name);
      return { error: true };
    }
    return { success: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, err);
    return { error: true };
  }
}

/** chq_dormancy_notice - variables: center_name, dormancy_date, reactivation_url */
export async function sendChqDormancyNoticeTemplate(
  supabase: SupabaseClient,
  opts: { name: string; phone: string | null; dormancyDateStr: string; reactivationUrl: string },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_dormancy_notice';
  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };
  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, template not APPROVED in wa_meta_templates`);
    return { skipped: true };
  }
  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name ?? ',', opts.dormancyDateStr, opts.reactivationUrl],
    });
    return ok ? { success: true } : { error: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE}:`, err);
    return { error: true };
  }
}

/** Loads center and sends dormancy notice (skips if template not APPROVED). */
export async function sendDormancyNotice(
  supabase: SupabaseClient,
  centerId: string,
): Promise<CenterNotifyResult> {
  const { data: row, error } = await supabase
    .from('centers')
    .select('name, phone, dormancy_date')
    .eq('id', centerId)
    .maybeSingle();
  if (error || !row) {
    console.warn('[centerNotify] sendDormancyNotice: center not found', centerId);
    return { skipped: true };
  }
  const c = row as { name: string | null; phone: string | null; dormancy_date: string | null };
  const dormYmd = c.dormancy_date ? String(c.dormancy_date).slice(0, 10) : '';
  const dormancyDateStr = dormYmd ? formatDateArEg(dormYmd) : ',';
  return sendChqDormancyNoticeTemplate(supabase, {
    name: c.name ?? ',',
    phone: c.phone,
    dormancyDateStr,
    reactivationUrl: reactivationBillingUrl(),
  });
}

/** chq_reactivation_warning_90 - variables: center_name, deletion_date */
export async function sendChqReactivationWarning90Template(
  supabase: SupabaseClient,
  opts: { name: string; phone: string | null; deletionDateStr: string },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_reactivation_warning_90';
  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };
  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, template not APPROVED in wa_meta_templates`);
    return { skipped: true };
  }
  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name ?? ',', opts.deletionDateStr],
    });
    return ok ? { success: true } : { error: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE}:`, err);
    return { error: true };
  }
}

/** ~9 months dormant (cron): deletion date = 12 months after dormancy_date. */
export async function sendReactivationWarning90(
  supabase: SupabaseClient,
  centerId: string,
): Promise<CenterNotifyResult> {
  const { data: row, error } = await supabase
    .from('centers')
    .select('name, phone, dormancy_date')
    .eq('id', centerId)
    .maybeSingle();
  if (error || !row) {
    console.warn('[centerNotify] sendReactivationWarning90: center not found', centerId);
    return { skipped: true };
  }
  const c = row as { name: string | null; phone: string | null; dormancy_date: string | null };
  const dormYmd = c.dormancy_date ? String(c.dormancy_date).slice(0, 10) : '';
  if (!dormYmd) return { skipped: true };
  const deletionYmd = addMonthsYmd(dormYmd, 12);
  const deletionDateStr = formatDateArEg(deletionYmd);
  return sendChqReactivationWarning90Template(supabase, {
    name: c.name ?? ',',
    phone: c.phone,
    deletionDateStr,
  });
}

/** chq_reactivation_warning_30 - variables: center_name, deletion_date */
export async function sendChqReactivationWarning30Template(
  supabase: SupabaseClient,
  opts: { name: string; phone: string | null; deletionDateStr: string },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_reactivation_warning_30';
  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };
  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, template not APPROVED in wa_meta_templates`);
    return { skipped: true };
  }
  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name ?? ',', opts.deletionDateStr],
    });
    return ok ? { success: true } : { error: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE}:`, err);
    return { error: true };
  }
}

export async function sendReactivationWarning30(
  supabase: SupabaseClient,
  centerId: string,
): Promise<CenterNotifyResult> {
  const { data: row, error } = await supabase
    .from('centers')
    .select('name, phone, dormancy_date')
    .eq('id', centerId)
    .maybeSingle();
  if (error || !row) {
    console.warn('[centerNotify] sendReactivationWarning30: center not found', centerId);
    return { skipped: true };
  }
  const c = row as { name: string | null; phone: string | null; dormancy_date: string | null };
  const dormYmd = c.dormancy_date ? String(c.dormancy_date).slice(0, 10) : '';
  if (!dormYmd) return { skipped: true };
  const deletionYmd = addMonthsYmd(dormYmd, 12);
  const deletionDateStr = formatDateArEg(deletionYmd);
  return sendChqReactivationWarning30Template(supabase, {
    name: c.name ?? ',',
    phone: c.phone,
    deletionDateStr,
  });
}

/** chq_data_deletion_notice - variables: center_name, deletion_date */
export async function sendChqDataDeletionNoticeTemplate(
  supabase: SupabaseClient,
  opts: { name: string; phone: string | null; deletionDateStr: string },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_data_deletion_notice';
  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };
  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, template not APPROVED in wa_meta_templates`);
    return { skipped: true };
  }
  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name ?? ',', opts.deletionDateStr],
    });
    return ok ? { success: true } : { error: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE}:`, err);
    return { error: true };
  }
}

/** After operational purge: uses purge date (today) as deletion_date in copy. */
export async function sendDataDeletionNotice(
  supabase: SupabaseClient,
  centerId: string,
  purgeDateYmd?: string,
): Promise<CenterNotifyResult> {
  const { data: row, error } = await supabase
    .from('centers')
    .select('name, phone')
    .eq('id', centerId)
    .maybeSingle();
  if (error || !row) {
    console.warn('[centerNotify] sendDataDeletionNotice: center not found', centerId);
    return { skipped: true };
  }
  const c = row as { name: string | null; phone: string | null };
  const ymd = (purgeDateYmd ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const deletionDateStr = formatDateArEg(ymd);
  return sendChqDataDeletionNoticeTemplate(supabase, {
    name: c.name ?? ',',
    phone: c.phone,
    deletionDateStr,
  });
}

/** WhatsApp owner confirmation after Paymob subscription payment (wraps chq_payment_confirmed). */
export async function sendPaymentConfirmed(
  supabase: SupabaseClient,
  ownerPhone: string,
  centerName: string,
  periodStr: string,
  amountStr: string,
): Promise<CenterNotifyResult> {
  return sendChqPaymentConfirmedTemplate(supabase, {
    name: centerName,
    phone: ownerPhone,
    billingPeriodLabel: periodStr,
    billingAmountStr: amountStr,
  });
}

/** chq_payment_confirmed - Paymob subscription / renewal success (Item 7). */
export async function sendChqPaymentConfirmedTemplate(
  supabase: SupabaseClient,
  opts: { name: string; phone: string | null; billingPeriodLabel: string; billingAmountStr: string },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_payment_confirmed';
  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  if (cfg?.value === false) return { skipped: true };

  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return { skipped: true };
  }

  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name, opts.billingPeriodLabel, opts.billingAmountStr],
    });
    if (!ok) {
      console.error(`[centerNotify] ${TEMPLATE} send failed:`, opts.name);
      return { error: true };
    }
    return { success: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, err);
    return { error: true };
  }
}

/** chq_pack_invoice - Parent Pack monthly or partial invoice (Session D). Pass `templateEnabled` from route flag. */
export async function sendChqPackInvoiceTemplate(
  supabase: SupabaseClient,
  templateEnabled: boolean,
  opts: {
    name: string;
    phone: string | null;
    monthArabic: string;
    parentCountStr: string;
    amountStr: string;
  },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_pack_invoice';
  if (!templateEnabled) return { skipped: true };

  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  if (cfg?.value === false) return { skipped: true };

  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return { skipped: true };
  }

  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name, opts.monthArabic, opts.parentCountStr, opts.amountStr],
    });
    if (!ok) {
      console.error(`[centerNotify] ${TEMPLATE} send failed:`, opts.name);
      return { error: true };
    }
    return { success: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, err);
    return { error: true };
  }
}

/** chq_credit_expiry - credits expiring within 30 days (billing engine). Enable when template is Active in Meta. */
export async function sendChqCreditExpiryTemplate(
  supabase: SupabaseClient,
  templateEnabled: boolean,
  opts: { name: string; phone: string | null; amountStr: string; expiresOnStr: string },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_credit_expiry';
  if (!templateEnabled) return { skipped: true };

  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  if (cfg?.value === false) return { skipped: true };

  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return { skipped: true };
  }

  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name, opts.amountStr, opts.expiresOnStr],
    });
    if (!ok) {
      console.error(`[centerNotify] ${TEMPLATE} send failed:`, opts.name);
      return { error: true };
    }
    return { success: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, err);
    return { error: true };
  }
}

const TEMPLATE_WEEKLY_SUMMARY = 'chq_weekly_summary';

/** chq_weekly_summary - weekly owner stats + rotating tip (Automation 5). Never throws. */
export async function sendWeeklyReport(
  supabase: SupabaseClient,
  centerId: string,
  ownerPhone: string | null,
  ownerName: string,
  centerName: string,
  activeStudents: number,
  sessions: number,
  revenue: number,
  newStudents: number,
  tip: string,
): Promise<CenterNotifyResult> {
  try {
    const { data: cfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (cfg?.value === false) return { skipped: true };

    const to = digitsOnly(ownerPhone ?? '');
    if (!to) return { skipped: true };

    const approved = await isTemplateApproved(TEMPLATE_WEEKLY_SUMMARY, supabase);
    if (!approved) {
      console.warn(`[centerNotify] Skipping ${TEMPLATE_WEEKLY_SUMMARY}, not approved`);
      return { skipped: true };
    }

    const activeStr = formatNumber(activeStudents, 'ar');
    const sessionsStr = formatNumber(sessions, 'ar');
    const revenueStr = formatCurrency(revenue, 'ar');
    const newStr = formatNumber(newStudents, 'ar');

    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE_WEEKLY_SUMMARY,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [ownerName, centerName, activeStr, sessionsStr, revenueStr, newStr, tip],
    });
    if (!ok) {
      console.error(`[centerNotify] ${TEMPLATE_WEEKLY_SUMMARY} send failed:`, centerId, centerName);
      return { error: true };
    }
    console.info(`[centerNotify] ${TEMPLATE_WEEKLY_SUMMARY} sent`, centerId, centerName);
    return { success: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE_WEEKLY_SUMMARY} send failed:`, centerId, err);
    return { error: true };
  }
}

/** chq_payment_failed - subscription Paymob failure (Session E). Pass `templateEnabled` from route flag. */
export async function sendChqPaymentFailedTemplate(
  supabase: SupabaseClient,
  templateEnabled: boolean,
  opts: { name: string; phone: string | null; amountStr: string },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_payment_failed';
  if (!templateEnabled) return { skipped: true };

  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  if (cfg?.value === false) return { skipped: true };

  const to = digitsOnly(opts.phone ?? '');
  if (!to) return { skipped: true };

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return { skipped: true };
  }

  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [opts.name, opts.amountStr],
    });
    if (!ok) {
      console.error(`[centerNotify] ${TEMPLATE} send failed:`, opts.name);
      return { error: true };
    }
    return { success: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, err);
    return { error: true };
  }
}

export async function sendWelcomeTemplate(
  supabase: SupabaseClient,
  center: {
    id: string;
    name: string;
    phone: string | null;
  },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_welcome';
  if (!center.phone || !digitsOnly(center.phone)) {
    console.warn('[centerNotify] Welcome skipped, no phone', center.id);
    return { skipped: true };
  }

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return { skipped: true };
  }

  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: digitsOnly(center.phone),
      bodyParameters: [center.name, PLATFORM_URL, center.phone],
    });
    if (ok) {
      console.info('[centerNotify] Welcome sent to', center.name);
      return { success: true };
    }
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, center.name);
    return { error: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, err);
    return { error: true };
  }
}

export async function sendOnboardingStep1Template(
  supabase: SupabaseClient,
  center: {
    id: string;
    name: string;
    phone: string | null;
  },
): Promise<CenterNotifyResult> {
  const TEMPLATE = 'chq_onboarding_step1';
  if (!center.phone || !digitsOnly(center.phone)) {
    console.warn('[centerNotify] Onboarding step1 skipped, no phone', center.id);
    return { skipped: true };
  }

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return { skipped: true };
  }

  try {
    const ok = await postWhatsappTemplate({
      templateName: TEMPLATE,
      languageCode: 'ar_EG',
      toDigits: digitsOnly(center.phone),
      bodyParameters: [center.name, PLATFORM_URL],
    });
    if (ok) {
      console.info('[centerNotify] Onboarding step1 sent to', center.name);
      return { success: true };
    }
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, center.name);
    return { error: true };
  } catch (err) {
    console.error(`[centerNotify] ${TEMPLATE} send failed:`, err);
    return { error: true };
  }
}

export async function sendOnboardingStep2(
  phone: string,
  ownerName: string,
  centerName: string,
  locale?: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_ONBOARDING_STEP2))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const base = publicAppBase();
    const groupsUrl = `${base}/ar/groups`;
    const owner = ownerName.trim() || centerName.trim() || ',';
    const center = centerName.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_ONBOARDING_STEP2,
      languageCode: onboardingTemplateLang(locale),
      toDigits: to,
      bodyParameters: [owner, center, groupsUrl],
    });
  } catch (err) {
    console.error('[centerNotify] sendOnboardingStep2:', err);
    return false;
  }
}

export async function sendOnboardingStep3(
  phone: string,
  ownerName: string,
  centerName: string,
  locale?: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_ONBOARDING_STEP3))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const base = publicAppBase();
    const settingsUrl = `${base}/ar/settings`;
    const owner = ownerName.trim() || centerName.trim() || ',';
    const center = centerName.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_ONBOARDING_STEP3,
      languageCode: onboardingTemplateLang(locale),
      toDigits: to,
      bodyParameters: [owner, center, settingsUrl],
    });
  } catch (err) {
    console.error('[centerNotify] sendOnboardingStep3:', err);
    return false;
  }
}

export async function sendOnboardingStep4(
  phone: string,
  ownerName: string,
  centerName: string,
  locale?: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_ONBOARDING_STEP4))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const base = publicAppBase();
    const scanUrl = `${base}/ar/scan`;
    const owner = ownerName.trim() || centerName.trim() || ',';
    const center = centerName.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_ONBOARDING_STEP4,
      languageCode: onboardingTemplateLang(locale),
      toDigits: to,
      bodyParameters: [owner, center, scanUrl],
    });
  } catch (err) {
    console.error('[centerNotify] sendOnboardingStep4:', err);
    return false;
  }
}

export async function sendTeamInvite(
  phone: string,
  inviteeName: string,
  centerName: string,
  role: string,
  inviteToken: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_TEAM_INVITE))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const base = publicAppBase();
    const inviteUrl = `${base}/ar/accept-invite?token=${encodeURIComponent(inviteToken)}`;
    const name = inviteeName.trim() || ',';
    const center = centerName.trim() || ',';
    const roleLabel = role.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_TEAM_INVITE,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [name, center, roleLabel, inviteUrl],
    });
  } catch (err) {
    console.error('[centerNotify] sendTeamInvite:', err);
    return false;
  }
}

export async function sendOrderShipped(
  phone: string,
  ownerName: string,
  centerName: string,
  cardCount: number,
  trackingUrl: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_ORDER_SHIPPED))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const owner = ownerName.trim() || centerName.trim() || ',';
    const center = centerName.trim() || ',';
    const countStr = formatNumber(cardCount, 'ar');
    const track = trackingUrl.trim() || publicAppBase();
    return await postWhatsappTemplate({
      templateName: TEMPLATE_ORDER_SHIPPED,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [owner, center, countStr, track],
    });
  } catch (err) {
    console.error('[centerNotify] sendOrderShipped:', err);
    return false;
  }
}

export async function sendReferralCommission(
  phone: string,
  ownerName: string,
  referredCenterName: string,
  commissionAmount: number,
  totalBalance: number,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_REFERRAL_COMMISSION))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const owner = ownerName.trim() || ',';
    const referred = referredCenterName.trim() || ',';
    const amt = formatNumber(commissionAmount, 'ar');
    const total = formatNumber(totalBalance, 'ar');
    return await postWhatsappTemplate({
      templateName: TEMPLATE_REFERRAL_COMMISSION,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [owner, referred, amt, total],
    });
  } catch (err) {
    console.error('[centerNotify] sendReferralCommission:', err);
    return false;
  }
}

export async function sendWithdrawalProcessed(
  phone: string,
  ownerName: string,
  decision: string,
  amount: number,
  note: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_WITHDRAWAL_PROCESSED))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const owner = ownerName.trim() || ',';
    const dec = decision.trim() || ',';
    const amtStr = formatNumber(amount, 'ar');
    const noteText = note.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_WITHDRAWAL_PROCESSED,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [owner, dec, amtStr, noteText],
    });
  } catch (err) {
    console.error('[centerNotify] sendWithdrawalProcessed:', err);
    return false;
  }
}

// IMPORTANT: The chq_vendor_new_order Meta template MUST have a quick_reply button
// defined at index 0 in the Meta template editor with any placeholder payload.
// This code injects the dynamic READY_<orderId> payload at send time.
// If the template has no button, the dynamic payload is silently ignored by Meta.
// Body variables (order): reference, quantity, notes, courier display name (platform_config.courier_name).
export async function sendVendorNewOrder(
  phone: string,
  ref: string,
  quantity: number,
  notes: string,
  orderId: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_VENDOR_NEW_ORDER))) return false;
    const to = digitsOnly(phone) || digitsOnly(process.env.VENDOR_WHATSAPP_NUMBER?.trim() ?? '');
    if (!to) {
      console.warn('[centerNotify] sendVendorNewOrder: no vendor phone (arg or VENDOR_WHATSAPP_NUMBER)');
      return false;
    }
    const ord = ref.trim() || ',';
    const countStr = formatNumber(quantity, 'ar');
    const notesText = notes.trim() || ',';
    const courierLabel = await getCourierDisplayName(supabase);
    const oid = orderId.trim();
    const buttonsPayload: WhatsappTemplateButtonComponent[] | undefined =
      oid.length > 0
        ? [
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: `READY_${oid}` }],
            },
          ]
        : undefined;
    return await postWhatsappTemplate({
      templateName: TEMPLATE_VENDOR_NEW_ORDER,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [ord, countStr, notesText, courierLabel],
      buttonsPayload,
    });
  } catch (err) {
    console.error('[centerNotify] sendVendorNewOrder:', err);
    return false;
  }
}

export async function sendParentAnnouncementPromo(
  parentPhone: string,
  centerName: string,
  messageBody: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_PARENT_ANNOUNCEMENT_PROMO))) return false;
    const to = digitsOnly(parentPhone);
    if (!to) return false;
    const center = centerName.trim() || ',';
    const body = messageBody.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_PARENT_ANNOUNCEMENT_PROMO,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [center, body],
    });
  } catch (err) {
    console.error('[centerNotify] sendParentAnnouncementPromo:', err);
    return false;
  }
}

export async function sendParentAnnouncementOps(
  parentPhone: string,
  centerName: string,
  messageBody: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_PARENT_ANNOUNCEMENT_OPS))) return false;
    const to = digitsOnly(parentPhone);
    if (!to) return false;
    const center = centerName.trim() || ',';
    const body = messageBody.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_PARENT_ANNOUNCEMENT_OPS,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [center, body],
    });
  } catch (err) {
    console.error('[centerNotify] sendParentAnnouncementOps:', err);
    return false;
  }
}

export async function sendParentTermSummary(
  parentPhone: string,
  studentName: string,
  groupName: string,
  attendedSessions: number,
  totalSessions: number,
  balance: number,
  centerName: string,
): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_PARENT_TERM_SUMMARY))) return false;
    const to = digitsOnly(parentPhone);
    if (!to) return false;
    const student = studentName.trim() || ',';
    const group = groupName.trim() || ',';
    const attendedStr = formatNumber(attendedSessions, 'ar');
    const totalStr = formatNumber(totalSessions, 'ar');
    const balanceStr = formatNumber(balance, 'ar');
    const center = centerName.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_PARENT_TERM_SUMMARY,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [student, group, attendedStr, totalStr, balanceStr, center],
    });
  } catch (err) {
    console.error('[centerNotify] sendParentTermSummary:', err);
    return false;
  }
}

/** Sends WhatsApp template `chq_pin_delivery` with the OTP (requires approved template + WA). */
/**
 * Set-PIN link for the cross-device / closed-tab fallback (Option B onboarding).
 * Body parameter is the full URL the owner taps to land on /set-pin?t=<token>.
 * Distinct Meta template from chq_pin_delivery so the OTP path stays unchanged.
 */
export async function sendPinSetupLink(phone: string, setupUrl: string): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_PIN_SETUP_LINK))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const url = setupUrl.trim();
    if (!url) return false;
    return await postWhatsappTemplate({
      templateName: TEMPLATE_PIN_SETUP_LINK,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [url],
    });
  } catch (err) {
    console.error('[centerNotify] sendPinSetupLink:', err);
    return false;
  }
}

export async function sendPinDelivery(phone: string, otpCode: string): Promise<boolean> {
  try {
    if (shouldSkipWaForTestPhoneId()) return false;
    const supabase = serviceSupabase();
    if (!supabase) return false;
    if (!(await canSendApprovedTemplate(supabase, TEMPLATE_PIN_DELIVERY))) return false;
    const to = digitsOnly(phone);
    if (!to) return false;
    const code = otpCode.trim() || ',';
    return await postWhatsappTemplate({
      templateName: TEMPLATE_PIN_DELIVERY,
      languageCode: 'ar_EG',
      toDigits: to,
      bodyParameters: [code],
    });
  } catch (err) {
    console.error('[centerNotify] sendPinDelivery:', err);
    return false;
  }
}

/**
 * Renewal reminder (7 days before due), overdue template + optional suspend,
 * onboarding step 1 (24h after approval). Called from process-renewals cron.
 */
export async function runProcessRenewalWhatsappTemplates(supabase: SupabaseClient): Promise<{
  renewalReminders: number;
  overdueReminders: number;
  suspended: number;
  onboardingStep1: number;
}> {
  const renewalReminders = 0;
  const overdueReminders = 0;
  const suspended = 0;
  let onboardingStep1 = 0;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: onboardRows, error: onboardErr } = await supabase
    .from('centers')
    .select('id, name, phone, approved_at, onboarding_completed, onboarding_step1_sent_at')
    .not('approved_at', 'is', null)
    .eq('onboarding_completed', false)
    .is('onboarding_step1_sent_at', null)
    .not('phone', 'is', null)
    .lt('approved_at', twentyFourHoursAgo);

  if (onboardErr) {
    console.error('[centerNotify] onboarding step1 query:', onboardErr);
  } else {
    for (const raw of onboardRows ?? []) {
      try {
        const r = raw as {
          id: string;
          name: string;
          phone: string | null;
        };
        const sentRes = await sendOnboardingStep1Template(supabase, r);
        if (!sentRes.success) continue;
        const { error: upErr } = await supabase
          .from('centers')
          .update({ onboarding_step1_sent_at: new Date().toISOString() })
          .eq('id', r.id);
        if (upErr) {
          console.error('[centerNotify] onboarding_step1_sent_at update failed:', r.id, upErr);
        } else {
          onboardingStep1 += 1;
        }
      } catch (loopErr) {
        console.error('[centerNotify] onboarding step1 loop:', loopErr);
      }
    }
  }

  return { renewalReminders, overdueReminders, suspended, onboardingStep1 };
}

type CenterChurnRow = {
  id: string;
  name: string;
  phone: string | null;
  inactivity_alert_sent_at: string | null;
};

function canSendInactivityAlert(row: CenterChurnRow, thresholdDateStr: string): boolean {
  if (!row.inactivity_alert_sent_at) return true;
  return cairoDateFromTimestamp(row.inactivity_alert_sent_at) < thresholdDateStr;
}

/**
 * chq_inactivity_alert for centers inactive > 5 days (same last-scan logic as detect-churn edge).
 */
export async function runChqInactivityAlertTemplates(supabase: SupabaseClient): Promise<number> {
  let sent = 0;
  const thresholdDateStr = sixDaysAgoCairoSafe();
  const TEMPLATE = 'chq_inactivity_alert';

  const { data: centers, error: cErr } = await supabase
    .from('centers')
    .select('id, name, phone, inactivity_alert_sent_at')
    .eq('status', 'active')
    .not('phone', 'is', null);

  if (cErr) {
    console.error('[centerNotify] inactivity centers query:', cErr);
    return 0;
  }

  const approved = await isTemplateApproved(TEMPLATE, supabase);
  if (!approved) {
    console.warn(`[centerNotify] Skipping ${TEMPLATE}, not approved`);
    return 0;
  }

  for (const raw of centers ?? []) {
    try {
      const row = raw as CenterChurnRow;
      if (!canSendInactivityAlert(row, thresholdDateStr)) continue;

      const { data: lastRow } = await supabase
        .from('attendance_scans')
        .select('scanned_at')
        .eq('center_id', row.id)
        .order('scanned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastScan = (lastRow as { scanned_at?: string } | null)?.scanned_at ?? null;
      const lastScanAt = lastScan ? new Date(lastScan) : null;
      const daysInactive = lastScanAt
        ? Math.floor((Date.now() - lastScanAt.getTime()) / (24 * 60 * 60 * 1000))
        : 999;

      if (daysInactive <= 5) continue;

      const to = digitsOnly(row.phone ?? '');
      if (!to) {
        console.warn('[centerNotify] inactivity skip invalid phone', row.id);
        continue;
      }

      const daysStr = String(lastScan ? daysInactive : 999);
      let ok = false;
      try {
        ok = await postWhatsappTemplate({
          templateName: TEMPLATE,
          languageCode: 'ar',
          toDigits: to,
          bodyParameters: [row.name ?? ',', daysStr],
        });
      } catch (sendErr) {
        console.error(`[centerNotify] ${TEMPLATE} send failed:`, sendErr);
        continue;
      }

      if (ok) {
        const { error: upErr } = await supabase
          .from('centers')
          .update({ inactivity_alert_sent_at: new Date().toISOString() })
          .eq('id', row.id);
        if (upErr) {
          console.error('[centerNotify] inactivity_alert_sent_at update failed:', row.id, upErr);
        } else {
          sent += 1;
        }
      } else {
        console.error(`[centerNotify] ${TEMPLATE} send failed for center`, row.id);
      }
    } catch (rowErr) {
      console.error('[centerNotify] inactivity row error:', rowErr);
    }
  }

  return sent;
}

/** Cairo calendar date string for (today - 6 days), for idempotency vs inactivity_alert_sent_at::date < CURRENT_DATE - 6 */
function sixDaysAgoCairoSafe(): string {
  return dateInNDays(-6);
}
