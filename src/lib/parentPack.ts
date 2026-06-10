/**
 * Parent WhatsApp Pack - pricing, caps, Cairo dates, WA template names.
 * Use alongside src/lib/parent-pack.ts (billing helpers).
 */

import { BLAST_PRICE_PER_PARENT_INCLUSIVE } from '@/lib/invoiceTemplates';

export const PACK_PRICE_PER_PARENT = 12;
export const PACK_BASE_PER_PARENT = 10.08;
export const PACK_SERVICE_FEE_RATE = 0.06;
export const PACK_VAT_RATE = 0.14;

/** Per-parent announcement blast total (incl. service + VAT); must match invoice PDFs. */
export const BLAST_PRICE_PER_PARENT = BLAST_PRICE_PER_PARENT_INCLUSIVE;
export const BLAST_BASE_PER_PARENT = 6.72;
export const BLAST_SERVICE_FEE_RATE = 0.06;
export const BLAST_VAT_RATE = 0.14;

export const ANNOUNCEMENT_CAPS: Record<string, number> = {
  nano: 700,
  starter: 1500,
  pro: 4500,
  business: 9000,
  enterprise: 18000,
  top_centers: 99999,
};

export const ANNOUNCEMENT_WARN_THRESHOLD = 0.9;

export const WA_TEMPLATES = {
  PARENT_WELCOME: 'chq_parent_welcome',
  PARENT_ABSENCE: 'chq_parent_absence',
  PARENT_BALANCE_DUE: 'chq_parent_balance_due',
  PARENT_TERM_SUMMARY: 'chq_parent_term_summary',
  PARENT_ANNOUNCEMENT_OPS: 'chq_parent_announcement_ops',
  PARENT_ANNOUNCEMENT_PROMO: 'chq_parent_announcement_promo',
} as const;

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicNumerals(n: string | number): string {
  return String(n).replace(/[0-9]/g, (d) => ARABIC_DIGITS[parseInt(d, 10)] ?? d);
}

export function getAnnouncementCap(plan: string): number {
  return ANNOUNCEMENT_CAPS[plan] ?? ANNOUNCEMENT_CAPS.starter;
}

export function getDayOfWeek(date: Date, timezone = 'Africa/Cairo'): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  })
    .format(date)
    .toLowerCase();
}

export function getTodayCairo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function getCurrentCairoTime(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return { hour: hour === 24 ? 0 : hour, minute };
}

export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function dateInNDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function currentMonthFirstDay(): string {
  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  return `${d.slice(0, 7)}-01`;
}

/** Plan-tiered minimum invoice thresholds (EGP). */
export const PLAN_INVOICE_MINIMUMS: Record<string, number> = {
  solo: 600,
  nano: 1_000,
  starter: 2_000,
  pro: 5_000,
  business: 8_000,
  enterprise: 10_000,
  top_centers: 10_000,
};

export const MAX_ROLLOVER_MONTHS = 6;

export function getInvoiceMinimum(plan: string, customMinimum: number | null | undefined): number {
  if (customMinimum != null && customMinimum > 0) return customMinimum;
  return PLAN_INVOICE_MINIMUMS[plan] ?? 1_000;
}

export function shouldIssueInvoice(opts: {
  plan: string;
  customMinimum: number | null | undefined;
  pendingBalance: number;
  monthsWithoutInvoice: number;
  isFinalInvoice?: boolean;
}): boolean {
  const { plan, customMinimum, pendingBalance, monthsWithoutInvoice, isFinalInvoice } = opts;
  if (pendingBalance <= 0) return false;
  if (isFinalInvoice) return true;
  const minimum = getInvoiceMinimum(plan, customMinimum);
  return pendingBalance >= minimum || monthsWithoutInvoice >= MAX_ROLLOVER_MONTHS;
}

export function currentBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function previousBillingPeriod(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
