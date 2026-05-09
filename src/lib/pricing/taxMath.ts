/**
 * Cascading inclusive pricing per docs/PRICING_SPEC.md — NOT additive-on-base stacking.
 * Rates applied in strip order: VAT off inclusive → stamp off remainder → service off remainder → base.
 */

export const VAT_RATE = 0.14;
export const STAMP_RATE = 0.005;
export const SERVICE_RATE = 0.06;

/** Same as 1 / ((1-VAT)(1-STAMP)(1-SERVICE)). */
export const MARKUP_FACTOR =
  1 / (1 - VAT_RATE) / (1 - STAMP_RATE) / (1 - SERVICE_RATE);

/** QR card physical economics: base per card before cascade (spec audit). */
export const CARD_UNIT_BASE_EGP = 50;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function baseFromInclusive(inclusive: number): number {
  const i = Number(inclusive);
  if (!Number.isFinite(i)) return 0;
  return round2(i * (1 - VAT_RATE) * (1 - STAMP_RATE) * (1 - SERVICE_RATE));
}

export function inclusiveFromBase(base: number): number {
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return round2(b / (1 - SERVICE_RATE) / (1 - STAMP_RATE) / (1 - VAT_RATE));
}

export interface TaxBreakdown {
  inclusive: number;
  vat: number;
  stamp: number;
  service: number;
  base: number;
}

/**
 * Decompose inclusive amount into tax lines; last tax line (VAT) absorbs cent drift so components sum exactly.
 */
export function explodeInclusive(inclusive: number): TaxBreakdown {
  const i = round2(Number(inclusive));
  if (!Number.isFinite(i) || i <= 0) {
    return { inclusive: 0, vat: 0, stamp: 0, service: 0, base: 0 };
  }
  const vatGross = i * VAT_RATE;
  const postVat = i - vatGross;
  const stampGross = postVat * STAMP_RATE;
  const postStamp = postVat - stampGross;
  const serviceGross = postStamp * SERVICE_RATE;
  const baseGross = postStamp - serviceGross;

  const base = round2(baseGross);
  const service = round2(serviceGross);
  const stamp = round2(stampGross);
  const vat = round2(i - base - service - stamp);

  return { inclusive: i, vat, stamp, service, base };
}

const LABELS = {
  en: {
    inclVat: 'incl. VAT (14%)',
    inclStamp: 'incl. stamp duty (0.5%)',
    inclService: 'incl. service fee (6%)',
    netBase: 'your net (base)',
    subtotal: 'Subtotal',
    serviceFee: 'Service fee (6%)',
    stampDuty: 'Stamp duty (0.5%)',
    vat: 'VAT (14%)',
    total: 'Total',
  },
  ar: {
    inclVat: 'شاملة ضريبة القيمة المضافة (١٤٪)',
    inclStamp: 'شاملة الدمغة (٠٫٥٪)',
    inclService: 'شاملة رسوم الخدمة (٦٪)',
    netBase: 'صافي الإيراد (الأساس)',
    subtotal: 'الإجمالي قبل الضرائب',
    serviceFee: 'رسوم خدمة (٦٪)',
    stampDuty: 'دمغة (٠٫٥٪)',
    vat: 'ضريبة القيمة المضافة (١٤٪)',
    total: 'الإجمالي',
  },
} as const;

type LineLocale = 'en' | 'ar';

function L(locale: LineLocale) {
  return locale === 'ar' ? LABELS.ar : LABELS.en;
}

/** Internal/admin — descending “stripping” presentation from inclusive. */
export function buildInternalBreakdown(
  inclusive: number,
  locale: LineLocale,
): { label: string; amount: number }[] {
  const b = explodeInclusive(inclusive);
  return [
    { label: L(locale).inclVat, amount: b.vat },
    { label: L(locale).inclStamp, amount: b.stamp },
    { label: L(locale).inclService, amount: b.service },
    { label: L(locale).netBase, amount: b.base },
  ];
}

export interface LegalInvoiceLine {
  label: string;
  amount: number;
  isTotal?: boolean;
}

/** Legal Egyptian invoice — VAT MUST be last tax line before total. */
export function buildLegalInvoiceLines(inclusive: number, locale: LineLocale): LegalInvoiceLine[] {
  const b = explodeInclusive(inclusive);
  return [
    { label: L(locale).subtotal, amount: b.base },
    { label: L(locale).serviceFee, amount: b.service },
    { label: L(locale).stampDuty, amount: b.stamp },
    { label: L(locale).vat, amount: b.vat },
    { label: L(locale).total, amount: b.inclusive, isTotal: true },
  ];
}

/** Inclusive subtotal for N QR cards at fixed base 50 EGP/card before taxes. */
export function cardOrderProductInclusiveFromQty(quantity: number): number {
  const q = Math.max(0, Math.round(Number(quantity)));
  if (q === 0) return 0;
  return inclusiveFromBase(q * CARD_UNIT_BASE_EGP);
}
