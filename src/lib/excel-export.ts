import * as XLSX from 'xlsx';

interface StudentExport {
  name: string;
  subject_name: string;
  payment_status: string;
  last_paid_date: string | null;
  monthly_fee: number;
  payment_method?: string;
}

export function exportToExcel(students: StudentExport[], filename?: string) {
  const worksheet = XLSX.utils.json_to_sheet(
    students.map(s => ({
      'اسم الطالب': s.name,
      'المادة': s.subject_name || '',
      'الحالة': s.payment_status === 'paid' ? 'مسدد' : 'غير مسدد',
      'آخر دفعة': s.last_paid_date ? new Date(s.last_paid_date).toLocaleDateString('ar-EG') : '',
      'المبلغ': s.monthly_fee || 0,
    }))
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'المدفوعات');
  XLSX.writeFile(workbook, filename || `payments-${Date.now()}.xlsx`);
}
