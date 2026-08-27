import * as XLSX from 'xlsx';

export interface ParsedRoster {
  detectedFormat: 'system' | 'generic';
  course?: { name: string; refCode?: string; semester?: string; status?: string };
  trainees: { name: string; traineeNo: string; level?: string }[];
  warnings: string[];
}

const HEADER_TRAINEE_NAME = /اسم\s*الطالب|اسم\s*المتدرب/;
const HEADER_ID = /الرقم\s*(الجامعي|التدريبي)/;

function cellStr(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/**
 * يتعرف على تنسيق "ملخص قائمة المسجلين" من نظام الكلية:
 * كتلة معلومات مقرر أعلى الملف (اسم المقرر/الرقم المرجعي/الفصل الدراسي)
 * ثم صف رؤوس (اسم الطالب | الرقم الجامعي | ...) وصفوف الطلاب بعده.
 */
export function parseRosterFile(buf: ArrayBuffer, filename: string): ParsedRoster {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
  const warnings: string[] = [];

  // 1) إيجاد صف الرؤوس
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const line = rows[i].map(cellStr);
    if (line.some(c => HEADER_TRAINEE_NAME.test(c)) && line.some(c => HEADER_ID.test(c))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    warnings.push('لم يتم التعرف على صف الأعمدة تلقائياً — تأكد أن الملف يحوي عمودي «اسم الطالب» و«الرقم الجامعي».');
    return { detectedFormat: 'generic', trainees: [], warnings };
  }

  // 2) استخراج معلومات المقرر من الصفوف السابقة
  const course: ParsedRoster['course'] = { name: '' };
  for (let i = 0; i < headerIdx; i++) {
    const line = rows[i].map(cellStr);
    for (let c = 0; c < line.length - 1; c++) {
      const label = line[c];
      const value = line[c + 1];
      if (!label || !value) continue;
      if (/^اسم\s*المقرر$/.test(label)) course.name = value;
      else if (/الرقم\s*المرجعي/.test(label)) course.refCode = value;
      else if (/الفصل/.test(label)) course.semester = value;
      else if (/^الحالة$/.test(label)) course.status = value;
    }
  }

  // 3) فهرسة الأعمدة
  const head = rows[headerIdx].map(cellStr);
  const colName = head.findIndex(c => HEADER_TRAINEE_NAME.test(c));
  const colId = head.findIndex(c => HEADER_ID.test(c));
  const colLevel = head.findIndex(c => /المستوى/.test(c));

  // 4) قراءة الطلاب
  const seen = new Set<string>();
  const trainees: ParsedRoster['trainees'] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const name = cellStr(rows[i][colName]);
    const no = cellStr(rows[i][colId]).replace(/\.0$/, '');
    if (!name && !no) continue;
    if (!name || !no) {
      warnings.push(`صف ${i + 1}: بيانات ناقصة — تم تجاهله.`);
      continue;
    }
    const key = `${name}|${no}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trainees.push({
      name,
      traineeNo: /^\d+$/.test(no) ? no : no,
      level: colLevel >= 0 ? cellStr(rows[i][colLevel]) || undefined : undefined
    });
  }

  if (!trainees.length) warnings.push('لم يتم العثور على متدربين في الجدول.');
  if (!course.name) warnings.push('لم يُعثر على اسم المقرر في رأس الملف.');
  void filename;
  return { detectedFormat: 'system', course, trainees, warnings };
}
