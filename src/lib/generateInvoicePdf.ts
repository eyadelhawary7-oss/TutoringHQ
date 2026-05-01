import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/formatNumber';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  buildInvoiceHtml,
  INVOICE_PREFIX,
  type InvoiceRenderPayload,
  type InvoiceTemplateData,
} from '@/lib/invoiceTemplates';

const PDF_NUM_LOCALE = 'ar';

const CHROMIUM_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v123.0.0/chromium-v123.0.0-pack.tar';

const NAVY = '#0f172a';
const TEAL = '#0D9488';
const RED = '#ef4444';
const AMBER = '#d97706';
const WHITE = '#ffffff';
const GRAY_BG = '#f8fafc';
const BORDER = '#ebebeb';
const MUTED = '#94a3b8';

const DOC_TOTAL = 13;
const GREEN = '#16a34a';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtEgp(n: number): string {
  return formatNumber(n, PDF_NUM_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ج.م';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDate(d, PDF_NUM_LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDateTime(d, PDF_NUM_LOCALE, {
    day: '2-digit',
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
  return period?.trim() ? esc(period) : '—';
}

function paymentMethodAr(raw: string | null | undefined): string {
  if (!raw?.trim()) return 'Paymob';
  const x = raw.trim().toLowerCase();
  if (x === 'paymob' || x.includes('paymob')) return 'Paymob';
  if (x === 'instapay' || x.includes('instapay')) return 'Instapay';
  return esc(raw.trim());
}

function overdueDaysFromDue(dueYmd: string | null | undefined): number {
  if (!dueYmd) return 0;
  const due = new Date(`${dueYmd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return Math.max(0, diff);
}

function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
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
    payg: { en: 'Pay as you go', ar: 'دفع حسب الاستخدام' },
    top_centers: { en: 'Top Centers', ar: 'مراكز مميزة' },
  };
  const hit = table[k];
  if (hit) return hit;
  const label = (planRaw ?? 'starter').replace(/_/g, ' ');
  const title = label.replace(/\b\w/g, (c) => c.toUpperCase());
  return { en: title, ar: '—' };
}

type LineRow = {
  titleAr: string;
  subAr?: string;
  mid: string;
  amount: number;
  amountMuted?: boolean;
  amountRed?: boolean;
  amountGreen?: boolean;
  titleBoldRed?: boolean;
};

type BreakRow = { labelAr: string; value: string; red?: boolean; teal?: boolean; amber?: boolean; green?: boolean };

type SidebarRow = { label: string; value: string };

function sidebarDivider(): string {
  return `<div style="height:1px;background:rgba(255,255,255,0.15);margin:14px 0;"></div>`;
}

function sidebarMetaBlock(rows: SidebarRow[]): string {
  return rows
    .map(
      (r) => `
    <div style="margin-bottom:12px;">
      <div style="font-size:10px;color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;font-family:Cairo,sans-serif;">${esc(r.label)}</div>
      <div style="font-size:13px;font-weight:700;color:${WHITE};font-family:Cairo,sans-serif;margin-top:4px;">${r.value}</div>
    </div>`,
    )
    .join('');
}

function renderLineTable(rows: LineRow[]): string {
  const head = `
  <thead>
    <tr style="background:${GRAY_BG};">
      <th style="padding:10px 12px;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-family:Cairo,sans-serif;border-bottom:1px solid ${BORDER};">البيان</th>
      <th style="padding:10px 12px;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-family:Cairo,sans-serif;text-align:center;border-bottom:1px solid ${BORDER};">التفاصيل</th>
      <th style="padding:10px 12px;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-family:Cairo,sans-serif;text-align:left;border-bottom:1px solid ${BORDER};">المبلغ</th>
    </tr>
  </thead>`;
  const body = rows
    .map((r) => {
      const amtColor = r.amountMuted ? MUTED : r.amountRed ? RED : r.amountGreen ? GREEN : '#0f172a';
      const titleColor = r.titleBoldRed ? RED : '#0f172a';
      const titleWeight = r.titleBoldRed ? 800 : 700;
      const sub = r.subAr
        ? `<div style="font-size:11px;color:${TEAL};margin-top:4px;font-family:Cairo,sans-serif;">${esc(r.subAr)}</div>`
        : '';
      return `<tr>
      <td style="padding:12px;vertical-align:top;border-bottom:1px solid ${BORDER};font-family:Cairo,sans-serif;">
        <div style="font-weight:${titleWeight};color:${titleColor};">${esc(r.titleAr)}</div>
        ${sub}
      </td>
      <td style="padding:12px;vertical-align:top;border-bottom:1px solid ${BORDER};text-align:center;font-size:12px;color:${TEAL};font-family:Cairo,sans-serif;">${esc(r.mid)}</td>
      <td style="padding:12px;vertical-align:top;border-bottom:1px solid ${BORDER};text-align:left;font-family:system-ui,sans-serif;font-variant-numeric:tabular-nums;font-weight:600;color:${amtColor};">${r.amountMuted ? `<span style="color:${MUTED};">${esc(fmtEgp(r.amount))}</span>` : esc(fmtEgp(r.amount))}</td>
    </tr>`;
    })
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;" dir="rtl">${head}<tbody>${body}</tbody></table>`;
}

function renderBreakdownTwoCol(leftRows: BreakRow[], rightRows: BreakRow[]): string {
  const col = (rows: BreakRow[], title: string) => `
  <div style="flex:1;min-width:0;">
    <div style="font-size:10px;color:#64748b;margin-bottom:10px;font-family:Cairo,sans-serif;">${esc(title)}</div>
    ${rows
      .map((r) => {
        const c = r.red ? RED : r.teal ? TEAL : r.amber ? AMBER : r.green ? GREEN : '#475569';
        const font = r.teal ? "'Bodoni Moda',serif" : 'system-ui,sans-serif';
        const fw = r.teal ? 700 : 500;
        return `<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:12px;font-family:Cairo,sans-serif;color:#475569;">
        <span>${esc(r.labelAr)}</span>
        <span style="color:${c};font-weight:${fw};font-family:${r.teal ? font : 'system-ui,sans-serif'};font-variant-numeric:tabular-nums;">${esc(r.value)}</span>
      </div>`;
      })
      .join('')}
  </div>`;
  return `<div style="display:flex;gap:24px;margin-top:20px;flex-wrap:wrap;" dir="rtl">
  ${col(leftRows, 'تفاصيل الدفع')}
  ${col(rightRows, 'الإجماليات')}
</div>`;
}

function taxBoxHtml(): string {
  return `<div style="margin-top:18px;padding:12px 14px;border:1px solid ${BORDER};border-radius:8px;background:${GRAY_BG};font-size:11px;line-height:1.6;color:#475569;font-family:Cairo,sans-serif;" dir="rtl">
  جميع المبالغ شاملة للضرائب والرسوم: ضريبة القيمة المضافة 14% · رسوم الخدمة 6% · رسوم الدمغة 0.4%
</div>`;
}

function referralStripHtml(qrDataUrl: string, codeSpaced: string, referUrl: string): string {
  return `<div style="margin-top:28px;padding-top:20px;border-top:1px solid ${BORDER};page-break-inside:avoid;" dir="rtl">
  <div style="font-size:15px;font-weight:700;color:#0f172a;font-family:Cairo,sans-serif;margin-bottom:8px;">تعرف على سنتر تاني؟ اكسب كل شهر.</div>
  <div style="font-size:12px;color:#64748b;margin-bottom:14px;font-family:Cairo,sans-serif;">شهر 1: 25% | شهر 2-12: 10% | +13: 5% دائمة</div>
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:20px;">
    <div style="font-family:system-ui,monospace;font-size:18px;letter-spacing:0.35em;font-weight:700;color:${TEAL};border:2px dashed ${TEAL};padding:10px 16px;border-radius:8px;">${esc(codeSpaced)}</div>
    <div style="flex:1;min-width:200px;">
      <div style="font-size:11px;color:#64748b;font-family:system-ui,sans-serif;">${esc(referUrl)}</div>
    </div>
    <div><img src="${qrDataUrl}" width="96" height="96" alt="" style="display:block;border-radius:6px;" /></div>
  </div>
</div>`;
}

async function htmlToPdfBuffer(
  html: string,
  opts?: { waitUntil?: 'load' | 'networkidle0' },
): Promise<Buffer | null> {
  let browser: Browser | null = null;
  try {
    const executablePath = await chromium.executablePath(CHROMIUM_URL);
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
    });
    const page = await browser.newPage();
    const waitUntil = opts?.waitUntil ?? 'load';
    await page.setContent(html, { waitUntil, timeout: waitUntil === 'networkidle0' ? 60000 : 30000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } catch (err) {
    console.error('[generateInvoicePdf] puppeteer:', err);
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[generateInvoicePdf] close:', e);
      }
    }
  }
}

