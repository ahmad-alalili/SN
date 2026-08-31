import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, loadSettings, type Note, type Trainee, type Severity } from '../db/schema';
import { useActiveTrainer, useToast, useNav } from '../App';
import { fmtDate } from '../lib/media';
import { AttachmentSummary } from '../components/MediaGallery';
import { exportNotesToExcel } from '../lib/excel';
import { SEV_BORDER, SEV_DOT, SEV_CHIP_CLS, statusOf } from '../lib/status';

type Filters = { traineeId: number | null; courseId: number | null; categoryId: number | null; q: string; from: string; to: string };

export default function NotesList() {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const { go } = useNav();
  const [f, setF] = useState<Filters>({ traineeId: null, courseId: null, categoryId: null, q: '', from: '', to: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Note | null>(null);

  const notes = useLiveQuery(
    () => db.notes.where('trainerId').equals(t.id).toArray(),
    [t.id]
  ) ?? [];
  const trainees = useLiveQuery(() => db.trainees.where('trainerId').equals(t.id).toArray(), [t.id]) ?? [];
  const courses = useLiveQuery(() => db.courses.where('trainerId').equals(t.id).toArray(), [t.id]) ?? [];
  const categories = useLiveQuery(() => db.categories.where('trainerId').equals(t.id).toArray(), [t.id]) ?? [];

  const traineeById = useMemo(() => new Map(trainees.map(x => [x.id!, x])), [trainees]);
  const courseById = useMemo(() => new Map(courses.map(c => [c.id!, c])), [courses]);
  const catById = useMemo(() => new Map(categories.map(c => [c.id!, c])), [categories]);
  const catSeverityMap = useMemo(
    () => new Map(categories.map(c => [c.id!, c.severity as '' | 'yellow' | 'orange' | 'red' | undefined])),
    [categories]
  );
  // قواعد حالة المتدرب (قابلة للتخصيص من الإعدادات)
  const rules = useLiveQuery(() => loadSettings(t.id), [t.id]);

  const filtered = useMemo(() => {
    let list = [...notes];
    if (f.traineeId) list = list.filter(n => (n.traineeIds ?? []).includes(f.traineeId!));
    if (f.courseId) list = list.filter(n => n.courseId === f.courseId);
    if (f.categoryId) {
      const subIds = categories.filter(c => c.parentId === f.categoryId).map(c => c.id!);
      list = list.filter(n => n.categoryId === f.categoryId || (n.subcategoryId && subIds.includes(n.subcategoryId)));
    }
    if (f.q.trim()) {
      const q = f.q.trim();
      list = list.filter(n => {
        if (n.text.includes(q)) return true;
        const co = courseById.get(n.courseId);
        if (co?.name.includes(q)) return true;
        // بحث في أي متدرب من متدربي الملاحظة (بالاسم أو الرقم)
        return n.traineeIds.some(id => {
          const tr = traineeById.get(id);
          return !!tr && (tr.name.includes(q) || String(tr.traineeNo).includes(q));
        });
      });
    }
    if (f.from) list = list.filter(n => n.createdAt >= new Date(f.from).getTime());
    if (f.to) list = list.filter(n => n.createdAt <= new Date(f.to).getTime() + 86400000);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, f, traineeById, courseById, categories]);

  const hasFilter = f.traineeId || f.courseId || f.categoryId || f.q.trim() || f.from || f.to;

  // ⏰ التذكيرات المستحقة (موعد ها ولم تُعلَّم منجزة)
  const dueReminders = useMemo(
    () => notes
      .filter(n => n.remind && !n.remindDone && !!n.dueAt && n.dueAt <= Date.now())
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)),
    [notes]
  );
  // التذكيرات القادمة القريبة (خلال 3 أيام)
  const upcoming = useMemo(
    () => notes
      .filter(n => n.remind && !n.remindDone && !!n.dueAt && n.dueAt > Date.now() && n.dueAt <= Date.now() + 3 * 86400000)
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)),
    [notes]
  );

  async function markDone(n: Note) {
    await db.notes.update(n.id!, { remindDone: true });
    toast('تم تعليم التذكير كمنجز ✓');
  }

  async function del() {
    if (!confirmDel) return;
    await db.notes.delete(confirmDel.id!); // المرفقات تُحذف تلقائياً بالـ hook
    setConfirmDel(null);
    toast('تم حذف الملاحظة ومرفقاتها');
  }

  return (
    <div className="space-y-4">
      {/* ⏰ بانر التذكيرات المستحقة */}
      {dueReminders.length > 0 && (
        <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-3.5 space-y-2 animate-pulse">
          <h3 className="font-extrabold text-red-700 text-sm">
            🔔 {dueReminders.length} تذكير مستحق الآن — يحتاج متابعتك!
          </h3>
          {dueReminders.slice(0, 5).map(n => (
            <div key={n.id} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-red-200">
              <span className="text-lg">⏰</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{n.text || '(ملاحظة بدون نص)'}</p>
                <p className="text-[10px] text-slate-500">استحق: {n.dueAt ? fmtDate(n.dueAt) : ''}</p>
              </div>
              <button className="btn-primary !py-1 !px-2.5 text-[10px]" onClick={() => markDone(n)}>منجز ✓</button>
              <button className="btn-ghost !py-1 !px-2.5 text-[10px]" onClick={() => go('note-form', { noteId: n.id })}>فتح</button>
            </div>
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-center gap-2">
          <span>⏳</span>
          <p className="text-xs text-amber-800 font-semibold">
            لديك {upcoming.length} تذكير قادم خلال الأيام الثلاثة القادمة
          </p>
        </div>
      )}

      {/* البحث والفلترة */}
      <div className="card p-3 space-y-3">
        <div className="flex gap-2">
          <input className="input flex-1" placeholder='🔍 ابحث في النصوص والأسماء والأرقام...'
            value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
          <button className={`btn-ghost shrink-0 ${hasFilter ? '!border-brand-600 !text-brand-700' : ''}`}
            onClick={() => setShowFilters(s => !s)}>
            🎛️ فلترة {hasFilter ? '•' : ''}
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <Select value={f.traineeId} onChange={v => setF({ ...f, traineeId: v })}
              placeholder="كل المتدربين"
              items={trainees.map(x => ({ id: x.id!, label: x.name }))} />
            <Select value={f.courseId} onChange={v => setF({ ...f, courseId: v })}
              placeholder="كل المقررات"
              items={courses.map(c => ({ id: c.id!, label: c.name }))} />
            <Select value={f.categoryId} onChange={v => setF({ ...f, categoryId: v })}
              placeholder="كل التصنيفات"
              items={[...categories.filter(c => c.parentId === null)
                .flatMap(r => [{ id: r.id!, label: r.name },
                  ...categories.filter(k => k.parentId === r.id).map(k => ({ id: k.id!, label: `↳ ${k.name}` }))])]} />
            <div className="grid grid-cols-2 gap-1.5 col-span-2 sm:col-span-1">
              <input type="date" className="input !px-2 text-xs" value={f.from}
                onChange={e => setF({ ...f, from: e.target.value })} title="من تاريخ" />
              <input type="date" className="input !px-2 text-xs" value={f.to}
                onChange={e => setF({ ...f, to: e.target.value })} title="إلى تاريخ" />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-slate-500 px-1">
          <span>{filtered.length} من {notes.length} ملاحظة</span>
          <div className="flex gap-2">
            {hasFilter && (
              <button className="underline hover:text-red-600"
                onClick={() => setF({ traineeId: null, courseId: null, categoryId: null, q: '', from: '', to: '' })}>
                مسح الفلاتر
              </button>
            )}
            {!!filtered.length && (
              <button className="underline font-bold hover:text-brand-700"
                onClick={() => exportNotesToExcel(filtered, { traineeById, courseById, catById }, toast)}>
                ⬇️ تصدير Excel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* القائمة */}
      {!filtered.length ? (
        <div className="card p-8 text-center space-y-3">
          <div className="text-5xl">{notes.length ? '🔍' : '🗒️'}</div>
          <h2 className="font-bold text-lg">{notes.length ? 'لا نتائج مطابقة' : 'لا ملاحظات بعد'}</h2>
          <p className="text-sm text-slate-500">
            {notes.length ? 'جرّب تعديل الفلاتر أو البحث بكلمة أخرى.' : 'ابدأ بتسجيل أول ملاحظة لك — تستغرق أقل من 30 ثانية.'}
          </p>
          {!notes.length && (
            <button className="btn-primary" onClick={() => go('note-form')}>➕ ملاحظة جديدة</button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(n => {
            const trs = (n.traineeIds ?? []).map(id => traineeById.get(id)).filter(Boolean) as Trainee[];
            const co = courseById.get(n.courseId);
            const mainCat = catById.get(n.categoryId);
            const subCat = n.subcategoryId ? catById.get(n.subcategoryId) : null;
            // الخطورة الفعّالة: الخاصة بالملاحظة أولاً، ثم تصنيفها
            const sev = (n.severity || mainCat?.severity || subCat?.severity || '') as string;
            const isDue = n.remind && !n.remindDone && !!n.dueAt && n.dueAt <= Date.now();
            const isUpcoming = !isDue && n.remind && !n.remindDone && !!n.dueAt && n.dueAt > Date.now();
            // حالة كل متدرب: من خطورة كل ملاحظة له (خاصة أو موروثة) وفق قواعد المدرب
            const trStatuses = trs.map(tr => statusOf(
              notes
                .filter(x => (x.traineeIds ?? []).includes(tr.id!))
                .map(x => ({
                  sev: (x.severity
                    || catById.get(x.categoryId)?.severity
                    || (x.subcategoryId ? catById.get(x.subcategoryId)?.severity : undefined)
                    || undefined) as Severity | undefined
                })),
              rules ?? undefined
            ));
            return (
              <div key={n.id} className={`card p-4 space-y-2 ${SEV_BORDER[sev] ?? ''} ${isDue ? '!border-red-400 ring-2 ring-red-200' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {/* شرائح المتدربين مع حالتهم */}
                    <div className="flex flex-wrap items-center gap-1">
                      {trs.length === 0 && (
                        <span className="chip font-bold">👤 متدرب محذوف</span>
                      )}
                      {trs.map((tr, i) => (
                        <span key={tr.id}
                          className={`chip whitespace-nowrap ${trStatuses[i]?.cls ?? ''}`}
                          title={`الحالة: ${trStatuses[i]?.label} • نقاط المخالفات: ${trStatuses[i]?.points}`}>
                          {trStatuses[i]?.emoji} <b>{tr.name}</b>&nbsp;•&nbsp;🆔 {tr.traineeNo}
                        </span>
                      ))}
                      {trs.length > 1 && (
                        <span className="chip !bg-purple-100 !text-purple-800 whitespace-nowrap">👥 جماعية ({trs.length})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="chip !bg-blue-50 !text-blue-800 whitespace-nowrap truncate max-w-52">📚 {co?.name ?? 'مقرر محذوف'}</span>
                      <span className="chip !bg-blue-50 !text-blue-800 whitespace-nowrap">🔖 المرجعي: <b>{co?.refCode ?? '—'}</b></span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[11px] text-slate-400 text-left ${isDue ? '!text-red-600 font-bold' : ''}`}>
                      <span className="block whitespace-nowrap">أنشئت: {fmtDate(n.createdAt)}</span>
                      <span className="block whitespace-nowrap">آخر تعديل: {fmtDate(n.updatedAt ?? n.createdAt)}</span>
                    </span>
                    {(mainCat || subCat) && (
                      <span className="chip bg-brand-100 !text-brand-800 max-w-40 truncate">
                    {(mainCat?.severity || subCat?.severity) && (
                          <span className={`w-2 h-2 rounded-full inline-block ml-1 ${SEV_DOT[mainCat!.severity!]}`} />
                        )}
                        🏷️ {mainCat?.name}{subCat ? ` ↳ ${subCat.name}` : ''}
                      </span>
                    )}
                    {(isDue || isUpcoming) && (
                      <span className={`chip whitespace-nowrap ${isDue ? '!bg-red-100 !text-red-700 animate-pulse' : '!bg-amber-100 !text-amber-700'}`}>
                        ⏰ {isDue ? 'مستحق الآن!' : `موعد: ${n.dueAt ? fmtDate(n.dueAt) : ''}`}
                      </span>
                    )}
                    {sev && sev !== '' && (
                      <span className={`chip whitespace-nowrap ${SEV_CHIP_CLS[sev]}`}>
                        🚦 {sev === 'yellow' ? 'خفيفة' : sev === 'orange' ? 'متوسطة' : 'خطرة'}
                      </span>
                    )}
                  </div>
                </div>

                {n.text && <p className="text-sm leading-relaxed whitespace-pre-wrap border-r-2 border-slate-100 pr-3 py-0.5">{n.text}</p>}

                {n.id !== undefined && <AttachmentSummary noteId={n.id} />}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-300">
                    {(n.updatedAt ?? n.createdAt) - n.createdAt > 60000 ? '(معدلة)' : ''}
                  </span>
                  <div className="flex gap-1.5">
                    <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => go('note-form', { noteId: n.id })}>✏️ تعديل</button>
                    <button className="btn-ghost !py-1.5 !px-3 text-xs hover:!bg-red-50" onClick={() => setConfirmDel(n)}>🗑️ حذف</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* تأكيد الحذف */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setConfirmDel(null)}>
          <div className="card p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-red-600">حذف الملاحظة؟</h3>
            <p className="text-sm text-slate-600">
              ستُحذف الملاحظة وكل مرفقاتها (صور/فيديو/صوت) نهائياً.
            </p>
            <div className="flex gap-2">
              <button className="btn-danger flex-1" onClick={del}>نعم، احذف</button>
              <button className="btn-ghost flex-1" onClick={() => setConfirmDel(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================== منتقي فلتر ================== */
function Select({ value, onChange, placeholder, items }: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  items: { id: number; label: string }[];
}) {
  return (
    <select className="input !py-2 text-xs"
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{placeholder}</option>
      {items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
    </select>
  );
}

export type { Note };
