import type { SupabaseClient } from '@supabase/supabase-js';
import { dateInNDays, todayISO } from '@/lib/parentPack';

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

function formatNextPaymentDueAr(nextPaymentDue: string | null): string {
  if (!nextPaymentDue) return '—';
  try {
    return new Date(`${nextPaymentDue}T12:00:00`).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return nextPaymentDue;
  }
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

type CenterBillingRow = {
  id: string;
  name: string;
  phone: string | null;
  next_payment_due: string | null;
  billing_amount: number | string | null;
  billing_status: string | null;
  current_period_start: string | null;
  renewal_reminder_sent_at: string | null;
  overdue_reminder_sent_at: string | null;
};

function canSendRenewalReminder(row: CenterBillingRow): boolean {
  if (!row.renewal_reminder_sent_at) return true;
  if (!row.current_period_start) return false;
  const sent = new Date(row.renewal_reminder_sent_at).getTime();
  const period = new Date(`${row.current_period_start}T00:00:00Z`).getTime();
  return sent < period;
}

function canSendOverdueReminder(row: CenterBillingRow, todayCairo: string): boolean {
  if (!row.overdue_reminder_sent_at) return true;
  return cairoDateFromTimestamp(row.overdue_reminder_sent_at) < todayCairo;
}

function daysOverdueCount(nextPaymentDue: string, todayCairo: string): number {
  const due = new Date(`${nextPaymentDue}T12:00:00`).getTime();
  const today = new Date(`${todayCairo}T12:00:00`).getTime();
  return Math.floor((today - due) / (24 * 60 * 60 * 1000));
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

  const todayCairo = todayISO();
  const dueIn7 = dateInNDays(7);
  const sixDaysAgoCairo = dateInNDays(-6);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const billingSelect =
    'id, name, phone, next_payment_due, billing_amount, billing_status, current_period_start, renewal_reminder_sent_at, overdue_reminder_sent_at';

  const { data: reminderRows, error: reminderErr } = await supabase
    .from('centers')
    .select(billingSelect)
    .eq('next_payment_due', dueIn7)
    .neq('billing_status', 'suspended')
    .not('phone', 'is', null);

  if (reminderErr) {
    console.error('[centerNotify] renewal query:', reminderErr);
  } else {
    for (const raw of reminderRows ?? []) {
      const row = raw as CenterBillingRow;
      if (!canSendRenewalReminder(row)) continue;
      const to = digitsOnly(row.phone ?? '');
      if (!to) {
        console.warn('[centerNotify] renewal skip invalid phone', row.id);
        continue;
      }
      const amountStr = String(row.billing_amount ?? 0);
      const dueAr = formatNextPaymentDueAr(row.next_payment_due);
      const ok = await postWhatsappTemplate({
        templateName: 'chq_renewal_reminder',
        languageCode: 'ar',
        toDigits: to,
        bodyParameters: [row.name ?? '—', dueAr, amountStr],
      });
      if (ok) {
        await supabase.from('centers').update({ renewal_reminder_sent_at: new Date().toISOString() }).eq('id', row.id);
        renewalReminders += 1;
      }
    }
  }

  const { data: overdueRows, error: overdueErr } = await supabase
    .from('centers')
    .select(billingSelect)
    .lt('next_payment_due', todayCairo)
    .neq('billing_status', 'suspended')
    .not('phone', 'is', null)
    .not('next_payment_due', 'is', null);

  if (overdueErr) {
    console.error('[centerNotify] overdue query:', overdueErr);
  } else {
    for (const raw of overdueRows ?? []) {
      const row = raw as CenterBillingRow;
      if (!canSendOverdueReminder(row, todayCairo)) continue;
      const to = digitsOnly(row.phone ?? '');
      if (!to) {
        console.warn('[centerNotify] overdue skip invalid phone', row.id);
        continue;
      }
      const daysLate = String(Math.max(0, daysOverdueCount(row.next_payment_due!, todayCairo)));
      const amountStr = String(row.billing_amount ?? 0);
      const ok = await postWhatsappTemplate({
        templateName: 'chq_renewal_overdue',
        languageCode: 'ar_EG',
        toDigits: to,
        bodyParameters: [row.name ?? '—', daysLate, amountStr],
      });
      if (ok) {
        await supabase.from('centers').update({ overdue_reminder_sent_at: new Date().toISOString() }).eq('id', row.id);
        overdueReminders += 1;
        if (daysOverdueCount(row.next_payment_due!, todayCairo) >= 7) {
          const { error: susErr } = await supabase
            .from('centers')
            .update({
              billing_status: 'suspended',
              subscription_status: 'suspended',
              status: 'suspended',
            })
            .eq('id', row.id);
          if (susErr) {
            console.error('[centerNotify] auto-suspend failed:', row.id, susErr);
          } else {
            suspended += 1;
          }
        }
      }
    }
  }

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
