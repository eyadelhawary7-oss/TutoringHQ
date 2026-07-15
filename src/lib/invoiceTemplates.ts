import { formatDate, formatDateTime, formatNumber, formatPercent, formatTime } from '@/lib/formatNumber';
import { calcExclusive, type ExclusivePricing } from '@/lib/invoiceTaxUtils';
import {
  buildRedesignedInvoiceLines,
  processingFeeInfoBodyAr,
  PROCESSING_FEE_VAT_RATE,
  type RedesignedInvoiceLine,
} from '@/lib/processingFee';

/** HTML for PDF/email previews. RTL-EXEMPT: email clients + tax PDFs use physical box model for predictable rendering. */

const PDF_LOCALE = 'ar';

export const BLAST_PRICE_PER_PARENT_INCLUSIVE = 9.8;

export const INVOICE_PREFIX: Record<string, string> = {
  subscription: 'INV',
  base_subscription: 'BASE',
  signup_first_payment: 'SIGNUP',
  pack_billing: 'PACK',
  announcement_settlement: 'ANN',
  announcement_cap: 'ANNCAP',
  plan_upgrade_difference: 'UPG',
  setup_fee: 'SETUP',
  payment_proof: 'PROOF',
  whatsapp_addon: 'WA',
  late_payment_fee: 'LATE',
  referral_payout: 'PAY',
};

export const PAGE_LABELS: Record<string, string> = {
  subscription: '1 OF 11: SUBSCRIPTION INVOICE',
  base_subscription: '2 OF 11: BASE SUBSCRIPTION',
  signup_first_payment: '3 OF 11: SIGNUP FIRST PAYMENT',
  pack_billing: '4 OF 11: WHATSAPP PACK BILLING',
  announcement_settlement: '5 OF 11: ANNOUNCEMENT SETTLEMENT',
  announcement_cap: '6 OF 11: ANNOUNCEMENT CAP',
  plan_upgrade_difference: '7 OF 11: PLAN UPGRADE DIFFERENCE',
  setup_fee: '8 OF 11: SETUP FEE',
  late_payment_fee: '9 OF 11: LATE PAYMENT FEE',
  referral_payout: '10 OF 11: REFERRAL PAYOUT RECEIPT',
  payment_proof: '11 OF 11: PAYMENT PROOF',
  whatsapp_addon: 'WHATSAPP ADD-ON',
  reactivation_fee: 'REACTIVATION FEE',
};

const TYPE_LABEL_AR: Record<string, string> = {
  subscription: 'فاتورة اشتراك',
  base_subscription: 'فاتورة الاشتراك الأساسي',
  signup_first_payment: 'دفعة التسجيل الأولى',
  pack_billing: 'فاتورة باقة أولياء الأمور',
  announcement_settlement: 'تسوية إعلانات',
  announcement_cap: 'سقف الإعلانات',
  plan_upgrade_difference: 'فرق ترقية الخطة',
  payment_proof: 'إثبات دفع',
  setup_fee: 'رسوم إعداد / توصيل',
  whatsapp_addon: 'باقة واتساب',
  late_payment_fee: 'فاتورة غرامة تأخير',
  referral_payout: 'إيصال صرف عمولات',
  reactivation_fee: 'فاتورة إعادة تفعيل',
};

export interface InvoiceTemplateData {
  invoice: {
    id: string;
    invoice_number: string | null;
    invoice_type: string;
    total_amount: string | number;
    /** VAT slice already inside total_amount, snapshotted at issue time (null = legacy). */
    vat_amount?: string | number | null;
    /** VAT fraction used for this invoice (e.g. 0.14), snapshotted at issue time (null = legacy). */
    vat_rate?: string | number | null;
    /** Flat processing fee snapshotted at issue time; source of truth over metadata.processing_fee. */
    processing_fee?: string | number | null;
    discount_amount: string | number | null;
    billing_period_start: string;
    billing_period_end: string;
    due_date: string;
    status: string;
    notes: string | null;
    created_at: string;
    metadata?: Record<string, unknown> | null;
    /** Populated by generateInvoicePdf for rendering */
    center_id?: string;
    payment_method?: string | null;
    payment_reference?: string | null;
    paymob_transaction_id?: string | null;
    paid_at?: string | null;
    base_amount?: string | number | null;
    payment_amount?: string | number | null;
  };
  center: {
    id: string;
    name: string;
    center_code: string;
    phone: string | null;
    plan: string | null;
    referral_code?: string | null;
    city?: string | null;
    subscription_billing_period?: string | null;
    next_payment_due?: string | null;
    pack_price_per_parent?: number | string | null;
    announcement_balance?: number | string | null;
  };
  /** QR for referral strip; omit for referral_payout */
  referralQrDataUrl?: string | null;
  /** Merged render payload (not persisted) */
  render?: InvoiceRenderPayload;
}

