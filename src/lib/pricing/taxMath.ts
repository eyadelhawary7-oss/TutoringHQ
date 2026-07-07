/**
 * Inclusive pricing decomposition. The only tax shown to customers is VAT (14%);
 * a flat 20 EGP processing fee is added separately on Paymob-charged invoices
 * (see src/lib/processingFee.ts). The former 6% service fee and 0.5% stamp duty
 * have been removed everywhere — they no longer exist in the math or the UI.
 */

export const VAT_RATE = 0.14;

/**
 * VAT-INCLUSIVE decomposition (B-H1). A VAT-inclusive price P contains base B
 * and VAT at rate r where P = B × (1 + r). Therefore:
 *   base = P / (1 + r)          VAT = P − base = P × r / (1 + r)
 * This is the ONLY arithmetically correct split for a "VAT (14%)" line — the
 * printed VAT then equals exactly 14% of the printed subtotal, as an Egyptian
 * فاتورة ضريبية legally requires. (The former model stripped P × 0.14 / P × 0.86,
 * which made the "14%" line 16.28% of the subtotal — non-compliant, and it
 * disagreed with processingFee.vatInsideInclusive, which already used ÷1.14.)
 */
const VAT_DIVISOR = 1 + VAT_RATE;

/**
 * QR card physical economics: base per card before VAT. Grosses up to a flat
 * 60 EGP/card inclusive under the VAT-inclusive split (base = 60 / 1.14). Kept
 * UNROUNDED so N-card multiples gross back to exactly N × 60 EGP with no
 * rounding drift, and so the setup_fee invoice can show a base + VAT breakdown.
 */
export const CARD_UNIT_BASE_EGP = 60 / VAT_DIVISOR;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** VAT contained inside a VAT-inclusive amount: P × 0.14 / 1.14. */
function vatInside(inclusive: number): number {
  return round2((inclusive * VAT_RATE) / VAT_DIVISOR);
}

export function baseFromInclusive(inclusive: number): number {
  const i = Number(inclusive);
  if (!Number.isFinite(i)) return 0;
  return round2(i / VAT_DIVISOR);
}

export function inclusiveFromBase(base: number): number {
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return round2(b * VAT_DIVISOR);
}

export interface TaxBreakdown {
  inclusive: number;
  vat: number;
  base: number;
}

/**
 * Decompose inclusive amount into base + VAT so the two sum exactly. VAT is the
 * 14% slice already inside the inclusive amount (P × 0.14 / 1.14), identical to
 * processingFee.vatInsideInclusive — the two modules now agree exactly.
 */
export function explodeInclusive(inclusive: number): TaxBreakdown {
  const i = round2(Number(inclusive));
  if (!Number.isFinite(i) || i <= 0) {
    return { inclusive: 0, vat: 0, base: 0 };
  }
  const vat = vatInside(i);
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
