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

  // Use header: 1 to get raw arrays - FIRST ROW is always headers
  const rawData = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: '',
  }) as (string | number)[][];

  if (rawData.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerRow = rawData[0];
  const maxCols = Math.max(...rawData.map((r) => r.length), headerRow.length);
  const headers = Array.from({ length: maxCols }, (_, i) => {
    const v = headerRow[i];
    const s = v != null ? String(v).trim() : '';
    return s || `Column ${i + 1}`;
  });

  const rows: Record<string, string | number>[] = [];
  for (let r = 1; r < rawData.length; r++) {
    const row = rawData[r] as (string | number)[];
    const obj: Record<string, string | number> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const val = row[c];
      obj[key] = val != null ? val : '';
    }
    rows.push(obj);
  }

  return { headers, rows };
}

export interface ColumnMapping {
  studentName: string | null;
  phone: string | null;
  parentPhone: string | null;
  notes: string | null;
  subject: string | null;
  group: string | null;
  monthlyFee: string | null;
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    studentName: null,
    phone: null,
    parentPhone: null,
    notes: null,
    subject: null,
    group: null,
    monthlyFee: null,
  };

  const namePatterns = ['name', 'اسم', 'الاسم', 'اسم الطالب', 'student', 'الطالب', 'الاسم_الكامل'];
  const phonePatterns = ['phone', 'هاتف', 'الهاتف', 'رقم', 'موبايل', 'تليفون', 'mobile', 'رقم الطالب', 'رقم الهاتف'];
  const parentPatterns = ['parent', 'ولي', 'ولي الأمر', 'رقم ولي', 'parent phone', 'رقم ولي الأمر'];
  const notesPatterns = ['notes', 'ملاحظات', 'note', 'تعليق', 'comment'];
  const subjectPatterns = ['subject', 'مادة', 'المادة', 'الماده', 'course'];
  const groupPatterns = ['group', 'مجموعة', 'المجموعة', 'شعبة'];
  const feePatterns = ['fee', 'اشتراك', 'رسوم', 'مبلغ', 'monthly', 'الاشتراك', 'المبلغ'];

  for (const header of headers) {
    const lower = header.toLowerCase().trim();

    if (!mapping.parentPhone && parentPatterns.some(p => lower.includes(p))) {
      mapping.parentPhone = header;
    } else if (!mapping.notes && notesPatterns.some(p => lower.includes(p))) {
      mapping.notes = header;
    } else if (!mapping.phone && phonePatterns.some(p => lower.includes(p))) {
      mapping.phone = header;
    } else if (!mapping.studentName && namePatterns.some(p => lower.includes(p))) {
      mapping.studentName = header;
    } else if (!mapping.subject && subjectPatterns.some(p => lower.includes(p))) {
      mapping.subject = header;
    } else if (!mapping.group && groupPatterns.some(p => lower.includes(p))) {
      mapping.group = header;
    } else if (!mapping.monthlyFee && feePatterns.some(p => lower.includes(p))) {
      mapping.monthlyFee = header;
    }
  }

  return mapping;
}
