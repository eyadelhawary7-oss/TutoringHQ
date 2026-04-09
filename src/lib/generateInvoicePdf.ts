import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';

// ── Types ──────────────────────────────────────────────────────────

export interface InvoiceData {
  invoiceNumber: string;
  invoiceType: string;
  status: 'paid' | 'pending' | 'overdue' | 'failed';
  centerName: string;
  centerPhone: string;
  centerCity: string;
  planName: string;
  planNameAr: string;
  billingPeriod: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  totalAmount: number;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  issuedAt: string;
  dueDate: string;
}

// ── Constants (match generateOrderPdf.ts) ───────────────────────────

const CHROMIUM_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v123.0.0/chromium-v123.0.0-pack.tar';

// ── Helpers ───────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function statusBadgeHtml(status: InvoiceData['status']): string {
  const label =
    status === 'paid'
      ? 'PAID'
      : status === 'pending'
        ? 'PENDING'
        : status === 'overdue'
          ? 'OVERDUE'
          : 'FAILED';
  const bg =
    status === 'paid'
      ? '#DCFCE7'
      : status === 'pending'
        ? '#FEF3C7'
        : '#FEE2E2';
  const color =
    status === 'paid' ? '#166534' : status === 'pending' ? '#B45309' : '#991B1B';
  return `<span class="status-pill" style="background:${bg};color:${color}">${label}</span>`;
}

function formatPaymentMethodLabel(raw: string | null): string {
  if (!raw?.trim()) return 'Paymob';
  const x = raw.trim().toLowerCase();
  if (x === 'paymob' || x.includes('paymob')) return 'Paymob';
  return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1);
}

function planStudentCapLine(planNameEn: string): string {
  const t = planNameEn.trim().toLowerCase();
  const caps: Record<string, string> = {
    nano: 'Up to 100 students',
    starter: 'Up to 250 students',
    pro: 'Up to 500 students',
    business: 'Up to 1,000 students',
    enterprise: 'Up to 2,000 students',
    payg: 'Per active student (PAYG)',
    'pay as you go': 'Per active student (PAYG)',
  };
  return caps[t] ?? 'Plan capacity per your subscription';
}