function wrapDocument(inner: string, footerLeft: string, footerRight: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,600;0,6..96,700;1,6..96,400;1,6..96,600&family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body style="background:${WHITE};color:#0f172a;">
<div style="display:flex;min-height:297mm;width:210mm;margin:0 auto;font-size:13px;">
${inner}
</div>
<div style="width:210mm;margin:0 auto;padding:8mm 12mm 10mm;font-size:10px;color:#64748b;display:flex;justify-content:space-between;align-items:center;font-family:system-ui,sans-serif;border-top:1px solid ${BORDER};">
  <span style="font-family:Cairo,sans-serif;">${esc(footerLeft)}</span>
  <span style="font-family:system-ui,sans-serif;font-weight:600;">${esc(footerRight)}</span>
</div>
</body>
</html>`;
}

function buildSidebar(params: {
  docTypeAr: string;
  invoiceNumber: string;
  issueDate: string;
  statusHtml: string;
  metaRows: SidebarRow[];
  paymentMethodLine: string;
  paymentTs: string;
}): string {
  const wordmark = `<div style="font-family:'Bodoni Moda',serif;font-size:22px;font-weight:600;color:${WHITE};line-height:1.2;">CENTER<span style="color:${TEAL};font-style:italic;">HQ</span></div>
  <div style="font-size:11px;color:${MUTED};margin-top:6px;font-family:Cairo,sans-serif;">إدارة ذكية للسناتر التعليمية</div>`;

  return `<aside style="width:56mm;min-width:56mm;background:${NAVY};color:${WHITE};padding:16mm 14px 14px;display:flex;flex-direction:column;">
  ${wordmark}
  ${sidebarDivider()}
  <div style="font-size:10px;color:${MUTED};text-transform:uppercase;font-family:Cairo,sans-serif;">نوع المستند</div>
  <div style="font-size:14px;font-weight:800;color:${WHITE};margin-top:4px;font-family:Cairo,sans-serif;">${esc(params.docTypeAr)}</div>
  <div style="margin-top:14px;">
    <div style="font-size:10px;color:${MUTED};font-family:Cairo,sans-serif;">رقم المستند</div>
    <div style="font-size:13px;font-weight:700;font-family:system-ui,sans-serif;margin-top:4px;">${esc(params.invoiceNumber)}</div>
  </div>
  <div style="margin-top:12px;">
    <div style="font-size:10px;color:${MUTED};font-family:Cairo,sans-serif;">تاريخ الإصدار</div>
    <div style="font-size:13px;font-weight:700;font-family:system-ui,sans-serif;margin-top:4px;">${esc(params.issueDate)}</div>
  </div>
  <div style="margin-top:14px;">${params.statusHtml}</div>
  ${sidebarMetaBlock(params.metaRows)}
  ${sidebarDivider()}
  <div style="font-size:10px;color:${MUTED};font-family:Cairo,sans-serif;">من</div>
  <div style="font-size:14px;font-weight:700;color:${WHITE};margin-top:4px;font-family:system-ui,sans-serif;">CenterHQ</div>
  <div style="font-size:11px;color:${MUTED};margin-top:4px;font-family:Cairo,sans-serif;">منتج EHG Intelligence</div>
  <div style="margin-top:14px;">
    <div style="font-size:10px;color:${MUTED};font-family:Cairo,sans-serif;">طريقة الدفع</div>
    <div style="font-size:12px;font-weight:700;color:${WHITE};margin-top:4px;font-family:Cairo,sans-serif;">${esc(params.paymentMethodLine)}</div>
    <div style="font-size:10px;color:${MUTED};margin-top:4px;font-family:system-ui,sans-serif;">${esc(params.paymentTs)}</div>
  </div>
  <div style="margin-top:auto;padding-top:20px;font-size:11px;color:${MUTED};font-family:system-ui,sans-serif;line-height:1.5;">
    +20 122 060 1410<br/><span style="color:${TEAL};">centerhq.app</span>
  </div>
</aside>`;
}

function buildMainColumn(params: {
  topBanner?: { line: string; sub?: string; bannerLineColor?: string };
  headerLabel: string;
  centerName: string;
  centerPhone: string;
  centerCity: string;
  amountLabel: string;
  totalAmount: number;
  totalAmountColor?: string;
  lineRows: LineRow[];
  leftBreak: BreakRow[];
  rightBreak: BreakRow[];
  showTax: boolean;
  referralStrip?: string;
  extraTitleAr?: string;
}): string {
  const cityLine = params.centerCity.trim() ? `${esc(params.centerCity.trim())}` : '—';
  const bannerLineColor = params.topBanner?.bannerLineColor ?? TEAL;
  const banner = params.topBanner
    ? `<div style="text-align:left;margin-bottom:12px;">
    <div style="font-size:12px;color:${bannerLineColor};font-weight:700;font-family:Cairo,sans-serif;">${esc(params.topBanner.line)}</div>
    ${params.topBanner.sub ? `<div style="font-size:11px;color:#64748b;margin-top:4px;font-family:Cairo,sans-serif;max-width:520px;">${esc(params.topBanner.sub)}</div>` : ''}
  </div>`
    : '';

  const extraTitle = params.extraTitleAr
    ? `<div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:8px;font-family:Cairo,sans-serif;">${esc(params.extraTitleAr)}</div>`
    : '';

  return `<main style="flex:1;padding:12mm 14px 10mm;background:${WHITE};">
  ${banner}
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
    <div>
      <div style="font-size:10px;color:#64748b;font-family:Cairo,sans-serif;">${esc(params.headerLabel)}</div>
      <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:6px;font-family:Cairo,sans-serif;">${esc(params.centerName)}</div>
      <div style="font-size:12px;color:#475569;margin-top:6px;font-family:system-ui,sans-serif;">${esc(params.centerPhone || '—')}</div>
      <div style="font-size:12px;color:#475569;font-family:Cairo,sans-serif;">${cityLine}</div>
    </div>
    <div style="text-align:left;">
      <div style="font-size:10px;color:#64748b;font-family:Cairo,sans-serif;">${esc(params.amountLabel)}</div>
      <div style="font-size:36px;font-weight:700;color:${params.totalAmountColor ?? TEAL};font-family:'Bodoni Moda',serif;margin-top:4px;font-variant-numeric:tabular-nums;">${esc(fmtEgp(params.totalAmount))}</div>
    </div>
  </div>
  ${extraTitle}
  ${renderLineTable(params.lineRows)}
  ${renderBreakdownTwoCol(params.leftBreak, params.rightBreak)}
  ${params.showTax ? taxBoxHtml() : ''}
  ${params.referralStrip ?? ''}
</main>`;
}

