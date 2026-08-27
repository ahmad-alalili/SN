import { db } from './schema';
import { blobToBase64, base64ToBlob } from '../lib/media';

interface BackupFile {
  app: 'trainer-notes';
  version: 1;
  exportedAt: number;
  data: {
    trainers: unknown[];
    courses: unknown[];
    trainees: unknown[];
    categories: unknown[];
    notes: unknown[];
    attachments: (Omit<Record<string, unknown>, 'blob' | 'thumb'> & { blobB64?: string; thumbB64?: string })[];
    importLogs: unknown[];
  };
}

export async function exportBackup(includeMedia = true): Promise<Blob> {
  const [trainers, courses, trainees, categories, notes, attachments, importLogs] = await Promise.all([
    db.trainers.toArray(), db.courses.toArray(), db.trainees.toArray(),
    db.categories.toArray(), db.notes.toArray(), db.attachments.toArray(),
    db.importLogs.toArray()
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
    app: 'trainer-notes', version: 1, exportedAt: Date.now(),
    data: { trainers, courses, trainees, categories, notes, attachments: atts, importLogs }
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function importBackup(file: File): Promise<{ mode: 'replace' }> {
  const text = await file.text();
  const parsed = JSON.parse(text) as BackupFile;
  if (parsed.app !== 'tracker-notes-app'.replace('tracker-notes-app', 'trainer-notes') || parsed.version !== 1) {
    throw new Error('الملف ليس نسخة احتياطية صالحة من هذا التطبيق');
  }
  const d = parsed.data;
  await db.transaction('rw', [db.trainers, db.courses, db.trainees, db.categories, db.notes, db.attachments, db.importLogs], async () => {
    await Promise.all([
      db.trainers.clear(), db.courses.clear(), db.trainees.clear(),
      db.categories.clear(), db.notes.clear(), db.attachments.clear(), db.importLogs.clear()
    ]);
    await db.trainers.bulkAdd(d.trainers as never[]);
    await db.courses.bulkAdd(d.courses as never[]);
    await db.trainees.bulkAdd(d.trainees as never[]);
    await db.categories.bulkAdd(d.categories as never[]);
    await db.notes.bulkAdd(d.notes as never[]);
    for (const a of d.attachments) {
      const { blobB64, thumbB64, ...rest } = a as Record<string, unknown>;
      await db.attachments.add({
        ...(rest as object),
        blob: blobB64 ? base64ToBlob(blobB64 as string, String(rest.mime || 'application/octet-stream')) : new Blob([]),
        thumb: thumbB64 ? base64ToBlob(thumbB64 as string, String(rest.mime || 'image/jpeg')) : undefined
      } as never);
    }
    if (d.importLogs?.length) await db.importLogs.bulkAdd(d.importLogs as never[]);
  });
  return { mode: 'replace' };
}

/** تقدير حجم التخزين المستخدم */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
