import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

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

const INVOICE_TYPE_ORDER: Record<string, number> = {
  subscription: 1,
  base_subscription: 2,
  signup_first_payment: 3,
  pack_billing: 4,
  announcement_settlement: 5,
  announcement_cap: 6,
  plan_upgrade_difference: 7,
  payment_proof: 8,
  setup_fee: 9,
  whatsapp_addon: 10,
  late_payment_fee: 11,
  late_fee: 11,
  reactivation_fee: 12,
};

const DOC_TYPE_AR: Record<string, string> = {
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
  late_fee: 'فاتورة غرامة تأخير',
  reactivation_fee: 'فاتورة إعادة تفعيل',
};

export function invoiceTypeFooterIndex(invoiceType: string): number {
  return INVOICE_TYPE_ORDER[invoiceType] ?? 1;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtEgp(n: number): string {
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} EGP`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
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
    nano: { en: 'Nano', ar: 'ناشئ' },
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

function parsePackParentsFromRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const m = /\((\d+)\s*parents?\)/i.exec(ref);
  if (m) return parseInt(m[1], 10);
  const m2 = /\((\d+)\s*students?\)/i.exec(ref);
  if (m2) return parseInt(m2[1], 10);
  return null;
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

type StatusKind =
  | 'paid'
  | 'pending'
  | 'overdue'
  | 'processed'
  | 'upgraded'
  | 'shipped'
  | 'review'
  | 'cap_deduct'
  | 'pack_auto'
  | 'activated'
  | 'reactivation';

function resolveStatusKind(
  invoiceType: string,
  status: string,
  dueYmd: string | null | undefined,
): { kind: StatusKind; overdueDays: number } {
  const st = (status ?? '').toLowerCase();
  const od = st === 'overdue' ? overdueDaysFromDue(dueYmd) : 0;

  if (invoiceType === 'payment_proof' && (st === 'pending' || st === 'approved')) {
    return { kind: 'review', overdueDays: 0 };
  }
  if (invoiceType === 'signup_first_payment' && (st === 'paid' || st === 'approved')) {
    return { kind: 'activated', overdueDays: 0 };
  }
  if (invoiceType === 'pack_billing' && (st === 'paid' || st === 'approved')) {
    return { kind: 'pack_auto', overdueDays: 0 };
  }
  if (invoiceType === 'announcement_settlement' && (st === 'paid' || st === 'approved')) {
    return { kind: 'processed', overdueDays: 0 };
  }
  if (invoiceType === 'announcement_cap') {
    return { kind: 'cap_deduct', overdueDays: 0 };
  }
  if (invoiceType === 'plan_upgrade_difference' && (st === 'paid' || st === 'approved')) {
    return { kind: 'upgraded', overdueDays: 0 };
  }
  if (invoiceType === 'setup_fee' && (st === 'paid' || st === 'approved')) {
    return { kind: 'shipped', overdueDays: 0 };
  }
  if (invoiceType === 'reactivation_fee' && (st === 'pending' || st === 'overdue')) {
    return { kind: 'reactivation', overdueDays: 0 };
  }
  if (st === 'overdue') return { kind: 'overdue', overdueDays: od || overdueDaysFromDue(dueYmd) };
  if (st === 'paid' || st === 'approved') return { kind: 'paid', overdueDays: 0 };
  return { kind: 'pending', overdueDays: 0 };
}

function statusPillHtml(kind: StatusKind, overdueDays: number): string {
  const base =
    'display:inline-block;padding:6px 14px;border-radius:9999px;font-size:11px;font-weight:700;font-family:Cairo,system-ui,sans-serif;';
  switch (kind) {
    case 'paid':
    case 'activated':
    case 'pack_auto':
      return `<span style="${base}background:${TEAL};color:${WHITE};">${kind === 'activated' ? 'تم تفعيل الحساب' : kind === 'pack_auto' ? 'تم الخصم تلقائياً' : 'مدفوعة'}</span>`;
    case 'pending':
      return `<span style="${base}border:2px solid ${AMBER};color:${AMBER};background:transparent;">في انتظار الدفع</span>`;
    case 'overdue':
      return `<span style="${base}border:2px solid ${RED};color:${RED};background:transparent;">متأخرة ${overdueDays || '—'} أيام</span>`;
    case 'processed':
      return `<span style="${base}border:2px solid ${TEAL};color:${TEAL};background:transparent;">تمت التسوية</span>`;
    case 'upgraded':
      return `<span style="${base}border:2px solid ${TEAL};color:${TEAL};background:transparent;">تمت الترقية</span>`;
    case 'shipped':
      return `<span style="${base}border:2px solid ${TEAL};color:${TEAL};background:transparent;">تم الشحن</span>`;
    case 'review':
      return `<span style="${base}border:2px solid ${AMBER};color:${AMBER};background:transparent;">قيد المراجعة</span>`;
    case 'cap_deduct':
      return `<span style="${base}border:2px solid ${TEAL};color:${TEAL};background:transparent;">خُصم فوراً</span>`;
    case 'reactivation':
      return `<span style="${base}background:${TEAL};color:${WHITE};">إعادة تفعيل</span>`;
    default:
      return `<span style="${base}border:2px solid ${MUTED};color:${MUTED};background:transparent;">—</span>`;
  }
}

function latePaymentOverduePillHtml(days: number, rate: number): string {
  const base =
    'display:inline-block;padding:6px 14px;border-radius:9999px;font-size:11px;font-weight:700;font-family:Cairo,system-ui,sans-serif;';
  const tier10 = rate >= 0.095;
  const color = tier10 ? RED : AMBER;
  const border = tier10 ? `2px solid ${RED}` : `2px solid ${AMBER}`;
  return `<span style="${base}background:transparent;color:${color};border:${border};">متأخرة ${days || '—'} أيام</span>`;
}

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

async function htmlToPdfBuffer(html: string): Promise<Buffer | null> {
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
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
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

// ── Data loading & type-specific assembly ─────────────────────────

type InvoiceRow = Record<string, unknown>;
type CenterRow = Record<string, unknown>;

export async function generateInvoicePdf(invoiceId: string, supabase: SupabaseClient): Promise<Buffer | null> {
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();

  if (invErr || !invoice) {
    console.error('[generateInvoicePdf] invoice load:', invErr);
    return null;
  }

  const inv = invoice as InvoiceRow;
  const centerId = String(inv.center_id ?? '');
  const invoiceType = String(inv.invoice_type ?? 'subscription');

  const { data: center, error: cErr } = await supabase
    .from('centers')
    .select(
      'name, phone, city, plan, referral_code, subscription_billing_period, next_payment_due, billing_amount, pack_price_per_parent, announcement_balance, dormancy_date, active_months_count',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    console.error('[generateInvoicePdf] center load:', cErr);
    return null;
  }

  const c = center as CenterRow;
  const planKey = String(c.plan ?? '');
  const { en: planEn, ar: planAr } = planPresentation(planKey);

  const { data: planRow } = await supabase
    .from('pricing_plans')
    .select('plan_key, arabic_name, english_name, all_in_price, monthly_fee')
    .eq('plan_key', planKey)
    .maybeSingle();

  const pr = planRow as { arabic_name?: string; english_name?: string } | null;
  const displayPlanAr = pr?.arabic_name?.trim() ? String(pr.arabic_name) : planAr;
  const displayPlanEn = pr?.english_name?.trim() ? String(pr.english_name) : planEn;

  const invNo = String(inv.invoice_number ?? invoiceId.slice(0, 8));
  const total = Number(inv.total_amount ?? 0);
  const base = Number(inv.base_amount ?? total);
  const status = String(inv.status ?? 'pending');
  const dueYmd = inv.due_date != null ? String(inv.due_date).slice(0, 10) : null;
  const { kind: statusKind, overdueDays } = resolveStatusKind(invoiceType, status, dueYmd);
  let statusHtml = statusPillHtml(statusKind, overdueDays);

  const issuedAt = fmtDate(inv.created_at != null ? String(inv.created_at) : undefined);
  const periodStart = fmtDate(inv.billing_period_start != null ? String(inv.billing_period_start) : undefined);
  const periodEnd = fmtDate(inv.billing_period_end != null ? String(inv.billing_period_end) : undefined);
  const periodRange = `${periodStart} – ${periodEnd}`;

  const pref =
    inv.payment_reference != null && String(inv.payment_reference).trim()
      ? String(inv.payment_reference).trim()
      : '';
  const ptxn =
    inv.paymob_transaction_id != null && String(inv.paymob_transaction_id).trim()
      ? String(inv.paymob_transaction_id).trim()
      : '';
  const payRef = pref || ptxn || null;
  const paidAtStr = inv.paid_at ? fmtDateTime(String(inv.paid_at)) : '—';
  const paymentTs = status === 'paid' || status === 'approved' ? paidAtStr : '—';

  const meta = (inv.metadata as Record<string, unknown> | null) ?? {};

  const centerName = String(c.name ?? '—');
  const centerPhone = String(c.phone ?? '—');
  const centerCity = String(c.city ?? '');
  const billingCycle = billingCycleAr(c.subscription_billing_period != null ? String(c.subscription_billing_period) : null);
  const nextDue = c.next_payment_due != null ? fmtDate(String(c.next_payment_due)) : '—';
  const packPricePer = Number(c.pack_price_per_parent ?? 12);

  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://centerhq.app').replace(/\/$/, '');
  const refCode = String(c.referral_code ?? 'CODE').replace(/\s+/g, '') || 'CODE';
  const referUrl = `${appBase}/refer/${encodeURIComponent(refCode)}`;
  let referralStrip: string | undefined;
  const showReferralStrip =
    invoiceType !== 'payment_proof' && invoiceType !== 'setup_fee' && invoiceType !== 'reactivation_fee';
  if (showReferralStrip) {
    try {
      const qrDataUrl = await QRCode.toDataURL(referUrl, { margin: 1, width: 160 });
      const codeSpaced = refCode.toUpperCase().split('').join(' ');
      referralStrip = referralStripHtml(qrDataUrl, codeSpaced, referUrl);
    } catch (e) {
      console.error('[generateInvoicePdf] QR:', e);
    }
  }

  const docTypeAr = DOC_TYPE_AR[invoiceType] ?? 'فاتورة';
  const footerIdx = invoiceTypeFooterIndex(invoiceType);
  const footerRight = `${footerIdx} OF ${DOC_TOTAL}: ${invoiceType.toUpperCase().replace(/_/g, ' ')}`;
  const footerLeft = 'CenterHQ · centerhq.app · An EHG Intelligence Product';

  let topBanner: { line: string; sub?: string; bannerLineColor?: string } | undefined;
  let headerLabel = 'مُرسَلة إلى';
  let amountLabel = 'الإجمالي';
  let invoiceAmountColor: string | undefined;
  let lineRows: LineRow[] = [];
  let leftBreak: BreakRow[] = [];
  let rightBreak: BreakRow[] = [];
  let showTax = true;
  let extraTitleAr: string | undefined;
  let paymentMethodLine = paymentMethodAr(inv.payment_method != null ? String(inv.payment_method) : null);
  let sidebarMeta: SidebarRow[] = [];

  if (invoiceType === 'subscription') {
    sidebarMeta = [
      { label: 'الخطة', value: `${displayPlanAr} (${displayPlanEn})` },
      { label: 'دورة الفوترة', value: billingCycle },
      { label: 'الفترة', value: periodRange },
      { label: 'طريقة الدفع', value: paymentMethodLine },
    ];
    lineRows = [
      {
        titleAr: `اشتراك ${displayPlanAr}`,
        subAr: displayPlanEn,
        mid: periodRange,
        amount: total,
      },
    ];
    leftBreak = [
      { labelAr: 'الخطة × الفترة', value: fmtEgp(total) },
      { labelAr: 'ض.ق.م مدمجة', value: '—' },
      { labelAr: 'رسوم خدمة مدمجة', value: '—' },
      { labelAr: 'دمغة مدمجة', value: '—' },
    ];
    rightBreak = [
      { labelAr: 'المجموع', value: fmtEgp(total), teal: true },
    ];
  } else if (invoiceType === 'base_subscription') {
    paymentMethodLine = '—';
    sidebarMeta = [
      { label: 'الخطة', value: `${displayPlanAr} (${displayPlanEn})` },
      { label: 'دورة الفوترة', value: billingCycle },
      { label: 'الفترة', value: periodRange },
      { label: 'تاريخ الاستحقاق', value: nextDue },
    ];
    const nextInvoiceHint = c.next_payment_due != null ? fmtDate(String(c.next_payment_due)) : '—';
    topBanner = {
      line: 'الشهر الأول من اشتراكك.',
      sub: `الفاتورة التالية ستصدر في ${nextInvoiceHint}`,
    };
    lineRows = [
      {
        titleAr: `اشتراك ${displayPlanAr}`,
        subAr: displayPlanEn,
        mid: periodRange,
        amount: total,
      },
    ];
    leftBreak = [
      { labelAr: 'المرجع', value: payRef ? esc(payRef) : 'بانتظار الدفع' },
      { labelAr: 'توقيت الدفع', value: paymentTs },
    ];
    rightBreak = [{ labelAr: 'المجموع', value: fmtEgp(total), teal: true }];
  } else if (invoiceType === 'signup_first_payment') {
    sidebarMeta = [
      { label: 'الخطة', value: `${displayPlanAr} (${displayPlanEn})` },
      { label: 'دورة الفوترة', value: billingCycle },
      { label: 'الفترة الأولى', value: periodRange },
      { label: 'طريقة الدفع', value: paymentMethodLine },
    ];
    const renewHint = inv.billing_period_end != null ? fmtDate(String(inv.billing_period_end)) : nextDue;
    topBanner = {
      line: 'مرحباً بك في CenterHQ.',
      sub: `حسابك نشط الآن. التجديد القادم: ${renewHint}. ستصلك رسالة تذكير قبل 7 أيام.`,
    };
    lineRows = [
      {
        titleAr: `تسجيل — ${displayPlanAr}`,
        subAr: displayPlanEn,
        mid: periodRange,
        amount: total,
      },
    ];
    leftBreak = [
      { labelAr: 'المرجع', value: payRef ? esc(payRef) : '—' },
      { labelAr: 'توقيت الدفع', value: paymentTs },
    ];
    rightBreak = [{ labelAr: 'المجموع', value: fmtEgp(total), teal: true }];
  } else if (invoiceType === 'pack_billing') {
    const nActive = (parsePackParentsFromRef(payRef) ?? Math.round(base / packPricePer)) || 0;
    const priceLine = `${fmtEgp(packPricePer)} لكل ولي أمر`;
    sidebarMeta = [
      { label: 'أولياء الأمور النشطون', value: String(nActive) },
      { label: 'السعر', value: priceLine },
      { label: 'الفترة', value: periodRange },
    ];
    const inactiveNote = 'غير نشط (مُعفى)';
    lineRows = [
      {
        titleAr: `${nActive} × أولياء أمور نشطون`,
        subAr: 'باقة أولياء الأمور',
        mid: periodRange,
        amount: base,
      },
      {
        titleAr: inactiveNote,
        subAr: undefined,
        mid: '—',
        amount: 0,
        amountMuted: true,
      },
    ];
    leftBreak = [
      { labelAr: `نشط × ${packPricePer} EGP`, value: fmtEgp(Math.max(0, nActive * packPricePer)) },
      { labelAr: 'غير نشط (مُعفى)', value: fmtEgp(0) },
      { labelAr: 'ض.ق.م مدمجة', value: '—' },
    ];
    rightBreak = [{ labelAr: 'المجموع', value: fmtEgp(total), teal: true }];
  } else if (invoiceType === 'whatsapp_addon') {
    const n = parsePackParentsFromRef(payRef) ?? 0;
    sidebarMeta = [
      { label: 'الطلاب/الرسائل', value: String(n || '—') },
      { label: 'الفترة', value: periodRange },
      { label: 'النوع', value: 'باقة واتساب' },
    ];
    lineRows = [
      {
        titleAr: 'باقة واتساب تراكمية',
        subAr: payRef ? esc(String(payRef).slice(0, 80)) : undefined,
        mid: periodRange,
        amount: total,
      },
    ];
    leftBreak = [
      { labelAr: 'المجموع الفرعي', value: fmtEgp(base) },
      { labelAr: 'ضرائب مدمجة', value: '—' },
    ];
    rightBreak = [{ labelAr: 'المجموع', value: fmtEgp(total), teal: true }];
  } else if (invoiceType === 'announcement_settlement') {
    const invCreated = inv.created_at ? String(inv.created_at) : '';
    const day = invCreated.slice(0, 10);
    const { data: blasts } = await supabase
      .from('announcement_blasts')
      .select('blast_type, parents_notified, total_amount, created_at, charged_at')
      .eq('center_id', centerId)
      .eq('billing_status', 'included_in_renewal')
      .order('charged_at', { ascending: false })
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
      return ca === day || (invCreated && b.charged_at && Math.abs(new Date(b.charged_at).getTime() - new Date(invCreated).getTime()) < 36e5);
    });
    const useBlasts = matched.length > 0 ? matched : list.slice(0, 5);

    const totalRecv = useBlasts.reduce((s, b) => s + Number(b.parents_notified ?? 0), 0);
    sidebarMeta = [
      { label: 'عدد الإعلانات', value: String(useBlasts.length || 1) },
      { label: 'إجمالي المستلِمين', value: String(totalRecv || '—') },
      { label: 'الفترة', value: periodRange },
    ];
    paymentMethodLine = 'رصيد الإعلانات — خُصم عند كل إرسال';

    if (useBlasts.length === 0) {
      lineRows = [
        {
          titleAr: 'تسوية إعلانات شهرية',
          subAr: 'مجمّع',
          mid: periodRange,
          amount: total,
        },
      ];
    } else {
      lineRows = useBlasts.map((b) => {
        const bt = b.blast_type === 'ops' ? 'عمليات' : 'ترويج';
        const cnt = Number(b.parents_notified ?? 0);
        const amt = Number(b.total_amount ?? 0);
        const dt = fmtDate(b.created_at);
        return {
          titleAr: `إعلان ${bt} — ${cnt} مستلم × السعر`,
          subAr: undefined,
          mid: `${dt} · ${cnt}`,
          amount: amt,
        };
      });
    }
    const subtotal = useBlasts.reduce((s, b) => s + Number(b.total_amount ?? 0), 0) || total;
    leftBreak = useBlasts.map((b, i) => ({
      labelAr: `إعلان ${i + 1}`,
      value: fmtEgp(Number(b.total_amount ?? 0)),
    }));
    if (leftBreak.length === 0) leftBreak = [{ labelAr: 'المجموع', value: fmtEgp(total) }];
    leftBreak.push({ labelAr: 'ضرائب مدمجة', value: '—' });
    rightBreak = [{ labelAr: 'الإجمالي الشهري', value: fmtEgp(total), teal: true }];
  } else if (invoiceType === 'announcement_cap') {
    const invCreated = inv.created_at ? String(inv.created_at) : '';
    const { data: blasts } = await supabase
      .from('announcement_blasts')
      .select('blast_type, parents_notified, total_amount, created_at')
      .eq('center_id', centerId)
      .order('created_at', { ascending: false })
      .limit(5);
    const last = (blasts ?? [])[0] as
      | { blast_type?: string; parents_notified?: number; total_amount?: number; created_at?: string }
      | undefined;
    const cap = total;
    const after = 0;
    sidebarMeta = [
      { label: 'النوع', value: last?.blast_type === 'ops' ? 'عمليات' : 'ترويج' },
      { label: 'تاريخ الإرسال', value: last?.created_at ? fmtDateTime(last.created_at) : fmtDateTime(invCreated) },
      { label: 'عدد المستلِمين', value: String(last?.parents_notified ?? '—') },
    ];
    paymentMethodLine = `رصيد الإعلانات — رصيد قبل: ${fmtEgp(cap)} | رصيد بعد: ${fmtEgp(after)}`;
    const blastAmt = last ? Number(last.total_amount ?? 0) : total;
    const rec = last ? Number(last.parents_notified ?? 0) : 0;
    lineRows = [
      {
        titleAr: last ? `إعلان — ${rec} مستلم × 8 EGP` : 'سقف الإعلانات',
        subAr: undefined,
        mid: last?.created_at ? fmtDateTime(last.created_at) : periodRange,
        amount: blastAmt,
      },
      {
        titleAr: 'تجاوز السقف — لا يُحتسب مبلغ إضافي',
        subAr: undefined,
        mid: 'السقف / المستخدم',
        amount: 0,
        amountMuted: true,
      },
    ];
    leftBreak = [
      { labelAr: `المستلمون × 8 EGP`, value: fmtEgp(rec * 8) },
      { labelAr: 'تجاوز السقف', value: fmtEgp(0) },
      { labelAr: 'ضرائب مدمجة', value: '—' },
    ];
    rightBreak = [{ labelAr: 'الإجمالي', value: fmtEgp(total), teal: true }];
  } else if (invoiceType === 'plan_upgrade_difference') {
    let sess: { metadata?: unknown } | null = null;
    const { data: sessHit } = await supabase
      .from('combined_payment_sessions')
      .select('metadata')
      .eq('center_id', centerId)
      .contains('invoice_ids', [invoiceId])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    sess = sessHit;
    if (!sess) {
      const { data: sessions } = await supabase
        .from('combined_payment_sessions')
        .select('metadata, invoice_ids')
        .eq('center_id', centerId)
        .eq('session_type', 'upgrade')
        .order('created_at', { ascending: false })
        .limit(25);
      const hit = (sessions ?? []).find((row: { invoice_ids?: string[] }) =>
        Array.isArray(row.invoice_ids) ? row.invoice_ids.includes(invoiceId) : false,
      );
      sess = hit ? { metadata: hit.metadata } : null;
    }

    const md = (sess?.metadata as Record<string, unknown> | undefined) ?? {};
    const newPlan = String(md.newPlan ?? planKey);
    const oldPlan = String(md.previousPlan ?? '—');
    const daysRem = Number(md.daysRemaining ?? 0);
    const charged = Number(md.amountCharged ?? total);
    const capped = Number(md.cappedProratedCost ?? charged);
    const oldCredit = Math.max(0, capped - charged);

    const newPres = planPresentation(newPlan);
    const oldPres = planPresentation(oldPlan);

    sidebarMeta = [
      { label: 'من الخطة', value: oldPres.ar },
      { label: 'إلى الخطة', value: newPres.ar },
      { label: 'الأيام المتبقية', value: String(daysRem || '—') },
    ];
    extraTitleAr = 'رسوم الترقية المحسوبة بالأيام';
    if (daysRem > 0 || capped > 0 || oldCredit > 0) {
      lineRows = [
        {
          titleAr: `الخطة الجديدة (${newPres.ar}) — بالأيام`,
          subAr: 'تناسبي',
          mid: `${daysRem || '—'} يوم`,
          amount: capped,
        },
        {
          titleAr: `رصيد الخطة السابقة (${oldPres.ar})`,
          subAr: undefined,
          mid: 'رصيد مُعاد',
          amount: -oldCredit,
          amountRed: true,
        },
      ];
      leftBreak = [
        { labelAr: 'خطة جديدة (أيام)', value: fmtEgp(capped) },
        { labelAr: 'رصيد الخطة القديمة', value: fmtEgp(-oldCredit), red: oldCredit > 0 },
      ];
      rightBreak = [{ labelAr: 'فرق الترقية', value: fmtEgp(charged), teal: true }];
    } else {
      lineRows = [
        {
          titleAr: 'فرق ترقية الخطة',
          subAr: `${oldPres.ar} ← ${newPres.ar}`,
          mid: periodRange,
          amount: total,
        },
      ];
      leftBreak = [{ labelAr: 'الفرق المحسوب', value: fmtEgp(total) }];
      rightBreak = [{ labelAr: 'المجموع', value: fmtEgp(total), teal: true }];
    }
  } else if (invoiceType === 'payment_proof') {
    headerLabel = 'مُقدَّم من';
    amountLabel = 'المبلغ المُقدَّم';
    const payAmt = Number(inv.payment_amount ?? inv.total_amount ?? 0);
    paymentMethodLine = paymentMethodAr(inv.payment_method != null ? String(inv.payment_method) : 'instapay');
    sidebarMeta = [
      { label: 'طريقة الدفع', value: paymentMethodLine },
      { label: 'تاريخ الإرسال', value: issuedAt },
      { label: 'مرجع الفاتورة', value: payRef ? esc(payRef) : '—' },
    ];
    topBanner = {
      line: 'في انتظار تأكيد المشرف.',
      sub: 'تم استلام إثبات الدفع وهو قيد المراجعة. ستصلك رسالة واتساب فور التأكيد. عادةً يستغرق ذلك 1-2 ساعة عمل.',
    };
    lineRows = [
      {
        titleAr: 'تجديد اشتراك — إثبات تحويل',
        subAr: 'بانتظار الموافقة',
        mid: 'تجديد',
        amount: payAmt,
      },
    ];
    leftBreak = [
      { labelAr: 'المبلغ المُرسل', value: fmtEgp(payAmt) },
      { labelAr: 'حالة المراجعة', value: 'قيد المراجعة' },
      { labelAr: 'الوقت المتوقع', value: '1-2 ساعة' },
    ];
    rightBreak = [{ labelAr: 'المجموع', value: fmtEgp(payAmt), teal: true }];
    referralStrip = undefined;
  } else if (invoiceType === 'setup_fee') {
    headerLabel = 'التوصيل إلى';
    const product = String(meta.product_name_ar ?? 'ماسح البطاقات الذكية');
    const shipCo = String(meta.shipping_company ?? 'Bosta');
    const track = String(meta.tracking_number ?? payRef ?? '—');
    sidebarMeta = [
      { label: 'المنتج', value: product },
      { label: 'شركة الشحن', value: shipCo },
      { label: 'رقم التتبع', value: esc(track) },
    ];
    const scannerPrice =
      meta.scanner_unit_price != null && Number(meta.scanner_unit_price) > 0
        ? Number(meta.scanner_unit_price)
        : Math.max(0, base - 50);
    const deliveryFee = Math.max(0, total - scannerPrice);
    lineRows = [
      {
        titleAr: `${product} — CenterHQ Scanner`,
        subAr: 'جهاز مسح البطاقات',
        mid: `1 × ${fmtEgp(scannerPrice)}`,
        amount: scannerPrice,
      },
      {
        titleAr: 'رسوم توصيل Bosta',
        subAr: undefined,
        mid: 'Express · 1-2 days',
        amount: deliveryFee,
      },
    ];
    leftBreak = [
      { labelAr: 'الماسح × 1', value: fmtEgp(scannerPrice) },
      { labelAr: 'شحن Bosta', value: fmtEgp(deliveryFee) },
    ];
    rightBreak = [{ labelAr: 'المدفوع', value: fmtEgp(total), teal: true }];
    showTax = false;
    referralStrip = undefined;
  } else if (invoiceType === 'late_payment_fee' || invoiceType === 'late_fee') {
    const lfMeta = meta as {
      late_fee_rate?: number;
      late_fee_amount?: number;
      days_overdue?: number;
      tier?: number;
      cycle_anchor?: string;
      grace_period_end?: string;
    };
    const rate = Number(lfMeta.late_fee_rate ?? 0);
    const feeAmt = Number(lfMeta.late_fee_amount ?? Math.max(0, total - base));
    const daysOd = Number(lfMeta.days_overdue ?? overdueDays ?? 0);
    const origDueYmd =
      lfMeta.cycle_anchor != null && String(lfMeta.cycle_anchor).trim()
        ? String(lfMeta.cycle_anchor).slice(0, 10)
        : inv.billing_period_start != null
          ? String(inv.billing_period_start).slice(0, 10)
          : dueYmd ?? '';
    const graceEndYmd =
      lfMeta.grace_period_end != null && String(lfMeta.grace_period_end).trim()
        ? String(lfMeta.grace_period_end).slice(0, 10)
        : null;
    const graceEndLabel = graceEndYmd ? fmtDate(graceEndYmd) : '—';
    const dueDateLabel = dueYmd ? fmtDate(dueYmd) : '—';

    sidebarMeta = [
      { label: 'الموعد الأصلي', value: origDueYmd ? fmtDate(origDueYmd) : '—' },
      { label: 'أيام التأخير', value: String(daysOd || '—') },
      { label: 'نسبة الغرامة', value: `${Math.round(rate * 100)}%` },
    ];

    if (status === 'pending' || status === 'overdue') {
      statusHtml = latePaymentOverduePillHtml(daysOd, rate);
    }

    topBanner = {
      line: 'الحساب معرض للإيقاف.',
      sub: 'يرجى سداد المبلغ الكامل بما في ذلك غرامة التأخير لاستعادة الوصول الكامل.',
      bannerLineColor: RED,
    };
    paymentMethodLine = `السداد متأخر — انتهت فترة السماح: ${graceEndLabel}`;

    const tier10 = rate >= 0.095;
    invoiceAmountColor = tier10 ? RED : AMBER;

    lineRows = [
      {
        titleAr: `${displayPlanAr} — ${billingCycle}`,
        subAr: `فترة الفوترة`,
        mid: periodRange,
        amount: base,
      },
      {
        titleAr: `غرامة التأخير (${Math.round(rate * 100)}%)`,
        titleBoldRed: true,
        mid: `${dueDateLabel} · ${issuedAt}`,
        amount: feeAmt,
        amountRed: true,
      },
    ];
    leftBreak = [
      { labelAr: 'مبلغ الخطة الأساسي', value: fmtEgp(base) },
      { labelAr: `غرامة التأخير (${Math.round(rate * 100)}%)`, value: fmtEgp(feeAmt), red: true },
      { labelAr: 'الضرائب مدمجة', value: 'شاملة' },
    ];
    rightBreak = [
      {
        labelAr: 'الإجمالي المستحق',
        value: fmtEgp(total),
        red: tier10,
        amber: !tier10 && rate > 0,
      },
    ];
  } else if (invoiceType === 'reactivation_fee') {
    referralStrip = undefined;
    const rm = meta as {
      active_months_count?: number;
      avg_monthly_price?: number;
      base_fee?: number;
      discount_rate?: number;
      suspension_started?: string | null;
      suspension_days?: number;
    };
    const avgM = Number(rm.avg_monthly_price ?? base);
    const dr = Number(rm.discount_rate ?? 0);
    const monthsActive = Number(rm.active_months_count ?? Number(c.active_months_count ?? 0));
    const discAmt = Number(inv.discount_amount ?? Math.round(base * dr * 100) / 100);
    const suspStart =
      rm.suspension_started != null && String(rm.suspension_started).trim()
        ? fmtDate(String(rm.suspension_started))
        : c.dormancy_date != null
          ? fmtDate(String(c.dormancy_date))
          : '—';
    const suspDays = Number(rm.suspension_days ?? 0);

    sidebarMeta = [
      { label: 'تاريخ الإيقاف', value: suspStart },
      { label: 'مدة الإيقاف', value: suspDays > 0 ? `${suspDays} يوم` : '—' },
      { label: 'خصم الولاء', value: dr > 0 ? `${Math.round(dr * 100)}%` : '—' },
    ];
    topBanner = {
      line: 'مرحباً بك مجدداً في CenterHQ.',
      sub: 'حسابك نشط الآن. جميع بياناتك محفوظة.',
      bannerLineColor: TEAL,
    };
    amountLabel = 'رسوم إعادة التفعيل';
    invoiceAmountColor = TEAL;

    lineRows = [
      {
        titleAr: 'متوسط الاشتراك الشهري (مرجعية التسعير)',
        subAr: undefined,
        mid: `مجموع فواتير الاشتراك ÷ ${Math.max(1, monthsActive)} شهر`,
        amount: base,
      },
    ];
    if (dr > 0 && discAmt > 0) {
      lineRows.push({
        titleAr: 'خصم الولاء',
        subAr: undefined,
        mid: `${monthsActive} شهر نشاط`,
        amount: -discAmt,
        amountGreen: true,
      });
    }
    leftBreak = [
      { labelAr: 'متوسط السعر الشهري', value: fmtEgp(avgM) },
      ...(dr > 0
        ? [{ labelAr: `خصم الولاء (${Math.round(dr * 100)}%)`, value: `−${fmtEgp(discAmt)}`, green: true } as BreakRow]
        : []),
    ];
    rightBreak = [{ labelAr: 'إجمالي إعادة التفعيل', value: fmtEgp(total), teal: true }];
    showTax = false;
  } else {
    sidebarMeta = [
      { label: 'الخطة', value: displayPlanAr },
      { label: 'الفترة', value: periodRange },
    ];
    lineRows = [{ titleAr: 'بند فاتورة', subAr: invoiceType, mid: periodRange, amount: total }];
    leftBreak = [{ labelAr: 'المجموع', value: fmtEgp(total) }];
    rightBreak = [{ labelAr: 'الإجمالي', value: fmtEgp(total), teal: true }];
  }

  if (invoiceType !== 'payment_proof' && invoiceType !== 'setup_fee' && payRef && (status === 'paid' || status === 'approved')) {
    if (leftBreak.length && !leftBreak.some((x) => x.labelAr.includes('TXN') || x.labelAr.includes('المرجع'))) {
      leftBreak = [{ labelAr: 'مرجع TXN', value: esc(payRef) }, ...leftBreak];
    }
  }

  const sidebar = buildSidebar({
    docTypeAr,
    invoiceNumber: invNo,
    issueDate: issuedAt,
    statusHtml,
    metaRows: sidebarMeta,
    paymentMethodLine,
    paymentTs,
  });

  const main = buildMainColumn({
    topBanner,
    headerLabel,
    centerName,
    centerPhone,
    centerCity,
    amountLabel,
    totalAmount: total,
    totalAmountColor: invoiceAmountColor,
    lineRows,
    leftBreak,
    rightBreak,
    showTax,
    referralStrip,
    extraTitleAr,
  });

  const html = wrapDocument(`${sidebar}${main}`, footerLeft, footerRight);
  return htmlToPdfBuffer(html);
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
        titleAr: `عمولة ${pct}% — ${cname}`,
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