// Invoice PDF (template engine)

type InvoiceRow = Record<string, unknown>;
type CenterRow = Record<string, unknown>;

function resolveInvoiceNumber(
  inv: InvoiceRow,
  center: CenterRow,
  invoiceType: string,
): string {
  const existing = inv.invoice_number != null ? String(inv.invoice_number).trim() : "";
  if (existing) return existing;
  const prefix = INVOICE_PREFIX[invoiceType] ?? "INV";
  const codeRaw = center.center_code != null ? String(center.center_code).trim() : "";
  const code = codeRaw || String(center.id ?? "XXXX").slice(0, 6).toUpperCase();
  const anchor = inv.created_at != null ? String(inv.created_at) : new Date().toISOString();
  const d = new Date(anchor);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  if (invoiceType === "referral_payout") {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `PAY-${code}-${y}-Q${q}`;
  }
  return `${prefix}-${code}-${y}-${m}`;
}

function monthArabicFromDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
}

export async function generateInvoicePdf(invoiceId: string): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(
      `
      id, center_id, invoice_number, invoice_type, total_amount, subtotal,
      tax_amount, discount_amount, billing_period_start,
      billing_period_end, due_date, status, notes, created_at, metadata,
      base_amount, payment_method, payment_reference, paymob_transaction_id,
      paid_at, payment_amount,
      centers (
        id, name, center_code, phone, plan, referral_code, city,
        subscription_billing_period, next_payment_due, pack_price_per_parent,
        announcement_balance, active_months_count, dormancy_date
      )
    `,
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr || !invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  const inv = invoice as InvoiceRow & { centers?: CenterRow | CenterRow[] };
  const centerJoined = inv.centers;
  const center = (Array.isArray(centerJoined) ? centerJoined[0] : centerJoined) as CenterRow | undefined;
  if (!center) {
    throw new Error(`Center not found for invoice: ${invoiceId}`);
  }

  const invoiceType = String(inv.invoice_type ?? "subscription").replace(/late_fee/g, "late_payment_fee");
  const centerId = String(inv.center_id ?? center.id ?? "");

  const planKey = String(center.plan ?? "starter");
  let planRow = (
    await supabase
      .from("pricing_plans")
      .select("arabic_name, english_name, name_ar, name_en, students_per_week_limit")
      .eq("id", planKey)
      .maybeSingle()
  ).data;
  if (!planRow) {
    const r2 = await supabase
      .from("pricing_plans")
      .select("arabic_name, english_name, name_ar, name_en, students_per_week_limit")
      .eq("plan_key", planKey)
      .maybeSingle();
    planRow = r2.data;
  }

  const pr = planRow as Record<string, unknown> | null;
  const planArabic =
    (pr?.arabic_name as string)?.trim() ||
    (pr?.name_ar as string)?.trim() ||
    planPresentation(planKey).ar;
  const planEnglish =
    (pr?.english_name as string)?.trim() ||
    (pr?.name_en as string)?.trim() ||
    planPresentation(planKey).en;
  const studentCap = Number(pr?.students_per_week_limit ?? 0) || 0;

  const render: InvoiceRenderPayload = {
    planArabic,
    planEnglish,
    studentCap,
    monthArabic: monthArabicFromDate(
      inv.billing_period_start != null ? String(inv.billing_period_start) : String(inv.created_at ?? ""),
    ),
    transactionId:
      (inv.payment_reference != null && String(inv.payment_reference).trim()) ||
      (inv.paymob_transaction_id != null && String(inv.paymob_transaction_id).trim()) ||
      null,
  };

  const invCreated = inv.created_at != null ? String(inv.created_at) : "";

  if (invoiceType === "announcement_settlement") {
    const day = invCreated.slice(0, 10);
    const { data: blasts } = await supabase
      .from("announcement_blasts")
      .select("blast_type, parents_notified, total_amount, created_at, charged_at")
      .eq("center_id", centerId)
      .eq("billing_status", "included_in_renewal")
      .order("charged_at", { ascending: false })
      .limit(40);
    const list = (blasts ?? []) as {
      blast_type?: string;
      parents_notified?: number;
      total_amount?: number | string;
      created_at?: string;
      charged_at?: string;
    }[];
    const matched = list.filter((b) => {
      const ca = b.charged_at?.slice(0, 10);
      return (
        ca === day ||
        (invCreated &&
          b.charged_at &&
          Math.abs(new Date(b.charged_at).getTime() - new Date(invCreated).getTime()) < 36e5)
      );
    });
    const useBlasts = matched.length > 0 ? matched : list.slice(0, 5);
    render.settlementBlasts = useBlasts.map((b) => ({
      blast_type: String(b.blast_type ?? ""),
      parents_notified: Number(b.parents_notified ?? 0),
      total_amount: Number(b.total_amount ?? 0),
      created_at: String(b.created_at ?? ""),
    }));
  }

  if (invoiceType === "announcement_cap") {
    const { data: blasts } = await supabase
      .from("announcement_blasts")
      .select("blast_type, parents_notified, total_amount, created_at")
      .eq("center_id", centerId)
      .order("created_at", { ascending: false })
      .limit(5);
    const last = (blasts ?? [])[0] as
      | { blast_type?: string; parents_notified?: number; total_amount?: number; created_at?: string }
      | undefined;
    if (last) {
      render.capBlast = {
        blast_type: String(last.blast_type ?? ""),
        parents_notified: Number(last.parents_notified ?? 0),
        created_at: String(last.created_at ?? ""),
        announcement_index: 1,
        monthly_cap: 2,
        monthly_used: 1,
      };
    }
    const totalAmt = Number(inv.total_amount ?? 0);
    const bal = Number(center.announcement_balance ?? 0);
    render.capBalanceBefore = bal + totalAmt;
    render.capBalanceAfter = bal;
  }

  if (invoiceType === "plan_upgrade_difference") {
    const { data: sessHit } = await supabase
      .from("combined_payment_sessions")
      .select("metadata")
      .eq("center_id", centerId)
      .contains("invoice_ids", [invoiceId])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let sess = sessHit;
    if (!sess) {
      const { data: sessions } = await supabase
        .from("combined_payment_sessions")
        .select("metadata, invoice_ids")
        .eq("center_id", centerId)
        .eq("session_type", "upgrade")
        .order("created_at", { ascending: false })
        .limit(25);
      const hit = (sessions ?? []).find((row: { invoice_ids?: string[] }) =>
        Array.isArray(row.invoice_ids) ? row.invoice_ids.includes(invoiceId) : false,
      );
      sess = hit ? { metadata: hit.metadata } : null;
    }
    const md = (sess?.metadata as Record<string, unknown> | undefined) ?? {};
    const newPlan = String(md.newPlan ?? planKey);
    const oldPlan = String(md.previousPlan ?? "—");
    const daysRem = Number(md.daysRemaining ?? 0);
    const charged = Number(md.amountCharged ?? inv.total_amount ?? 0);
    const capped = Number(md.cappedProratedCost ?? charged);
    const oldCredit = Math.max(0, capped - charged);
    const { data: newPlanRow } = await supabase
      .from("pricing_plans")
      .select("students_per_week_limit")
      .eq("id", newPlan)
      .maybeSingle();
    const newCapVal = Number(newPlanRow?.students_per_week_limit ?? 0) || studentCap;
    render.upgrade = {
      fromPlanAr: planPresentation(oldPlan).ar,
      toPlanAr: planPresentation(newPlan).ar,
      fromPlanEn: planPresentation(oldPlan).en,
      toPlanEn: planPresentation(newPlan).en,
      daysRemaining: daysRem,
      newPlanAmount: capped,
      oldPlanCredit: oldCredit,
      newCap: newCapVal,
    };
  }

  if (invoiceType === "referral_payout") {
    const meta = (inv.metadata ?? {}) as Record<string, unknown>;
    const details = meta as {
      commission_ids?: string[];
      withdrawal_fee?: number;
      gross_amount?: number;
      instapay_number?: string;
    };
    const fee = Number(details.withdrawal_fee ?? 0);
    const gross = Number(details.gross_amount ?? Number(inv.total_amount ?? 0) + fee);
    let commissions: {
      id: string;
      period_month: string;
      commission_rate: number;
      commission_amount: number;
      referral_id: string | null;
    }[] = [];
    const ids = details.commission_ids;
    if (ids?.length) {
      const { data: rows } = await supabase
        .from("referral_commissions")
        .select("id, period_month, commission_rate, commission_amount, referral_id")
        .in("id", ids);
      commissions = (rows ?? []) as typeof commissions;
    }
    const refIds = [...new Set(commissions.map((x) => x.referral_id).filter(Boolean))] as string[];
    const referralById = new Map<string, { referred_center_id: string | null; referred_first_paid_at: string | null }>();
    if (refIds.length) {
      const { data: refs } = await supabase
        .from("referrals")
        .select("id, referred_center_id, referred_first_paid_at")
        .in("id", refIds);
      for (const r of refs ?? []) {
        const row = r as { id: string; referred_center_id: string | null; referred_first_paid_at: string | null };
        referralById.set(row.id, {
          referred_center_id: row.referred_center_id,
          referred_first_paid_at: row.referred_first_paid_at,
        });
      }
    }
    const centerIds = [
      ...new Set(commissions.map((x) => referralById.get(x.referral_id ?? "")?.referred_center_id).filter(Boolean)),
    ] as string[];
    const names = new Map<string, string>();
    if (centerIds.length) {
      const { data: cen } = await supabase.from("centers").select("id, name").in("id", centerIds);
      for (const row of cen ?? []) {
        names.set(String((row as { id: string }).id), String((row as { name?: string }).name ?? "—"));
      }
    }
    function monthLabelComm(r: (typeof commissions)[0]): string {
      const ref = r.referral_id ? referralById.get(r.referral_id) : undefined;
      const fp = ref?.referred_first_paid_at;
      if (!fp || !r.period_month) return r.period_month;
      const [y, m] = r.period_month.split("-").map(Number);
      const pm = new Date(y, m - 1, 1);
      const fpd = new Date(fp);
      const n = (pm.getFullYear() - fpd.getFullYear()) * 12 + (pm.getMonth() - fpd.getMonth()) + 1;
      return n > 0 ? `شهر ${n}` : r.period_month;
    }
    render.referralGross = gross;
    render.referralWithdrawalFee = fee;
    render.referralInstapay = String(details.instapay_number ?? "—");
    render.referralCount = commissions.filter((x) => x.id !== "agg").length || commissions.length;
    render.referralCommissions = commissions.map((r) => {
      const ref = r.referral_id ? referralById.get(r.referral_id) : undefined;
      const cid = ref?.referred_center_id;
      const cname = cid ? names.get(cid) ?? "—" : "—";
      const pctFloat = Number(r.commission_rate ?? 0);
      const pct = pctFloat <= 1 ? Math.round(pctFloat * 100) : Math.round(pctFloat);
      const pmStr =
        r.period_month?.includes("-") ? r.period_month : `${new Date().getFullYear()}-01`;
      const [y, mo] = pmStr.split("-").map(Number);
      const pm = new Date(y, mo - 1, 1);
      const fp = ref?.referred_first_paid_at ? new Date(ref.referred_first_paid_at) : pm;
      const monthIndex =
        ref?.referred_first_paid_at && !Number.isNaN(pm.getTime()) && !Number.isNaN(fp.getTime())
          ? (pm.getFullYear() - fp.getFullYear()) * 12 + (pm.getMonth() - fp.getMonth()) + 1
          : 1;
      return {
        monthIndex: monthIndex > 0 ? monthIndex : 1,
        commissionPercent: pct,
        referredCenterName: cname,
        monthLabel: monthLabelComm(r),
        commissionAmount: Number(r.commission_amount ?? 0),
      };
    });
  }

  const invNoResolved = resolveInvoiceNumber(inv, center, invoiceType);

  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "https://centerhq.app").replace(/\/$/, "");
  const refCode = String(center.referral_code ?? "CODE").replace(/\s+/g, "") || "CODE";
  const referUrl = `${appBase}/refer/${encodeURIComponent(refCode)}`;
  let referralQrDataUrl: string | null = null;
  if (invoiceType !== "referral_payout") {
    try {
      const QRCode = (await import("qrcode")).default;
      referralQrDataUrl = await QRCode.toDataURL(referUrl, {
        width: 60,
        margin: 1,
        color: { dark: "#0D9488", light: "#08101e" },
      });
    } catch (e) {
      console.error("[generateInvoicePdf] QR:", e);
    }
  }

  const templatePayload: InvoiceTemplateData = {
    invoice: {
      id: String(inv.id),
      invoice_number: invNoResolved,
      invoice_type: invoiceType,
      total_amount: Number(inv.total_amount ?? 0),
      subtotal: inv.subtotal != null ? Number(inv.subtotal) : null,
      tax_amount: inv.tax_amount != null ? Number(inv.tax_amount) : null,
      discount_amount: inv.discount_amount != null ? Number(inv.discount_amount) : null,
      billing_period_start: String(inv.billing_period_start ?? ""),
      billing_period_end: String(inv.billing_period_end ?? ""),
      due_date: String(inv.due_date ?? ""),
      status: String(inv.status ?? "pending"),
      notes: inv.notes != null ? String(inv.notes) : null,
      created_at: String(inv.created_at ?? ""),
      metadata: (inv.metadata as Record<string, unknown> | null) ?? null,
      center_id: centerId,
      payment_method: inv.payment_method != null ? String(inv.payment_method) : null,
      payment_reference: inv.payment_reference != null ? String(inv.payment_reference) : null,
      paymob_transaction_id: inv.paymob_transaction_id != null ? String(inv.paymob_transaction_id) : null,
      paid_at: inv.paid_at != null ? String(inv.paid_at) : null,
      base_amount: inv.base_amount != null ? Number(inv.base_amount) : null,
      payment_amount: inv.payment_amount != null ? Number(inv.payment_amount) : null,
    },
    center: {
      id: String(center.id),
      name: String(center.name ?? "—"),
      center_code: String(center.center_code ?? center.id ?? "").slice(0, 12),
      phone: center.phone != null ? String(center.phone) : null,
      plan: center.plan != null ? String(center.plan) : null,
      referral_code: center.referral_code != null ? String(center.referral_code) : null,
      city: center.city != null ? String(center.city) : null,
      subscription_billing_period:
        center.subscription_billing_period != null ? String(center.subscription_billing_period) : null,
      next_payment_due: center.next_payment_due != null ? String(center.next_payment_due) : null,
      pack_price_per_parent:
        center.pack_price_per_parent != null ? Number(center.pack_price_per_parent) : null,
      announcement_balance:
        center.announcement_balance != null ? Number(center.announcement_balance) : null,
    },
    referralQrDataUrl,
    render,
  };

  const html = buildInvoiceHtml(templatePayload);
  const pdf = await htmlToPdfBuffer(html, { waitUntil: "networkidle0" });
  if (!pdf) {
    throw new Error("PDF generation failed");
  }
  return pdf;
}

