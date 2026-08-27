import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category } from '../db/schema';
import { useActiveTrainer, useToast, useNav } from '../App';

export default function Categories() {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const { go } = useNav();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string; children: Category[] } | null>(null);

  const categories = useLiveQuery(
    () => db.categories.where('trainerId').equals(t.id).toArray(),
    [t.id]
  ) ?? [];

  if (!categories.length) {
    return <Empty onAdd={n => db.categories.add({ trainerId: t.id, parentId: null, name: n, createdAt: Date.now() })} go={go} />;
  }

  const roots = categories.filter(c => !c.parentId);
  const childrenOf = (id: number) => categories.filter(c => c.parentId === id);

  async function addCategory(pname: string, pid: string) {
    const n = pname.trim();
    if (!n) return;
    await db.categories.add({
      trainerId: t.id,
      parentId: pid ? Number(pid) : null,
      name: n,
      createdAt: Date.now()
    });
    setName(''); setParentId('');
    toast(`تمت إضافة التصنيف «${n}»`);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <h2 className="font-bold">➕ إضافة تصنيف</h2>
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1 min-w-40" placeholder="اسم التصنيف..." value={name}
            onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory(name, parentId)} />
          <select className="input w-auto" value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">تصنيف رئيسي</option>
            {roots.map(r => <option key={r.id} value={r.id}>فرعي من: {r.name}</option>)}
          </select>
          <button className="btn-primary" onClick={() => addCategory(name, parentId)}>إضافة</button>
        </div>
      </div>

      <div className="space-y-3">
        {roots.map(root => {
          const kids = childrenOf(root.id!);
          return (
            <div key={root.id} className="card p-4">
              <Row cat={root} count={kids.length}
                editing={editing} editName={editName}
                onStartEdit={() => { setEditing(root.id!); setEditName(root.name); }}
                onEditChange={setEditName}
                onSaveEdit={async () => {
                  if (editName.trim()) {
                    await db.categories.update(editing!, { name: editName.trim() });
                    toast('تم التعديل');
                  }
                  setEditing(null);
                }}
                onDelete={async () => {
                  if (kids.length) {
                    setConfirmDelete({ id: root.id!, name: root.name, children: kids });
                  } else {
                    const notesCount = await db.notes.where('categoryId').equals(root.id!).count()
                      + await db.notes.where('subcategoryId').equals(root.id!).count();
                    if (notesCount > 0) {
                      toast(`لا يمكن الحذف: ${notesCount} ملاحظة مرتبطة بهذا التصنيف`, 'err');
                    } else {
                      await db.categories.delete(root.id!);
                      toast('تم حذف التصنيف');
                    }
                  }
                }} />
              {kids.length > 0 && (
                <div className="mt-2 mr-5 pr-4 border-r-2 border-brand-200 space-y-1.5">
                  {kids.map(k => (
                    <Row key={k.id} cat={k} sub count={0}
                      editing={editing} editName={editName}
                      onStartEdit={() => { setEditing(k.id!); setEditName(k.name); }}
                      onEditChange={setEditName}
                      onSaveEdit={async () => {
                        if (editName.trim()) {
                          await db.categories.update(editing!, { name: editName.trim() });
                          toast('تم التعديل');
                        }
                        setEditing(null);
                      }}
                      onDelete={async () => {
                        const notesCount = await db.notes.where('subcategoryId').equals(k.id!).count();
                        if (notesCount > 0) {
                          toast(`لا يمكن الحذف: ${notesCount} ملاحظة مرتبطة`, 'err');
                        } else {
                          await db.categories.delete(k.id!);
                          toast('تم حذف الفرعي');
                        }
                      }} />
                  ))}
                </div>
              )}
            </div>
            );
        })}
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog info={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onMoveChildrenTo={async targetId => {
            await db.categories.bulkUpdate(confirmDelete.children.map(c => ({ key: c.id!, changes: { parentId: targetId } })));
            await db.categories.delete(confirmDelete.id);
            setConfirmDelete(null);
            toast('تم نقل الفروع وحذف الرئيسي');
          }}
          onDeleteAll={async () => {
            for (const c of confirmDelete.children) {
              const cnt = await db.notes.where('subcategoryId').equals(c.id!).count();
              if (cnt > 0) { toast('يوجد ملاحظات مرتبطة بالفروع — لا يمكن الحذف', 'err'); return; }
            }
            const rootCnt = await db.notes.where('categoryId').equals(confirmDelete.id).count();
            if (rootCnt > 0) { toast('يوجد ملاحظات على الرئيسي مباشرة', 'err'); return; }
            await db.categories.bulkDelete(confirmDelete.children.map(c => c.id!));
            await db.categories.delete(confirmDelete.id);
            setConfirmDelete(null);
            toast('تم الحذف الكامل');
          }} />
      )}
    </div>
  );
}