export type InvoiceRenderPayload = {
  planArabic?: string;
  planEnglish?: string;
  studentCap?: number;
  /** Announcement settlement rows */
  settlementBlasts?: {
    blast_type: string;
    parents_notified: number;
    total_amount: number;
    created_at: string;
  }[];
  /** Single blast for cap invoice */
  capBlast?: {
    blast_type: string;
    parents_notified: number;
    created_at: string;
    announcement_index?: number;
    monthly_cap?: number;
    monthly_used?: number;
  };
  capBalanceBefore?: number;
  capBalanceAfter?: number;
  upgrade?: {
    fromPlanAr: string;
    toPlanAr: string;
    fromPlanEn?: string;
    toPlanEn?: string;
    daysRemaining: number;
    newPlanAmount: number;
    oldPlanCredit: number;
    newCap?: number;
  };
  referralCommissions?: {
    monthIndex: number;
    commissionPercent: number;
    referredCenterName: string;
    monthLabel: string;
    commissionAmount: number;
  }[];
  referralGross?: number;
  referralWithdrawalFee?: number;
  referralInstapay?: string;
  referralCount?: number;
  /** Arabic long month label e.g. "أبريل 2026" for pack sidebar */
  monthArabic?: string;
  transactionId?: string | null;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtMoney(n: number): string {
  return formatNumber(round2(n), 'en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateAr(iso: string | null | undefined): string {
  if (!iso) return ',';
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ',';
  return formatDate(d, PDF_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDateTimeAr(iso: string | null | undefined): string {
  if (!iso) return ',';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ',';
  return formatDateTime(d, PDF_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function billingCycleAr(period: string | null | undefined): string {
  const p = (period ?? '').toLowerCase();
  if (p === 'monthly') return 'شهري';
  if (p === 'quarterly') return 'ربع سنوي';
  if (p === 'annual' || p === 'yearly') return 'سنوي';
  return period?.trim() ? esc(period) : ',';
}

function paymentMethodAr(raw: string | null | undefined): string {
  if (!raw?.trim()) return 'Paymob';
  const x = raw.trim().toLowerCase();
  if (x === 'paymob' || x.includes('paymob')) return 'Paymob';
  if (x === 'instapay' || x.includes('instapay')) return 'Instapay';
  return esc(raw.trim());
}

function parsePackParentsFromRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const m = /\((\d+)\s*parents?\)/i.exec(ref);
  if (m) return parseInt(m[1]!, 10);
  const m2 = /\((\d+)\s*students?\)/i.exec(ref);
  if (m2) return parseInt(m2[1]!, 10);
  return null;
}

function blastTypeAr(bt: string): string {
  const k = (bt ?? '').toLowerCase();
  if (k === 'ops' || k === 'operations') return 'عمليات';
  return 'ترويج';
}

function planPresentation(planRaw: string | null | undefined): { en: string; ar: string } {
  const k = (planRaw ?? 'starter').toLowerCase().replace(/-/g, '_');
  const table: Record<string, { en: string; ar: string }> = {
    solo: { en: 'Solo', ar: 'فردي' },
    nano: { en: 'Nano', ar: 'سنتر نانو' },
    starter: { en: 'Starter', ar: 'أساسي' },
    pro: { en: 'Pro', ar: 'محترف' },
    business: { en: 'Business', ar: 'أعمال' },
    enterprise: { en: 'Enterprise', ar: 'مؤسسات' },
    top_centers: { en: 'Top Centers', ar: 'مراكز مميزة' },
  };
  const hit = table[k];
  if (hit) return hit;
  const label = (planRaw ?? 'starter').replace(/_/g, ' ');
  const title = label.replace(/\b\w/g, (c) => c.toUpperCase());
  return { en: title, ar: ',' };
}

type BadgeKey =
  | 'paid'
  | 'pending'
  | 'overdue'
  | 'review'
  | 'activated'
  | 'deducted'
  | 'settled'
  | 'instant'
  | 'upgraded'
  | 'shipped'
  | 'transferred';

function resolveBadgeKey(invoiceType: string, status: string, daysLate: number): { key: BadgeKey; overdueExtra?: string } {
  const st = (status ?? '').toLowerCase();
  if (invoiceType === 'payment_proof' && (st === 'pending' || st === 'approved')) return { key: 'review' };
  if (invoiceType === 'signup_first_payment' && (st === 'paid' || st === 'approved')) return { key: 'activated' };
  if (invoiceType === 'pack_billing' && (st === 'paid' || st === 'approved')) return { key: 'deducted' };
  if (invoiceType === 'announcement_settlement' && (st === 'paid' || st === 'approved')) return { key: 'settled' };
  if (invoiceType === 'announcement_cap') return { key: 'instant' };
  if (invoiceType === 'plan_upgrade_difference' && (st === 'paid' || st === 'approved')) return { key: 'upgraded' };
  if (invoiceType === 'setup_fee' && (st === 'paid' || st === 'approved')) return { key: 'shipped' };
  if (invoiceType === 'referral_payout' && (st === 'paid' || st === 'approved')) return { key: 'transferred' };
  if (st === 'overdue') return { key: 'overdue', overdueExtra: daysLate > 0 ? `متأخرة ${daysLate} أيام` : 'متأخرة' };
  if (st === 'paid' || st === 'approved') return { key: 'paid' };
  return { key: 'pending' };
}

function overdueDaysFromDue(dueYmd: string | null | undefined): number {
  if (!dueYmd) return 0;
  const due = new Date(`${dueYmd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
}

function statusBadgeHtml(key: BadgeKey, overdueExtra?: string): string {
  const configs: Record<BadgeKey, { bg: string; color: string; label: string }> = {
    paid: { bg: '#064e3b', color: '#10b981', label: 'مدفوعة' },
    pending: { bg: '#451a03', color: '#f59e0b', label: 'في انتظار الدفع' },
    overdue: { bg: '#450a0a', color: '#ef4444', label: overdueExtra || 'متأخرة' },
    review: { bg: '#1e293b', color: '#94a3b8', label: 'قيد المراجعة' },
    activated: { bg: '#042f2e', color: '#0D9488', label: 'تم تفعيل الحساب' },
    deducted: { bg: '#042f2e', color: '#0D9488', label: 'تم الخصم تلقائياً' },
    settled: { bg: '#042f2e', color: '#0D9488', label: 'تمت التسوية' },
    instant: { bg: '#042f2e', color: '#0D9488', label: 'خُصم فوراً' },
    upgraded: { bg: '#042f2e', color: '#0D9488', label: 'تمت الترقية' },
    shipped: { bg: '#042f2e', color: '#0D9488', label: 'تم الشحن' },
    transferred: { bg: '#042f2e', color: '#0D9488', label: 'تم التحويل' },
  };
  const c = configs[key];
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 12px;border-radius:9999px;background:${c.bg};">
    <span style="width:8px;height:8px;border-radius:50%;background:${c.color};"></span>
    <span style="color:${c.color};font-size:12px;font-weight:700;">${esc(c.label)}</span>
  </div>`;
}

function statusStampHtml(status: string, dueYmd: string | undefined): string {
  const st = (status ?? '').toLowerCase();
  if (st === 'overdue') {
    return `<div style="margin-top:24px;padding:16px;border:2px dashed #ef4444;border-radius:8px;text-align:center;">
      <div style="color:#ef4444;font-size:14px;font-weight:700;letter-spacing:0.35em;font-family:'Playfair Display',serif;">O V E R D U E</div>
    </div>`;
  }
  if (st === 'paid' || st === 'approved') {
    return `<div style="margin-top:24px;padding:16px;border:2px dashed #0D9488;border-radius:8px;text-align:center;">
      <div style="color:#0D9488;font-size:14px;font-weight:700;letter-spacing:0.35em;font-family:'Playfair Display',serif;">P A I D</div>
    </div>`;
  }
  return '';
}

function totalsRow(label: string, value: string, style = ''): string {
  return `<div class="totals-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;${style}">
    <span style="color:#64748b;font-size:12px;">${label}</span>
    <span style="color:#64748b;font-size:12px;">${value}</span>
  </div>`;
}

function totalsRowBold(label: string, value: string): string {
  return `<div class="totals-row" style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #1e293b;padding-top:8px;margin-top:8px;">
    <span style="color:#f8fafc;font-size:16px;font-weight:700;">${esc(label)}</span>
    <span style="color:#0D9488;font-size:18px;font-weight:700;font-family:'Playfair Display',serif;">${value}</span>
  </div>`;
}

function dividerDashed(): string {
  return `<div style="margin:8px 0;border-top:1px dashed #475569;opacity:0.9;"></div>`;
}

function dividerLight(): string {
  return `<div style="margin:8px 0;border-top:1px solid #334155;"></div>`;
}

function dividerSolid(): string {
  return `<div style="margin:8px 0;border-top:2px solid #1e293b;"></div>`;
}

function taxNoteRow(note: string): string {
  return `<div style="margin-top:10px;font-size:11px;color:#64748b;line-height:1.55;font-family:Cairo,sans-serif;">${esc(note)}</div>`;
}

/** Standard "VAT N٪ (included)" note, driven by the invoice's stored rate. */
function taxNoteStandardAr(vatPct: string): string {
  return `ضريبة القيمة المضافة ${vatPct}٪ (مشمولة)`;
}

/**
 * `p` decomposes the CHARGE (base + VAT). `feeAmt` is the flat processing fee
 * added on top; `grandTotal` (charge + fee) defaults to `p.total + feeAmt`.
 */
function exclusiveTotalsStandard(
  p: ExclusivePricing,
  totalLabel: string,
  taxNoteAr: string,
  feeAmt = 0,
  grandTotal?: number,
  vatOverride?: number | null,
  vatPct = '14',
): string {
  const total = grandTotal != null ? grandTotal : round2(p.total + feeAmt);
  const vatShown = vatOverride != null ? vatOverride : p.vat;
  return `${totalsRow('المجموع الجزئي', `${fmtMoney(p.base)} EGP`)}
  ${dividerDashed()}
  ${totalsRow(`ضريبة القيمة المضافة (${vatPct}%)`, `${fmtMoney(vatShown)} EGP`)}
  ${feeAmt > 0 ? totalsRow('رسوم المعالجة (ⓘ)', `${fmtMoney(feeAmt)} EGP`) : ''}
  ${dividerSolid()}
  ${totalsRowBold(totalLabel, `${fmtMoney(total)} EGP`)}
  ${taxNoteRow(taxNoteAr)}
  ${feeAmt > 0 ? processingFeeNoteRow(feeAmt) : ''}`;
}

/** ⓘ footnote with the processing-fee explanation (PDF is non-interactive). */
function processingFeeNoteRow(amount: number): string {
  return `<div style="margin-top:10px;font-size:11px;color:#94a3b8;line-height:1.55;font-family:Cairo,sans-serif;">ⓘ ${esc(processingFeeInfoBodyAr(amount))}</div>`;
}

/**
 * Renders redesigned customer-facing totals (Section 5) from a prebuilt line set:
 *   ...charge lines → رسوم المعالجة (ⓘ) → الإجمالي → ضريبة القيمة المضافة (مشمولة).
 * VAT is the LAST line, a breakdown already inside the total (does not add to it).
 * The old stamp-duty and service-fee lines are removed.
 */
function renderRedesignedTotals(
  lines: RedesignedInvoiceLine[],
  totalLabel: string,
  vatOverride?: number | null,
): string {
  const charges = lines.filter((l) => !l.isTotal && !l.isVatNote && l.key !== 'processing_fee');
  const feeLine = lines.find((l) => l.key === 'processing_fee');
  const totalLine = lines.find((l) => l.isTotal);
  const vat = lines.find((l) => l.isVatNote);
  const chargeRows = charges
    .map((l) => totalsRow(esc(l.label), `${fmtMoney(l.amount)} EGP`))
    .join('\n  ');
  const feeRow = feeLine
    ? totalsRow(`${esc(feeLine.label)} ⓘ`, `${fmtMoney(feeLine.amount)} EGP`)
    : '';
  const vatAmt = vatOverride != null ? vatOverride : vat?.amount ?? 0;
  const vatRow = vat ? totalsRow(esc(vat.label), `${fmtMoney(vatAmt)} EGP`) : '';
  const note = feeLine ? processingFeeNoteRow(feeLine.amount) : '';
  return `${chargeRows}
  ${feeRow}
  ${dividerSolid()}
  ${totalsRowBold(totalLabel, `${fmtMoney(totalLine?.amount ?? 0)} EGP`)}
  ${vatRow}
  ${note}`;
}

/** Subscription / pack totals: قيمة الاشتراك → رسوم المعالجة (ⓘ) → الإجمالي → VAT. */
function redesignedSubscriptionTotals(
  total: number,
  fee: number,
  totalLabel: string,
  vatOverride?: number | null,
): string {
  return renderRedesignedTotals(
    buildRedesignedInvoiceLines({ total, fee, locale: 'ar' }),
    totalLabel,
    vatOverride,
  );
}

function lineRowHtml(opts: {
  amount: number;
  detail: string;
  title: string;
  subtitle: string;
  amountTeal?: boolean;
  amountRed?: boolean;
  amountAmber?: boolean;
  amountMuted?: boolean;
  stripe?: boolean;
}): string {
  const bg = opts.stripe ? 'background:#111c2f;' : '';
  let amtStyle =
    "text-align:right;padding:16px 0;font-size:15px;font-weight:700;white-space:nowrap;font-family:'Playfair Display',serif;";
  let amtText: string;
  if (opts.amountMuted) {
    amtStyle += 'color:#64748b;';
    amtText = `0 EGP`;
  } else if (opts.amountRed) {
    amtStyle += 'color:#ef4444;';
    amtText = `- EGP ${fmtMoney(Math.abs(opts.amount))}`;
  } else if (opts.amountAmber) {
    amtStyle += 'color:#f59e0b;';
    amtText = `${fmtMoney(opts.amount)} EGP`;
  } else {
    amtStyle += 'color:#0D9488;';
    amtText = `${fmtMoney(opts.amount)} EGP`;
  }
  const titleColor = opts.amountMuted ? '#64748b' : '#f8fafc';
  return `<tr style="border-bottom:1px solid #1e293b;vertical-align:top;${bg}">
    <td style="${amtStyle}">${amtText}</td>
    <td style="text-align:center;padding:16px 8px;color:#64748b;font-size:12px;">${esc(opts.detail)}</td>
    <td style="text-align:right;padding:16px 0;">
      <div style="color:${titleColor};font-size:14px;font-weight:700;">${esc(opts.title)}</div>
      <div style="color:#64748b;font-size:11px;margin-top:2px;">${esc(opts.subtitle)}</div>
    </td>
  </tr>`;
}

function lineItemsTable(rows: string): string {
  return `<table style="width:100%;border-collapse:collapse;direction:rtl;">
  <thead>
    <tr style="border-bottom:1px solid #1e293b;">
      <th style="text-align:right;color:#64748b;font-size:11px;padding:8px 0;">المبلغ</th>
      <th style="text-align:center;color:#64748b;font-size:11px;padding:8px 0;">التفاصيل</th>
      <th style="text-align:right;color:#64748b;font-size:11px;padding:8px 0;">البيان</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function taxDisclosureBox(txnBlock: string): string {
  return `<div class="tax-box" style="background:#0a1628;border:1px solid #1e293b;border-radius:8px;padding:12px;margin-top:16px;display:flex;gap:24px;flex-wrap:wrap;">
  <div>
    <div style="color:#64748b;font-size:11px;margin-bottom:4px;">الإفصاح الضريبي</div>
    <div style="color:#cbd5e1;font-size:11px;">التفصيل أعلاه يوضح القيمة الأساسية والضرائب والرسوم؛ الإجمالي النهائي كما هو مسجل.</div>
  </div>
  ${txnBlock}
</div>`;
}

function referralSectionHtml(referralCode: string, qrDataUrl: string | null | undefined): string {
  const code = referralCode.replace(/\s+/g, '') || 'CODE';
  const qr =
    qrDataUrl && qrDataUrl.startsWith('data:')
      ? `<img src="${qrDataUrl}" width="60" height="60" alt="" />`
      : `<div style="width:60px;height:60px;margin:0 auto;background:repeating-linear-gradient(90deg,#0D9488,#0D9488 2px,#08101e 2px,#08101e 4px);border-radius:4px;"></div>`;
  return `<div style="background:#08101e;border-top:1px solid #1e293b;padding:16px 0;margin-top:0;">
  <div style="text-align:center;color:#64748b;font-size:11px;margin-bottom:12px;">برنامج الإحالة</div>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
    <div>
      <div style="color:#f8fafc;font-size:15px;font-weight:700;">تعرف على سنتر تاني؟</div>
      <div style="color:#0D9488;font-size:15px;font-weight:700;">اكسب كل شهر.</div>
      <div style="color:#64748b;font-size:11px;margin-top:6px;">
        +13: <strong style="color:#f8fafc;">5% دائمة</strong>
        &nbsp; شهر 2-12: <strong style="color:#f8fafc;">10%</strong>
        &nbsp; شهر 1: <strong style="color:#f8fafc;">25%</strong>
      </div>
    </div>
    <div style="text-align:center;">
      <div style="color:#64748b;font-size:11px;margin-bottom:4px;">كود الإحالة</div>
      <div style="border:1px dashed #0D9488;padding:8px 16px;letter-spacing:6px;font-size:20px;font-weight:700;color:#f8fafc;font-family:'Playfair Display',serif;">
        ${esc(code.toUpperCase())}
      </div>
      <div style="color:#64748b;font-size:10px;margin-top:4px;">tutoringhq.app/refer/${esc(code)}</div>
    </div>
    <div style="text-align:center;">
      <div style="color:#64748b;font-size:11px;margin-bottom:4px;">امسح للإحالة</div>
      ${qr}
    </div>
  </div>
</div>`;
}

function headerRecipientTotal(opts: {
  recipientLabel: string;
  centerName: string;
  centerPhone: string;
  centerAddress: string;
  totalLabel: string;
  totalFormatted: string;
}): string {
  return `<div class="header-row" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
    <div class="recipient">
      <div style="color:#64748b;font-size:11px;">${esc(opts.recipientLabel)}</div>
      <div style="color:#f8fafc;font-size:20px;font-weight:700;font-family:'Cairo',sans-serif;">${esc(opts.centerName)}</div>
      <div style="color:#cbd5e1;font-size:12px;">${esc(opts.centerPhone || ',')}</div>
      <div style="color:#64748b;font-size:11px;">${esc(opts.centerAddress || ',')}</div>
    </div>
    <div class="total-block" style="text-align:left;">
      <div style="color:#64748b;font-size:11px;">${esc(opts.totalLabel)}</div>
      <div style="font-family:'Playfair Display',serif;font-size:48px;font-weight:700;color:#f8fafc;">
        <span style="font-size:18px;color:#64748b;">EGP </span>${opts.totalFormatted}
      </div>
    </div>
  </div>`;
}

function resolveTotalHeaderLabel(
  invoiceType: string,
  status: string,
  badgeKey: BadgeKey,
): string {
  const st = (status ?? '').toLowerCase();
  if (invoiceType === 'referral_payout') return 'إجمالي المبلغ المُصروف';
  if (invoiceType === 'payment_proof') return 'المبلغ المُقدَّم';
  if (invoiceType === 'plan_upgrade_difference' && (st === 'paid' || st === 'approved')) return 'رسوم الترقية المحسوبة بالأيام';
  if (invoiceType === 'announcement_settlement' && (st === 'paid' || st === 'approved')) return 'إجمالي التسوية الشهرية';
  if (invoiceType === 'pack_billing' && (st === 'paid' || st === 'approved')) return 'إجمالي المبلغ المخصوم';
  if (invoiceType === 'announcement_cap') return 'إجمالي المبلغ المخصوم';
  if (st === 'paid' || st === 'approved') return 'إجمالي المبلغ المدفوع';
  if (st === 'overdue' && invoiceType === 'late_payment_fee') return 'إجمالي المبلغ المستحق';
  if (st === 'pending') return 'إجمالي المبلغ المستحق';
  if (badgeKey === 'deducted' || badgeKey === 'instant') return 'إجمالي المبلغ المخصوم';
  if (badgeKey === 'settled') return 'إجمالي التسوية الشهرية';
  return 'إجمالي المبلغ المستحق';
}

export function buildInvoiceHtml(data: InvoiceTemplateData): string {
  const inv = data.invoice;
  const c = data.center;
  const r = data.render ?? {};
  const invoiceType = (inv.invoice_type ?? 'subscription').replace(/late_fee/g, 'late_payment_fee');
  const status = String(inv.status ?? 'pending');
  const meta = (inv.metadata ?? {}) as Record<string, unknown>;
  // Stored tax snapshot (persisted at issue time). Prefer these over recomputing so
  // an invoice always reprints the exact VAT it was charged, at the rate in force
  // when it was raised — a later national VAT-rate change never rewrites old invoices.
  const storedVat = inv.vat_amount != null ? num(inv.vat_amount) : null;
  const storedVatRate = inv.vat_rate != null && num(inv.vat_rate) > 0 ? num(inv.vat_rate) : null;
  const storedProcessingFee = inv.processing_fee != null ? num(inv.processing_fee) : null;
  const vatPct = String(Math.round((storedVatRate ?? PROCESSING_FEE_VAT_RATE) * 100));
  const dueYmd = inv.due_date ? String(inv.due_date).slice(0, 10) : undefined;
  const daysLate = overdueDaysFromDue(dueYmd);
  const { key: badgeKey, overdueExtra } = resolveBadgeKey(invoiceType, status, daysLate);
  const invNo = String(inv.invoice_number ?? ',').trim() || ',';

  const planAr = r.planArabic ?? planPresentation(c.plan).ar;
  const billingCycle = billingCycleAr(c.subscription_billing_period ?? null);
  const periodStart = fmtDateAr(inv.billing_period_start);
  const periodEnd = fmtDateAr(inv.billing_period_end);
  const periodRange = `${periodStart} to ${periodEnd}`;
  const periodArabic = `${periodStart} – ${periodEnd}`;
  const issueDate = fmtDateAr(inv.created_at);
  const total = num(inv.total_amount);
  const base = num(inv.base_amount ?? total);
  const discount = num(inv.discount_amount);

  const payRef =
    (inv.payment_reference && String(inv.payment_reference).trim()) ||
    (inv.paymob_transaction_id && String(inv.paymob_transaction_id).trim()) ||
    '';
  const paymentTs =
    status === 'paid' || status === 'approved'
      ? fmtDateTimeAr(inv.paid_at ? String(inv.paid_at) : null)
      : ',';
  const paymentMethod = paymentMethodAr(inv.payment_method ?? null);

  let recipientLabel = 'مُرسلة إلى';
  if (invoiceType === 'referral_payout') recipientLabel = 'مُصروف إلى';
  if (invoiceType === 'payment_proof') recipientLabel = 'مُقدَّم من';

  const totalLabel = resolveTotalHeaderLabel(invoiceType, status, badgeKey);
  const typeLabelAr = TYPE_LABEL_AR[invoiceType] ?? 'فاتورة';
  const pageLabel = PAGE_LABELS[invoiceType] ?? invoiceType.toUpperCase().replace(/_/g, ' ');

  const centerAddress = (c.city ?? '').trim();
  const stamp = statusStampHtml(status, dueYmd);

  let contextBanner = '';
  if (invoiceType === 'base_subscription') {
    const next = c.next_payment_due ? fmtDateAr(String(c.next_payment_due)) : ',';
    contextBanner = `<div style="background:#451a03;border-right:3px solid #f59e0b;padding:10px 12px;margin-bottom:16px;border-radius:4px;">
      <div style="color:#f8fafc;font-weight:700;font-size:13px;">الشهر الأول من اشتراكك.</div>
      <div style="color:#cbd5e1;font-size:12px;">الفاتورة التالية ستصدر في ${esc(next)}.</div>
    </div>`;
  } else if (invoiceType === 'signup_first_payment') {
    const renew = inv.billing_period_end ? fmtDateAr(String(inv.billing_period_end)) : ',';
    contextBanner = `<div style="background:#042f2e;border-right:3px solid #0D9488;padding:10px 12px;margin-bottom:16px;border-radius:4px;">
      <div style="color:#f8fafc;font-weight:700;font-size:13px;">مرحباً بك في TutoringHQ.</div>
      <div style="color:#cbd5e1;font-size:12px;">حسابك نشط الآن. التجديد القادم: ${esc(renew)}. ستصلك رسالة تذكير قبل 7 أيام.</div>
    </div>`;
  } else if (invoiceType === 'late_payment_fee') {
    contextBanner = `<div style="background:#450a0a;border-right:3px solid #ef4444;padding:10px 12px;margin-bottom:16px;border-radius:4px;">
      <div style="color:#f8fafc;font-weight:700;font-size:13px;">الحساب معرض للإيقاف.</div>
      <div style="color:#cbd5e1;font-size:12px;">يرجى سداد المبلغ الكامل بما في ذلك غرامة التأخير لاستعادة الوصول الكامل. سيتم إيقاف حسابك إذا لم يتم السداد خلال 7 أيام.</div>
    </div>`;
  } else if (invoiceType === 'payment_proof') {
    contextBanner = `<div style="background:#1e293b;border-right:3px solid #94a3b8;padding:10px 12px;margin-bottom:16px;border-radius:4px;">
      <div style="color:#f8fafc;font-weight:700;font-size:13px;">في انتظار تأكيد المشرف.</div>
      <div style="color:#cbd5e1;font-size:12px;">تم استلام إثبات الدفع وهو قيد المراجعة. ستصلك رسالة واتساب فور التأكيد. عادةً يستغرق ذلك 1-2 ساعة عمل.</div>
    </div>`;
  }

  let typeSpecificSidebar = '';
  let capPaymentExtra = '';
  const studentCap = r.studentCap ?? 0;
  const packPricePerPre = num(c.pack_price_per_parent ?? 12) || 12;
  let packActivePre = 0;
  if (invoiceType === 'pack_billing') {
    const fromRef = parsePackParentsFromRef(payRef);
    const fromMath = Math.round(base / packPricePerPre);
    const n = fromRef ?? (fromMath || num(meta.active_parent_count));
    packActivePre = Math.max(0, n);
  }

  if (invoiceType === 'subscription') {
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الخطة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(planAr)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">دورة الفوترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(billingCycle)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الفترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(periodArabic)}</div>`;
  } else if (invoiceType === 'base_subscription') {
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الخطة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(planAr)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">دورة الفوترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(billingCycle)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">تاريخ الاستحقاق</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(dueYmd ? fmtDateAr(dueYmd) : ',')}</div>`;
  } else if (invoiceType === 'signup_first_payment') {
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الخطة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(planAr)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">دورة الفوترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(billingCycle)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الفترة الأولى</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(periodArabic)}</div>`;
  } else if (invoiceType === 'pack_billing') {
    const pSidebar = calcExclusive(total);
    const acSidebar = num(meta.active_count ?? meta.active_parent_count ?? packActivePre) || packActivePre;
    const exSidebar = acSidebar > 0 ? (pSidebar.base / acSidebar).toFixed(2) : '0.00';
    const ma = r.monthArabic ?? periodArabic;
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">أولياء الأمور النشطون</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(String(packActivePre))} ولي أمر</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">السعر</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(exSidebar)} ج.م / ولي أمر</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الفترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(ma)}</div>`;
  } else if (invoiceType === 'announcement_settlement') {
    const blasts = r.settlementBlasts ?? [];
    const annCount = blasts.length || num(meta.announcement_count ?? 1);
    const totalRecv = blasts.reduce((s, b) => s + b.parents_notified, 0) || num(meta.total_recipients);
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">عدد الإعلانات</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(String(annCount))} إعلانات</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">إجمالي المستلِمين</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(String(totalRecv || ','))} ولي أمر</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الفترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(r.monthArabic ?? periodArabic)}</div>`;
  } else if (invoiceType === 'announcement_cap') {
    const cb = r.capBlast;
    const sendDt = cb ? fmtDateTimeAr(cb.created_at) : issueDate;
    const rc = cb?.parents_notified ?? 0;
    const bb = r.capBalanceBefore ?? num(c.announcement_balance) + total;
    const ba = r.capBalanceAfter ?? num(c.announcement_balance);
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">النوع</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">تجاوز الحد الشهري</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">تاريخ الإرسال</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(sendDt)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">عدد المستلِمين</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(String(rc))} ولي أمر</div>`;
    capPaymentExtra = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">رصيد قبل</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${fmtMoney(bb)} ج.م</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">رصيد بعد</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${fmtMoney(ba)} ج.م</div>`;
  } else if (invoiceType === 'plan_upgrade_difference') {
    const u = r.upgrade;
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">من الخطة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(u?.fromPlanAr ?? ',')}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">إلى الخطة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(u?.toPlanAr ?? planAr)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الأيام المتبقية</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(String(u?.daysRemaining ?? ','))} يوم</div>`;
  } else if (invoiceType === 'setup_fee') {
    const productName = String(meta.product_name_ar ?? 'ماسح البطاقات الذكية');
    const shipCo = String(meta.shipping_company ?? 'Bosta');
    const track = String(meta.tracking_number ?? payRef ?? ',');
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">المنتج</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(productName)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">شركة الشحن</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(shipCo)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">رقم التتبع</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(track)}</div>`;
  } else if (invoiceType === 'late_payment_fee') {
    const lf = meta as { late_fee_rate?: number; days_overdue?: number; cycle_anchor?: string };
    const pct = Math.round(num(lf.late_fee_rate) * 100);
    const orig = lf.cycle_anchor ? fmtDateAr(String(lf.cycle_anchor)) : fmtDateAr(inv.billing_period_start);
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الموعد الأصلي</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(orig)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">أيام التأخير</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(String(num(lf.days_overdue) || daysLate))} أيام</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">نسبة الغرامة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(formatPercent(pct || 0, PDF_LOCALE))}</div>`;
  } else if (invoiceType === 'referral_payout') {
    const rc = r.referralCount ?? r.referralCommissions?.length ?? 0;
    const inst = r.referralInstapay ?? String(meta.instapay_number ?? ',');
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">عدد الإحالات</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(String(rc))} مراكز</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الفترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(periodArabic)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">Instapay</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(inst)}</div>`;
  } else if (invoiceType === 'payment_proof') {
    const refInv = String(meta.reference_invoice_number ?? payRef ?? ',');
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">طريقة الدفع</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(paymentMethod)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">تاريخ الإرسال</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(issueDate)}</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">مرجع الفاتورة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(refInv)}</div>`;
  } else if (invoiceType === 'whatsapp_addon') {
    typeSpecificSidebar = `
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">نوع الإضافة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">واتساب</div>
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">الفترة</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(periodArabic)}</div>`;
  }

  const paymentMethodBlock =
    invoiceType === 'announcement_cap'
      ? `${capPaymentExtra}
      <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">طريقة الدفع</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc('رصيد الإعلانات')}</div>
      <div class="meta-value" style="color:#64748b;font-size:11px;">${esc(paymentTs)}</div>`
      : invoiceType === 'announcement_settlement'
        ? `<div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">طريقة الدفع</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">رصيد الإعلانات - خُصم عند كل إرسال</div>
      <div class="meta-value" style="color:#64748b;font-size:11px;">${esc(paymentTs)}</div>`
        : `<div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">طريقة الدفع</div>
      <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(paymentMethod)}</div>
      <div class="meta-value" style="color:#64748b;font-size:11px;">${esc(paymentTs)}</div>`;

  let lineRowsHtml = '';
  let totalsInner = '';
  let showTaxBox = true;
  let txnLine = '';
  const txnId = r.transactionId ?? payRef;
  // Flat processing fee snapshotted on the invoice (Section 5). 0 = none / legacy.
  // Prefer the stored column; fall back to the legacy metadata snapshot.
  const processingFeeAmt = storedProcessingFee ?? num(meta.processing_fee);
  const subscriptionValue = round2(total - processingFeeAmt);

  const discountRowHtml =
    discount > 0
      ? totalsRow('خصم', `<span style="color:#10b981;font-weight:700;">-${fmtMoney(discount)} EGP</span>`)
      : '';

  if (['subscription', 'base_subscription'].includes(invoiceType)) {
    lineRowsHtml = lineRowHtml({
      amount: subscriptionValue,
      detail: periodRange,
      title: `${planAr}, ${billingCycle}`,
      subtitle: `حتى ${studentCap > 0 ? studentCap : ','} طالب`,
    });
    totalsInner = `${discountRowHtml}
    ${redesignedSubscriptionTotals(total, processingFeeAmt, totalLabel, storedVat)}`;
  } else if (invoiceType === 'signup_first_payment') {
    lineRowsHtml = lineRowHtml({
      amount: subscriptionValue,
      detail: periodRange,
      title: `${planAr}, ${billingCycle} (أول دفعة)`,
      subtitle: `حتى ${studentCap > 0 ? studentCap : ','} طالب`,
    });
    totalsInner = `${discountRowHtml}
    ${redesignedSubscriptionTotals(total, processingFeeAmt, totalLabel, storedVat)}`;
  } else if (invoiceType === 'teacher_overage') {
    const overStudents = num(meta.overage_students ?? 0);
    lineRowsHtml = lineRowHtml({
      amount: subscriptionValue,
      detail: periodRange,
      title: 'رسوم طلاب فوق الحد (Scale)',
      subtitle: overStudents > 0 ? `${overStudents} طالب × 20 ج.م` : 'تسوية شهرية',
    });
    totalsInner = redesignedSubscriptionTotals(total, processingFeeAmt, totalLabel, storedVat);
  } else if (invoiceType === 'pack_billing') {
    const active = packActivePre;
    const activeCount = num(meta.active_count ?? meta.active_parent_count ?? active) || active;
    const perParent = activeCount > 0 ? (subscriptionValue / activeCount).toFixed(2) : '0.00';
    const inactive = num(meta.inactive_parent_count ?? 0);
    lineRowsHtml =
      lineRowHtml({
        amount: subscriptionValue,
        detail: periodRange,
        title: 'باقة واتساب أولياء الأمور, شهري',
        subtitle: `${activeCount} ولي أمر × ${perParent} ج.م/ولي`,
      }) +
      lineRowHtml({
        amount: 0,
        detail: 'N/A',
        title: 'أولياء الأمور غير النشطين (مُعفى)',
        subtitle: `${inactive} أولياء`,
        amountMuted: true,
      });
    totalsInner = redesignedSubscriptionTotals(total, processingFeeAmt, totalLabel, storedVat);
  } else if (invoiceType === 'announcement_settlement') {
    // Decompose the blast charge only (total − flat processing fee).
    const p = calcExclusive(round2(total - processingFeeAmt));
    const blasts = r.settlementBlasts ?? [];
    const metaAnn = meta.announcements as { parent_count: number }[] | undefined;
    const totalParents =
      metaAnn?.length
        ? metaAnn.reduce((s, b) => s + num(b.parent_count), 0)
        : blasts.length > 0
          ? blasts.reduce((s, b) => s + b.parents_notified, 0)
          : num(meta.parent_count ?? 0);
    const exclusivePerParent = totalParents > 0 ? (p.base / totalParents).toFixed(2) : '0.00';
    if (blasts.length === 0) {
      const pc = num(meta.parent_count ?? 0);
      const amt = round2(pc * (totalParents > 0 ? p.base / totalParents : 0));
      lineRowsHtml = lineRowHtml({
        amount: amt,
        detail: `${fmtDateAr(inv.created_at)} · ${pc} parents`,
        title: `إعلان 1 - ${blastTypeAr('promo')}`,
        subtitle: `${pc} ولي أمر × ${exclusivePerParent} ج.م/ولي`,
      });
      totalsInner = `${totalsRow(`إعلان 1 - ${pc} × ${exclusivePerParent} ج.م`, `${fmtMoney(amt)} EGP`)}
      ${exclusiveTotalsStandard(p, totalLabel, taxNoteStandardAr(vatPct), processingFeeAmt, round2(total), storedVat, vatPct)}`;
    } else {
      lineRowsHtml = blasts
        .map((b, i) => {
          const pc = b.parents_notified;
          const amt = num(b.total_amount) || round2(pc * (totalParents > 0 ? p.base / totalParents : 0));
          return lineRowHtml({
            amount: amt,
            detail: `${fmtDateAr(b.created_at)} · ${pc} parents`,
            title: `إعلان ${i + 1} - ${blastTypeAr(b.blast_type)}`,
            subtitle: `${pc} ولي أمر × ${exclusivePerParent} ج.م/ولي`,
          });
        })
        .join('');
      totalsInner =
        blasts
          .map((b, i) => {
            const pc = b.parents_notified;
            const amt = num(b.total_amount) || round2(pc * (totalParents > 0 ? p.base / totalParents : 0));
            return totalsRow(`إعلان ${i + 1} - ${pc} × ${exclusivePerParent} ج.م`, `${fmtMoney(amt)} EGP`);
          })
          .join('') +
        exclusiveTotalsStandard(p, totalLabel, taxNoteStandardAr(vatPct), processingFeeAmt, round2(total), storedVat, vatPct);
    }
  } else if (invoiceType === 'announcement_cap') {
    // Decompose the blast charge only (total − flat processing fee).
    const p = calcExclusive(round2(total - processingFeeAmt));
    const cb = r.capBlast;
    const pc = cb?.parents_notified ?? 0;
    const exclusivePerParentCap = pc > 0 ? (p.base / pc).toFixed(2) : '0.00';
    const amt =
      pc > 0 ? round2(pc * parseFloat(exclusivePerParentCap)) : 0;
    const typeAr = cb ? blastTypeAr(cb.blast_type) : 'ترويج';
    const dt = cb ? fmtDateAr(cb.created_at) : periodStart;
    const tm = cb ? formatTime(cb.created_at, PDF_LOCALE) : '';
    const n = cb?.announcement_index ?? 1;
    const used = cb?.monthly_used ?? n;
    lineRowsHtml =
      lineRowHtml({
        amount: amt,
        detail: `${dt} · ${tm}`,
        title: `إعلان ${typeAr}`,
        subtitle: `${pc} ولي أمر × ${exclusivePerParentCap} ج.م/ولي`,
      }) +
      lineRowHtml({
        amount: 0,
        detail: `الحد: 2/شهر · المُستخدَم: ${used}`,
        title: 'ملاحظة تجاوز الحد الشهري',
        subtitle: `هذا هو إعلانك ${n} هذا الشهر`,
        amountMuted: true,
      });
    totalsInner = `${totalsRow(`${pc} ولي أمر × ${exclusivePerParentCap} ج.م`, `${fmtMoney(amt)} EGP`)}
    ${totalsRow('رسوم تجاوز الحد', `0 ج.م`)}
    ${exclusiveTotalsStandard(p, totalLabel, taxNoteStandardAr(vatPct), processingFeeAmt, round2(total), storedVat, vatPct)}`;
  } else if (invoiceType === 'plan_upgrade_difference') {
    const u = r.upgrade;
    const days = u?.daysRemaining ?? 0;
    const newAmt = u?.newPlanAmount ?? total + (u?.oldPlanCredit ?? 0);
    const credit = u?.oldPlanCredit ?? 0;
    const newCap = u?.newCap ?? studentCap;
    lineRowsHtml =
      lineRowHtml({
        amount: newAmt,
        detail: `${days} days remaining`,
        title: `${u?.toPlanAr ?? planAr} - محسوبة (${days} يوم)`,
        subtitle: `حتى ${newCap} طالب`,
      }) +
      lineRowHtml({
        amount: -credit,
        detail: 'رصيد مُعاد',
        title: `خصم الخطة ${u?.fromPlanAr ?? ','} (${days} يوم)`,
        subtitle: 'الأيام المتبقية من الفترة الحالية',
        amountRed: true,
      });
    // Processing-fee layout (Section 5): the charge, an optional flat fee, then the
    // total. No 6% service line, no 0.5% stamp line — VAT is shown as included.
    totalsInner = redesignedSubscriptionTotals(total, processingFeeAmt, totalLabel, storedVat);
  } else if (invoiceType === 'setup_fee') {
    showTaxBox = false;
    const productName = String(meta.product_name_ar ?? 'ماسح البطاقات الذكية');
    const city = String(meta.city ?? c.city ?? ',');
    const qty = num(meta.qty ?? 1) || 1;
    const unitPrice =
      meta.scanner_unit_price != null && num(meta.scanner_unit_price) > 0
        ? num(meta.scanner_unit_price)
        : Math.max(0, base - 50);
    const feeAmt = processingFeeAmt;
    let shippingFee = num(meta.shipping_fee ?? 0);
    if (!shippingFee) {
      shippingFee = Math.max(0, total - unitPrice * qty - feeAmt);
    }
    const prodTotal = round2(unitPrice * qty);
    // Product portion only (VAT applies to the cards, not the flat fee or shipping).
    const productInclusive = round2(total - feeAmt - shippingFee);
    const p = calcExclusive(productInclusive);
    // Prefer the stored (product-only) VAT so an old card invoice reprints at its rate.
    const vatShownSetup = storedVat != null ? storedVat : p.vat;
    const productSub = round2(p.base + vatShownSetup);
    const feeRow = feeAmt > 0 ? totalsRow('رسوم المعالجة (ⓘ)', `${fmtMoney(feeAmt)} EGP`) : '';
    const feeNote = feeAmt > 0 ? processingFeeNoteRow(feeAmt) : '';
    lineRowsHtml =
      lineRowHtml({
        amount: prodTotal,
        detail: `وحدة × ${fmtMoney(unitPrice)} ج.م | ${qty}`,
        title: productName,
        subtitle: 'مُعدَّ مسبقاً وجاهز للاستخدام',
      }) +
      lineRowHtml({
        amount: shippingFee,
        detail: 'Express · 1-2 days',
        title: 'رسوم توصيل Bosta',
        subtitle: `توصيل سريع - ${city}`,
      });
    totalsInner = `${totalsRow('قيمة المنتج الأساسية', `${fmtMoney(p.base)} EGP`)}
    ${dividerDashed()}
    ${totalsRow(`ضريبة القيمة المضافة (${vatPct}%)`, `${fmtMoney(vatShownSetup)} EGP`)}
    ${dividerLight()}
    ${totalsRow('مجموع المنتج', `${fmtMoney(productSub)} EGP`)}
    ${feeRow}
    ${totalsRow('رسوم شحن بوسطة', `${fmtMoney(shippingFee)} EGP`)}
    ${dividerSolid()}
    ${totalsRowBold('إجمالي المدفوع', `${fmtMoney(round2(total))} EGP`)}
    ${taxNoteRow(`ضريبة القيمة المضافة ${vatPct}٪ (مشمولة) - على المنتج فقط. رسوم المعالجة والشحن منفصلة.`)}
    ${feeNote}`;
  } else if (invoiceType === 'referral_payout') {
    showTaxBox = false;
    const metaComm = meta.commissions as { amount: number }[] | undefined;
    const wfee = num(meta.withdrawal_fee ?? r.referralWithdrawalFee);
    const grossFromMeta = metaComm?.reduce((s, c) => s + num(c.amount), 0) ?? 0;
    const gross = grossFromMeta > 0 ? grossFromMeta : r.referralGross ?? total + wfee;
    const fee = wfee;
    const comm = r.referralCommissions ?? [];
    if (comm.length === 0) {
      lineRowsHtml = lineRowHtml({
        amount: gross,
        detail: periodArabic,
        title: 'عمولة إحالة',
        subtitle: 'ملخص',
      });
    } else {
      lineRowsHtml = comm
        .map((x) =>
          lineRowHtml({
            amount: x.commissionAmount,
            detail: `${x.monthLabel} · الشهر ${x.monthIndex}`,
            title: `عمولة إحالة - الشهر ${x.monthIndex} (${formatPercent(Number(x.commissionPercent) || 0, PDF_LOCALE)})`,
            subtitle: x.referredCenterName,
          }),
        )
        .join('');
    }
    lineRowsHtml += lineRowHtml({
      amount: -fee,
      detail: 'N/A',
      title: 'رسوم السحب',
      subtitle: 'خصم من الإجمالي',
      amountRed: fee > 0,
      amountMuted: fee <= 0,
    });
    totalsInner = `${totalsRow('إجمالي العمولات', `${fmtMoney(gross)} EGP`)}
    ${totalsRow(
      'رسوم السحب (5%)',
      `<span style="color:#ef4444;font-weight:700;">-${fmtMoney(fee)} EGP</span>`,
    )}
    ${dividerSolid()}
    ${totalsRowBold('صافي المدفوع', `${fmtMoney(total)} EGP`)}
    ${taxNoteRow('لا ضريبة قيمة مضافة - هذا دفع عمولات من TutoringHQ.')}`;
  } else if (invoiceType === 'payment_proof') {
    showTaxBox = false;
    const refInv = String(meta.reference_invoice_number ?? payRef ?? ',');
    lineRowsHtml = lineRowHtml({
      amount: total,
      detail: 'تجديد',
      title: `${planAr}, تجديد ${billingCycle}`,
      subtitle: `مرجع: ${refInv}`,
    });
    totalsInner = `${totalsRowBold('المبلغ المُقدَّم', `${fmtMoney(total)} EGP`)}
    ${taxNoteRow('المبالغ تعكس اجمالي الفاتورة المرجعية.')}`;
  } else if (invoiceType === 'whatsapp_addon') {
    const desc = String(meta.description ?? inv.notes ?? ',');
    lineRowsHtml = lineRowHtml({
      amount: subscriptionValue,
      detail: periodRange,
      title: 'إضافة واتساب',
      subtitle: desc,
    });
    totalsInner = `${discountRowHtml}
    ${redesignedSubscriptionTotals(total, processingFeeAmt, totalLabel, storedVat)}`;
  } else {
    const p = calcExclusive(round2(total - processingFeeAmt));
    lineRowsHtml = lineRowHtml({
      amount: round2(total - processingFeeAmt),
      detail: periodRange,
      title: 'بند فاتورة',
      subtitle: invoiceType,
    });
    totalsInner = exclusiveTotalsStandard(
      p,
      'الإجمالي',
      taxNoteStandardAr(vatPct),
      processingFeeAmt,
      round2(total),
      storedVat,
      vatPct,
    );
  }

  if (txnId && !['payment_proof', 'referral_payout', 'setup_fee'].includes(invoiceType)) {
    txnLine = `<div style="border-left:3px solid #0D9488;padding-left:8px;color:#64748b;font-size:11px;margin-top:8px;">TXN · ${esc(txnId)}</div>`;
  }

  const taxBoxTxnCol = txnLine && showTaxBox ? `<div style="min-width:120px;">${txnLine}</div>` : '';

  const taxBoxFinal =
    showTaxBox && invoiceType !== 'referral_payout' && invoiceType !== 'payment_proof'
      ? taxDisclosureBox(taxBoxTxnCol)
      : '';

  const totalsSection = `<div class="totals" style="margin-top:16px;border-top:1px solid #1e293b;padding-top:12px;">
  ${totalsInner}
  ${txnLine && !showTaxBox ? txnLine : ''}
</div>`;

  const referralHtml =
    invoiceType !== 'referral_payout'
      ? referralSectionHtml(String(c.referral_code ?? 'CODE'), data.referralQrDataUrl ?? null)
      : '';

  const sidebar = `<div class="sidebar" style="width:260px;flex-shrink:0;background:#08101e;padding:24px;display:flex;flex-direction:column;min-height:297mm;box-sizing:border-box;">
  <div class="wordmark">
    <span style="color:#f8fafc;font-family:'Bodoni Moda',serif;font-size:22px;font-weight:700;">Tutoring</span><span style="color:#0D9488;font-family:'Bodoni Moda',serif;font-size:22px;font-weight:700;">HQ</span>
  </div>
  <div class="wordmark-sub" style="color:#64748b;font-size:11px;margin-top:2px;">إدارة ذكية للسناتر التعليمية</div>
  <div style="border-top:1px solid #1e293b;margin:16px 0;"></div>
  <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">نوع المستند</div>
  <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(typeLabelAr)}</div>
  <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">رقم المستند</div>
  <div class="meta-value" style="color:#0D9488;font-size:13px;font-weight:600;">${esc(invNo)}</div>
  <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">تاريخ الإصدار</div>
  <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">${esc(issueDate)}</div>
  ${statusBadgeHtml(badgeKey, overdueExtra)}
  ${typeSpecificSidebar}
  <div style="border-top:1px solid #1e293b;margin:16px 0;"></div>
  <div class="meta-label" style="color:#64748b;font-size:11px;margin-top:10px;">من</div>
  <div class="meta-value" style="color:#f8fafc;font-size:13px;font-weight:600;">TutoringHQ</div>
  <div class="meta-value" style="color:#64748b;font-size:11px;">منتج EHG Intelligence</div>
  ${paymentMethodBlock}
  ${stamp}
  <div style="margin-top:auto;padding-top:16px;border-top:1px solid #1e293b;">
    <div style="color:#64748b;font-size:11px;">+20 122 060 1410</div>
    <div style="color:#64748b;font-size:11px;">tutoringhq.app</div>
  </div>
</div>`;

  const main = `<div class="main" style="flex:1;background:#0d1b2e;padding:32px;box-sizing:border-box;min-width:0;">
  ${contextBanner}
  ${headerRecipientTotal({
    recipientLabel,
    centerName: c.name,
    centerPhone: c.phone ?? ',',
    centerAddress,
    totalLabel,
    totalFormatted: fmtMoney(total),
  })}
  <div style="border-top:2px solid #0D9488;margin:16px 0;"></div>
  ${lineItemsTable(lineRowsHtml)}
  ${totalsSection}
  ${taxBoxFinal}
  <div class="footer" style="border-top:1px solid #1e293b;padding-top:12px;margin-top:16px;display:flex;justify-content:space-between;color:#64748b;font-size:11px;flex-wrap:wrap;gap:8px;">
    <span>TutoringHQ · tutoringhq.app · An EHG Intelligence Product</span>
    <span>${esc(pageLabel)}</span>
  </div>
  ${referralHtml}
</div>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Playfair+Display:wght@400;700&family=Bodoni+Moda:wght@400;700&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body { margin:0; font-family: Cairo, sans-serif; direction: rtl; font-size: 13px; background: #0d1b2e; color: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { display: flex; width: 210mm; min-height: 297mm; margin: 0 auto; }
</style>
</head>
<body>
<div class="page">
${sidebar}
${main}
</div>
</body>
</html>`;
}
