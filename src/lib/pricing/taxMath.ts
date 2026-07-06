/**
 * Inclusive pricing decomposition. The only tax shown to customers is VAT (14%);
 * a flat 20 EGP processing fee is added separately on Paymob-charged invoices
 * (see src/lib/processingFee.ts). The former 6% service fee and 0.5% stamp duty
 * have been removed everywhere — they no longer exist in the math or the UI.
 */

export const VAT_RATE = 0.14;

/**
 * QR card physical economics: base per card before VAT. Grosses up to a flat
 * 60 EGP/card inclusive (60 × (1 − VAT) = 51.6). Kept as a base so the setup_fee
 * invoice can still show a base + VAT breakdown.
 */
export const CARD_UNIT_BASE_EGP = 51.6;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function baseFromInclusive(inclusive: number): number {
  const i = Number(inclusive);
  if (!Number.isFinite(i)) return 0;
  return round2(i * (1 - VAT_RATE));
}

export function inclusiveFromBase(base: number): number {
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return round2(b / (1 - VAT_RATE));
}

export interface TaxBreakdown {
  inclusive: number;
  vat: number;
  base: number;
}

/**
 * Decompose inclusive amount into base + VAT so the two sum exactly.
 */
export function explodeInclusive(inclusive: number): TaxBreakdown {
  const i = round2(Number(inclusive));
  if (!Number.isFinite(i) || i <= 0) {
    return { inclusive: 0, vat: 0, base: 0 };
  }
  const vat = round2(i * VAT_RATE);
  const base = round2(i - vat);
  return { inclusive: i, vat, base };
}

const LABELS = {
  en: {
    inclVat: 'incl. VAT (14%)',
    netBase: 'your net (base)',
    subtotal: 'Subtotal',
    vat: 'VAT (14%)',
    total: 'Total',
  },
  ar: {
    inclVat: 'شاملة ضريبة القيمة المضافة (١٤٪)',
    netBase: 'صافي الإيراد (الأساس)',
    subtotal: 'الإجمالي قبل الضرائب',
    vat: 'ضريبة القيمة المضافة (١٤٪)',
    total: 'الإجمالي',
  },
} as const;

type LineLocale = 'en' | 'ar';

function L(locale: LineLocale) {
  return locale === 'ar' ? LABELS.ar : LABELS.en;
}

/** Internal/admin - descending “stripping” presentation from inclusive. */
export function buildInternalBreakdown(
  inclusive: number,
  locale: LineLocale,
): { label: string; amount: number }[] {
  const b = explodeInclusive(inclusive);
  return [
    { label: L(locale).inclVat, amount: b.vat },
    { label: L(locale).netBase, amount: b.base },
  ];
}

export interface LegalInvoiceLine {
  label: string;
  amount: number;
  isTotal?: boolean;
}

/** Legal Egyptian invoice - VAT is the last tax line before total. */
export function buildLegalInvoiceLines(inclusive: number, locale: LineLocale): LegalInvoiceLine[] {
  const b = explodeInclusive(inclusive);
  return [
    { label: L(locale).subtotal, amount: b.base },
    { label: L(locale).vat, amount: b.vat },
    { label: L(locale).total, amount: b.inclusive, isTotal: true },
  ];
}

/** Inclusive subtotal for N QR cards at 60 EGP/card (VAT-inclusive). */
export function cardOrderProductInclusiveFromQty(quantity: number): number {
  const q = Math.max(0, Math.round(Number(quantity)));
  if (q === 0) return 0;
  return inclusiveFromBase(q * CARD_UNIT_BASE_EGP);
}
