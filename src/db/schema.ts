import Dexie, { type Table } from 'dexie';

export interface Trainer {
  id?: number;
  name: string;
  createdAt: number;
}

export interface Course {
  id?: number;
  trainerId: number;
  refCode: string;
  name: string;
  semester?: string;
  termId?: number | null;
  createdAt: number;
}

export interface StudyTerm {
  id?: number;
  trainerId: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Trainee {
  id?: number;
  trainerId: number;
  traineeNo: string;
  name: string;
  level?: string;
  /** الشعب المسجَّل فيها (تُملأ عند الاستيراد أو الإضافة من نموذج بمقرر محدد) */
  courseIds?: number[];
  createdAt: number;
  updatedAt: number;
}

export type Severity = '' | 'yellow' | 'orange' | 'red';

export interface Category {
  id?: number;
  trainerId: number;
  parentId: number | null; // null = رئيسي
  name: string;
  /** درجة الخطورة لأغراض حساب حالة المتدرب */
  severity?: Severity;
  createdAt: number;
}

export interface AcademicYear {
  id?: number;
  trainerId: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id?: number;
  trainerId: number;
  /** متدربون واحد أو أكثر (ملاحظة جماعية) */
  traineeIds: number[];
  courseId: number;
  categoryId: number;
  subcategoryId: number | null;
  academicYearId?: number | null;
  text: string;
  /** موعد تذكير اختياري (مهمة/نشاط/مهلة) */
  dueAt?: number;
  remind?: boolean;
  remindDone?: boolean;
  /** درجة الخطورة الخاصة بهذه الملاحظة — تتجاوز افتراضي التصنيف */
  severity?: Severity;
  /** تاريخ حدوث الملاحظة، مستقل عن سجل إنشائها */
  noteAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type AttachmentKind = 'image' | 'video' | 'audio';

/** قواعد حساب حالة المتدرب — قابلة للتخصيص من الإعدادات لكل مدرب */
export interface AppSettings {
  trainerId: number;
  /** نقاط كل درجة مخالفة */
  wYellow: number;
  wOrange: number;
  wRed: number;
  /** يبقى 🟡 حتى هذا المجموع (فوقه 🟠) */
  yellowMax: number;
  /** يبقى 🟠 حتى هذا المجموع (فوقه 🔴) */
  orangeMax: number;
}

export const DEFAULT_SETTINGS: Omit<AppSettings, 'trainerId'> = {
  wYellow: 1,
  wOrange: 2,
  wRed: 3,
  yellowMax: 2,
  orangeMax: 5
};

/** قراءة إعدادات المدرب مع القيم الافتراضية لأي حقل ناقص */
export async function loadSettings(trainerId: number): Promise<AppSettings> {
  const s = await db.settings.get(trainerId);
  return s ? { ...DEFAULT_SETTINGS, ...s } : { trainerId, ...DEFAULT_SETTINGS };
}

export interface Attachment {
  id?: number;
  noteId: number;
  kind: AttachmentKind;
  mime: string;
  name: string;
  size: number;
  blob: Blob;
  thumb?: Blob;
  createdAt: number;
}

export interface ImportLog {
  id?: number;
  trainerId: number;
  filename: string;
  rows: number;
  addedCourses: number;
  addedTrainees: number;
  skippedDuplicates: number;
  at: number;
}

export interface PortableFileLink {
  trainerId: number;
  fileName: string;
  /** FileSystemFileHandle is structured-cloneable and remains local to this browser. */
  handle?: unknown;
  /** Non-extractable device key; the password itself is never stored. */
  key?: CryptoKey;
  salt?: string;
  encrypted?: boolean;
  direct: boolean;
  dirty: boolean;
  lastChangedAt?: number;
  lastSavedAt?: number;
}

export class TrainerNotesDB extends Dexie {
  trainers!: Table<Trainer, number>;
  courses!: Table<Course, number>;
  studyTerms!: Table<StudyTerm, number>;
  trainees!: Table<Trainee, number>;
  categories!: Table<Category, number>;
  academicYears!: Table<AcademicYear, number>;
  notes!: Table<Note, number>;
  attachments!: Table<Attachment, number>;
  importLogs!: Table<ImportLog, number>;
  settings!: Table<AppSettings, number>;
  portableFiles!: Table<PortableFileLink, number>;

