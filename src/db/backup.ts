import { db } from './schema';
import { blobToBase64, base64ToBlob } from '../lib/media';

interface BackupFile {
  app: 'trainer-notes';
  version: 1 | 2 | 3 | 4;
  exportedAt: number;
  data: {
    trainers: unknown[];
    courses: unknown[];
    trainees: unknown[];
    categories: unknown[];
    notes: unknown[];
    attachments: (Omit<Record<string, unknown>, 'blob' | 'thumb'> & { blobB64?: string; thumbB64?: string })[];
    importLogs: unknown[];
    settings?: unknown[];
    academicYears?: unknown[];
    studyTerms?: unknown[];
  };
}

type StoredRecord = Record<string, unknown>;

function timestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function records(value: unknown, name: string): StoredRecord[] {
  if (!Array.isArray(value)) throw new Error(`حقل «${name}» غير صالح في النسخة الاحتياطية`);
  return value.filter((item): item is StoredRecord => !!item && typeof item === 'object');
}

function normalizeRecords(value: unknown, name: string, fallback: number, includeUpdatedAt = false): StoredRecord[] {
  return records(value, name).map(item => {
    const createdAt = timestamp(item.createdAt, fallback);
    return includeUpdatedAt
      ? { ...item, createdAt, updatedAt: timestamp(item.updatedAt, createdAt) }
      : { ...item, createdAt };
  });
}

