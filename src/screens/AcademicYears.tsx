import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AcademicYear } from '../db/schema';
import { useActiveTrainer, useToast } from '../App';
import { fmtDate } from '../lib/media';
import { Modal } from './Trainees';

export default function AcademicYears() {
  const trainer = useActiveTrainer()!;
  const toast = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<AcademicYear | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AcademicYear | null>(null);

  const years = useLiveQuery(
    () => db.academicYears.where('trainerId').equals(trainer.id).sortBy('name'),
    [trainer.id]
  ) ?? [];

  function closeForm() {
    setName('');
    setEditing(null);
    setShowForm(false);
  }

  async function save() {
    const value = name.trim();
    if (!value) { toast('اكتب العام الدراسي أولاً', 'err'); return; }
    const duplicate = await db.academicYears.where('[trainerId+name]').equals([trainer.id, value]).first();
    if (duplicate && duplicate.id !== editing?.id) {
      toast('هذا العام الدراسي موجود مسبقاً', 'err');
      return;
    }
    const now = Date.now();
    if (editing) {
      await db.academicYears.update(editing.id!, { name: value, updatedAt: now });
      toast('تم تعديل العام الدراسي');
    } else {
      await db.academicYears.add({ trainerId: trainer.id, name: value, createdAt: now, updatedAt: now });
      toast(`أُضيف العام الدراسي «${value}»`);
    }
    closeForm();
  }

  async function remove() {
    if (!confirmDelete) return;
    const used = await db.notes.where('academicYearId').equals(confirmDelete.id!).count();
    if (used) {
      toast(`لا يمكن الحذف: مرتبط بـ ${used} ملاحظة`, 'err');
    } else {
      await db.academicYears.delete(confirmDelete.id!);
      toast('تم حذف العام الدراسي');
    }
    setConfirmDelete(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">🗓️ الأعوام الدراسية</h2>
          <p className="text-xs text-slate-500 mt-1">تُستخدم لاختيار العام مباشرة من الملاحظة.</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setShowForm(true)}>＋ عام دراسي</button>
      </div>

      {!years.length ? (
        <div className="card p-8 text-center space-y-3">
          <div className="text-5xl">🗓️</div>
          <h3 className="font-bold">لا توجد أعوام دراسية بعد</h3>
          <p className="text-sm text-slate-500">أضف عاماً مثل «1447-1448» أو أنشئه من نموذج الملاحظة مباشرة.</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {years.map(year => (
            <div key={year.id} className="flex items-center gap-3 p-3.5">
              <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-800 grid place-items-center text-lg shrink-0">🗓️</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{year.name}</p>
                <p className="text-xs text-slate-500">أُنشئ {fmtDate(year.createdAt)} • آخر تعديل {fmtDate(year.updatedAt ?? year.createdAt)}</p>
              </div>
              <button className="btn-ghost !p-2 text-xs" onClick={() => { setEditing(year); setName(year.name); setShowForm(true); }}>✏️</button>
              <button className="btn-ghost !p-2 text-xs hover:!bg-red-50" onClick={() => setConfirmDelete(year)}>🗑️</button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title={editing ? 'تعديل العام الدراسي' : 'عام دراسي جديد'} onClose={closeForm}>
          <div className="space-y-3">
            <div>
              <label className="label">العام الدراسي *</label>
              <input className="input" autoFocus placeholder="مثال: 1447-1448" value={name}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && save()} />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={save}>{editing ? 'حفظ التعديل' : 'إضافة العام'}</button>
              <button className="btn-ghost" onClick={closeForm}>إلغاء</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title={`حذف «${confirmDelete.name}»؟`} onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600">لن يمكن حذف العام إذا كان مستخدماً في ملاحظة.</p>
          <div className="flex gap-2 pt-3">
            <button className="btn-danger flex-1" onClick={remove}>نعم، احذف</button>
            <button className="btn-ghost flex-1" onClick={() => setConfirmDelete(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
