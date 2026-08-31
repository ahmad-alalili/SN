import { useRef, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, loadSettings, type AppSettings } from '../db/schema';
import { exportBackup, importBackup, storageEstimate } from '../db/backup';
import { useActiveTrainer, useAppearance, useToast, type AccentChoice, type BackgroundChoice } from '../App';
import { fmtSize, fmtDate } from '../lib/media';
import { saveAs } from '../lib/excel';
import { statusOf } from '../lib/status';

export default function Settings() {
  const t = useActiveTrainer()!;
  const toast = useToast();
  const { appearance, updateAppearance } = useAppearance();
  const backupRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null);

  // قواعد حالة المتدرب
  const settings = useLiveQuery(() => loadSettings(t.id), [t.id]);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);

  async function saveRules() {
    if (!draft) return;
    const y = Math.max(0, draft.wYellow), o = Math.max(1, draft.wOrange), r = Math.max(1, draft.wRed);
    const yMax = Math.max(1, draft.yellowMax), oMax = Math.max(yMax + 1, draft.orangeMax);
    await db.settings.put({ trainerId: t.id, wYellow: y, wOrange: o, wRed: r, yellowMax: yMax, orangeMax: oMax });
    setDraft({ trainerId: t.id, wYellow: y, wOrange: o, wRed: r, yellowMax: yMax, orangeMax: oMax });
    toast('تم حفظ قواعد الحالة — ستُطبق على جميع المتدربين فوراً');
  }

  const preview = draft ? statusOf(
    [
      { sev: 'yellow' }, { sev: 'yellow' },
      { sev: 'orange' }, { sev: 'red' }
    ],
    { ...draft }
  ) : null;

  const stats = useLiveQuery(async () => ({
    trainees: await db.trainees.where('trainerId').equals(t.id).count(),
    courses: await db.courses.where('trainerId').equals(t.id).count(),
    academicYears: await db.academicYears.where('trainerId').equals(t.id).count(),
    categories: await db.categories.where('trainerId').equals(t.id).count(),
    notes: await db.notes.where('trainerId').equals(t.id).count(),
    media: await db.attachments.count()
  }), [t.id]);

  async function doExportBackup(includeMedia: boolean) {
    setBusy('export');
    try {
      const blob = await exportBackup(includeMedia);
      saveAs(blob, `نسخة-احتياطية-${new Date().toISOString().slice(0, 10)}${includeMedia ? '' : '-بدون-وسائط'}.json`);
      toast('تم تنزيل النسخة الاحتياطية');
    } finally { setBusy(''); }
  }

  async function doImportBackup(f: File) {
    if (!confirm('⚠️ الاستيراد سيستبدل كل البيانات الحالية على هذا الجهاز. متأكد؟')) return;
    setBusy('import');
    try {
      const result = await importBackup(f);
      toast(result.restoredCategories
        ? `تمت استعادة النسخة وإضافة ${result.restoredCategories} تصنيف مفقود`
        : 'تمت استعادة النسخة الاحتياطية مع جميع تواريخها وتصنيفاتها');
      localStorage.removeItem('trainer-notes.activeTrainer');
      location.reload();
    } catch (e) {
      console.error(e);
      toast('الملف غير صالح', 'err');
    } finally { setBusy(''); }
  }

  async function wipe() {
    if (!confirm('⚠️⚠️ سيتم مسح كل بيانات هذا المدرب نهائياً (ملاحظات + وسائط). هل أنت متأكد تماماً؟')) return;
    if (!confirm('تأكيد أخير: لا يمكن التراجع! نزّل نسخة احتياطية أولاً إن شئت.')) return;
    setBusy('wipe');
    try {
      const myNotes = await db.notes.where('trainerId').equals(t.id).toArray();
      const noteIds = new Set(myNotes.map(n => n.id!));
      await db.transaction('rw', [db.notes, db.attachments], async () => {
        for (const a of await db.attachments.toArray()) {
          if (noteIds.has(a.noteId)) await db.attachments.delete(a.id!);
        }
        await db.notes.where('trainerId').equals(t.id).delete();
      });
      for (const coll of [db.trainees, db.courses, db.categories, db.academicYears, db.importLogs]) {
        await coll.where('trainerId').equals(t.id).delete();
      }
      toast('تم مسح بيانات المدرب بالكامل');
      localStorage.removeItem('trainer-notes.activeTrainer');
      location.reload();
    } finally { setBusy(''); }
  }

  useEffect(() => {
    storageEstimate().then(setEst);
    navigator.storage?.persisted?.().then(setStoragePersistent).catch(() => setStoragePersistent(null));
  }, []);

  async function keepDataOnDevice() {
    if (!navigator.storage?.persist) {
      toast('هذا المتصفح لا يدعم طلب الحفظ الدائم للبيانات', 'err');
      return;
    }
    const granted = await navigator.storage.persist();
    setStoragePersistent(granted);
    toast(granted
      ? 'تم تفعيل الحفظ الدائم للبيانات على هذا الجهاز'
      : 'المتصفح لم يمنح الحفظ الدائم. لا تحذف بيانات التصفح، وخذ نسخة احتياطية دورياً', granted ? 'ok' : 'err');
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <div>
          <h2 className="font-bold">المظهر</h2>
          <p className="text-xs text-slate-500 mt-1">اختيارات المظهر تحفظ على هذا الجهاز وتعمل دون إنترنت.</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-2">الخلفية الزجاجية</p>
          <div className="grid grid-cols-2 gap-3">
            <BackgroundOption id="coral" label="مرجانية" selected={appearance.background}
              onChoose={background => updateAppearance({ background })} />
            <BackgroundOption id="verdant" label="خضراء عميقة" selected={appearance.background}
              onChoose={background => updateAppearance({ background })} />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-2">لون التمييز</p>
          <div className="flex items-center gap-3" role="group" aria-label="لون التمييز">
            <AccentSwatch id="aqua" color="#48d4c4" selected={appearance.accent} onChoose={accent => updateAppearance({ accent })} />
            <AccentSwatch id="coral" color="#ffad91" selected={appearance.accent} onChoose={accent => updateAppearance({ accent })} />
            <AccentSwatch id="lime" color="#b7df78" selected={appearance.accent} onChoose={accent => updateAppearance({ accent })} />
          </div>
        </div>
      </div>

      {/* قواعد حالة المتدرب */}
      <div className="card p-4 space-y-3">
        <h2 className="font-bold">🚦 قواعد حالة المتدرب</h2>
        {draft && (
          <>
            {/* نقاط كل درجة */}
            <p className="text-xs text-slate-500">نقاط كل مخالفة حسب درجتها:</p>
            <div className="grid grid-cols-3 gap-2">
              <NumField label="🟡 خفيفة" value={draft.wYellow} min={0}
                onChange={v => setDraft({ ...draft, wYellow: v })} />
              <NumField label="🟠 متوسطة" value={draft.wOrange} min={1}
                onChange={v => setDraft({ ...draft, wOrange: v })} />
              <NumField label="🔴 خطرة" value={draft.wRed} min={1}
                onChange={v => setDraft({ ...draft, wRed: v })} />
            </div>

            {/* حدود الألوان */}
            <p className="text-xs text-slate-500 pt-1">متى يتحول لون الطالب؟ (بالمجموع التراكمي):</p>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="🟡 يبقى أصفر حتى" value={draft.yellowMax} min={1}
                onChange={v => setDraft({ ...draft, yellowMax: v })} />
              <NumField label="🟠 يبقى برتقالياً حتى" value={draft.orangeMax} min={draft.yellowMax + 1}
                onChange={v => setDraft({ ...draft, orangeMax: v })} />
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 rounded-lg p-2.5">
              📊 المعادلة عندك الآن:
              فوق <b>{draft.yellowMax}</b> نقطة ← 🟠 متوسط،
              وفوق <b>{draft.orangeMax}</b> نقطة ← 🔴 كثير المخالفات.
              <br />مثال: مخالفتان حمراوان = <b>{draft.wRed * 2}</b> نقاط ←{' '}
              {preview && draft.wRed * 2 > draft.orangeMax ? '🔴 كثير المخالفات' : preview && draft.wRed * 2 > draft.yellowMax ? '🟠 متوسط' : '🟡 خفيف'}
            </p>

            {/* معاينة حية */}
            {preview && (
              <div className={`rounded-xl p-3 text-sm font-bold ${preview.cls.replace('!bg-', 'bg-').replace('!text-', 'text-')}`}>
                معاينة: طالب لديه ٢ صفراء + ١ برتقالية + ١ حمراء ({preview.points} نقاط) ← {preview.emoji} {preview.label}
              </div>
            )}

            <button className="btn-primary w-full" onClick={saveRules}>💾 حفظ القواعد</button>
          </>
        )}
      </div>

      {/* إحصائيات */}
      <div className="card p-4">
        <h2 className="font-bold mb-3">📊 ملخص البيانات</h2>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[['🧑‍🎓', 'متدرب', stats?.trainees ?? 0],
            ['📚', 'مقرر', stats?.courses ?? 0],
            ['🏷️', 'تصنيف', stats?.categories ?? 0],
            ['🗒️', 'ملاحظة', stats?.notes ?? 0]].map(([icon, label, v]) => (
            <div key={label as string} className="rounded-xl bg-slate-50 py-3">
              <div className="text-xl">{icon}</div>
              <div className="text-lg font-extrabold">{v as number}</div>
              <div className="text-[10px] text-slate-500">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-slate-400 mt-3">
          💾 مستخدم على الجهاز: {est ? `${fmtSize(est.usage)} من ~${fmtSize(est.quota)}` : '...'}
          {' • '}📎 إجمالي المرفقات: {stats?.media ?? 0}
        </p>
      </div>

      {/* إدارة التصنيفات */}
      <button className="card w-full p-4 flex items-center justify-between hover:bg-slate-50 transition"
        onClick={() => window.dispatchEvent(new CustomEvent('goto-categories'))}>
        <span className="font-bold">🏷️ إدارة التصنيفات</span>
        <span className="text-slate-400 text-sm">رئيسية وفرعية ←</span>
      </button>

      <button className="card w-full p-4 flex items-center justify-between hover:bg-slate-50 transition"
        onClick={() => window.dispatchEvent(new CustomEvent('goto-academic-years'))}>
        <span className="font-bold">🗓️ إدارة الأعوام الدراسية</span>
        <span className="text-slate-400 text-sm">{stats?.academicYears ?? 0} عام ←</span>
      </button>

      {/* النسخ الاحتياطي */}
      <div className="card p-4 space-y-3">
        <h2 className="font-bold">💾 النسخ الاحتياطي والاستعادة</h2>
        <p className="text-xs text-slate-500">
          بياناتك محفوظة على هذا الجهاز فقط. نزّل نسخة احتياطية دورياً — تشمل الملاحظات والوسائط.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy === 'export'} onClick={() => doExportBackup(true)}>
            ⬇️ نسخة كاملة (بالوسائط)
          </button>
          <button className="btn-ghost" disabled={busy === 'export'} onClick={() => doExportBackup(false)}>
            خفيفة (بدون وسائط)
          </button>
          <button className="btn-ghost" disabled={busy === 'import'} onClick={() => backupRef.current?.click()}>
            ⬆️ استعادة نسخة
          </button>
        </div>
        <input ref={backupRef} type="file" accept=".json" hidden
          onChange={e => { e.target.files?.[0] && doImportBackup(e.target.files[0]); e.target.value = ''; }} />
      </div>

      {/* التطبيق دون اتصال */}
      <div className="card p-4 space-y-3">
        <h2 className="font-bold">📱 العمل دون إنترنت</h2>
        <p className="text-xs text-slate-500">
          بعد فتح التطبيق مرة واحدة أثناء الاتصال، يُحفظ التطبيق وبياناته على هذا الجهاز ويمكن تشغيله بلا إنترنت.
        </p>
        <button className="btn-ghost w-full" onClick={keepDataOnDevice}>
          {storagePersistent ? '✓ بياناتي محفوظة بشكل دائم على الجهاز' : 'حفظ بياناتي بشكل دائم على هذا الجهاز'}
        </button>
        <p className="text-[11px] text-slate-400">
          ثبّت التطبيق من قائمة المتصفح عبر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»، ثم افتحه من أيقونته.
        </p>
      </div>

      {/* حول التطبيق */}
      <div className="card p-4 space-y-1.5 text-xs text-slate-500">
        <h2 className="font-bold text-sm text-slate-700">ℹ️ حول التطبيق</h2>
        <p>📝 ملاحظات المدرب — إصدار 1.0</p>
        <p>يعمل دون إنترنت 100% • البيانات محلية (IndexedDB) • قابل للتثبيت كتطبيق</p>
        <p className="pt-1">💡 لتثبيته: قائمة المتصفح ← «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p>
      </div>

      {/* منطقة الخطر */}
      <div className="card !border-red-200 p-4 space-y-2">
        <h2 className="font-bold text-red-600 text-sm">⚠️ منطقة الخطر</h2>
        <p className="text-xs text-slate-500">مسح كل بيانات المدرب الحالي ({t.name}) من هذا الجهاز.</p>
        <button className="btn-danger" disabled={busy === 'wipe'} onClick={wipe}>
          🗑️ مسح كل بياناتي
        </button>
      </div>
    </div>
  );
}

