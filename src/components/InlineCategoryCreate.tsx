import { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Severity } from '../db/schema';
import { useActiveTrainer, useToast } from '../App';
import { SEV_DOT, SEV_LABEL } from '../lib/status';

/**
 * قائمة منسدلة لاختيار تصنيف مع إنشاء فوري + تحديد درجة الخطورة
 * (🟡 خفيفة / 🟠 متوسطة / 🔴 خطرة) — تُستخدم لحساب حالة المتدرب.
 */
export default function CategorySelect({
  parentId, value, onChange, placeholder = 'اختر التصنيف...'
}: {
  parentId?: number | null;
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
}) {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSev, setNewSev] = useState<Severity>('');
  const boxRef = useRef<HTMLDivElement>(null);

  const cats = useLiveQuery(
    () => db.categories.where('trainerId').equals(t.id).toArray(),
    [t.id]
  ) ?? [];

  const pool = parentId == null ? cats.filter(c => c.parentId === null) : cats.filter(c => c.parentId === parentId);
  const filtered = pool.filter(c => !q.trim() || c.name.includes(q.trim()));
  const selected = cats.find(c => c.id === value);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function createNew() {
    const n = newName.trim();
    if (!n) return;
    const dup = pool.find(c => c.name === n);
    if (dup) {
      // تحديث الخطورة لو اختيرت أثناء الإنشاء
      if (newSev && dup.severity !== newSev) await db.categories.update(dup.id!, { severity: newSev });
      onChange(dup.id!); setCreating(false); setNewName(''); setNewSev(''); setOpen(false);
      return;
    }
    const id = await db.categories.add({
      trainerId: t.id,
      parentId: parentId ?? null,
      name: n,
      severity: newSev || undefined,
      createdAt: Date.now()
    });
    onChange(id);
    toast(`أُنشئ التصنيف «${n}»${newSev ? ` (${SEV_LABEL[newSev]})` : ''}`);
    setCreating(false); setNewName(''); setNewSev(''); setOpen(false);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" className={`input text-right flex items-center justify-between ${value ? '' : 'text-slate-400'}`}
        onClick={() => setOpen(o => !o)}>
        <span className="truncate flex items-center gap-1.5">
          {selected?.severity ? (
            <span className={`w-2 h-2 rounded-full inline-block ${SEV_DOT[selected.severity]}`} />
          ) : null}
          {selected?.name ?? placeholder}
        </span>
        <span className="text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full card p-2 shadow-lg max-h-80 overflow-auto">
          {!creating ? (
            <>
              <input className="input mb-2 py-1.5" autoFocus placeholder='🔍 بحث...' value={q}
                onChange={e => setQ(e.target.value)} />
              <button type="button"
                className="w-full text-right rounded-lg px-3 py-2 text-sm hover:bg-slate-100 flex items-center justify-between"
                onClick={() => onChange(null)}>
                <span className="text-slate-400">{parentId != null ? '— بدون تصنيف فرعي —' : '— اختر لاحقاً —'}</span>
              </button>
              {filtered.map(c => (
                <div key={c.id}
                  className={`w-full rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-brand-50 flex items-center gap-1 ${c.id === value ? 'bg-brand-100' : ''}`}>
                  <button type="button" className="flex-1 text-right flex items-center gap-1.5 min-w-0"
                    onClick={() => { onChange(c.id!); setOpen(false); }}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${c.severity ? SEV_DOT[c.severity] : 'bg-slate-200'}`}
                      title={c.severity ? SEV_LABEL[c.severity] : 'بدون خطورة'} />
                    <span className="truncate">{c.name}</span>
                    {c.id === value && <span> ✓</span>}
                  </button>
                  {/* تبديل سريع للخطورة بالنقر على الدائرة اليمنى */}
                  <SeverityToggle id={c.id!} sev={c.severity ?? ''} />
                </div>
              ))}
              {!filtered.length && q.trim() && (
                <p className="px-3 py-2 text-xs text-slate-400">لا نتائج — أنشئه من الأسفل 👇</p>
              )}
              <div className="border-t border-dashed border-slate-200 mt-2 pt-2">
                <button type="button" className="w-full text-right rounded-lg px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50"
                  onClick={() => setCreating(true)}>
                  ＋ تصنيف جديد...
                </button>
              </div>
            </>
          ) : (
            <div className="p-1 space-y-2">
              <label className="label !mb-0">تصنيف {parentId != null ? 'فرعي' : 'رئيسي'} جديد</label>
              <input className="input" autoFocus value={newName} placeholder="اكتب الاسم..."
                onChange={e => setNewName(e.target.value)} />
              <div>
                <label className="label !mb-1 text-xs">درجة الخطورة (تحسب على حالة المتدرب)</label>
                <div className="flex gap-1">
                  {(['', 'yellow', 'orange', 'red'] as Severity[]).map(s => (
                    <button type="button" key={s || 'none'}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold border transition
                        ${newSev === s ? 'bg-brand-700 text-white border-brand-700' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                      onClick={() => setNewSev(s)}>
                      {SEV_LABEL[s]}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">مثال: نسيان أدوات 🟡 • تأخر متكرر 🟠 • تدخين 🔴</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1 !py-1.5 text-xs" onClick={createNew}>حفظ واستخدام</button>
                <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setCreating(false)}>رجوع</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  async function createFromQ(n: string) {
    const dup = pool.find(c => c.name === n);
    if (dup) { onChange(dup.id!); setOpen(false); return; }
    const id = await db.categories.add({
      trainerId: t.id, parentId: parentId ?? null, name: n, createdAt: Date.now()
    });
    onChange(id);
    toast(`أُنشئ «${n}» واختير فوراً`);
    setOpen(false); setQ('');
  }
}

/* تبديل خطورة تصنيف موجود من داخل القائمة */
function SeverityToggle({ id, sev }: { id: number; sev: Severity }) {
  const next: Record<string, Severity> = { '': 'yellow', yellow: 'orange', orange: 'red', red: '' };
  const cls: Record<string, string> = {
    '': 'bg-slate-200', yellow: 'bg-yellow-400', orange: 'bg-orange-500', red: 'bg-red-500'
  };
  return (
    <button type="button"
      className={`w-4 h-4 rounded-full shrink-0 border border-black/10 ${cls[sev]} hover:scale-110 transition`}
      title={`الخطورة: ${SEV_LABEL[sev] || 'بدون'} — انقر للتغيير`}
      onClick={e => {
        e.stopPropagation();
        db.categories.update(id, { severity: next[sev] });
      }} />
  );
}
