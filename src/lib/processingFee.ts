// src/lib/processingFee.ts
//
// Flat "processing fee" added to every Paymob-charged subscription / pack invoice.
// Per the Summer-2026 billing brief (Section 5). The fee is ADDED on top of the
// VAT-inclusive subscription price, so:
//
//   total charged = subscription (VAT-inclusive) + processing fee
//
// Two controls live in platform_config and are editable from /admin/platform-config
// with NO rebuild (the brief's "two controls" requirement):
//   - processing_fee_enabled (bool, default true)  → hides/shows the fee everywhere
//   - processing_fee_amount  (number EGP, default 20) → the flat amount
//
// The fee that was applied to a given invoice is snapshotted into
// invoices.metadata.processing_fee at creation time, so the rendered breakdown is
// deterministic even if the config later changes.
//
// This module is PURE and client-safe (no Supabase import). The server-side config
// reader lives in src/lib/pricingConfig.ts (getProcessingFeeConfig).

export const PROCESSING_FEE_ENABLED_KEY = 'processing_fee_enabled';
export const PROCESSING_FEE_AMOUNT_KEY = 'processing_fee_amount';

export const PROCESSING_FEE_DEFAULT_ENABLED = true;
export const PROCESSING_FEE_DEFAULT_AMOUNT = 20;

/** VAT is 14% inclusive on the new simplified model (no separate stamp/service lines). */
export const PROCESSING_FEE_VAT_RATE = 0.14;

export interface ProcessingFeeConfig {
  enabled: boolean;
  amount: number;
}

