import * as XLSX from 'xlsx';
// SECURITY NOTE — SheetJS (xlsx) Dependabot HIGH alerts #1 and #2
// CVE: Prototype Pollution + ReDoS in SheetJS
// ASSESSED: LOW RISK for this codebase.
// Reason: xlsx is used exclusively for WRITING/EXPORTING files (json_to_sheet, writeFile).
// It is never used to READ or PARSE user-uploaded files.
// The vulnerabilities (Prototype Pollution, ReDoS) are only exploitable via the
// input parsing path (read, readFile, XLSX.read) which is not used anywhere in this project.
// Student CSV import uses a separate parsing library, not xlsx.
// No patched version exists on npm as of May 2026.
// Resolution: Replace with exceljs after Customer 1 onboarding. Track in backlog.
// Dismissed on Dependabot: justified as not exploitable given current usage pattern.

import { formatDate, formatDateTime } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

const XLS_LOCALE = 'ar';

interface StudentExport {
  name: string;
  subject: string;
  payment_status: string;
  last_paid_date: string | null;
  fee: number;
  payment_method?: string | null;
  last_payment_method?: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'كاش',
  instapay: 'إنستاباي',
  vodafone_cash: 'فودافون كاش',
  vodacash: 'فودافون كاش',
  orange: 'أورانج',
  fawry: 'فوري',
  bank_transfer: 'تحويل بنكي',
  bank: 'تحويل بنكي',
};

export function exportToExcel(students: StudentExport[], filename?: string) {
  const worksheet = XLSX.utils.json_to_sheet(
    students.map(s => ({
      'اسم الطالب': s.name,
      'المادة': s.subject || '',
      'الحالة': s.payment_status === 'paid' ? 'مسدد' : s.payment_status === 'pending' ? 'معلق' : 'غير مسدد',
      'تاريخ آخر دفعة': s.last_paid_date ? formatDate(s.last_paid_date, XLS_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      'المبلغ': s.fee || 0,
      'طريقة الدفع': s.last_payment_method ? (METHOD_LABELS[s.last_payment_method] || s.last_payment_method) : '',
    }))
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'المدفوعات');
  XLSX.writeFile(workbook, filename || `CenterHQ_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export interface DashboardExportData {
  students: { id: string; name: string; phone?: string; parent_phone?: string; subject?: string; payment_status: string; qr_code?: string }[];
  attendance: { student_name: string; scanned_at: string; payment_status_at_scan?: string }[];
  payments: { student_name: string; amount: number; method: string; paid_at: string; recorded_by?: string }[];
}

export function exportDashboardToExcel(data: DashboardExportData) {
  const filename = `CenterHQ_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const workbook = XLSX.utils.book_new();

  const studentsSheet = XLSX.utils.json_to_sheet(
    data.students.map(s => ({
      id: s.id,
      'اسم الطالب': s.name,
      'الهاتف': s.phone || '',
      'هاتف ولي الأمر': s.parent_phone || '',
      'المادة': s.subject || '',
      'الحالة': s.payment_status === 'paid' ? 'مسدد' : 'غير مسدد',
      'رمز QR': s.qr_code || '',
    }))
  );
  XLSX.utils.book_append_sheet(workbook, studentsSheet, 'Students');

  const attendanceSheet = XLSX.utils.json_to_sheet(
    data.attendance.map(a => ({
      'اسم الطالب': a.student_name,
      'وقت المسح': a.scanned_at ? formatDateTime(a.scanned_at, XLS_LOCALE) : '',
      'الحالة وقت المسح': a.payment_status_at_scan || '',
    }))
  );
  XLSX.utils.book_append_sheet(workbook, attendanceSheet, 'Attendance');

  const paymentsSheet = XLSX.utils.json_to_sheet(
    data.payments.map(p => ({
      'اسم الطالب': p.student_name,
      'المبلغ': p.amount,
      'طريقة الدفع': METHOD_LABELS[p.method] || p.method,
      'تاريخ الدفع': p.paid_at ? formatDateTime(p.paid_at, XLS_LOCALE) : '',
      'سجّل بواسطة': p.recorded_by || '',
    }))
  );
  XLSX.utils.book_append_sheet(workbook, paymentsSheet, 'Payments');

  XLSX.writeFile(workbook, filename);
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

export function exportPaymentsToExcel(records: PaymentExportRecord[], filename?: string) {
  const worksheet = XLSX.utils.json_to_sheet(
    records.map(r => ({
      'التاريخ': r.paid_at ? formatDate(r.paid_at, XLS_LOCALE) : '',
      'اسم الطالب': r.student_name || '',
      'رقم الطالب': r.student_number ? formatStudentNumberForDisplay(r.student_number) : '',
      'المجموعة': r.group_name || '',
      'المبلغ': r.amount,
      'طريقة الدفع': METHOD_LABELS[r.method] || r.method,
      'الحالة': r.confirmed !== false && r.status === 'confirmed' ? 'مسدد' : 'معلق',
    }))
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'المدفوعات');
  XLSX.writeFile(workbook, filename || `CenterHQ_Payments_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
