import type { SupabaseClient } from '@supabase/supabase-js';
import { dateInNDays } from '@/lib/parentPack';

const PLATFORM_URL = 'https://center-hq.vercel.app';

function waPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

function waToken(): string | null {
  return process.env.WHATSAPP_TOKEN || null;
}

function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

function cairoDateFromTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

async function postWhatsappTemplate(opts: {
  templateName: string;
  languageCode: 'ar' | 'ar_EG';
  toDigits: string;
  bodyParameters: string[];
}): Promise<boolean> {
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
        type: 'template',
        template: {
          name: opts.templateName,
          language: { code: opts.languageCode },
          components: [
            {
              type: 'body',
              parameters: opts.bodyParameters.map((text) => ({ type: 'text', text })),
            },
          ],
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

/** chq_renewal_overdue — used by subscription billing cron (Items 2–3). */
export async function sendChqRenewalOverdueTemplate(opts: {
  name: string;
  phone: string | null;
  daysLate: string;
  amountStr: string;
}): Promise<boolean> {
  const to = digitsOnly(opts.phone ?? '');
  if (!to) return false;
  return postWhatsappTemplate({
    templateName: 'chq_renewal_overdue',
    languageCode: 'ar_EG',
    toDigits: to,
    bodyParameters: [opts.name ?? '—', opts.daysLate, opts.amountStr],
  });
}

/** chq_payment_confirmed — Paymob subscription / renewal success (Item 7). */
export async function sendChqPaymentConfirmedTemplate(
  supabase: SupabaseClient,
  opts: { name: string; phone: string | null; billingPeriodLabel: string; billingAmountStr: string },
): Promise<boolean> {
  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  if (cfg?.value === false) return false;

  const to = digitsOnly(opts.phone ?? '');
  if (!to) return false;

  return postWhatsappTemplate({
    templateName: 'chq_payment_confirmed',
    languageCode: 'ar_EG',
    toDigits: to,
    bodyParameters: [opts.name, opts.billingPeriodLabel, opts.billingAmountStr],
  });
}

/** chq_pack_invoice — Parent Pack monthly or partial invoice (Session D). Pass `templateEnabled` from route flag. */
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
): Promise<boolean> {
  if (!templateEnabled) return false;

  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  if (cfg?.value === false) return false;

  const to = digitsOnly(opts.phone ?? '');
  if (!to) return false;

  return postWhatsappTemplate({
    templateName: 'chq_pack_invoice',
    languageCode: 'ar_EG',
    toDigits: to,
    bodyParameters: [opts.name, opts.monthArabic, opts.parentCountStr, opts.amountStr],
  });
}

/** chq_payment_failed — subscription Paymob failure (Session E). Pass `templateEnabled` from route flag. */
export async function sendChqPaymentFailedTemplate(
  supabase: SupabaseClient,
  templateEnabled: boolean,
  opts: { name: string; phone: string | null; amountStr: string },
): Promise<boolean> {
  if (!templateEnabled) return false;

  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  if (cfg?.value === false) return false;

  const to = digitsOnly(opts.phone ?? '');
  if (!to) return false;

  return postWhatsappTemplate({
    templateName: 'chq_payment_failed',
    languageCode: 'ar_EG',
    toDigits: to,
    bodyParameters: [opts.name, opts.amountStr],
  });
}

export async function sendWelcomeTemplate(center: {
  id: string;
  name: string;
  phone: string | null;
}): Promise<void> {
  if (!center.phone || !digitsOnly(center.phone)) {
    console.warn('[centerNotify] Welcome skipped — no phone', center.id);
    return;
  }
  try {
    const ok = await postWhatsappTemplate({
      templateName: 'chq_welcome',
      languageCode: 'ar_EG',
      toDigits: digitsOnly(center.phone),
      bodyParameters: [center.name, PLATFORM_URL, center.phone],
    });
    if (ok) {
      console.log('[centerNotify] Welcome sent to', center.name);
    }
  } catch (err) {
    console.error('[centerNotify] Welcome send failed:', err);
  }
}

export async function sendOnboardingStep1Template(center: {
  id: string;
  name: string;
  phone: string | null;
}): Promise<boolean> {
  if (!center.phone || !digitsOnly(center.phone)) {
    console.warn('[centerNotify] Onboarding step1 skipped — no phone', center.id);
    return false;
  }
  try {
    const ok = await postWhatsappTemplate({
      templateName: 'chq_onboarding_step1',
      languageCode: 'ar_EG',
      toDigits: digitsOnly(center.phone),
      bodyParameters: [center.name, PLATFORM_URL],
    });
    if (ok) {
      console.log('[centerNotify] Onboarding step1 sent to', center.name);
    }
    return ok;
  } catch (err) {
    console.error('[centerNotify] Onboarding step1 send failed:', err);
    return false;
  }
}

/**
 * Renewal reminder (7 days before due), overdue template + optional suspend,
 * onboarding step 1 (24h after approval). Called from process-renewals cron.
 */
export async function runProcessRenewalWhatsappTemplates(
  supabase: SupabaseClient,
): Promise<{
  renewalReminders: number;
  overdueReminders: number;
  suspended: number;
  onboardingStep1: number;
}> {
  let renewalReminders = 0;
  let overdueReminders = 0;
  let suspended = 0;
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
      const r = raw as {
        id: string;
        name: string;
        phone: string | null;
      };
      const sentOk = await sendOnboardingStep1Template(r);
      if (!sentOk) continue;
      const { error: upErr } = await supabase
        .from('centers')
        .update({ onboarding_step1_sent_at: new Date().toISOString() })
        .eq('id', r.id);
      if (upErr) {
        console.error('[centerNotify] onboarding_step1_sent_at update failed:', r.id, upErr);
      } else {
        onboardingStep1 += 1;
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

  const { data: centers, error: cErr } = await supabase
    .from('centers')
    .select('id, name, phone, inactivity_alert_sent_at')
    .eq('status', 'active')
    .not('phone', 'is', null);

  if (cErr) {
    console.error('[centerNotify] inactivity centers query:', cErr);
    return 0;
  }

  for (const raw of centers ?? []) {
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
    const ok = await postWhatsappTemplate({
      templateName: 'chq_inactivity_alert',
      languageCode: 'ar',
      toDigits: to,
      bodyParameters: [row.name ?? '—', daysStr],
    });

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
    }
  }

  return sent;
}

/** Cairo calendar date string for (today - 6 days), for idempotency vs inactivity_alert_sent_at::date < CURRENT_DATE - 6 */
function sixDaysAgoCairoSafe(): string {
  return dateInNDays(-6);
}
