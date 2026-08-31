import { db } from './schema';
import { blobToBase64, base64ToBlob } from '../lib/media';

interface BackupFile {
  app: 'trainer-notes';
  version: 1 | 2 | 3;
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

export async function exportBackup(includeMedia = true): Promise<Blob> {
  const [trainers, courses, trainees, categories, notes, attachments, importLogs, settings, academicYears] = await Promise.all([
    db.trainers.toArray(), db.courses.toArray(), db.trainees.toArray(),
    db.categories.toArray(), db.notes.toArray(), db.attachments.toArray(),
    db.importLogs.toArray(), db.settings.toArray(), db.academicYears.toArray()
  ]);
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
    app: 'trainer-notes', version: 3, exportedAt: Date.now(),
    data: { trainers, courses, trainees, categories, notes, attachments: atts, importLogs, settings, academicYears }
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function importBackup(file: File): Promise<{ mode: 'replace'; restoredCategories: number }> {
  const text = await file.text();
  const parsed = JSON.parse(text) as BackupFile;
  if (parsed.app !== 'trainer-notes' || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)) {
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

  await db.transaction('rw', [db.trainers, db.courses, db.trainees, db.categories, db.academicYears, db.notes, db.attachments, db.importLogs, db.settings], async () => {
    await Promise.all([
      db.trainers.clear(), db.courses.clear(), db.trainees.clear(),
      db.categories.clear(), db.academicYears.clear(), db.notes.clear(), db.attachments.clear(), db.importLogs.clear(), db.settings.clear()
    ]);
    await db.trainers.bulkAdd(trainers as never[]);
    await db.courses.bulkAdd(courses as never[]);
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