function BackgroundOption({ id, label, selected, onChoose }: {
  id: BackgroundChoice;
  label: string;
  selected: BackgroundChoice;
  onChoose: (background: BackgroundChoice) => void;
}) {
  return (
    <button type="button" className="appearance-background text-right p-3 flex items-end"
      style={{ backgroundImage: `url("${import.meta.env.BASE_URL}backgrounds/glass-${id}.png")` }}
      aria-pressed={selected === id} onClick={() => onChoose(id)}>
      <span className="text-xs font-bold text-white drop-shadow">{label}</span>
    </button>
  );
}

function AccentSwatch({ id, color, selected, onChoose }: {
  id: AccentChoice;
  color: string;
  selected: AccentChoice;
  onChoose: (accent: AccentChoice) => void;
}) {
  const labels: Record<AccentChoice, string> = { aqua: 'مائي', coral: 'مرجاني', lime: 'ليموني' };
  return (
    <button type="button" className="appearance-swatch" style={{ backgroundColor: color }}
      aria-label={`لون ${labels[id]}`} title={`لون ${labels[id]}`}
      aria-pressed={selected === id} onClick={() => onChoose(id)} />
  );
}

/* حقل رقمي صغير */
function NumField({ label, value, min, onChange }: {
  label: string; value: number; min: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-600 mb-1">{label}</span>
      <input type="number" className="input !py-2 text-center font-bold" min={min}
        value={value} onChange={e => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}
