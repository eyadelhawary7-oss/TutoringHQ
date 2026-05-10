import ExcelJS from 'exceljs';

export interface ParsedData {
  headers: string[];
  rows: Record<string, string | number>[];
}

export function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

/** Minimal RFC4180-style CSV parser (UTF-8), newline-normalized. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const s = stripBom(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function headersRowsFromMatrix(rawData: (string | number)[][]): ParsedData {
  if (rawData.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerRow = rawData[0].map((v) => (v != null ? String(v).trim() : ''));
  const maxCols = Math.max(...rawData.map((r) => r.length), headerRow.length);
  const headers = Array.from({ length: maxCols }, (_, i) => {
    const v = headerRow[i];
    const t = v != null ? String(v).trim() : '';
    return t || `Column ${i + 1}`;
  });

  const rows: Record<string, string | number>[] = [];
  for (let r = 1; r < rawData.length; r++) {
    const line = rawData[r] as (string | number)[];
    const obj: Record<string, string | number> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const val = line[c];
      obj[key] = val != null ? val : '';
    }
    rows.push(obj);
  }

  return { headers, rows };
}

function parseCsvBuffer(buffer: ArrayBuffer): ParsedData {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const rows = parseCsvText(text).map((r) => r.map((c) => (c === '' ? '' : c)));
  while (
    rows.length > 0 &&
    rows[rows.length - 1].every((c) => String(c).trim() === '')
  ) {
    rows.pop();
  }
  return headersRowsFromMatrix(rows as (string | number)[][]);
}

function excelCellToPrimitive(cell: ExcelJS.Cell): string | number {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as ExcelJS.CellFormulaValue & ExcelJS.CellRichTextValue & { richText?: { text: string }[] };
    if ('result' in o && o.result !== undefined && o.result !== null) {
      const r = o.result;
      return typeof r === 'number' ? r : String(r);
    }
    if (Array.isArray(o.richText)) {
      return o.richText.map((t) => t.text).join('');
    }
  }
  return String(v);
}

function worksheetToMatrix(ws: ExcelJS.Worksheet): (string | number)[][] {
  const dims = ws.dimensions;
  const matrix: (string | number)[][] = [];

  if (dims) {
    for (let r = dims.top; r <= dims.bottom; r++) {
      const row = ws.getRow(r);
      const arr: (string | number)[] = [];
      for (let c = dims.left; c <= dims.right; c++) {
        arr.push(excelCellToPrimitive(row.getCell(c)));
      }
      matrix.push(arr);
    }
    return matrix;
  }

  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as unknown[];
    if (!Array.isArray(vals) || vals.length <= 1) return;
    const slice = vals.slice(1).map((cell) => {
      if (cell === null || cell === undefined) return '';
      if (typeof cell === 'number' || typeof cell === 'string') return cell;
      if (typeof cell === 'object' && 'text' in (cell as object)) return String((cell as { text: string }).text);
      return String(cell);
    }) as (string | number)[];
    matrix.push(slice);
  });

  return matrix;
}

/**
 * Parse uploaded `.csv` (UTF-8) or `.xlsx` (first worksheet).
 * Legacy `.xls` binary workbooks are not supported — re-save as `.xlsx` or use CSV.
 */
export async function parseFile(file: ArrayBuffer, fileName: string): Promise<ParsedData> {
  const ext = fileName.toLowerCase().split('.').pop() || '';

  if (ext === 'csv') {
    return parseCsvBuffer(file);
  }

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file);
    const sheet = wb.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };
    const matrix = worksheetToMatrix(sheet);
    return headersRowsFromMatrix(matrix);
  } catch (err) {
    if (ext === 'xls') {
      throw new Error(
        'ملفات .xls القديمة غير مدعومة. احفظ الملف كـ .xlsx أو استخدم .csv — Legacy .xls is not supported; save as .xlsx or CSV.',
      );
    }
    throw err;
  }
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

    if (!mapping.parentPhone && parentPatterns.some((p) => lower.includes(p))) {
      mapping.parentPhone = header;
    } else if (!mapping.notes && notesPatterns.some((p) => lower.includes(p))) {
      mapping.notes = header;
    } else if (!mapping.phone && phonePatterns.some((p) => lower.includes(p))) {
      mapping.phone = header;
    } else if (!mapping.studentName && namePatterns.some((p) => lower.includes(p))) {
      mapping.studentName = header;
    } else if (!mapping.subject && subjectPatterns.some((p) => lower.includes(p))) {
      mapping.subject = header;
    } else if (!mapping.group && groupPatterns.some((p) => lower.includes(p))) {
      mapping.group = header;
    } else if (!mapping.monthlyFee && feePatterns.some((p) => lower.includes(p))) {
      mapping.monthlyFee = header;
    }
  }

  return mapping;
}
