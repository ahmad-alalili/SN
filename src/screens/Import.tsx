import { useRef, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isTraineeNoTaken } from '../db/schema';
import { useActiveTrainer, useToast } from '../App';
import { parseRosterFile, type ParsedRoster } from '../lib/importParser';
import { fmtDate, fmtSize } from '../lib/media';

export default function ImportScreen() {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRoster | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ addedCourses: number; addedTrainees: number; skipped: number; updatedTrainees: number } | null>(null);

  // حالة موجودة مسبقاً للمعاينة
  const existingCourses = useLiveQuery(() => db.courses.where('trainerId').equals(t.id).toArray(), [t.id]) ?? [];
  const existingTrainees = useLiveQuery(() => db.trainees.where('trainerId').equals(t.id).toArray(), [t.id]) ?? [];
  const logs = useLiveQuery(() =>
    db.importLogs.where('trainerId').equals(t.id).sortBy('at'), [t.id]
  ) ?? [];

  const existingCourseByRef = new Map(existingCourses.map(c => [c.refCode, c]));
  const existingByNo = new Map(existingTrainees.map(x => [x.traineeNo, x]));

  const newTrainees = parsed ? parsed.trainees.filter(x => !existingByNo.has(x.traineeNo)) : [];
  const dupTrainees = parsed ? parsed.trainees.filter(x => existingByNo.has(x.traineeNo)) : [];

  async function onFile(f: File) {
    setBusy(true); setResult(null);
    try {
      const buf = await f.arrayBuffer();
      const p = parseRosterFile(buf, f.name);
      setParsed(p);
      setFileName(f.name);
      if (p.detectedFormat === 'system') {
        toast('تم التعرف على تنسيق النظام تلقائياً ✓');
      }
    } catch {
      toast('تعذر قراءة الملف — تأكد أنه Excel أو CSV صالح', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!parsed || (!parsed.course && !parsed.trainees.length)) return;
    setBusy(true);
    try {
      let addedCourses = 0;
      let courseId: number | null = null;

      // المقرر
      if (parsed.course?.name && parsed.course.refCode) {
        const ex = existingCourseByRef.get(parsed.course.refCode);
        if (ex) {
          courseId = ex.id!;
          if (ex.name !== parsed.course.name) {
            await db.courses.update(ex.id!, { name: parsed.course.name, semester: parsed.course.semester });
          }
        } else {
          courseId = await db.courses.add({
            trainerId: t.id,
            refCode: parsed.course.refCode,
            name: parsed.course.name,
            semester: parsed.course.semester,
            createdAt: Date.now()
          });
          addedCourses = 1;
        }
      }

      // المتدربون
      let addedTrainees = 0, skipped = 0, updatedTrainees = 0;
      for (const x of parsed.trainees) {
        const ex = existingByNo.get(x.traineeNo);
        if (ex) {
          skipped++;
          const changes: { level?: string; courseIds?: number[] } = {};
          if (x.level && ex.level !== x.level) changes.level = x.level;
          if (courseId && !(ex.courseIds ?? []).includes(courseId)) {
            changes.courseIds = [...(ex.courseIds ?? []), courseId];
          }
          if (Object.keys(changes).length) {
            await db.trainees.update(ex.id!, { ...changes, updatedAt: Date.now() });
            updatedTrainees++;
          }
          continue;
        }
        const now = Date.now();
        await db.trainees.add({
          trainerId: t.id, name: x.name, traineeNo: x.traineeNo,
          level: x.level,
          courseIds: courseId ? [courseId] : [],
          createdAt: now,
          updatedAt: now
        });
        addedTrainees++;
      }

      await db.importLogs.add({
        trainerId: t.id, filename: fileName, rows: parsed.trainees.length,
        addedCourses, addedTrainees, skippedDuplicates: skipped, at: Date.now()
      });

      setResult({ addedCourses, addedTrainees, skipped, updatedTrainees });
      setParsed(null);
      toast('اكتمل الاستيراد بنجاح');
    } catch (e) {
      console.error(e);
      toast('خطأ أثناء الاستيراد', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <h2 className="font-bold">📥 استيراد الشعبة الدراسية</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          ارفع ملف «ملخص قائمة المسجلين» المُصدَّر من نظام الكلية (xls/xlsx/csv).
          سيتعرف التطبيق تلقائياً على اسم المقرر ورقمه المرجعي وقائمة المتدربين، ويعرض معاينة قبل الاعتماد.
          الملفات الأخرى (CSV عام) مدعومة أيضاً.
        </p>

        {!parsed && (
          <button className="w-full btn-primary !py-6 text-base"
            disabled={busy}
            onClick={() => fileRef.current?.click()}>
            {busy ? '⏳ جارٍ التحليل...' : '📄 اختر ملف الشعبة'}
          </button>
        )}
        <input ref={fileRef} type="file" accept=".xls,.xlsx,.csv" hidden
          onChange={e => { e.target.files?.[0] && onFile(e.target.files[0]); e.target.value = ''; }} />

        {/* تحذيرات */}
        {parsed?.warnings.length ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-1">
            {parsed.warnings.map((w, i) => <p key={i} className="text-xs text-amber-800">⚠️ {w}</p>)}
          </div>
        ) : null}

        {/* المعاينة */}
        {parsed && parsed.detectedFormat === 'system' && (
          <div className="space-y-3">
            {parsed.course && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                <p className="text-xs font-bold text-blue-500 mb-1">📚 المقرر المكتشف</p>
                <p className="font-bold">{parsed.course.name}</p>
                <p className="text-xs text-blue-700">
                  مرجع #{parsed.course.refCode}{parsed.course.semester ? ` • ${parsed.course.semester}` : ''}
                  {existingCourseByRef.has(parsed.course.refCode ?? '') && ' • (موجود — لن يتكرر)'}
                </p>
              </div>
            )}

            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <p className="text-xs font-bold text-emerald-600 mb-2">🧑‍🎓 المتدربون ({parsed.trainees.length})</p>
              <div className="max-h-52 overflow-auto rounded-lg bg-white divide-y divide-slate-100">
                {parsed.trainees.map((x, i) => {
                  const isNew = !existingByNo.has(x.traineeNo);
                  return (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                      <span>{isNew ? '🟢' : '⚪'}</span>
                      <span className={`flex-1 truncate ${isNew ? 'font-semibold' : 'text-slate-400 line-through decoration-slate-300'}`}>
                        {x.name}
                      </span>
                      <span className="text-[11px] text-slate-400">#{x.traineeNo}</span>
                      <span className="chip text-[9px]">{isNew ? 'جديد' : 'موجود'}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-emerald-700 mt-2">
                🟢 {newTrainees.length} سيُضاف • ⚪ {dupTrainees.length} موجود مسبقاً (سيُتجاهل)
              </p>
            </div>

            <div className="flex gap-2">
              <button className="btn-primary flex-1" disabled={busy} onClick={commit}>
                {busy ? '⏳ جارٍ الاستيراد...' : `✓ اعتماد (${newTrainees.length} جديد)`}
              </button>
              <button className="btn-ghost" onClick={() => setParsed(null)}>إلغاء</button>
            </div>
          </div>
        )}
      </div>

      {/* نتيجة أخيرة */}
      {result && (
        <div className="card p-4 bg-emerald-50 !border-emerald-200 space-y-1">
          <h3 className="font-bold text-emerald-700">✅ تم الاستيراد</h3>
          <p className="text-sm text-emerald-800">
            مقررات جديدة: {result.addedCourses} • متدربون جدد: {result.addedTrainees} • موجودون (تجاوز): {result.skipped}
            {result.updatedTrainees ? ` • حُدّث مستوى: ${result.updatedTrainees}` : ''}
          </p>
        </div>
      )}

      {/* سجل الاستيرادات */}
      {logs.length > 0 && (
        <div className="card p-4">
          <h3 className="font-bold text-sm mb-2">📜 سجل الاستيرادات</h3>
          <div className="space-y-1.5">
            {[...logs].reverse().slice(0, 8).map(l => (
              <div key={l.id} className="flex items-center justify-between text-xs text-slate-500">
                <span className="truncate max-w-48">📄 {l.filename}</span>
                <span>+{l.addedTrainees} متدرب، +{l.addedCourses} مقرر، تجاوز {l.skippedDuplicates}</span>
                <span className="whitespace-nowrap">{fmtDate(l.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* مساحة التخزين */}
      <StorageCard />
    </div>
  );
}

function StorageCard() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    import('../db/backup').then(m => m.storageEstimate().then(setEst));
  }, []);
  return est ? (
    <p className="text-center text-[11px] text-slate-400">
      💾 مساحة مستخدمة على الجهاز: {fmtSize(est.usage)} من ~{fmtSize(est.quota)}
    </p>
  ) : null;
}
