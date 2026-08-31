import { useState, useMemo, createContext, useContext } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isTraineeNoTaken, loadSettings, type Trainee, type Severity } from '../db/schema';
import { useActiveTrainer, useToast, useNav } from '../App';
import { fmtDate } from '../lib/media';
import { statusOf } from '../lib/status';

export default function Trainees() {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'course' | 'level'>('none');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Trainee | null>(null);
  const [name, setName] = useState('');
  const [no, setNo] = useState('');
  const [level, setLevel] = useState('');
  const [confirmDel, setConfirmDel] = useState<Trainee | null>(null);

  const trainees = useLiveQuery(
    () => db.trainees.where('trainerId').equals(t.id).toArray(),
    [t.id]
  ) ?? [];
  const courses = useLiveQuery(
    () => db.courses.where('trainerId').equals(t.id).toArray(),
    [t.id]
  ) ?? [];

  const filtered = trainees
    .filter(x => !q.trim() || x.name.includes(q.trim()) || x.traineeNo.includes(q.trim()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  // التجميع: حسب الشعبة (المقرر) أو المستوى أو بلا تجميع
  const groups = useMemo<{ key: string; label: string; items: Trainee[] }[]>(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', items: filtered }];
    if (groupBy === 'level') {
      const map = new Map<string, Trainee[]>();
      for (const x of filtered) {
        const k = x.level?.trim() || 'بدون مستوى';
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(x);
      }
      return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'ar'))
        .map(([k, items]) => ({ key: `lv:${k}`, label: k, items }));
    }
    // حسب الشعبة: متدرب قد ينتمي لأكثر من مقرر — يظهر في كل شعبة مسجل بها
    const map = new Map<string, { label: string; items: Trainee[] }>();
    map.set('c:none', { label: 'بدون شعبة', items: [] });
    for (const c of courses) map.set(`c:${c.id}`, { label: c.name, items: [] });
    for (const x of filtered) {
      const ids = x.courseIds ?? [];
      if (!ids.length) map.get('c:none')!.items.push(x);
      for (const cid of ids) {
        const g = map.get(`c:${cid}`);
        if (g) g.items.push(x);
      }
    }
    return [...map.values()]
      .filter(g => g.items.length > 0)
      .map(g => ({ key: `c:${g.label}`, label: g.label, items: g.items }));
  }, [filtered, groupBy, courses]);

  async function save() {
    const n = name.trim(), num = no.trim();
    if (!n || !num) { toast('الاسم والرقم التدريبي مطلوبان', 'err'); return; }
    if (await isTraineeNoTaken(t.id, num, editing?.id)) {
      toast('هذا الرقم التدريبي مسجل مسبقاً لمتدرب آخر', 'err'); return;
    }
    if (editing) {
      await db.trainees.update(editing.id!, {
        name: n, traineeNo: num, level: level || undefined, updatedAt: Date.now()
      });
      toast('تم تعديل بيانات المتدرب');
    } else {
      const now = Date.now();
      await db.trainees.add({
        trainerId: t.id, name: n, traineeNo: num, level: level || undefined, createdAt: now, updatedAt: now
      });
      toast(`تمت إضافة «${n}»`);
    }
    closeForm();
  }

  function openEdit(x: Trainee) {
    setEditing(x); setName(x.name); setNo(x.traineeNo); setLevel(x.level ?? ''); setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditing(null); setName(''); setNo(''); setLevel(''); }

  async function doDelete() {
    if (!confirmDel) return;
    const notesCount = await db.notes.where('traineeIds').equals(confirmDel.id!).count();
    if (notesCount > 0) {
      toast(`لا يمكن الحذف: لديه ${notesCount} ملاحظة`, 'err');
    } else {
      await db.trainees.delete(confirmDel.id!);
      toast('تم حذف المتدرب');
    }
    setConfirmDel(null);
  }

  return (
    <TraineeActionsCtx.Provider value={{ openEdit, setConfirmDel }}>
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className="input flex-1" placeholder='🔍 بحث بالاسم أو الرقم...' value={q}
          onChange={e => setQ(e.target.value)} />
        <button className="btn-primary shrink-0" onClick={() => setShowForm(true)}>➕ متدرب</button>
      </div>

      {/* تجميع حسب */}
      {trainees.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-500">🗂️ تجميع حسب:</span>
          <div className="flex gap-1">
            {([['none', 'بدون'], ['course', '📚 الشعبة'], ['level', '🎓 المستوى']] as const).map(([v, label]) => (
              <button key={v}
                onClick={() => setGroupBy(v)}
                className={`rounded-full px-3 py-1.5 font-bold transition ${
                  groupBy === v ? 'bg-brand-700 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!trainees.length ? (
        <div className="card p-8 text-center space-y-3">
          <div className="text-5xl">🧑‍🎓</div>
          <h2 className="font-bold text-lg">لا يوجد متدربون بعد</h2>
          <p className="text-sm text-slate-500">أضفهم يدوياً أو استوردهم دفعة واحدة من ملف الشعبة الدراسية.</p>
          <ImportHint />
        </div>
      ) : !filtered.length ? (
        <p className="text-center text-sm text-slate-400 py-8">لا نتائج مطابقة لـ «{q}»</p>
      ) : groupBy === 'none' ? (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {filtered.map(x => <TraineeRow key={x.id} x={x} />)}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => {
            const isCollapsed = collapsed[g.key] ?? false;
            return (
              <div key={g.key} className="card overflow-hidden">
                <button className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition"
                  onClick={() => setCollapsed(c => ({ ...c, [g.key]: !isCollapsed }))}>
                  <span className="font-bold text-sm flex items-center gap-2">
                    <span>{groupBy === 'course' ? '📚' : '🎓'}</span>
                    {g.label}
                  </span>
                  <span className="chip">{isCollapsed ? `${g.items.length} ▾` : `${g.items.length} ▴`}</span>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-slate-100">
                    {g.items.map(x => <TraineeRow key={`${g.key}-${x.id}`} x={x} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* نموذج الإضافة/التعديل */}
      {showForm && (
        <Modal title={editing ? 'تعديل متدرب' : 'متدرب جديد'} onClose={closeForm}>
          <div className="space-y-3">
            <div>
              <label className="label">الاسم الكامل *</label>
              <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">الرقم التدريبي / الجامعي *</label>
                <input className="input" inputMode="numeric" value={no} onChange={e => setNo(e.target.value)} />
              </div>
              <div>
                <label className="label">المستوى (اختياري)</label>
                <input className="input" placeholder="مثال: مستوى ثاني" value={level}
                  onChange={e => setLevel(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex-1" onClick={save}>{editing ? 'حفظ التعديلات' : 'إضافة'}</button>
              <button className="btn-ghost" onClick={closeForm}>إلغاء</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <Modal title={`حذف «${confirmDel.name}»؟`} onClose={() => setConfirmDel(null)}>
          <p className="text-sm text-slate-600">سيتم حذف المتدرب نهائياً. لا يمكن الحذف إذا كانت لديه ملاحظات.</p>
          <div className="flex gap-2 pt-3">
            <button className="btn-danger flex-1" onClick={doDelete}>نعم، احذف</button>
            <button className="btn-ghost flex-1" onClick={() => setConfirmDel(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </div>
    </TraineeActionsCtx.Provider>
  );
}

/* ================== صف متدرب ================== */
function TraineeRow({ x }: { x: Trainee }) {
  const { openEdit, setConfirmDel } = useTraineeActions();
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-800 grid place-items-center font-bold shrink-0">
        {x.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold truncate">{x.name}</p>
        <p className="text-xs text-slate-500">
          #{x.traineeNo}{x.level ? ` • ${x.level}` : ''} • أُنشئ {fmtDate(x.createdAt)}
          <br />آخر تعديل {fmtDate(x.updatedAt ?? x.createdAt)}
        </p>
      </div>
      <TraineeStatusBadge id={x.id!} />
      <NotesBadgeForTrainee id={x.id!} />
      <button className="btn-ghost !p-2 text-xs" onClick={() => openEdit(x)}>✏️</button>
      <button className="btn-ghost !p-2 text-xs hover:!bg-red-50" onClick={() => setConfirmDel(x)}>🗑️</button>
    </div>
  );
}

/* سياق تمرير دوال التعديل/الحذف للصفوف */
const TraineeActionsCtx = createContext<{ openEdit: (x: Trainee) => void; setConfirmDel: (x: Trainee) => void }>({
  openEdit: () => {}, setConfirmDel: () => {}
});
function useTraineeActions() { return useContext(TraineeActionsCtx); }

export function NotesBadgeForTrainee({ id }: { id: number }) {
  // فهرس traineeIds متعدد المداخل (*traineeIds) يتيح الاستعلام بالمطابقة المباشرة
  const count = useLiveQuery(() => db.notes.where('traineeIds').equals(id).count(), [id]) ?? 0;
  if (!count) return null;
  return <span className="chip bg-brand-100 !text-brand-800 shrink-0">🗒️ {count}</span>;
}

/** شارة حالة المتدرب (🟢🟡🟠🔴) محسوبة من مخالفاته — تظهر في قائمة المتدربين */
export function TraineeStatusBadge({ id }: { id: number }) {
  const st = useLiveQuery(async () => {
    const [notes, cats, rules] = await Promise.all([
      db.notes.where('traineeIds').equals(id).toArray(),
      db.categories.toArray(),
      loadSettings((await db.notes.where('traineeIds').equals(id).first())?.trainerId ?? 0)
    ]);
    const catSev = new Map(cats.map(c => [c.id!, c.severity]));
    return statusOf(notes.map(n => ({
      sev: (n.severity
        || catSev.get(n.categoryId)
        || (n.subcategoryId ? catSev.get(n.subcategoryId) : undefined)
        || undefined) as Severity | undefined
    })), rules);
  }, [id]);
  if (!st || st.key === 'green') return null;
  return (
    <span className={`chip whitespace-nowrap ${st.cls}`} title={`${st.label} • نقاط: ${st.points} من ${st.count} ملاحظة`}>
      {st.emoji} {st.label}
    </span>
  );
}

function ImportHint() {
  const { go } = useNav();
  return (
    <button className="btn-primary" onClick={() => go('import')}>
      📥 استيراد من ملف Excel
    </button>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="card p-5 w-full sm:max-w-md rounded-b-none sm:rounded-2xl space-y-2"
        onClick={e => e.stopPropagation()}>
        <div className="sm:hidden mx-auto w-10 h-1 rounded-full bg-slate-300 mb-2" />
        <h3 className="font-bold text-lg pb-1 border-b border-slate-100">{title}</h3>
        {children}
      </div>
    </div>
  );
}