  constructor() {
    super('trainer-notes');
    this.version(1).stores({
      trainers: '++id, name, createdAt',
      courses: '++id, trainerId, refCode, name, [trainerId+refCode]',
      trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo]',
      categories: '++id, trainerId, parentId, name',
      notes: '++id, trainerId, traineeId, courseId, categoryId, subcategoryId, createdAt, updatedAt',
      attachments: '++id, noteId, kind',
      importLogs: '++id, trainerId, at'
    });

    // الإصدار 3: خطورة التصنيفات + تذكيرات الملاحظات + شعب المتدربين
    this.version(3)
      .stores({
        trainers: '++id, name, createdAt',
        courses: '++id, trainerId, refCode, name, [trainerId+refCode]',
        trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo], *courseIds',
        categories: '++id, trainerId, parentId, name',
        notes: '++id, trainerId, *traineeIds, courseId, categoryId, subcategoryId, dueAt, remindDone, createdAt, updatedAt',
        attachments: '++id, noteId, kind',
        importLogs: '++id, trainerId, at'
      })
      .upgrade(async tx => {
        await tx.table('categories').toCollection().modify(c => {
          if (!c.severity) c.severity = '';
        });
        await tx.table('notes').toCollection().modify(n => {
          if (!Array.isArray(n.traineeIds)) {
            n.traineeIds = typeof n.traineeId === 'number' ? [n.traineeId] : [];
          }
          delete n.traineeId;
          n.dueAt = undefined; n.remind = false; n.remindDone = true;
        });
        await tx.table('trainees').toCollection().modify(t => {
          if (!Array.isArray(t.courseIds)) t.courseIds = [];
        });
      });

    // الإصدار 4: جدول إعدادات قواعد حالة المتدرب لكل مدرب
    this.version(4)
      .stores({
        trainers: '++id, name, createdAt',
        courses: '++id, trainerId, refCode, name, [trainerId+refCode]',
        trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo], *courseIds',
        categories: '++id, trainerId, parentId, name',
        notes: '++id, trainerId, *traineeIds, courseId, categoryId, subcategoryId, dueAt, remindDone, createdAt, updatedAt',
        attachments: '++id, noteId, kind',
        importLogs: '++id, trainerId, at',
        settings: 'trainerId'
      });

