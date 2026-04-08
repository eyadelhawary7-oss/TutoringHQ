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

function fmtEgp(n: number): string {
  return `${n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} EGP`;
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
    status === 'paid' ? '#166534' : status === 'pending' ? '#92400E' : '#991B1B';
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
  const paymentBand =
    d.status === 'paid'
      ? `
  <div class="pay-line pay-ok">✓ Payment received</div>
  <div class="pay-line">Paid via: ${esc(formatPaymentMethodLabel(d.paymentMethod))}</div>
  <div class="pay-line">Date: ${esc(d.paidAt ?? '—')}</div>
  <div class="pay-line">Ref: ${esc(d.paymentReference ?? '—')}</div>`
      : `
  <div class="pay-line pay-due">Payment due by ${esc(d.dueDate)}</div>
  <div class="pay-line">Pay securely via Paymob at centerhq.app</div>`;

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:Arial,system-ui,sans-serif;
  background:#fff;
  color:#0F172A;
  font-size:13px;
  line-height:1.45;
}
.wrap{max-width:100%}
.header-band{
  width:100%;
  height:60px;
  background:#0D9488;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 24px;
}
.brand-left{display:flex;align-items:center;gap:12px}
.ch-circle{
  width:36px;height:36px;border-radius:50%;
  border:2px solid rgba(255,255,255,.85);
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:800;color:#fff;letter-spacing:.5px
}
.brand-name{font-size:17px;font-weight:700;color:#fff}
.header-invoice{
  color:#fff;
  font-size:14px;
  font-weight:700;
  letter-spacing:4px;
  text-transform:uppercase;
}
.meta{
  display:flex;
  flex-direction:row;
  justify-content:space-between;
  gap:32px;
  padding:24px;
}
.meta-col{flex:1;min-width:0}
.label-tiny{
  font-size:10px;
  font-weight:700;
  color:#64748B;
  text-transform:uppercase;
  letter-spacing:.08em;
  margin-bottom:8px;
}
.billed-name{font-size:16px;font-weight:700;color:#0F172A;margin-bottom:4px}
.billed-muted{font-size:13px;color:#64748B;margin-top:2px}
.detail-rows{margin-top:0}
.detail-row{
  display:flex;
  justify-content:space-between;
  gap:12px;
  margin-bottom:6px;
  font-size:13px;
}
.detail-row .k{color:#64748B;white-space:nowrap}
.detail-row .v{color:#0F172A;text-align:right}
.detail-row .v.mono{font-family:ui-monospace,monospace;color:#0D9488;font-weight:600}
.status-pill{
  display:inline-block;
  padding:3px 10px;
  border-radius:999px;
  font-size:10px;
  font-weight:700;
  letter-spacing:.04em;
}
.divider-h{
  height:1px;
  background:#E2E8F0;
  margin:0 24px;
}
.table-wrap{padding:0 24px 16px}
table.inv{width:100%;border-collapse:collapse;margin-top:8px}
table.inv th{
  text-align:left;
  font-size:11px;
  font-weight:700;
  color:#64748B;
  text-transform:uppercase;
  letter-spacing:.04em;
  background:#F8FAFC;
  padding:10px 12px;
  border-bottom:1px solid #E2E8F0;
}
table.inv th:nth-child(3),table.inv td:nth-child(3){text-align:right}
table.inv td{
  padding:12px;
  vertical-align:top;
  border-bottom:1px solid #E2E8F0;
  font-size:13px;
}
.desc-main{font-weight:600;color:#0F172A}
.desc-sub{font-size:11px;color:#64748B;margin-top:4px}
.totals{
  padding:8px 24px 20px;
  display:flex;
  justify-content:flex-end;
}
.totals-inner{width:280px;max-width:100%}
.tline{
  display:flex;
  justify-content:space-between;
  margin-bottom:6px;
  font-size:13px;
  color:#64748B;
}
.tline strong{color:#0F172A;font-weight:600}
.tsep{border-top:1px solid #E2E8F0;margin:10px 0}
.ttotal{
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-size:15px;
  font-weight:700;
  color:#0D9488;
}
.pay-band{
  margin:0;
  padding:16px 24px;
  background:#F8FAFC;
  border-top:1px solid #E2E8F0;
}
.pay-line{font-size:12px;color:#475569;margin-top:4px}
.pay-line:first-child{margin-top:0}
.pay-ok{color:#166534;font-weight:600}
.pay-due{color:#0F172A;font-weight:600}
.footer-rule{
  height:2px;
  background:#0D9488;
  margin:0 24px 12px;
}
.footer{
  text-align:center;
  font-size:11px;
  color:#64748B;
  padding:0 24px 24px;
  line-height:1.6;
}
</style>
</head>
<body>
<div class="wrap">
  <div class="header-band">
    <div class="brand-left">
      <div class="ch-circle">CH</div>
      <span class="brand-name">CenterHQ</span>
    </div>
    <div class="header-invoice">INVOICE</div>
  </div>

  <div class="meta">
    <div class="meta-col">
      <div class="label-tiny">Billed to</div>
      <div class="billed-name">${esc(d.centerName)}</div>
      <div class="billed-muted">${esc(d.centerCity || '—')}</div>
      <div class="billed-muted">${esc(d.centerPhone || '—')}</div>
    </div>
    <div class="meta-col">
      <div class="detail-rows">
        <div class="detail-row"><span class="k">Invoice #</span><span class="v mono">${esc(d.invoiceNumber)}</span></div>
        <div class="detail-row"><span class="k">Issued</span><span class="v">${esc(d.issuedAt)}</span></div>
        <div class="detail-row"><span class="k">Due</span><span class="v">${esc(d.dueDate)}</span></div>
        <div class="detail-row"><span class="k">Period</span><span class="v">${esc(d.billingPeriod)}</span></div>
        <div class="detail-row"><span class="k">Status</span><span class="v">${statusBadgeHtml(d.status)}</span></div>
      </div>
    </div>
  </div>

  <div class="divider-h"></div>

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
          <td style="font-weight:600">${esc(fmtEgp(d.totalAmount))}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="totals">
    <div class="totals-inner">
      <div class="tline"><span>Subtotal</span><strong>${esc(fmtEgp(d.totalAmount))}</strong></div>
      <div class="tline"><span>VAT 14%</span><strong>Included</strong></div>
      <div class="tline"><span>Service fee 6%</span><strong>Included</strong></div>
      <div class="tline"><span>Stamp duty 0.4%</span><strong>Included</strong></div>
      <div class="tsep"></div>
      <div class="ttotal"><span>TOTAL DUE</span><span>${esc(fmtEgp(d.totalAmount))}</span></div>
    </div>
  </div>

  <div class="pay-band">${paymentBand}</div>

  <div class="footer-rule"></div>
  <div class="footer">
    <div>CenterHQ · centerhq.app · An EHG Intelligence Product</div>
    <div>EHG Intelligence Egypt · Cairo, Egypt</div>
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
      timeout: 20000,
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
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