function buildInvoiceHtml(data: InvoiceData, studentLine: string): string {
  const d = data;
  const cityLine = d.centerCity?.trim()
    ? `${esc(d.centerCity.trim())}, Egypt`
    : '—, Egypt';
  const refTrimmed = d.paymentReference?.trim();
  const refLine = refTrimmed
    ? `<div class="pay-line">Reference: ${esc(refTrimmed)}</div>`
    : '';
  const paymentBand =
    d.status === 'paid'
      ? `
  <div class="pay-band pay-band--paid">
    <div class="pay-line pay-title">✓ Payment Confirmed</div>
    <div class="pay-line">Paid on: ${esc(d.paidAt ?? '—')} via ${esc(formatPaymentMethodLabel(d.paymentMethod))}</div>
    ${refLine}
  </div>`
      : '';

  const watermark =
    d.status === 'paid'
      ? `<div class="watermark" aria-hidden="true">PAID</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:'Cairo',Arial,sans-serif;
  background:#fff;
  color:#0F172A;
  font-size:13px;
  line-height:1.5;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.wrap{position:relative;max-width:100%;min-height:100%}
.watermark{
  position:fixed;
  top:48%;
  left:50%;
  transform:translate(-50%,-50%) rotate(-30deg);
  font-size:72px;
  font-weight:800;
  letter-spacing:0.08em;
  color:rgba(13,148,136,0.15);
  z-index:0;
  pointer-events:none;
  white-space:nowrap;
}
.content{position:relative;z-index:1}
.header-band{
  width:100%;
  height:80px;
  background:#0D9488;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 32px;
}
.brand-left{display:flex;align-items:center;gap:14px;min-width:0}
.ch-circle{
  flex-shrink:0;
  width:40px;height:40px;border-radius:50%;
  background:#fff;
  display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:800;color:#0D9488;letter-spacing:0.02em;
}
.brand-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.brand-name{font-size:20px;font-weight:700;color:#fff;line-height:1.15}
.brand-tagline{font-size:11px;font-weight:600;color:rgba(255,255,255,0.92);line-height:1.2}
.header-invoice{
  color:#fff;
  font-size:24px;
  font-weight:800;
  letter-spacing:0.35em;
  text-transform:uppercase;
  flex-shrink:0;
}
.invoice-title-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:12px;
  padding:20px 32px 8px;
}
.inv-num{
  font-size:22px;
  font-weight:700;
  color:#0D9488;
  letter-spacing:0.02em;
}
.status-pill{
  display:inline-block;
  padding:6px 14px;
  border-radius:6px;
  font-size:11px;
  font-weight:700;
  letter-spacing:0.06em;
}
.meta{
  display:flex;
  flex-direction:row;
  justify-content:space-between;
  gap:40px;
  padding:24px 32px 28px;
}
.meta-col{flex:1;min-width:0}
.meta-col--right{text-align:right}
.label-tiny{
  font-size:10px;
  font-weight:700;
  color:#64748B;
  text-transform:uppercase;
  letter-spacing:0.1em;
  margin-bottom:10px;
}
.billed-name{font-size:16px;font-weight:700;color:#0F172A;margin-bottom:6px}
.billed-muted{font-size:13px;color:#475569;margin-top:4px}
.meta-detail{margin-bottom:8px;font-size:13px;color:#0F172A}
.meta-detail .k{color:#64748B;margin-right:6px}
.table-wrap{padding:0 32px 8px}
table.inv{width:100%;border-collapse:collapse;margin-top:4px}
table.inv thead th{
  text-align:left;
  font-size:11px;
  font-weight:700;
  color:#fff;
  text-transform:uppercase;
  letter-spacing:0.06em;
  background:#0F172A;
  padding:12px 14px;
}
table.inv thead th:last-child{text-align:right}
table.inv tbody td{
  padding:14px;
  vertical-align:top;
  font-size:13px;
  border-bottom:1px solid #E2E8F0;
}
table.inv tbody tr:nth-child(even){background:#f8fafc}
table.inv tbody td:last-child{
  text-align:right;
  font-weight:600;
  font-variant-numeric:tabular-nums;
}
.desc-main{font-weight:700;color:#0F172A}
.desc-sub{font-size:12px;color:#64748B;margin-top:4px}
.totals{
  padding:16px 32px 24px;
  display:flex;
  justify-content:flex-end;
}
.totals-inner{width:300px;max-width:100%}
.tline{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  margin-bottom:8px;
  font-size:13px;
  color:#64748B;
}
.tline strong,.tline .amt{color:#0F172A;font-weight:600;font-variant-numeric:tabular-nums}
.tline--muted{color:#94A3B8;font-size:12px}
.tline--muted .amt{color:#94A3B8;font-weight:500}
.ttotal-bar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-top:14px;
  padding:14px 16px;
  background:#0D9488;
  color:#fff;
  font-size:15px;
  font-weight:700;
  border-radius:4px;
}
.ttotal-bar .amt{font-variant-numeric:tabular-nums}
.pay-band{margin:0 32px 24px;padding:18px 20px;border-radius:6px}
.pay-band--paid{background:#f0fdf4;border:1px solid #BBF7D0}
.pay-line{font-size:13px;color:#475569;margin-top:6px}
.pay-line:first-child{margin-top:0}
.pay-title{color:#166534;font-weight:700;font-size:14px}
.footer-rule{
  height:1px;
  background:#0D9488;
  margin:0 32px 14px;
  opacity:0.85;
}
.footer{
  text-align:center;
  font-size:11px;
  color:#64748B;
  padding:0 32px 28px;
  line-height:1.6;
}
</style>
</head>
<body>
<div class="wrap">
  ${watermark}
  <div class="content">
  <div class="header-band">
    <div class="brand-left">
      <div class="ch-circle">CH</div>
      <div class="brand-text">
        <div class="brand-name">CenterHQ</div>
        <div class="brand-tagline" dir="rtl">إدارة ذكية للسناتر</div>
      </div>
    </div>
    <div class="header-invoice">INVOICE</div>
  </div>

  <div class="invoice-title-row">
    <div class="inv-num">${esc(d.invoiceNumber)}</div>
    <div>${statusBadgeHtml(d.status)}</div>
  </div>

  <div class="meta">
    <div class="meta-col">
      <div class="label-tiny">Billed To</div>
      <div class="billed-name">${esc(d.centerName)}</div>
      <div class="billed-muted">${esc(d.centerPhone || '—')}</div>
      <div class="billed-muted">${cityLine}</div>
    </div>
    <div class="meta-col meta-col--right">
      <div class="meta-detail"><span class="k">Issue Date:</span> ${esc(d.issuedAt)}</div>
      <div class="meta-detail"><span class="k">Due Date:</span> ${esc(d.dueDate)}</div>
      <div class="meta-detail"><span class="k">Billing Period:</span> ${esc(d.billingPeriodStart)} → ${esc(d.billingPeriodEnd)}</div>
    </div>
  </div>

  <div class="table-wrap">
    <table class="inv">
      <thead>
        <tr>
          <th>Description</th>
          <th>Period</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div class="desc-main">${esc(d.planName)} Plan</div>
            <div class="desc-sub" dir="auto">${esc(d.planNameAr)}</div>
            <div class="desc-sub">${esc(studentLine)}</div>
          </td>
          <td>${esc(d.billingPeriodStart)} to ${esc(d.billingPeriodEnd)}</td>
          <td>${esc(fmtNum(d.totalAmount))} EGP</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="totals">
    <div class="totals-inner">
      <div class="tline"><span>Subtotal</span><span class="amt">${esc(fmtNum(d.totalAmount))} EGP</span></div>
      <div class="tline tline--muted"><span>VAT 14% — Included</span><span class="amt">—</span></div>
      <div class="tline tline--muted"><span>Service Fee 6% — Included</span><span class="amt">—</span></div>
      <div class="tline tline--muted"><span>Stamp Duty 0.4% — Included</span><span class="amt">—</span></div>
      <div class="ttotal-bar"><span>Total</span><span class="amt">${esc(fmtNum(d.totalAmount))} EGP</span></div>
    </div>
  </div>

  ${paymentBand}

  <div class="footer-rule"></div>
  <div class="footer">
    CenterHQ · centerhq.app · An EHG Intelligence Product
  </div>
  </div>
</div>
</body>
</html>`;
}

// ── Main export ────────────────────────────────────────────────────

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer | null> {
  const studentLine = planStudentCapLine(data.planName);
  let browser: Browser | null = null;

  try {
    const html = buildInvoiceHtml(data, studentLine);
    const executablePath = await chromium.executablePath(CHROMIUM_URL);

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: 'load',
      timeout: 30000,
    });
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    });

    return Buffer.from(pdf);
  } catch (err) {
    console.error('[generateInvoicePdf] Error:', err);
    return null;
  } finally {
    if (browser !== null) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[generateInvoicePdf] Close error:', e);
      }
    }
  }
}
