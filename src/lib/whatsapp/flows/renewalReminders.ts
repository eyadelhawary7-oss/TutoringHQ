/**
 * Subscription renewal reminder flow
 * Arabic messages per stage. Payment details = bank account (IBAN).
 * Note: For proactive outreach, WhatsApp requires approved templates outside 24hr window.
 * Consider creating chq_renewal_* templates in Meta Business Manager.
 */

import { formatCurrency, formatDate as formatDateDisplay } from '@/lib/formatNumber';
import { sendFreeformMessage, normalizePhone } from '../client';

const WA_AR = 'ar';

const BANK_IBAN = process.env.RENEWAL_BANK_IBAN || 'EG38XXXX0000000000000000000000';
const SUMMER_NOTE = '\n\n📌 ملاحظة: يرجى مراجعة أسعار العام الدراسي الجديد.';
// Paymob link for online payment: https://accept.paymob.com/... (initiate via /api/billing/initiate-payment)

export type RenewalStage =
  | 'T_MINUS_7'
  | 'T_MINUS_3'
  | 'T_ZERO'
  | 'T_PLUS_3'
  | 'T_PLUS_7'
  | 'T_PLUS_9';

export interface CenterForRenewal {
  id: string;
  name: string;
  phone: string | null;
  subscription_renewal_date: string | null;
  subscription_monthly_fee: number | null;
  subscription_billing_period: string | null;
  subscription_status: string | null;
  summer_mode?: boolean;
}

function formatMonthlyFee(amount: number | null): string {
  return formatCurrency(Number(amount ?? 0), WA_AR);
}

function formatRenewalDate(dateStr: string | null): string {
  if (!dateStr) return ',';
  try {
    return formatDateDisplay(new Date(dateStr + 'T12:00:00'), WA_AR, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

const STAGE_MESSAGES: Record<RenewalStage, (c: CenterForRenewal) => string> = {
  T_MINUS_7: (c) =>
    `مرحباً ${c.name} 👋\n\nتذكير: تجديد اشتراك CenterHQ خلال 7 أيام.\n📅 موعد التجديد: ${formatRenewalDate(c.subscription_renewal_date)}\n💰 المبلغ: ${formatMonthlyFee(c.subscription_monthly_fee)}\n\nالتحويل البنكي:\nرقم الحساب (IBAN): ${BANK_IBAN}\n\nشكراً لثقتكم!`,

  T_MINUS_3: (c) =>
    `مرحباً ${c.name} 👋\n\nتذكير: تجديد اشتراك CenterHQ خلال 3 أيام.\n📅 موعد التجديد: ${formatRenewalDate(c.subscription_renewal_date)}\n💰 المبلغ: ${formatMonthlyFee(c.subscription_monthly_fee)}\n\nالتحويل البنكي:\nرقم الحساب (IBAN): ${BANK_IBAN}\n\nيرجى الدفع لتجنب انقطاع الخدمة.${c.summer_mode ? SUMMER_NOTE : ''}`,

  T_ZERO: (c) =>
    `مرحباً ${c.name} 👋\n\nموعد تجديد اشتراك CenterHQ اليوم.\n📅 موعد التجديد: ${formatRenewalDate(c.subscription_renewal_date)}\n💰 المبلغ: ${formatMonthlyFee(c.subscription_monthly_fee)}\n\nالتحويل البنكي:\nرقم الحساب (IBAN): ${BANK_IBAN}\n\nيرجى الدفع اليوم لتجنب انقطاع الخدمة.${c.summer_mode ? SUMMER_NOTE : ''}`,

  T_PLUS_3: (c) =>
    `مرحباً ${c.name} 👋\n\nتذكير: اشتراك CenterHQ متأخر 3 أيام.\n📅 موعد التجديد: ${formatRenewalDate(c.subscription_renewal_date)}\n💰 المبلغ: ${formatMonthlyFee(c.subscription_monthly_fee)}\n\nالتحويل البنكي:\nرقم الحساب (IBAN): ${BANK_IBAN}\n\nيرجى الدفع في أقرب وقت لتجنب إيقاف الخدمة.${c.summer_mode ? SUMMER_NOTE : ''}`,

  T_PLUS_7: (c) =>
    `مرحباً ${c.name} 👋\n\nتذكير عاجل: اشتراك CenterHQ متأخر 7 أيام.\n📅 موعد التجديد: ${formatRenewalDate(c.subscription_renewal_date)}\n💰 المبلغ: ${formatMonthlyFee(c.subscription_monthly_fee)}\n\nالتحويل البنكي:\nرقم الحساب (IBAN): ${BANK_IBAN}\n\nيرجى الدفع فوراً لتجنب إيقاف الخدمة.${c.summer_mode ? SUMMER_NOTE : ''}`,

  T_PLUS_9: (c) =>
    `مرحباً ${c.name} 👋\n\nتذكير نهائي: اشتراك CenterHQ متأخر 9 أيام.\n📅 موعد التجديد: ${formatRenewalDate(c.subscription_renewal_date)}\n💰 المبلغ: ${formatMonthlyFee(c.subscription_monthly_fee)}\n\nالتحويل البنكي:\nرقم الحساب (IBAN): ${BANK_IBAN}\n\nسيتم إيقاف الخدمة قريباً. يرجى الدفع فوراً لتجنب إيقاف الخدمة.${c.summer_mode ? SUMMER_NOTE : ''}`,
};

export interface SendRenewalReminderParams {
  center: CenterForRenewal;
  stage: RenewalStage;
}

/**
 * Send renewal reminder to center via WhatsApp.
 * Uses freeform message (within 24hr window). For proactive outreach, use approved templates.
 */
export async function sendRenewalReminder(
  params: SendRenewalReminderParams
): Promise<{ success: boolean; error?: string }> {
  const { center, stage } = params;
  const toPhone = center.phone;
  if (!toPhone || !normalizePhone(toPhone)) {
    return { success: false, error: 'Center has no valid phone' };
  }

  const body = STAGE_MESSAGES[stage](center);
  const result = await sendFreeformMessage(center.id, toPhone, body);
  return { success: result.success, error: result.error };
}

export interface SendRenewalSalesManagerAlertParams {
  centerId: string;
  centerName: string;
  renewalDate: string | null;
  monthlyFee: number | null;
  daysOverdue: number;
}

/**
 * Alert Sales Manager about center 9+ days overdue.
 * Uses SALES_MANAGER_PHONE env var.
 */
export async function sendRenewalSalesManagerAlert(
  params: SendRenewalSalesManagerAlertParams
): Promise<{ success: boolean; error?: string }> {
  const salesPhone = process.env.SALES_MANAGER_PHONE;
  if (!salesPhone) {
    return { success: false, error: 'SALES_MANAGER_PHONE not set' };
  }

  const body = `⚠️ تنبيه تجديد: سنتر "${params.centerName}" متأخر ${params.daysOverdue} يوم.\nموعد التجديد: ${formatRenewalDate(params.renewalDate)}\nMRR: ${formatMonthlyFee(params.monthlyFee)}\nيرجى المتابعة.`;
  const result = await sendFreeformMessage(params.centerId, salesPhone, body);
  return { success: result.success, error: result.error };
}
