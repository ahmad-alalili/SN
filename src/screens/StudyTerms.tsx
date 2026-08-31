import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Layers3, Pencil, Plus, Trash2 } from 'lucide-react';
import { db, type StudyTerm } from '../db/schema';
import { useActiveTrainer, useNav, useToast } from '../App';
import { fmtDate } from '../lib/media';
import { Modal } from './Trainees';

export default function StudyTerms() {
  const trainer = useActiveTrainer()!;
  const toast = useToast();
  const { go } = useNav();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<StudyTerm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StudyTerm | null>(null);

  const terms = useLiveQuery(
    () => db.studyTerms.where('trainerId').equals(trainer.id).sortBy('createdAt'),
    [trainer.id]
  ) ?? [];
  const courses = useLiveQuery(
    () => db.courses.where('trainerId').equals(trainer.id).toArray(),
    [trainer.id]
  ) ?? [];

  async function save() {
    const cleanName = name.trim();
    if (!cleanName) {
      toast('اكتب اسم الفصل أو المستوى', 'err');
      return;
    }
    const duplicate = terms.find(term => term.name === cleanName && term.id !== editing?.id);
    if (duplicate) {
      toast('هذا الفصل أو المستوى موجود مسبقاً', 'err');
      return;
    }
    if (editing) {
      await db.transaction('rw', [db.studyTerms, db.courses], async () => {
        await db.studyTerms.update(editing.id!, { name: cleanName, updatedAt: Date.now() });
        await db.courses.where('termId').equals(editing.id!).modify({ semester: cleanName });
      });
      toast('تم تعديل الاسم');
    } else {
      await db.studyTerms.add({
        trainerId: trainer.id,
        name: cleanName,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      toast(`تمت إضافة «${cleanName}»`);
    }
    setName('');
    setEditing(null);
  }

  function edit(term: StudyTerm) {
    setEditing(term);
    setName(term.name);
  }

  async function remove() {
    if (!confirmDelete) return;
    await db.transaction('rw', [db.studyTerms, db.courses], async () => {
      await db.courses.where('termId').equals(confirmDelete.id!).modify({ termId: null, semester: undefined });
      await db.studyTerms.delete(confirmDelete.id!);
    });
    toast('تم حذف الفصل وبقيت المقررات دون تصنيف');
    setConfirmDelete(null);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Layers3 className="text-brand-600" size={21} />
          <div>
            <h2 className="font-bold">الفصول والمستويات</h2>
            <p className="text-xs text-slate-500">أنشئ مجلداً ثم اربط المقررات به.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="مثال: الفصل الأول 1447" value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && save()} />
          <button className="btn-primary shrink-0" onClick={save}>
            {editing ? 'حفظ' : <><Plus size={17} /> إضافة</>}
          </button>
          {editing && <button className="btn-ghost" onClick={() => { setEditing(null); setName(''); }}>إلغاء</button>}
        </div>
      </div>

      {!terms.length ? (
        <div className="card p-8 text-center space-y-3">
          <Layers3 className="mx-auto text-brand-600" size={44} strokeWidth={1.5} />
          <h3 className="font-bold">لا توجد فصول بعد</h3>
          <p className="text-sm text-slate-500">أضف الفصل أو المستوى الأول من الخانة أعلاه.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {terms.map(term => {
            const count = courses.filter(course => course.termId === term.id).length;
            return (
              <article key={term.id} className="card p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-brand-100 grid place-items-center shrink-0">
                  <Layers3 size={21} className="text-brand-700" />
                </div>
                <button className="flex-1 min-w-0 text-right" onClick={() => go('courses', { termId: term.id })}>
                  <h3 className="font-bold truncate">{term.name}</h3>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <BookOpen size={13} /> {count} مقرر · أضيف {fmtDate(term.createdAt)}
                  </p>
                </button>
                <button className="btn-ghost !p-2" aria-label={`تعديل ${term.name}`} onClick={() => edit(term)}>
                  <Pencil size={16} />
                </button>
                <button className="btn-ghost !p-2 hover:!bg-red-50" aria-label={`حذف ${term.name}`} onClick={() => setConfirmDelete(term)}>
                  <Trash2 size={16} />
                </button>
              </article>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <Modal title={`حذف «${confirmDelete.name}»؟`} onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600">ستبقى المقررات محفوظة، وستنتقل إلى «بدون فصل».</p>
          <div className="flex gap-2 pt-3">
            <button className="btn-danger flex-1" onClick={remove}>حذف الفصل</button>
            <button className="btn-ghost flex-1" onClick={() => setConfirmDelete(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
