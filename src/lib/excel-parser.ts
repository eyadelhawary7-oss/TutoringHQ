import * as XLSX from 'xlsx';

export interface ParsedData {
  headers: string[];
  rows: Record<string, string | number>[];
}

export function parseFile(file: ArrayBuffer, fileName: string): ParsedData {
  const workbook = XLSX.read(file, {
    type: 'array',
    codepage: 65001, // UTF-8 for Arabic support
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const jsonData = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, {
    defval: '',
  });

  if (jsonData.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = Object.keys(jsonData[0]);
  return { headers, rows: jsonData };
}

export interface ColumnMapping {
  studentName: string | null;
  phone: string | null;
  parentPhone: string | null;
  subject: string | null;
  monthlyFee: string | null;
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    studentName: null,
    phone: null,
    parentPhone: null,
    subject: null,
    monthlyFee: null,
  };

  const namePatterns = ['name', 'اسم', 'الاسم', 'اسم الطالب', 'student', 'الطالب'];
  const phonePatterns = ['phone', 'هاتف', 'رقم', 'موبايل', 'تليفون', 'mobile', 'رقم الطالب'];
  const parentPatterns = ['parent', 'ولي', 'ولي الأمر', 'رقم ولي', 'parent phone', 'رقم ولي الأمر'];
  const subjectPatterns = ['subject', 'مادة', 'المادة', 'الماده', 'course'];
  const feePatterns = ['fee', 'اشتراك', 'رسوم', 'مبلغ', 'monthly', 'الاشتراك', 'المبلغ'];

  for (const header of headers) {
    const lower = header.toLowerCase().trim();

    if (!mapping.parentPhone && parentPatterns.some(p => lower.includes(p))) {
      mapping.parentPhone = header;
    } else if (!mapping.phone && phonePatterns.some(p => lower.includes(p))) {
      mapping.phone = header;
    } else if (!mapping.studentName && namePatterns.some(p => lower.includes(p))) {
      mapping.studentName = header;
    } else if (!mapping.subject && subjectPatterns.some(p => lower.includes(p))) {
      mapping.subject = header;
    } else if (!mapping.monthlyFee && feePatterns.some(p => lower.includes(p))) {
      mapping.monthlyFee = header;
    }
  }

  return mapping;
}