export type PayoutReceiptDetails = {
  instapay_number?: string;
  withdrawal_fee?: number;
  commission_ids?: string[];
  gross_amount?: number;
};

export async function generatePayoutReceiptPdf(payoutId: string, supabase: SupabaseClient): Promise<Buffer | null> {
  const { data: payout, error: pErr } = await supabase.from('payout_requests').select('*').eq('id', payoutId).maybeSingle();

  if (pErr || !payout) {
    console.error('[generatePayoutReceiptPdf] load:', pErr);
    return null;
  }

  const p = payout as Record<string, unknown>;
  const centerId = String(p.center_id ?? '');
  const amountReq = Number(p.amount_requested ?? 0);
  const st = String(p.status ?? '');
  const details = (p.payment_details as PayoutReceiptDetails | null) ?? {};
  const fee = Number(details.withdrawal_fee ?? 0);
  const gross = Number(details.gross_amount ?? amountReq + fee);
  const instapay = String(details.instapay_number ?? '—');

  const { data: center, error: cErr } = await supabase
    .from('centers')
    .select('name, phone, city, referral_code')
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) return null;
  const c = center as CenterRow;

  let commissions: {
    id: string;
    period_month: string;
    commission_rate: number;
    commission_amount: number;
    referral_id: string | null;
  }[] = [];

  const ids = details.commission_ids;
  if (ids?.length) {
    const { data: rows } = await supabase
      .from('referral_commissions')
      .select('id, period_month, commission_rate, commission_amount, referral_id')
      .in('id', ids);
    commissions = (rows ?? []) as typeof commissions;
  } else if (st === 'paid' && p.processed_at) {
    const day = String(p.processed_at).slice(0, 10);
    const start = `${day}T00:00:00.000Z`;
    const end = `${day}T23:59:59.999Z`;
    const { data: rows } = await supabase
      .from('referral_commissions')
      .select('id, period_month, commission_rate, commission_amount, referral_id')
      .eq('referrer_center_id', centerId)
      .eq('status', 'paid')
      .gte('paid_at', start)
      .lte('paid_at', end);
    commissions = (rows ?? []) as typeof commissions;
  }

  if (commissions.length === 0) {
    commissions = [
      {
        id: 'agg',
        period_month: String(p.requested_at ?? '').slice(0, 7),
        commission_rate: 0,
        commission_amount: gross,
        referral_id: null,
      },
    ];
  }

  const refIds = [...new Set(commissions.map((x) => x.referral_id).filter(Boolean))] as string[];
  const referralById = new Map<string, { referred_center_id: string | null; referred_first_paid_at: string | null }>();
  if (refIds.length) {
    const { data: refs } = await supabase
      .from('referrals')
      .select('id, referred_center_id, referred_first_paid_at')
      .in('id', refIds);
    for (const r of refs ?? []) {
      const row = r as { id: string; referred_center_id: string | null; referred_first_paid_at: string | null };
      referralById.set(row.id, {
        referred_center_id: row.referred_center_id,
        referred_first_paid_at: row.referred_first_paid_at,
      });
    }
  }

  const centerIds = [...new Set(commissions.map((x) => referralById.get(x.referral_id ?? '')?.referred_center_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (centerIds.length) {
    const { data: cen } = await supabase.from('centers').select('id, name').in('id', centerIds);
    for (const row of cen ?? []) names.set(String((row as { id: string }).id), String((row as { name?: string }).name ?? '—'));
  }

  function monthLabel(r: (typeof commissions)[0]): string {
    const ref = r.referral_id ? referralById.get(r.referral_id) : undefined;
    const fp = ref?.referred_first_paid_at;
    if (!fp || !r.period_month) return r.period_month;
    const [y, m] = r.period_month.split('-').map(Number);
    const pm = new Date(y, m - 1, 1);
    const fpd = new Date(fp);
    const n = (pm.getFullYear() - fpd.getFullYear()) * 12 + (pm.getMonth() - fpd.getMonth()) + 1;
    return n > 0 ? `شهر ${n}` : r.period_month;
  }

  let lineRows: LineRow[];
  if (commissions.length === 1 && commissions[0].id === 'agg') {
    lineRows = [
      {
        titleAr: 'إجمالي عمولات الإحالة',
        subAr: 'ملخص السحب',
        mid: commissions[0].period_month || '—',
        amount: gross,
      },
    ];
  } else {
    lineRows = commissions.map((r) => {
      const ref = r.referral_id ? referralById.get(r.referral_id) : undefined;
      const cid = ref?.referred_center_id;
      const cname = cid ? names.get(cid) ?? '—' : '—';
      const pct = Math.round(Number(r.commission_rate ?? 0) * 100);
      return {
        titleAr: `عمولة ${formatPercent(pct, PDF_NUM_LOCALE)} — ${cname}`,
        subAr: 'عمولة إحالة',
        mid: monthLabel(r),
        amount: Number(r.commission_amount ?? 0),
      };
    });
  }

  lineRows.push({
    titleAr: 'رسوم السحب',
    subAr: undefined,
    mid: 'N/A',
    amount: -fee,
    amountMuted: fee <= 0,
    amountRed: fee > 0,
  });

  const docNo = `PAY-${String(payoutId).slice(0, 8).toUpperCase()}`;
  const issuedAt = fmtDate(p.requested_at != null ? String(p.requested_at) : undefined);
  const paidTs = p.processed_at ? fmtDateTime(String(p.processed_at)) : '—';

  const statusHtml =
    st === 'paid'
      ? `<span style="display:inline-block;padding:6px 14px;border-radius:9999px;font-size:11px;font-weight:700;font-family:Cairo,sans-serif;background:${TEAL};color:${WHITE};">تم التحويل</span>`
      : `<span style="display:inline-block;padding:6px 14px;border-radius:9999px;font-size:11px;font-weight:700;font-family:Cairo,sans-serif;border:2px solid ${AMBER};color:${AMBER};">قيد المعالجة</span>`;

  const commissionCount = commissions.filter((x) => x.id !== 'agg').length || (commissions[0]?.id === 'agg' ? 0 : commissions.length);
  const periodStr = [...new Set(commissions.map((x) => x.period_month).filter(Boolean))].slice(0, 4).join('، ') || '—';

  const sidebar = buildSidebar({
    docTypeAr: 'إيصال صرف عمولات',
    invoiceNumber: docNo,
    issueDate: issuedAt,
    statusHtml,
    metaRows: [
      { label: 'عدد الإحالات', value: String(commissionCount || commissions.length) },
      { label: 'الفترة', value: esc(periodStr) },
      { label: 'رقم Instapay', value: esc(instapay) },
    ],
    paymentMethodLine:
      st === 'paid' ? 'تحويل Instapay — تمت الموافقة من المشرف' : 'تحويل Instapay — بانتظار الموافقة',
    paymentTs: paidTs,
  });

  const main = buildMainColumn({
    headerLabel: 'مُصروف إلى',
    centerName: String(c.name ?? '—'),
    centerPhone: String(c.phone ?? '—'),
    centerCity: String(c.city ?? ''),
    amountLabel: 'إجمالي المبلغ المُصروف',
    totalAmount: amountReq,
    lineRows,
    leftBreak: [
      { labelAr: 'إجمالي العمولات', value: fmtEgp(gross) },
      { labelAr: 'رسوم السحب', value: fmtEgp(-fee), red: fee > 0 },
    ],
    rightBreak: [{ labelAr: 'الصافي المدفوع', value: fmtEgp(amountReq), teal: true }],
    showTax: false,
  });

  const html = wrapDocument(
    `${sidebar}${main}`,
    'CenterHQ · centerhq.app · An EHG Intelligence Product',
    `13 OF ${DOC_TOTAL}: REFERRAL PAYOUT`,
  );
  return htmlToPdfBuffer(html);
}

/** PDF for internal `commission_payouts` (staff SR/SM) — not center `payout_requests`. */
export async function generateStaffCommissionPayoutPdf(
  payoutId: string,
  supabase: SupabaseClient,
): Promise<Buffer | null> {
  const { data: row, error } = await supabase
    .from('commission_payouts')
    .select(`*, staff(id, name, role, base_salary)`)
    .eq('id', payoutId)
    .maybeSingle();

  if (error || !row) {
    console.error('[generateStaffCommissionPayoutPdf] load:', error);
    return null;
  }

  const p = row as Record<string, unknown> & { staff?: unknown };
  const st = String(p.status ?? '');
  if (st !== 'confirmed' && st !== 'paid') {
    return null;
  }

  let staffName = '—';
  let staffRole = '—';
  const s = p.staff;
  if (Array.isArray(s) && s[0]) {
    staffName = String((s[0] as { name?: string }).name ?? '—');
    staffRole = String((s[0] as { role?: string }).role ?? '—');
  } else if (s && typeof s === 'object') {
    staffName = String((s as { name?: string }).name ?? '—');
    staffRole = String((s as { role?: string }).role ?? '—');
  }

  const period = String(p.period ?? '—');
  const total = Number(p.total_amount ?? 0);
  const adj = Number(p.adjustment_amount ?? 0);
  const paidAt =
    p.paid_at != null ? fmtDateTime(String(p.paid_at)) : st === 'paid' ? '—' : 'لم يُسجَّل بعد';

  const lineItems: { ar: string; amount: number; muted?: boolean }[] = [
    { ar: 'الراتب الأساسي', amount: Number(p.base_salary ?? 0) },
    { ar: 'عمولات المستوى الأول (T1)', amount: Number(p.t1_commissions ?? 0) },
    { ar: 'عمولات المستوى الثاني (T2)', amount: Number(p.t2_commissions ?? 0) },
    { ar: 'مكافآت الولاء', amount: Number(p.loyalty_bonuses ?? 0) },
    { ar: 'عمولات إضافية (override)', amount: Number(p.override_commissions ?? 0) },
  ];
  if (adj !== 0) {
    lineItems.push({ ar: 'تعديل', amount: adj, muted: false });
  }

  const statusAr = st === 'paid' ? 'مدفوع' : 'معتمد — بانتظار الصرف';
  const statusHtml =
    st === 'paid'
      ? `<span style="display:inline-block;padding:6px 14px;border-radius:9999px;font-size:11px;font-weight:700;font-family:Cairo,sans-serif;background:${TEAL};color:${WHITE};">${esc(statusAr)}</span>`
      : `<span style="display:inline-block;padding:6px 14px;border-radius:9999px;font-size:11px;font-weight:700;font-family:Cairo,sans-serif;border:2px solid ${AMBER};color:${AMBER};">${esc(statusAr)}</span>`;

  const docRef = `CP-${esc(payoutId.slice(0, 8).toUpperCase())}`;
  const rowsHtml = lineItems
    .map(
      (item) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid ${BORDER};font-family:Cairo,sans-serif;color:#334155;">${esc(item.ar)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid ${BORDER};text-align:left;direction:ltr;font-variant-numeric:tabular-nums;font-weight:600;color:${item.muted ? MUTED : NAVY};">${fmtEgp(item.amount)}</td>
    </tr>`,
    )
    .join('');

  const inner = `<div style="flex:1;padding:14mm 12mm;font-family:Cairo,sans-serif;direction:rtl;text-align:right;">
    <div style="font-size:20px;font-weight:800;color:${TEAL};margin-bottom:4px;">إيصال صرف عمولات فريق</div>
    <div style="font-size:11px;color:${MUTED};margin-bottom:16px;">${docRef}</div>
    <div style="margin-bottom:14px;">${statusHtml}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;">
      <tr><td style="padding:6px 0;color:${MUTED};width:40%;">اسم الموظف</td><td style="padding:6px 0;font-weight:700;">${esc(staffName)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">الدور</td><td style="padding:6px 0;">${esc(staffRole)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">الفترة</td><td style="padding:6px 0;">${esc(period)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">تاريخ الصرف</td><td style="padding:6px 0;direction:ltr;text-align:right;">${esc(paidAt)}</td></tr>
    </table>
    <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:${NAVY};">التفاصيل</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr>
          <th style="text-align:right;padding:8px;border-bottom:2px solid ${TEAL};font-family:Cairo,sans-serif;">البند</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid ${TEAL};direction:ltr;">المبلغ</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-radius:12px;background:${GRAY_BG};border:1px solid ${BORDER};">
      <span style="font-weight:800;font-size:15px;font-family:Cairo,sans-serif;">الإجمالي</span>
      <span style="font-weight:800;font-size:18px;color:${TEAL};direction:ltr;">${fmtEgp(total)}</span>
    </div>
  </div>`;

  const html = wrapDocument(
    inner,
    'CenterHQ · centerhq.app · An EHG Intelligence Product',
    `STAFF COMMISSION PAYOUT · ${esc(period)}`,
  );
  return htmlToPdfBuffer(html);
}
