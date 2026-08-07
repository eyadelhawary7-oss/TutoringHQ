import ExcelJS from 'exceljs';

import { formatDate, formatDateTime } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

const XLS_LOCALE = 'ar';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9D9D9' },
};

function triggerBrowserDownload(buffer: ExcelJS.Buffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function applyRtlSheet(ws: ExcelJS.Worksheet): void {
  ws.views = [{ rightToLeft: true }];
}

function styleHeaderRow(ws: ExcelJS.Worksheet, rowNumber: number, headers: string[]): void {
  const row = ws.getRow(rowNumber);
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.min(48, Math.max(12, h.length + 4));
  });
}

interface StudentExport {
  name: string;
  subject: string;
  payment_status: string;
  last_paid_date: string | null;
  fee: number;
  payment_method?: string | null;
  last_payment_method?: string | null;
}

// Two tuition methods only — design/NEW-MODEL.md.
const METHOD_LABELS: Record<string, string> = {
  cash: 'كاش',
  instapay: 'إنستاباي',
};

export async function exportToExcel(students: StudentExport[], filename?: string): Promise<void> {
  const rows = students.map((s) => ({
    'اسم الطالب': s.name,
    المادة: s.subject || '',
    الحالة: s.payment_status === 'paid' ? 'مسدد' : s.payment_status === 'pending' ? 'معلق' : 'غير مسدد',
    'تاريخ آخر دفعة': s.last_paid_date
      ? formatDate(s.last_paid_date, XLS_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
      : '',
    المبلغ: s.fee || 0,
    'طريقة الدفع': s.last_payment_method ? METHOD_LABELS[s.last_payment_method] || s.last_payment_method : '',
  }));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المدفوعات');
  applyRtlSheet(ws);

  const headers = Object.keys(rows[0] ?? { 'اسم الطالب': '' });
  ws.addRow(headers);
  styleHeaderRow(ws, 1, headers);
  rows.forEach((r) => ws.addRow(headers.map((h) => r[h as keyof typeof r])));

  const amountCol = headers.indexOf('المبلغ') + 1;
  if (amountCol > 0) {
    ws.getColumn(amountCol).numFmt = '#,##0';
  }

  const buf = await wb.xlsx.writeBuffer();
  triggerBrowserDownload(buf, filename || `TutoringHQ_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export interface DashboardExportData {
  students: {
    id: string;
    name: string;
    phone?: string;
    parent_phone?: string;
    subject?: string;
    /** charge - paid, from studentBalance.ts; <= 0 means no outstanding debt. */
    balance: number;
    qr_code?: string;
  }[];
  attendance: { student_name: string; scanned_at: string; payment_status_at_scan?: string }[];
  payments: { student_name: string; amount: number; method: string; paid_at: string; recorded_by?: string }[];
}

/** Exposed for unit tests (buffer validation). */
export async function buildDashboardExcelBuffer(data: DashboardExportData): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();

  const studentsRows = data.students.map((s) => ({
    id: s.id,
    'اسم الطالب': s.name,
    الهاتف: s.phone || '',
    'هاتف ولي الأمر': s.parent_phone || '',
    المادة: s.subject || '',
    الحالة: s.balance > 0 ? 'غير مسدد' : 'مسدد',
    'رمز QR': s.qr_code || '',
  }));

  const wsSt = wb.addWorksheet('Students');
  applyRtlSheet(wsSt);
  const h1 = Object.keys(
    studentsRows[0] ?? {
      id: '',
      'اسم الطالب': '',
      الهاتف: '',
      'هاتف ولي الأمر': '',
      المادة: '',
      الحالة: '',
      'رمز QR': '',
    },
  );
  wsSt.addRow(h1);
  styleHeaderRow(wsSt, 1, h1);
  studentsRows.forEach((r) => wsSt.addRow(h1.map((k) => r[k as keyof typeof r])));

  const wsAtt = wb.addWorksheet('Attendance');
  applyRtlSheet(wsAtt);
  const attRows = data.attendance.map((a) => ({
    'اسم الطالب': a.student_name,
    'وقت المسح': a.scanned_at ? formatDateTime(a.scanned_at, XLS_LOCALE) : '',
    'الحالة وقت المسح': a.payment_status_at_scan || '',
  }));
  const h2 = Object.keys(
    attRows[0] ?? { 'اسم الطالب': '', 'وقت المسح': '', 'الحالة وقت المسح': '' },
  );
  wsAtt.addRow(h2);
  styleHeaderRow(wsAtt, 1, h2);
  attRows.forEach((r) => wsAtt.addRow(h2.map((k) => r[k as keyof typeof r])));

  const wsPay = wb.addWorksheet('Payments');
  applyRtlSheet(wsPay);
  const payRows = data.payments.map((p) => ({
    'اسم الطالب': p.student_name,
    المبلغ: p.amount,
    'طريقة الدفع': METHOD_LABELS[p.method] || p.method,
    'تاريخ الدفع': p.paid_at ? formatDateTime(p.paid_at, XLS_LOCALE) : '',
    'سجّل بواسطة': p.recorded_by || '',
  }));
  const h3 = Object.keys(
    payRows[0] ?? {
      'اسم الطالب': '',
      المبلغ: '',
      'طريقة الدفع': '',
      'تاريخ الدفع': '',
      'سجّل بواسطة': '',
    },
  );
  wsPay.addRow(h3);
  styleHeaderRow(wsPay, 1, h3);
  payRows.forEach((r) => wsPay.addRow(h3.map((k) => r[k as keyof typeof r])));
  const egpCol = h3.indexOf('المبلغ') + 1;
  if (egpCol > 0) wsPay.getColumn(egpCol).numFmt = '#,##0';

  return wb.xlsx.writeBuffer();
}

export async function exportDashboardToExcel(data: DashboardExportData): Promise<void> {
  const filename = `TutoringHQ_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const buf = await buildDashboardExcelBuffer(data);
  triggerBrowserDownload(buf, filename);
}

export interface PaymentExportRecord {
  id: string;
  student_name?: string;
  student_number?: string;
  group_name?: string;
  amount: number;
  method: string;
  paid_at: string;
  status: string;
  confirmed?: boolean;
}

export async function exportPaymentsToExcel(records: PaymentExportRecord[], filename?: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المدفوعات');
  applyRtlSheet(ws);

  const rows = records.map((r) => ({
    التاريخ: r.paid_at ? formatDate(r.paid_at, XLS_LOCALE) : '',
    'اسم الطالب': r.student_name || '',
    'رقم الطالب': r.student_number ? formatStudentNumberForDisplay(r.student_number) : '',
    المجموعة: r.group_name || '',
    المبلغ: r.amount,
    'طريقة الدفع': METHOD_LABELS[r.method] || r.method,
    الحالة: r.confirmed !== false && r.status === 'confirmed' ? 'مسدد' : 'معلق',
  }));

  const headers = Object.keys(rows[0] ?? { التاريخ: '' });
  ws.addRow(headers);
  styleHeaderRow(ws, 1, headers);
  rows.forEach((r) => ws.addRow(headers.map((h) => r[h as keyof typeof r])));
  const amt = headers.indexOf('المبلغ') + 1;
  if (amt > 0) ws.getColumn(amt).numFmt = '#,##0';

  const buf = await wb.xlsx.writeBuffer();
  triggerBrowserDownload(buf, filename || `TutoringHQ_Payments_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