export async function exportBackup(includeMedia = true, trainerId?: number): Promise<Blob> {
  const [trainers, courses, trainees, categories, notes, importLogs, settings, academicYears, studyTerms] = await Promise.all([
    trainerId === undefined ? db.trainers.toArray() : db.trainers.where('id').equals(trainerId).toArray(),
    trainerId === undefined ? db.courses.toArray() : db.courses.where('trainerId').equals(trainerId).toArray(),
    trainerId === undefined ? db.trainees.toArray() : db.trainees.where('trainerId').equals(trainerId).toArray(),
    trainerId === undefined ? db.categories.toArray() : db.categories.where('trainerId').equals(trainerId).toArray(),
    trainerId === undefined ? db.notes.toArray() : db.notes.where('trainerId').equals(trainerId).toArray(),
    trainerId === undefined ? db.importLogs.toArray() : db.importLogs.where('trainerId').equals(trainerId).toArray(),
    trainerId === undefined ? db.settings.toArray() : db.settings.where('trainerId').equals(trainerId).toArray(),
    trainerId === undefined ? db.academicYears.toArray() : db.academicYears.where('trainerId').equals(trainerId).toArray(),
    trainerId === undefined ? db.studyTerms.toArray() : db.studyTerms.where('trainerId').equals(trainerId).toArray()
  ]);
  const noteIds = new Set(notes.map(note => note.id).filter((id): id is number => typeof id === 'number'));
  const attachments = trainerId === undefined
    ? await db.attachments.toArray()
    : (await db.attachments.toArray()).filter(attachment => noteIds.has(attachment.noteId));
  const atts = includeMedia
    ? await Promise.all(attachments.map(async a => ({
        ...a,
        blob: undefined,
        thumb: undefined,
        blobB64: a.blob ? await blobToBase64(a.blob) : undefined,
        thumbB64: a.thumb ? await blobToBase64(a.thumb) : undefined
      })))
    : attachments.map(a => ({ ...a, blob: undefined, thumb: undefined }));
  const backup: BackupFile = {
    app: 'trainer-notes', version: 4, exportedAt: Date.now(),
    data: { trainers, courses, trainees, categories, notes, attachments: atts, importLogs, settings, academicYears, studyTerms }
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function importBackup(file: File): Promise<{ mode: 'replace'; restoredCategories: number }> {
  const text = await file.text();
  const parsed = JSON.parse(text) as BackupFile;
  if (parsed.app !== 'trainer-notes' || ![1, 2, 3, 4].includes(parsed.version)) {
    throw new Error('الملف ليس نسخة احتياطية صالحة من هذا التطبيق');
  }
  const fallback = timestamp(parsed.exportedAt, Date.now());
  const d = parsed.data;
  const trainers = normalizeRecords(d.trainers, 'المدربون', fallback);
  const courses = normalizeRecords(d.courses, 'المقررات', fallback);
  const trainees = normalizeRecords(d.trainees, 'المتدربون', fallback, true);
  const categories = normalizeRecords(d.categories, 'التصنيفات', fallback);
  const notes: StoredRecord[] = normalizeRecords(d.notes, 'الملاحظات', fallback, true).map(note => ({
    ...note,
    noteAt: timestamp(note.noteAt, timestamp(note.createdAt, fallback))
  }));
  const attachments = records(d.attachments, 'المرفقات').map(item => ({
    ...item,
    createdAt: timestamp(item.createdAt, fallback)
  }));
  const importLogs = records(d.importLogs, 'سجل الاستيراد');
  const settings = d.settings ? records(d.settings, 'الإعدادات') : [];
  const academicYears = d.academicYears ? normalizeRecords(d.academicYears, 'الأعوام الدراسية', fallback, true) : [];
  const studyTerms = d.studyTerms ? normalizeRecords(d.studyTerms, 'الفصول الدراسية', fallback, true) : [];

  // النسخ القديمة خزنت اسم الفصل داخل المقرر فقط. نحوله إلى كيان مستقل عند الاستعادة.
  let nextTermId = studyTerms.reduce((max, term) => typeof term.id === 'number' ? Math.max(max, term.id) : max, 0);
  for (const course of courses) {
    if (typeof course.termId === 'number') continue;
    const semester = typeof course.semester === 'string' ? course.semester.trim() : '';
    if (!semester || typeof course.trainerId !== 'number') continue;
    let term = studyTerms.find(item => item.trainerId === course.trainerId && item.name === semester);
    if (!term) {
      term = {
        id: ++nextTermId,
        trainerId: course.trainerId,
        name: semester,
        createdAt: timestamp(course.createdAt, fallback),
        updatedAt: fallback
      };
      studyTerms.push(term);
    }
    course.termId = term.id;
  }

  // النسخ الكاملة تتضمن التصنيفات. في نسخة تالفة/قديمة ننشئ تصنيفاً بديلاً
  // بدلاً من ترك الملاحظات مرتبطة بمعرّفات مفقودة.
  const categoryIds = new Set(categories.map(c => c.id).filter((id): id is number => typeof id === 'number'));
  let restoredCategories = 0;
  for (const note of notes) {
    for (const id of [note.categoryId, note.subcategoryId]) {
      if (typeof id !== 'number' || id <= 0 || categoryIds.has(id)) continue;
      categories.push({
        id,
        trainerId: typeof note.trainerId === 'number' ? note.trainerId : 0,
        parentId: null,
        name: `تصنيف مستعاد #${id}`,
        createdAt: timestamp(note.createdAt, fallback)
      });
      categoryIds.add(id);
      restoredCategories++;
    }
  }

  await db.transaction('rw', [db.trainers, db.courses, db.studyTerms, db.trainees, db.categories, db.academicYears, db.notes, db.attachments, db.importLogs, db.settings, db.portableFiles], async () => {
    await Promise.all([
      db.trainers.clear(), db.courses.clear(), db.trainees.clear(),
      db.categories.clear(), db.academicYears.clear(), db.studyTerms.clear(), db.notes.clear(), db.attachments.clear(), db.importLogs.clear(), db.settings.clear(), db.portableFiles.clear()
    ]);
    await db.trainers.bulkAdd(trainers as never[]);
    await db.courses.bulkAdd(courses as never[]);
    if (studyTerms.length) await db.studyTerms.bulkAdd(studyTerms as never[]);
    await db.trainees.bulkAdd(trainees as never[]);
    await db.categories.bulkAdd(categories as never[]);
    if (academicYears.length) await db.academicYears.bulkAdd(academicYears as never[]);
    await db.notes.bulkAdd(notes as never[]);
    for (const a of attachments) {
      const { blobB64, thumbB64, ...rest } = a as Record<string, unknown>;
      await db.attachments.add({
        ...(rest as object),
        blob: blobB64 ? base64ToBlob(blobB64 as string, String(rest.mime || 'application/octet-stream')) : new Blob([]),
        thumb: thumbB64 ? base64ToBlob(thumbB64 as string, String(rest.mime || 'image/jpeg')) : undefined
      } as never);
    }
    if (importLogs.length) await db.importLogs.bulkAdd(importLogs as never[]);
    if (settings.length) await db.settings.bulkAdd(settings as never[]);
  });
  return { mode: 'replace', restoredCategories };
}

/** تقدير حجم التخزين المستخدم */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