/* ================== صف تصنيف ================== */
const SEV_NEXT: Record<string, '' | 'yellow' | 'orange' | 'red'> = {
  '': 'yellow', yellow: 'orange', orange: 'red', red: ''
};
const SEV_CLS: Record<string, string> = {
  '': 'bg-slate-200', yellow: 'bg-yellow-400', orange: 'bg-orange-500', red: 'bg-red-500'
};
function SeverityDot({ id, sev }: { id: number; sev: '' | 'yellow' | 'orange' | 'red' }) {
  return (
    <button className={`w-4 h-4 rounded-full shrink-0 border border-black/10 ${SEV_CLS[sev]} hover:scale-110 transition`}
      title={`درجة الخطورة: ${sev === '' ? 'بدون' : sev === 'yellow' ? 'خفيفة 🟡' : sev === 'orange' ? 'متوسطة 🟠' : 'خطرة 🔴'} — انقر للتغيير`}
      onClick={e => { e.stopPropagation(); db.categories.update(id, { severity: SEV_NEXT[sev] }); }} />
  );
}

function Row({ cat, sub, count, editing, editName, onStartEdit, onEditChange, onSaveEdit, onDelete }: {
  cat: Category; sub?: boolean; count: number;
  editing: number | null; editName: string;
  onStartEdit: () => void; onEditChange: (v: string) => void; onSaveEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${sub ? 'bg-slate-50' : ''}`}>
      {sub ? <span className="text-slate-400">↳</span> : <span className="text-lg">🏷️</span>}
      {editing === cat.id ? (
        <>
          <input className="input py-1.5" value={editName} autoFocus
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSaveEdit()} />
          <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={onSaveEdit}>حفظ</button>
        </>
      ) : (
        <>
          <span className="flex-1 font-semibold flex items-center gap-1.5">
            <SeverityDot id={cat.id!} sev={cat.severity ?? ''} />
            {cat.name}
          </span>
          {count > 0 && <span className="chip">{count} فرع</span>}
          <button className="btn-ghost !p-2 text-xs" onClick={onStartEdit} title="تعديل">✏️</button>
          <button className="btn-ghost !p-2 text-xs hover:!bg-red-50" onClick={onDelete} title="حذف">🗑️</button>
        </>
      )}
    </div>
  );
}

/* ================== نافذة حذف رئيسي له فروع ================== */
function ConfirmDeleteDialog({ info, onClose, onMoveChildrenTo, onDeleteAll }: {
  info: { id: number; name: string; children: Category[] };
  onClose: () => void;
  onMoveChildrenTo: (targetId: number | null) => void;
  onDeleteAll: () => void;
}) {
  const others = useLiveQuery(() => db.categories.where('trainerId').notEqual(0).toArray(), []) ?? [];
  const moveTargets = others.filter(c => c.parentId === null && c.id !== info.id);
  const [target, setTarget] = useState<string>(moveTargets[0]?.id?.toString() ?? '');
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-red-600">حذف «{info.name}»</h3>
        <p className="text-sm text-slate-600">
          هذا التصنيف يحوي {info.children.length} فرعاً. ماذا تريد أن نفعل بها؟
        </p>
        <select className="input" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">ترقيتها إلى تصنيفات رئيسية</option>
          {moveTargets.map(r => <option key={r.id} value={r.id}>نقلها إلى: {r.name}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn-danger flex-1"
            onClick={() => onMoveChildrenTo(target ? Number(target) : null)}>
            نقل الفروع والحذف
          </button>
          <button className="btn-ghost flex-1" onClick={onDeleteAll}>حذف الكل</button>
          <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

/* ================== حالة فارغة ================== */
function Empty({ onAdd, go }: { onAdd: (name: string) => void; go: ReturnType<typeof useNav>['go'] }) {
  const [name, setName] = useState('');
  const examples = ['أداء عملي', 'حضور وانصراف', 'مشروع تخرج', 'مشاركة وتفاعل'];
  return (
    <div className="card p-8 text-center space-y-4">
      <div className="text-5xl">🏷️</div>
      <h2 className="font-bold text-lg">ابدأ بإنشاء تصنيفاتك</h2>
      <p className="text-sm text-slate-500">التصنيفات تساعدك في تنظيم الملاحظات واسترجاعها لاحقاً — مثل «أداء عملي» أو «حضور».</p>
      <div className="flex flex-wrap justify-center gap-2">
        {examples.map(ex => (
          <button key={ex} className="chip hover:bg-brand-100 cursor-pointer"
            onClick={() => onAdd(ex)}>+ {ex}</button>
        ))}
      </div>
      <div className="flex gap-2 max-w-xs mx-auto pt-2">
        <input className="input" placeholder="اسم تصنيف جديد..." value={name}
          onChange={e => setName(e.target.value)} />
        <button className="btn-primary shrink-0" onClick={() => { onAdd(name); setName(''); }}>إضافة</button>
      </div>
      <button className="text-xs text-slate-400 underline" onClick={() => go('note-form')}>الذهاب إلى نموذج الملاحظة ←</button>
    </div>
  );
}
