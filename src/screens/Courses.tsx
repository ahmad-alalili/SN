import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isRefCodeTaken, type Course } from '../db/schema';
import { useActiveTrainer, useToast, useNav } from '../App';
import { fmtDate } from '../lib/media';
import { statusOf } from '../lib/status';
import { Modal } from './Trainees';

export default function Courses() {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [name, setName] = useState('');
  const [refCode, setRefCode] = useState('');
  const [semester, setSemester] = useState('');
  const [confirmDel, setConfirmDel] = useState<Course | null>(null);

  const courses = useLiveQuery(
    () => db.courses.where('trainerId').equals(t.id).toArray(),
    [t.id]
  ) ?? [];

  const filtered = courses
    .filter(x => !q.trim() || x.name.includes(q.trim()) || x.refCode.includes(q.trim()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  async function save() {
    const n = name.trim(), rc = refCode.trim();
    if (!n || !rc) { toast('اسم المقرر والرقم المرجعي مطلوبان', 'err'); return; }
    if (await isRefCodeTaken(t.id, rc, editing?.id)) {
      toast('هذا الرقم المرجعي مسجل لمقرر آخر', 'err'); return;
    }
    if (editing) {
      await db.courses.update(editing.id!, { name: n, refCode: rc, semester: semester || undefined });
      toast('تم تعديل المقرر');
    } else {
      await db.courses.add({ trainerId: t.id, name: n, refCode: rc, semester: semester || undefined, createdAt: Date.now() });
      toast(`تمت إضافة «${n}»`);
    }
    closeForm();
  }

  function openEdit(c: Course) {
    setEditing(c); setName(c.name); setRefCode(c.refCode); setSemester(c.semester ?? ''); setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditing(null); setName(''); setRefCode(''); setSemester(''); }

  async function doDelete() {
    if (!confirmDel) return;
    const notesCount = await db.notes.where('courseId').equals(confirmDel.id!).count();
    if (notesCount > 0) {
      toast(`لا يمكن الحذف: ${notesCount} ملاحظة مرتبطة`, 'err');
    } else {
      await db.courses.delete(confirmDel.id!);
      toast('تم حذف المقرر');
    }
    setConfirmDel(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className="input flex-1" placeholder='🔍 بحث بالاسم أو الرقم المرجعي...' value={q}
          onChange={e => setQ(e.target.value)} />
        <button className="btn-primary shrink-0" onClick={() => setShowForm(true)}>➕ مقرر</button>
      </div>

      {!courses.length ? (
        <div className="card p-8 text-center space-y-3">
          <div className="text-5xl">📚</div>
          <h2 className="font-bold text-lg">لا توجد مقررات بعد</h2>
          <p className="text-sm text-slate-500">أضف مقررك يدوياً أو استورده تلقائياً مع طلابه من ملف الشعبة.</p>
          <ImportHint />
        </div>
      ) : !filtered.length ? (
        <p className="text-center text-sm text-slate-400 py-8">لا نتائج مطابقة لـ «{q}»</p>
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {filtered.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3.5">
              <div className="w-10 h-10 rounded-xl bg-blue-100 grid place-items-center text-lg shrink-0">📘</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{c.name}</p>
                <p className="text-xs text-slate-500">
                  مرجع #{c.refCode}{c.semester ? ` • ${c.semester}` : ''} • أُضيف {fmtDate(c.createdAt)}
                </p>
              </div>
              <NotesBadgeForCourse id={c.id!} />
              <button className="btn-ghost !p-2 text-xs" onClick={() => openEdit(c)}>✏️</button>
              <button className="btn-ghost !p-2 text-xs hover:!bg-red-50" onClick={() => setConfirmDel(c)}>🗑️</button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title={editing ? 'تعديل مقرر' : 'مقرر جديد'} onClose={closeForm}>
          <div className="space-y-3">
            <div>
              <label className="label">اسم المقرر *</label>
              <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">الرقم المرجعي *</label>
                <input className="input" inputMode="numeric" value={refCode}
                  onChange={e => setRefCode(e.target.value)} />
              </div>
              <div>
                <label className="label">الفصل الدراسي (اختياري)</label>
                <input className="input" placeholder="مثال: الفصل الأول 1447" value={semester}
                  onChange={e => setSemester(e.target.value)} />
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
          <p className="text-sm text-slate-600">لا يمكن الحذف إذا كانت هناك ملاحظات مرتبطة به.</p>
          <div className="flex gap-2 pt-3">
            <button className="btn-danger flex-1" onClick={doDelete}>نعم، احذف</button>
            <button className="btn-ghost flex-1" onClick={() => setConfirmDel(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NotesBadgeForCourse({ id }: { id: number }) {
  const count = useLiveQuery(() => db.notes.where('courseId').equals(id).count(), [id]) ?? 0;
  if (!count) return null;
  return <span className="chip bg-brand-100 !text-brand-800 shrink-0">🗒️ {count}</span>;
}

function ImportHint() {
  const { go } = useNav();
  return (
    <button className="btn-primary" onClick={() => go('import')}>
      📥 استيراد شعبة كاملة
    </button>
  );
}
