import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { formatDate } from '@/lib/formatNumber';

// ── Types ──────────────────────────────────────────────────────────

interface PdfStudent {
  id: string;
  name: string;
  student_number: string;
  qr_code: string;
}

export interface GeneratePdfInput {
  ref: string;
  quantity: number;
  notes: string | null;
  centerName: string;
  centerPhone: string;
  cardColor: string;
  academicYear: string;
  students: PdfStudent[];
}

// ── Helpers ────────────────────────────────────────────────────────

function getContrastColor(hex: string): string {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return '#FFFFFF';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#0F172A' : '#FFFFFF';
}

// ── HTML Builder ───────────────────────────────────────────────────

function buildCardHtml(input: GeneratePdfInput): string {
  const { ref, quantity, notes, centerName, centerPhone, cardColor, academicYear, students } = input;

  const safeColor = cardColor || '#0D9488';
  const textColor = getContrastColor(safeColor);
  const initial = (centerName || 'C').charAt(0).toUpperCase();
  const displayNotes = notes || 'لا يوجد';
  const displayDate = formatDate(new Date(), 'ar', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const rows = students
    .map(
      (s) => `
    <div class="row">
      <div class="col">
        <div class="front">
          <div class="front-header" style="background:${safeColor}">
            <span class="front-center-name"
                  style="color:${textColor}">${centerName}</span>
          </div>
          <div class="front-body">
            <img class="qr" src="${s.qr_code}" alt="QR" />
            <div class="student-name">${s.name}</div>
            <div class="student-num">#${s.student_number}</div>
            <div class="acad-year">${academicYear}</div>
          </div>
        </div>
        <div class="label">الوجه الأمامي</div>
      </div>
      <div class="col">
        <div class="back">
          <div class="circle" style="background:${safeColor}">
            <span class="initial">${initial}</span>
          </div>
          <div class="back-name">${centerName}</div>
          <div class="back-phone">${centerPhone || ''}</div>
          <div class="powered">Powered by CenterHQ</div>
        </div>
        <div class="label">الوجه الخلفي</div>
      </div>
    </div>
  `,
    )
    .join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#fff;color:#0F172A}
.cover{width:100%;height:100vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:20px;padding:40px;
  page-break-after:always}
.platform{font-size:11px;font-weight:700;color:#94A3B8;
  letter-spacing:3px;text-transform:uppercase}
.title{font-size:26px;font-weight:800}
.ref-num{font-size:40px;font-weight:900;color:#0D9488;
  font-family:monospace;letter-spacing:3px;margin:8px 0}
.info-table{border-collapse:collapse;width:360px;margin-top:12px}
.info-table td{padding:10px 16px;border:1px solid #E2E8F0;font-size:13px}
.info-table td:first-child{background:#F8FAFC;font-weight:600;
  color:#64748B;width:40%}
.info-table td:last-child{font-weight:700}
.warning{background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;
  padding:10px 20px;font-size:12px;color:#92400E;text-align:center;
  max-width:360px;margin-top:8px}
.footer{font-size:11px;color:#CBD5E1;margin-top:16px}
.cards{padding:15mm;page-break-before:always}
.page-title{font-size:11px;font-weight:700;color:#64748B;
  margin-bottom:8mm;text-align:center;letter-spacing:1px}
.row{display:flex;flex-direction:row;align-items:flex-start;
  gap:8mm;margin-bottom:8mm;page-break-inside:avoid}
.col{display:flex;flex-direction:column;align-items:center;gap:1.5mm}
.label{font-size:7px;color:#94A3B8;text-align:center}
.front{width:85.6mm;height:54mm;border-radius:4mm;overflow:hidden;
  display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.front-header{height:13mm;display:flex;align-items:center;
  justify-content:flex-end;padding:0 4mm}
.front-center-name{font-size:9px;font-weight:800;letter-spacing:.5px}
.front-body{flex:1;background:#fff;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:1.5mm;padding:2mm}
.qr{width:23mm;height:23mm;object-fit:contain}
.student-name{font-size:9px;font-weight:700;text-align:center}
.student-num{font-size:7px;color:#64748B;font-family:monospace;
  text-align:center}
.acad-year{font-size:6px;color:#94A3B8;text-align:center}
.back{width:85.6mm;height:54mm;border-radius:4mm;overflow:hidden;
  border:1px solid #E2E8F0;background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;
  flex-direction:column;align-items:center;justify-content:center;
  gap:2mm;padding:4mm}
.circle{width:12mm;height:12mm;border-radius:50%;display:flex;
  align-items:center;justify-content:center}
.initial{font-size:18px;font-weight:900;color:#fff}
.back-name{font-size:10px;font-weight:700;text-align:center}
.back-phone{font-size:9px;color:#0D9488;font-family:monospace;
  text-align:center}
.powered{font-size:6px;color:#CBD5E1;text-align:center;margin-top:1mm}
</style>
</head>
<body>

<div class="cover">
  <div class="platform">CenterHQ Platform</div>
  <div class="title">طلب طباعة بطاقات</div>
  <div class="ref-num">${ref}</div>
  <table class="info-table">
    <tr><td>عدد البطاقات</td><td>${quantity}</td></tr>
    <tr><td>تاريخ الطلب</td><td>${displayDate}</td></tr>
    <tr><td>ملاحظات</td><td>${displayNotes}</td></tr>
  </table>
  <div class="warning">⚠️ هذا المستند سري — للاستخدام الداخلي فقط</div>
  <div class="footer">Powered by CenterHQ</div>
</div>

<div class="cards">
  <div class="page-title">بطاقات الطلاب | ${ref}</div>
  ${rows}
</div>

</body>
</html>`;
}

// ── Main Export ────────────────────────────────────────────────────

const CHROMIUM_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v123.0.0/chromium-v123.0.0-pack.tar';

export async function generateOrderPdf(input: GeneratePdfInput): Promise<Buffer | null> {
  let browser: Browser | null = null;

  try {
    const html = buildCardHtml(input);
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
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return Buffer.from(pdf);
  } catch (err) {
    console.error('[generateOrderPdf] Error:', err);
    return null;
  } finally {
    if (browser !== null) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[generateOrderPdf] Close error:', e);
      }
    }
  }
}