    // الإصدار 5: سجل آخر تعديل للمتدربين دون تغيير تاريخ إنشائهم الأصلي
    this.version(5)
      .stores({
        trainers: '++id, name, createdAt',
        courses: '++id, trainerId, refCode, name, [trainerId+refCode]',
        trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo], *courseIds',
        categories: '++id, trainerId, parentId, name',
        notes: '++id, trainerId, *traineeIds, courseId, categoryId, subcategoryId, dueAt, remindDone, createdAt, updatedAt',
        attachments: '++id, noteId, kind',
        importLogs: '++id, trainerId, at',
        settings: 'trainerId'
      })
      .upgrade(async tx => {
        await tx.table('trainees').toCollection().modify(trainee => {
          trainee.updatedAt = typeof trainee.updatedAt === 'number'
            ? trainee.updatedAt
            : (typeof trainee.createdAt === 'number' ? trainee.createdAt : Date.now());
        });
      });

    // الإصدار 6: فصل تاريخ الحدث عن تاريخ إنشاء السجل لأغراض التدقيق
    this.version(6)
      .stores({
        trainers: '++id, name, createdAt',
        courses: '++id, trainerId, refCode, name, [trainerId+refCode]',
        trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo], *courseIds',
        categories: '++id, trainerId, parentId, name',
        notes: '++id, trainerId, *traineeIds, courseId, categoryId, subcategoryId, dueAt, remindDone, noteAt, createdAt, updatedAt',
        attachments: '++id, noteId, kind',
        importLogs: '++id, trainerId, at',
        settings: 'trainerId'
      })
      .upgrade(async tx => {
        await tx.table('notes').toCollection().modify(note => {
          note.noteAt = typeof note.noteAt === 'number'
            ? note.noteAt
            : (typeof note.createdAt === 'number' ? note.createdAt : Date.now());
        });
      });

    // الإصدار 7: الأعوام الدراسية ككيانات مستقلة ترتبط بالملاحظات
    this.version(7)
      .stores({
        trainers: '++id, name, createdAt',
        courses: '++id, trainerId, refCode, name, [trainerId+refCode]',
        trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo], *courseIds',
        categories: '++id, trainerId, parentId, name',
        academicYears: '++id, trainerId, name, [trainerId+name]',
        notes: '++id, trainerId, *traineeIds, courseId, categoryId, subcategoryId, academicYearId, dueAt, remindDone, noteAt, createdAt, updatedAt',
        attachments: '++id, noteId, kind',
        importLogs: '++id, trainerId, at',
        settings: 'trainerId'
      });

    // الإصدار 8: الفصول والمستويات ككيانات مستقلة يمكن إدارتها من الشريط السفلي
    this.version(8)
      .stores({
        trainers: '++id, name, createdAt',
        courses: '++id, trainerId, refCode, name, termId, [trainerId+refCode]',
        studyTerms: '++id, trainerId, name, [trainerId+name]',
        trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo], *courseIds',
        categories: '++id, trainerId, parentId, name',
        academicYears: '++id, trainerId, name, [trainerId+name]',
        notes: '++id, trainerId, *traineeIds, courseId, categoryId, subcategoryId, academicYearId, dueAt, remindDone, noteAt, createdAt, updatedAt',
        attachments: '++id, noteId, kind',
        importLogs: '++id, trainerId, at',
        settings: 'trainerId'
      })
      .upgrade(async tx => {
        const terms = tx.table('studyTerms');
        const courses = tx.table('courses');
        const byName = new Map<string, number>();
        for (const course of await courses.toArray()) {
          const name = typeof course.semester === 'string' ? course.semester.trim() : '';
          if (!name) continue;
          const key = `${course.trainerId}:${name}`;
          let termId = byName.get(key);
          if (!termId) {
            const createdTermId = await terms.add({
              trainerId: course.trainerId,
              name,
              createdAt: course.createdAt ?? Date.now(),
              updatedAt: Date.now()
            }) as number;
            termId = createdTermId;
            byName.set(key, createdTermId);
          }
          if (typeof course.id === 'number') await courses.update(course.id, { termId });
        }
      });

    // الإصدار 9: ربط ملف مدرب مشفر للحفظ المباشر على الأجهزة الداعمة
    this.version(9).stores({
      trainers: '++id, name, createdAt',
      courses: '++id, trainerId, refCode, name, termId, [trainerId+refCode]',
      studyTerms: '++id, trainerId, name, [trainerId+name]',
      trainees: '++id, trainerId, traineeNo, name, [trainerId+traineeNo], *courseIds',
      categories: '++id, trainerId, parentId, name',
      academicYears: '++id, trainerId, name, [trainerId+name]',
      notes: '++id, trainerId, *traineeIds, courseId, categoryId, subcategoryId, academicYearId, dueAt, remindDone, noteAt, createdAt, updatedAt',
      attachments: '++id, noteId, kind',
      importLogs: '++id, trainerId, at',
      settings: 'trainerId',
      portableFiles: 'trainerId'
    });

    // حذف مرفقات الملاحظة عند حذفها
    this.notes.hook('deleting', (primKey, obj, tx) => {
      this.attachments.where('noteId').equals(primKey).delete();
    });
  }
}

export const db = new TrainerNotesDB();

/** التحقق من تفرد رقم المتدرب لنفس المدرب */
export async function isTraineeNoTaken(trainerId: number, traineeNo: string, excludeId?: number) {
  const found = await db.trainees.where('[trainerId+traineeNo]').equals([trainerId, traineeNo]).first();
  return !!found && found.id !== excludeId;
}

/** التحقق من تفرد الرقم المرجعي للمقرر لنفس المدرب */
export async function isRefCodeTaken(trainerId: number, refCode: string, excludeId?: number) {
  const found = await db.courses.where('[trainerId+refCode]').equals([trainerId, refCode]).first();
  return !!found && found.id !== excludeId;
}
