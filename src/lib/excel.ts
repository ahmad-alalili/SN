import * as XLSX from 'xlsx';
import { db } from '../db/schema';
import type { Note } from '../db/schema';

export async function exportNotesToExcel(
  notes: Note[],
  maps: {
    traineeById: Map<number, { name: string; traineeNo: string; level?: string }>;
    courseById: Map<number, { name: string; refCode: string }>;
    catById: Map<number, { name: string; parentId: number | null }>;
  },
  toast: (msg: string, kind?: 'ok' | 'err') => void
) {
  const atts = await db.attachments.toArray();
  const countByNote = new Map<number, number>();
  for (const a of atts) countByNote.set(a.noteId, (countByNote.get(a.noteId) ?? 0) + 1);

  const rows = notes.map((n, i) => {
    const names = (n.traineeIds ?? [])
      .map(id => maps.traineeById.get(id)?.name ?? '')
      .filter(Boolean).join('، ');
    const nos = (n.traineeIds ?? [])
      .map(id => maps.traineeById.get(id)?.traineeNo ?? '')
      .filter(Boolean).join('، ');
    const levels = [...new Set((n.traineeIds ?? [])
      .map(id => maps.traineeById.get(id)?.level ?? '')
      .filter(Boolean))].join('، ');
    const co = maps.courseById.get(n.courseId);
    const main = maps.catById.get(n.categoryId);
    const sub = n.subcategoryId ? maps.catById.get(n.subcategoryId) : null;
    return {
      '#': i + 1,
      'اسم المتدرب': names || '—',
      'الرقم التدريبي': nos || '—',
      'المستوى': levels,
      'اسم المقرر': co?.name ?? '',
      'الرقم المرجعي': co?.refCode ?? '',
      'التصنيف الرئيسي': main?.name ?? '',
      'التصنيف الفرعي': sub?.name ?? '',
      'نص الملاحظة': n.text,
      'عدد المرفقات': countByNote.get(n.id!) ?? 0,
      'التاريخ': new Date(n.createdAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 5 }, { wch: 25 }, { wch: 13 }, { wch: 12 }, { wch: 28 },
    { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 50 }, { wch: 10 }, { wch: 20 }
  ];
  // اتجاه الورقة من اليمين لليسار
  (ws as unknown as { '!dir'?: string })['!dir'] = 'rtl';

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الملاحظات');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const stamp = new Date().toISOString().slice(0, 10);
  saveAs(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `ملاحظات-${stamp}.xlsx`);
  toast(`تم تصدير ${rows.length} ملاحظة إلى Excel`);
}

export function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
