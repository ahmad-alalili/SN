import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseRosterFile } from '../src/lib/importParser';

/** بناء ملف اختبار بنفس بنية تصدير النظام الفعلي */
function buildSystemXls(): ArrayBuffer {
  const rows: (string | number)[][] = [
    ['معلومات المقرر', '', '', '', '', '', '', ''],
    ['اسم المقرر', 'عناصر إلكترونية - الكت 121 0', '', '', '', '', '', ''],
    ['الفصل الدراسي', 'الفصل التدريبي الأول 1448 - 144710', '', '', '', '', '', ''],
    ['الرقم المرجعي للمقرر', '68109', '', '', '', '', '', ''],
    ['الحالة', 'فعال'],
    [''],
    ['قائمة المسجلون (ملخص)'],
    ['اسم الطالب', 'الرقم الجامعي', 'حالة التسجيل', 'المرحلة', 'ساعات معتمدة', 'منتصف الفصل الدراسي', 'النهائي', 'المستوى'],
    ['بسام علي يحي الخالدي', '446232199', 'مقرر مسجل عن طريق مدير النظام', 'دبلوم', 0, 'لا يمكن الوصول', 'لا يمكن الوصول', 'مستوى ثاني'],
    ['جابر علي جابر المالكي', '446232133', 'مقرر مسجل عن طريق مدير النظام', 'دبلوم', 0, 'لا يمكن الوصول', 'لا يمكن الوصول', 'مستوى أول'],
    ['جواد جبران جابر المالكي', '446225548', 'مقرر مسجل عن طريق مدير النظام', 'دبلوم', 0, 'لا يمكن الوصول', 'لا يمكن الوصول', 'مستوى ثاني']
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ملخص قائمة المسجلين');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return out as unknown as ArrayBuffer;
}

describe('محلل الاستيراد الذكي', () => {
  it('يتعرف على تنسيق نظام الكلية ويستخرج المقرر والمتدربين', () => {
    const r = parseRosterFile(buildSystemXls(), 'test.xlsx');
    expect(r.detectedFormat).toBe('system');
    expect(r.course?.name).toBe('عناصر إلكترونية - الكت 121 0');
    expect(r.course?.refCode).toBe('68109');
    expect(r.course?.semester).toContain('1448');
    expect(r.trainees.length).toBe(3);
    expect(r.trainees[0]).toMatchObject({ name: 'بسام علي يحي الخالدي', traineeNo: '446232199', level: 'مستوى ثاني' });
  });

  it('يتعامل مع ملف فارغ بدون رؤوس معروفة', () => {
    const ws = XLSX.utils.aoa_to_sheet([['عمود'], ['بيانات']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 's');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as unknown as ArrayBuffer;
    const r = parseRosterFile(buf, 'x.xlsx');
    expect(r.detectedFormat).toBe('generic');
    expect(r.trainees).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
