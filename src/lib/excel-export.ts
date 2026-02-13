import * as XLSX from 'xlsx';

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
  orange: 'أورانج',
  fawry: 'فوري',
  bank_transfer: 'تحويل بنكي',
};

export function exportToExcel(students: StudentExport[], filename?: string) {
  const worksheet = XLSX.utils.json_to_sheet(
    students.map(s => ({
      'اسم الطالب': s.name,
      'المادة': s.subject || '',
      'الحالة': s.payment_status === 'paid' ? 'مسدد' : 'غير مسدد',
      'تاريخ آخر دفعة': s.last_paid_date ? new Date(s.last_paid_date).toLocaleDateString('ar-EG') : '',
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
      'وقت المسح': a.scanned_at ? new Date(a.scanned_at).toLocaleString('ar-EG') : '',
      'الحالة وقت المسح': a.payment_status_at_scan || '',
    }))
  );
  XLSX.utils.book_append_sheet(workbook, attendanceSheet, 'Attendance');

  const paymentsSheet = XLSX.utils.json_to_sheet(
    data.payments.map(p => ({
      'اسم الطالب': p.student_name,
      'المبلغ': p.amount,
      'طريقة الدفع': METHOD_LABELS[p.method] || p.method,
      'تاريخ الدفع': p.paid_at ? new Date(p.paid_at).toLocaleString('ar-EG') : '',
      'سجّل بواسطة': p.recorded_by || '',
    }))
  );
  XLSX.utils.book_append_sheet(workbook, paymentsSheet, 'Payments');

  XLSX.writeFile(workbook, filename);
}
