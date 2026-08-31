import { useState, useEffect, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Note } from '../db/schema';
import { useActiveTrainer, useToast, useNav } from '../App';
import CategorySelect from '../components/InlineCategoryCreate';
import MediaPicker, { type PendingMedia } from '../components/MediaPicker';
import { imageThumbnail, videoThumbnail } from '../lib/media';
import { SEV_LABEL } from '../lib/status';
import type { Severity } from '../db/schema';

const MAX_FILE = 25 * 1024 * 1024;

export default function NoteForm() {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const { params, go } = useNav();

  // تعديل ملاحظة قائمة؟
  const editId = typeof params.noteId === 'number' ? params.noteId : null;
  const existing = useLiveQuery(
    async () => (editId ? await db.notes.get(editId) : undefined),
    [editId]
  );

  const [traineeIds, setTraineeIds] = useState<number[]>(() => {
    if (Array.isArray(params.traineeIds)) return params.traineeIds as number[];
    if (typeof params.traineeId === 'number') return [params.traineeId];
    return [];
  });
  const [courseId, setCourseId] = useState<number | null>(
    typeof params.courseId === 'number' ? params.courseId : null
  );
  const [catId, setCatId] = useState<number | null>(null);
  const [subCatId, setSubCatId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // تاريخ الملاحظة (تلقائي بالوقت الحالي) + التذكير + الشعبة كاملة
  const nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const [noteDate, setNoteDate] = useState<string>(nowLocal);
  const [remind, setRemind] = useState(false);
  const [dueAt, setDueAt] = useState<string>('');
  const [wholeSection, setWholeSection] = useState(false);
  // درجة الخطورة الخاصة بالملاحظة ('' = وراثة من التصنيف)
  const [sevOverride, setSevOverride] = useState<Severity | null>(null);

  useEffect(() => {
    if (existing) {
      setTraineeIds(Array.isArray(existing.traineeIds) ? existing.traineeIds : []);
      setCourseId(existing.courseId);
      setCatId(existing.categoryId || null);
      setSubCatId(existing.subcategoryId ?? null);
      setText(existing.text);
      const d = new Date(existing.noteAt ?? existing.createdAt);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      setNoteDate(d.toISOString().slice(0, 16));
      setRemind(!!existing.remind && !existing.remindDone);
      setDueAt(existing.dueAt ? new Date(existing.dueAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
      setSevOverride(existing.severity ?? null);
    }
  }, [existing?.id]);

  const trainees = useLiveQuery(() => db.trainees.where('trainerId').equals(t.id).toArray(), [t.id]) ?? [];
  const courses = useLiveQuery(() => db.courses.where('trainerId').equals(t.id).toArray(), [t.id]) ?? [];
  const cats = useLiveQuery(
    () => db.categories.where('trainerId').equals(t.id).toArray(),
    [t.id]
  ) ?? [];
  const subCats = catId ? cats.filter(c => c.parentId === catId) : [];

  // متدربو الشعبة المحددة
  const sectionTrainees = useMemo(
    () => (courseId ? trainees.filter(x => (x.courseIds ?? []).includes(courseId)) : []),
    [trainees, courseId]
  );

  async function save() {
    // الشعبة كاملة = دمج متدربي المقرر مع المختارين
    const finalIds = wholeSection && courseId
      ? [...new Set([...traineeIds, ...sectionTrainees.map(x => x.id!)])]
      : traineeIds;
    if (!finalIds.length) { toast('اختر متدرباً واحداً على الأقل', 'err'); return; }
    if (!courseId) { toast('اختر المقرر', 'err'); return; }
    if (!text.trim() && !media.length) { toast('اكتب الملاحظة أو أرفق وسائط', 'err'); return; }
    if (remind && !dueAt) { toast('حدد موعد التذكير أو ألغِ التذكير', 'err'); return; }

    const noteTimestamp = noteDate ? new Date(noteDate).getTime() : Date.now();
    const dueTs = remind && dueAt ? new Date(dueAt).getTime() : undefined;
    // الخطورة الفعّالة: اختيار المستخدم إن غيّره، وإلا افتراضي التصنيف/الفرعي
    const catSev = (cats.find(c => c.id === catId)?.severity || subCats.find(c => c.id === subCatId)?.severity || undefined) as Severity | undefined;
    const effectiveSev: Severity | undefined = sevOverride === null ? (catSev || undefined) : sevOverride;

    setSaving(true);
    try {
      const now = Date.now();
      let noteId: number;
      if (editId && existing) {
        await db.notes.update(editId, {
          traineeIds: finalIds,
          courseId,
          categoryId: catId ?? 0,
          subcategoryId: subCatId,
          text: text.trim(),
          noteAt: noteTimestamp,
          updatedAt: now,
          dueAt: dueTs,
          remind: !!remind,
          remindDone: remind ? (existing.remindDone ?? true) : true,
          severity: effectiveSev
        });
        noteId = editId;
      } else {
        noteId = await db.notes.add({
          trainerId: t.id, traineeIds: finalIds, courseId,
          categoryId: catId ?? 0,
          subcategoryId: subCatId,
          text: text.trim(),
          dueAt: dueTs,
          remind: !!remind,
          remindDone: !remind,
          severity: effectiveSev,
          noteAt: noteTimestamp,
          createdAt: now,
          updatedAt: now
        });
      }

      // حفظ المرفقات الجديدة
      for (const m of media) {
        if ((m as PendingMedia & { saved?: boolean }).saved) continue;
        let thumb = m.thumb;
        if (!thumb && m.kind === 'image') thumb = await imageThumbnail(m.blob);
        if (!thumb && m.kind === 'video') thumb = await videoThumbnail(m.blob);
        await db.attachments.add({
          noteId, kind: m.kind, mime: m.mime, name: m.name,
          size: m.size, blob: m.blob, thumb, createdAt: now
        });
      }

      toast(editId ? 'تم تحديث الملاحظة' : 'تم حفظ الملاحظة بنجاح');
      go('notes');
    } catch (e) {
      console.error(e);
      toast('حدث خطأ أثناء الحفظ', 'err');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <h2 className="font-bold">
          {editId ? '✏️ تعديل ملاحظة' : '📝 ملاحظة جديدة'}
        </h2>

        {/* المتدربون — واحد أو أكثر + إنشاء فوري */}
        <MultiTraineePicker
          trainees={trainees.map(x => ({ id: x.id!, primary: x.name, secondary: `#${x.traineeNo}${x.level ? ` • ${x.level}` : ''}` }))}
          value={traineeIds}
          onChange={setTraineeIds}
          emptyText="لا يوجد متدربون — أضفهم هنا مباشرة أو استورد ملف الشعبة"
          onGoImport={() => go('import')}
          onCreateNew={async (name, no) => {
            const dup = await db.trainees.where('[trainerId+traineeNo]').equals([t.id, no]).first();
            if (dup) { toast('الرقم التدريبي مسجل مسبقاً — اختير المتدرب الموجود', 'err'); return dup.id!; }
            const now = Date.now();
            const id = await db.trainees.add({
              trainerId: t.id, name, traineeNo: no,
              courseIds: courseId ? [courseId] : [],
              createdAt: now,
              updatedAt: now
            });
            toast(`أُنشئ المتدرب «${name}»`);
            return id;
          }} />

        {/* المقرر */}
        <EntityPicker label="📚 المقرر *" placeholder="ابحث بالاسم أو الرقم المرجعي..."
          items={courses.map(c => ({ id: c.id!, primary: c.name, secondary: `مرجع #${c.refCode}` }))}
          value={courseId} onChange={setCourseId} />

        {/* التصنيف الرئيسي */}
        <div>
          <label className="label">🏷️ التصنيف الرئيسي</label>
          <CategorySelect parentId={null} value={catId} onChange={id => { setCatId(id); setSubCatId(null); }} />
        </div>

        {/* الفرعي */}
        {catId && (
          <div>
            <label className="label">↳ التصنيف الفرعي (اختياري)</label>
            <CategorySelect parentId={catId} value={subCatId} onChange={setSubCatId}
              placeholder="بدون تصنيف فرعي" />
          </div>
        )}

        {/* درجة خطورة الملاحظة */}
        <div>
          <label className="label">🚦 درجة خطورة هذه الملاحظة</label>
          <SeverityChooser
            catSev={(cats.find(c => c.id === catId)?.severity || undefined) as Severity | undefined}
            value={sevOverride}
            onChange={setSevOverride} />
        </div>

        {/* نص + تاريخ الملاحظة */}
        <div>
          <label className="label">🗒️ نص الملاحظة</label>
          <textarea ref={textRef} className="input min-h-32 leading-relaxed" autoFocus={!editId}
            placeholder="اكتب ملاحظتك عن المتدرب... (النص اختياري إن أرفقت وسائط)"
            value={text} onChange={e => setText(e.target.value)} />
        </div>

        {/* تاريخ الملاحظة (تلقائي وقابل للتعديل) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">📅 تاريخ الملاحظة</label>
            <input type="datetime-local" className="input"
              value={noteDate}
              onChange={e => setNoteDate(e.target.value)} />
            {!editId && <p className="text-[10px] text-slate-400 mt-1">⏱️ مُعبأ تلقائياً بالوقت الحالي</p>}
          </div>
          <div className="flex items-end">
            <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2 w-full">
              سيُسجَّل بتاريخ: <b>{noteDate ? new Date(noteDate).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</b>
            </p>
          </div>
        </div>

        {/* تذكير / منبه */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-bold text-amber-800 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-amber-600" checked={remind}
              onChange={e => setRemind(e.target.checked)} />
            ⏰ تذكيرني بهذه الملاحظة (واجب / نشاط / مهلة)
          </label>
          {remind && (
            <>
              <input type="datetime-local" className="input !bg-white" value={dueAt}
                min={new Date(Date.now() - 60000).toISOString().slice(0, 16)}
                onChange={e => setDueAt(e.target.value)} />
              <p className="text-[11px] text-amber-700">سيظهر التنبيه في شاشة الملاحظات عند موعده حتى تعلّمه منجزاً.</p>
            </>
          )}
        </div>

        {/* الشعبة كاملة */}
        <label className="flex items-center gap-2 text-sm font-bold cursor-pointer select-none">
          <input type="checkbox" className="w-4 h-4 accent-brand-700" checked={wholeSection}
            onChange={e => setWholeSection(e.target.checked)} disabled={!courseId} />
          👥 تطبق على الشعبة كاملة
        </label>
        {wholeSection && courseId && (
          <p className="text-xs text-emerald-700 -mt-1">
            ستُسجل لجميع متدربي «{courses.find(c => c.id === courseId)?.name}» ({sectionTrainees.length} متدرباً).
          </p>
        )}

        {/* الوسائط */}
        <div>
          <label className="label">📎 الوسائط (صور / فيديو / صوت)</label>
          <MediaPicker items={media} onChange={setMedia} />
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn-primary flex-1" disabled={saving} onClick={save}>
            {saving ? '⏳ جارٍ الحفظ...' : editId ? 'حفظ التعديلات' : '💾 حفظ الملاحظة'}
          </button>
          <button className="btn-ghost" onClick={() => go('notes')}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

/* ================== منتقي متدربين متعدد + إنشاء فوري ================== */
function MultiTraineePicker({ trainees, value, onChange, emptyText, onGoImport, onCreateNew }: {
  trainees: { id: number; primary: string; secondary?: string }[];
  value: number[];
  onChange: (v: number[]) => void;
  emptyText?: string;
  onGoImport?: () => void;
  onCreateNew?: (name: string, no: string) => Promise<number>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [nName, setNName] = useState('');
  const [nNo, setNNo] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const byId = new Map(trainees.map(i => [i.id, i]));
  const selected = value.map(id => byId.get(id)).filter(Boolean) as typeof trainees;
  const filtered = trainees.filter(i =>
    !q.trim() || i.primary.includes(q.trim()) || (i.secondary ?? '').includes(q.trim())
  );
  const exactMatch = q.trim() ? filtered.some(i => i.primary === q.trim()) : false;

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  }

  async function quickCreate() {
    if (!onCreateNew || !nName.trim() || !nNo.trim()) return;
    try {
      const id = await onCreateNew(nName.trim(), nNo.trim());
      onChange([...value, id]);
      setCreating(false); setNName(''); setNNo(''); setQ('');
      // أبقِ القائمة مفتوحة ليضيف المزيد إن شاء
    } catch { /* toast داخل المعالج */ }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <label className="label">
        🧑‍🎓 المتدربون * <span className="text-xs font-normal text-slate-400">(واحد أو أكثر • أو أنشئ جديداً فوراً)</span>
      </label>

      {/* شرائح المختارين */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(s => (
            <span key={s.id} className="chip !bg-brand-100 !text-brand-900 font-semibold">
              {s.primary}
              <button type="button" className="text-brand-700 hover:text-red-600 mr-1"
                onClick={() => toggle(s.id)} title="إزالة">✕</button>
            </span>
          ))}
          <button type="button"
            className="chip hover:!bg-red-50 !text-red-600 cursor-pointer"
            onClick={() => onChange([])}>
            مسح الكل
          </button>
        </div>
      )}

      <button type="button"
        className={`input text-right flex items-center justify-between ${value.length ? '' : 'text-slate-400'}`}
        onClick={() => setOpen(o => !o)}>
        <span className="truncate">
          {value.length === 0 ? 'ابحث واختر متدرباً أو أكثر...'
            : value.length === 1 ? 'إضافة / تعديل الاختيار...'
            : `✓ ${value.length} متدرب محدد — انقر للمزيد`}
        </span>
        <span className="text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full card p-2 shadow-lg max-h-72 overflow-auto">
          {!creating ? (
            <>
              <input className="input mb-2 py-1.5" autoFocus placeholder="🔍 بحث بالاسم أو الرقم..." value={q}
                onChange={e => setQ(e.target.value)} />
              {!trainees.length && emptyText && (
                <div className="p-2 space-y-2">
                  <p className="text-xs text-slate-400">{emptyText}</p>
                  {onGoImport && <button type="button" className="btn-primary w-full !py-1.5 text-xs"
                    onClick={() => { setOpen(false); onGoImport(); }}>📥 الذهاب للاستيراد</button>}
                </div>
              )}
              {filtered.slice(0, 100).map(i => (
                <button type="button" key={i.id}
                  className={`w-full text-right rounded-lg px-3 py-2 text-sm flex items-center gap-2 hover:bg-brand-50 ${value.includes(i.id) ? 'bg-brand-100 font-bold' : ''}`}
                  onClick={() => toggle(i.id)}>
                  <span className={`w-4 h-4 rounded border grid place-items-center text-[10px] shrink-0
                    ${value.includes(i.id) ? 'bg-brand-700 border-brand-700 text-white' : 'border-slate-300'}`}>
                    {value.includes(i.id) ? '✓' : ''}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold block truncate">{i.primary}</span>
                    {i.secondary && <span className="block text-[11px] text-slate-400">{i.secondary}</span>}
                  </span>
                </button>
              ))}
              {filtered.length > 100 && (
                <p className="px-3 py-1 text-xs text-slate-400">…{filtered.length - 100} نتيجة أخرى — اكتب للبحث</p>
              )}
              <div className="border-t border-dashed border-slate-200 mt-2 pt-2 space-y-1.5">
                {q.trim() && !exactMatch && onCreateNew && (
                  <button type="button" className="w-full btn-primary !py-1.5 text-xs"
                    onClick={() => { setNName(q.trim()); setCreating(true); }}>
                    ＋ متدرب جديد بالاسم «{q.trim()}»
                  </button>
                )}
                {onCreateNew && (
                  <button type="button" className="w-full text-right rounded-lg px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50"
                    onClick={() => setCreating(true)}>
                    ＋ إنشاء متدرب جديد...
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="p-1 space-y-2">
              <label className="label !mb-0">متدرب جديد</label>
              <input className="input" autoFocus placeholder="الاسم الكامل..." value={nName}
                onChange={e => setNName(e.target.value)} />
              <input className="input" inputMode="numeric" placeholder="الرقم التدريبي / الجامعي..." value={nNo}
                onChange={e => setNNo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && quickCreate()} />
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1 !py-1.5 text-xs"
                  disabled={!nName.trim() || !nNo.trim()} onClick={quickCreate}>
                  حفظ وإضافته للملاحظة
                </button>
                <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setCreating(false)}>رجوع</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================== منتقي درجة خطورة الملاحظة ================== */
function SeverityChooser({ catSev, value, onChange }: {
  catSev?: Severity;                       // افتراضي التصنيف
  value: Severity | null;                  // null = وراثة من التصنيف
  onChange: (v: Severity | null) => void;
}) {
  const opts: { v: Severity | null }[] = [
    { v: null }, { v: '' }, { v: 'yellow' }, { v: 'orange' }, { v: 'red' }
  ];
  const effective: Severity = value === null ? (catSev ?? '') : value;
  const inherited = value === null && !!catSev;

  const btnCls = (active: boolean, color: string) =>
    `flex-1 rounded-xl px-1 py-2 text-[11px] font-bold border transition ${
      active ? `${color} text-white border-transparent` : 'bg-white border-slate-200 hover:bg-slate-50'
    }`;

  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <button type="button"
          className={btnCls(effective === '', effective === '' ? 'bg-slate-500' : '')}
          onClick={() => onChange('')}>
          ⚪ بدون
        </button>
        <button type="button" className={btnCls(effective === 'yellow', 'bg-yellow-500')}
          onClick={() => onChange('yellow')}>🟡 خفيفة</button>
        <button type="button" className={btnCls(effective === 'orange', 'bg-orange-500')}
          onClick={() => onChange('orange')}>🟠 متوسطة</button>
        <button type="button" className={btnCls(effective === 'red', 'bg-red-600')}
          onClick={() => onChange('red')}>🔴 خطرة</button>
      </div>
      <p className="text-[10px] text-slate-400">
        {inherited
          ? `⤵️ موروثة من التصنيف (${SEV_LABEL[catSev!]}) — انقر أي درجة لتجاوزها لهذه الملاحظة فقط`
          : value === ''
            ? 'ملاحظة بدون خطورة — لا تُحتسب على حالة المتدرب'
            : 'درجة مخصصة لهذه الملاحظة'}
      </p>
    </div>
  );
}

/* ================== منتقي كيان مع بحث ================== */
function EntityPicker({ label, placeholder, items, value, onChange, emptyText, onGoImport }: {
  label: string;
  placeholder: string;
  items: { id: number; primary: string; secondary?: string }[];
  value: number | null;
  onChange: (v: number | null) => void;
  emptyText?: string;
  onGoImport?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selected = items.find(i => i.id === value);
  const filtered = items.filter(i =>
    !q.trim() || i.primary.includes(q.trim()) || (i.secondary ?? '').includes(q.trim())
  );

  return (
    <div className="relative" ref={wrapRef}>
      <label className="label">{label}</label>
      <button type="button"
        className={`input text-right flex items-center justify-between ${value ? '' : 'text-slate-400'}`}
        onClick={() => setOpen(o => !o)}>
        <span className="truncate">{selected ? `${selected.primary} ${selected.secondary ?? ''}` : placeholder}</span>
        <span className="text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full card p-2 shadow-lg max-h-64 overflow-auto">
          <input className="input mb-2 py-1.5" autoFocus placeholder="🔍 بحث..." value={q}
            onChange={e => setQ(e.target.value)} />
          {!items.length && emptyText && (
            <div className="p-2 space-y-2">
              <p className="text-xs text-slate-400">{emptyText}</p>
              {onGoImport && <button type="button" className="btn-primary w-full !py-1.5 text-xs" onClick={() => { setOpen(false); onGoImport(); }}>📥 الذهاب للاستيراد</button>}
            </div>
          )}
          <button type="button"
            className="w-full text-right rounded-lg px-3 py-2 text-sm hover:bg-slate-100 text-slate-400"
            onClick={() => { onChange(null); setOpen(false); }}>
            — اختر لاحقاً / إلغاء التحديد —
          </button>
          {filtered.slice(0, 100).map(i => (
            <button type="button" key={i.id}
              className={`w-full text-right rounded-lg px-3 py-2 text-sm hover:bg-brand-50 ${i.id === value ? 'bg-brand-100 font-bold' : ''}`}
              onClick={() => { onChange(i.id); setOpen(false); }}>
              <span className="font-semibold">{i.primary}</span>
              {i.secondary && <span className="block text-[11px] text-slate-400">{i.secondary}</span>}
            </button>
          ))}
          {filtered.length > 100 && (
            <p className="px-3 py-1 text-xs text-slate-400">…{filtered.length - 100} نتيجة أخرى — اكتب للبحث</p>
          )}
        </div>
      )}
    </div>
  );
}

export type { Note };