export const PROCESSING_FEE_DEFAULTS: ProcessingFeeConfig = {
  enabled: PROCESSING_FEE_DEFAULT_ENABLED,
  amount: PROCESSING_FEE_DEFAULT_AMOUNT,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The fee actually applied given config: 0 when disabled or non-positive. */
export function resolveProcessingFeeAmount(cfg: ProcessingFeeConfig): number {
  if (!cfg || !cfg.enabled) return 0;
  const a = round2(Number(cfg.amount));
  return Number.isFinite(a) && a > 0 ? a : 0;
}

export interface AppliedProcessingFee {
  /** VAT-inclusive subscription / pack price (what the plan advertises). */
  subscription: number;
  /** The flat fee actually added (0 when disabled). */
  fee: number;
  /** subscription + fee — the amount actually charged via Paymob. */
  total: number;
}

/**
 * Add the configured processing fee to a VAT-inclusive subscription (or pack) amount.
 * Returns the subscription, the fee applied, and the new charged total.
 */
export function applyProcessingFee(
  subscriptionInclusive: number,
  cfg: ProcessingFeeConfig,
): AppliedProcessingFee {
  const sub = round2(Number(subscriptionInclusive));
  const safeSub = Number.isFinite(sub) && sub > 0 ? sub : 0;
  const fee = resolveProcessingFeeAmount(cfg);
  return { subscription: safeSub, fee, total: round2(safeSub + fee) };
}

/** VAT already contained inside a VAT-inclusive amount (14%): inclusive × 0.14 / 1.14. */
export function vatInsideInclusive(inclusive: number): number {
  const i = round2(Number(inclusive));
  if (!Number.isFinite(i) || i <= 0) return 0;
  return round2((i * PROCESSING_FEE_VAT_RATE) / (1 + PROCESSING_FEE_VAT_RATE));
}

export type RedesignedInvoiceLineKey =
  | 'subscription'
  | 'processing_fee'
  | 'total'
  | 'vat_included';

export interface RedesignedInvoiceLine {
  key: string;
  label: string;
  amount: number;
  /** The bold grand-total row. */
  isTotal?: boolean;
  /** VAT breakdown — already inside the total; does NOT add to it. */
  isVatNote?: boolean;
  /** Processing-fee row carries the ⓘ info affordance. */
  hasInfo?: boolean;
}

/** A charge line that appears BEFORE the processing fee (subscription, late fee, reactivation fee, …). */
export interface InvoiceChargeLine {
  key: string;
  label: string;
  amount: number;
}

type LineLocale = 'ar' | 'en';

const LINE_LABELS: Record<LineLocale, Record<RedesignedInvoiceLineKey, string>> = {
  ar: {
    subscription: 'قيمة الاشتراك',
    processing_fee: 'رسوم المعالجة',
    total: 'الإجمالي',
    vat_included: 'ضريبة القيمة المضافة (مشمولة)',
  },
  en: {
    subscription: 'Subscription value',
    processing_fee: 'Processing fee',
    total: 'Total',
    vat_included: 'VAT (included)',
  },
};

/**
 * Generic customer-facing invoice lines in the legal order (Section 5):
 *   ...charge lines → رسوم المعالجة (ⓘ) → الإجمالي → ضريبة القيمة المضافة (مشمولة).
 * VAT is the LAST line, a breakdown already inside the total (does not add to it).
 * The flat processing fee is its OWN line on top of the charges — it is never
 * folded into any charge (so e.g. a late-fee % is never applied to it).
 *
 * @param charges Ordered charge lines (subscription, late fee, reactivation fee, …).
 * @param fee     Flat processing fee; the line is omitted when 0.
 * @param total   Charged total. Defaults to sum(charges) + fee.
 */
export function buildCombinedInvoiceLines(opts: {
  charges: InvoiceChargeLine[];
  fee: number;
  total?: number;
  locale?: LineLocale;
}): RedesignedInvoiceLine[] {
  const locale: LineLocale = opts.locale === 'en' ? 'en' : 'ar';
  const labels = LINE_LABELS[locale];
  const fee = Math.max(0, round2(Number(opts.fee) || 0));
  const charges = (opts.charges ?? []).map((c) => ({
    key: c.key,
    label: c.label,
    amount: round2(Number(c.amount) || 0),
  }));
  const chargesSum = charges.reduce((s, c) => s + c.amount, 0);
  const rawTotal = opts.total != null ? round2(Number(opts.total)) : round2(chargesSum + fee);
  const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0;
  const vat = vatInsideInclusive(total);

  const lines: RedesignedInvoiceLine[] = charges.map((c) => ({
    key: c.key,
    label: c.label,
    amount: c.amount,
  }));
  if (fee > 0) {
    lines.push({ key: 'processing_fee', label: labels.processing_fee, amount: fee, hasInfo: true });
  }
  lines.push({ key: 'total', label: labels.total, amount: total, isTotal: true });
  lines.push({ key: 'vat_included', label: labels.vat_included, amount: vat, isVatNote: true });
  return lines;
}

/**
 * Customer-facing invoice lines for a single subscription / pack charge (Section 5):
 *   1. قيمة الاشتراك      — subscription price (VAT-inclusive, = total − fee)
 *   2. رسوم المعالجة (ⓘ)  — processing fee (omitted when 0)
 *   3. الإجمالي           — total
 *   4. ضريبة القيمة المضافة (مشمولة) — VAT, LAST line, breakdown inside the total
 *
 * @param total The charged total (subscription + fee) — i.e. invoices.total_amount.
 * @param fee   The fee snapshotted on the invoice (metadata.processing_fee); 0 = none.
 */
export function buildRedesignedInvoiceLines(opts: {
  total: number;
  fee: number;
  locale?: LineLocale;
}): RedesignedInvoiceLine[] {
  const locale: LineLocale = opts.locale === 'en' ? 'en' : 'ar';
  const labels = LINE_LABELS[locale];
  const total = round2(Number(opts.total));
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const fee = Math.max(0, round2(Number(opts.fee) || 0));
  const subscription = round2(safeTotal - fee);
  return buildCombinedInvoiceLines({
    charges: [{ key: 'subscription', label: labels.subscription, amount: subscription }],
    fee,
    total: safeTotal,
    locale,
  });
}

// ── ⓘ info-sheet copy (Arabic) ──────────────────────────────────────────────
// Tapping the ⓘ on the processing-fee line opens a small sheet with a "تمام"
// dismiss button. The amount is interpolated from config so the copy stays
// correct if the fee changes (e.g. back to 9).

export const PROCESSING_FEE_INFO_TITLE_AR = 'رسوم المعالجة';
export const PROCESSING_FEE_INFO_DISMISS_AR = 'تمام';
export const PROCESSING_FEE_INFO_TITLE_EN = 'Processing fee';
export const PROCESSING_FEE_INFO_DISMISS_EN = 'OK';

/** Arabic info body, with the live fee amount interpolated (default 20). */
export function processingFeeInfoBodyAr(amount: number = PROCESSING_FEE_DEFAULT_AMOUNT): string {
  const n = Number.isFinite(amount) && amount > 0 ? round2(amount) : PROCESSING_FEE_DEFAULT_AMOUNT;
  const amountText = Number.isInteger(n) ? String(n) : String(n);
  return `رسوم ثابتة قدرها ${amountText} جنيهًا تُضاف إلى كل عملية دفع، وتغطي تكلفة معالجة الدفع بأمان عبر البطاقة أو المحفظة. وهي ثابتة لا تتغير مع قيمة باقتك.`;
}

/** English info body (for the LTR locale). */
export function processingFeeInfoBodyEn(amount: number = PROCESSING_FEE_DEFAULT_AMOUNT): string {
  const n = Number.isFinite(amount) && amount > 0 ? round2(amount) : PROCESSING_FEE_DEFAULT_AMOUNT;
  return `A flat ${n} EGP fee added to every payment to cover the cost of processing it securely by card or wallet. It is fixed and does not change with the size of your plan.`;
}
