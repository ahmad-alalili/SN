import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ArrowRight, BookCopy, CirclePlus, FilePlus2, FolderOpen, KeyRound, Layers3, NotebookPen, NotebookTabs, Settings2, ShieldCheck, UserRound, UsersRound, type LucideIcon } from 'lucide-react';
import { db, type Trainer } from './db/schema';
import {
  importPortableTrainer, inspectPortableFile, linkPortableTrainer, pickPortableOpenFile, pickPortableSaveHandle,
  saveLinkedTrainer, supportsDirectPortableFiles, watchPortableTrainer, type PickedPortableFile, type PortableFileInfo
} from './db/portable';

/* ================== Toasts ================== */
interface Toast { id: number; msg: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

function ToastHost({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[92vw] max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className={`rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg animate-[fadein_.2s_ease] ${t.kind === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {t.kind === 'ok' ? '✅ ' : '⚠️ '}{t.msg}
        </div>
      ))}
    </div>
  );
}

/* ================== المدرب النشط ================== */
const ACTIVE_KEY = 'trainer-notes.activeTrainer';
interface ActiveTrainer { id: number; name: string }
const TrainerCtx = createContext<ActiveTrainer | null>(null);
export const useActiveTrainer = () => useContext(TrainerCtx);

export type BackgroundChoice = 'coral' | 'verdant' | 'graphite';
export type AccentChoice = 'aqua' | 'coral' | 'lime';
export interface AppAppearance {
  background: BackgroundChoice;
  accent: AccentChoice;
}
const APPEARANCE_KEY = 'trainer-notes.appearance';
const DEFAULT_APPEARANCE: AppAppearance = { background: 'verdant', accent: 'aqua' };
const AppearanceCtx = createContext<{
  appearance: AppAppearance;
  updateAppearance: (next: Partial<AppAppearance>) => void;
}>({ appearance: DEFAULT_APPEARANCE, updateAppearance: () => {} });
export const useAppearance = () => useContext(AppearanceCtx);

function loadAppearance(): AppAppearance {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}') as Partial<AppAppearance>;
    return {
      background: ['coral', 'verdant', 'graphite'].includes(saved.background ?? '')
        ? saved.background as BackgroundChoice
        : DEFAULT_APPEARANCE.background,
      accent: ['aqua', 'coral', 'lime'].includes(saved.accent ?? '')
        ? saved.accent as AccentChoice
        : DEFAULT_APPEARANCE.accent
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export type Screen = 'notes' | 'note-form' | 'trainees' | 'courses' | 'study-terms' | 'categories' | 'academic-years' | 'import' | 'settings';
interface NavCtxT {
  screen: Screen;
  params: Record<string, unknown>;
  go: (s: Screen, p?: Record<string, unknown>) => void;
}
const NavContext = createContext<NavCtxT>({ screen: 'notes', params: {}, go: () => {} });
export const useNav = () => useContext(NavContext);

export default function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const [active, setActive] = useState<ActiveTrainer | null>(() => {
    try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null'); } catch { return null; }
  });
  const [appearance, setAppearance] = useState<AppAppearance>(loadAppearance);
  const updateAppearance = useCallback((next: Partial<AppAppearance>) => {
    setAppearance(current => ({ ...current, ...next }));
  }, []);
  useEffect(() => {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  }, [appearance]);
  useEffect(() => {
    if (!active) return;
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
    db.trainers.get(active.id).then(t => {
      if (!t) { setActive(null); localStorage.removeItem(ACTIVE_KEY); }
    });
  }, [active]);
  useEffect(() => active ? watchPortableTrainer(active.id) : undefined, [active?.id]);

  const [screen, setScreen] = useState<Screen>(() => {
    const h = location.hash.replace(/^#\//, '') as Screen;
    return ['notes', 'note-form', 'trainees', 'courses', 'study-terms', 'categories', 'academic-years', 'import', 'settings'].includes(h) ? h : 'notes';
  });
  const [params, setParams] = useState<Record<string, unknown>>({});
  const go = useCallback((s: Screen, p: Record<string, unknown> = {}) => {
    setScreen(s); setParams(p);
    if (location.hash !== `#/${s}`) history.replaceState(null, '', `#/${s}`);
    window.scrollTo({ top: 0 });
  }, []);

  // دعم الروابط العميقة عبر الـ hash (#/trainees ...)
  useEffect(() => {
    const valid: Screen[] = ['notes', 'note-form', 'trainees', 'courses', 'study-terms', 'categories', 'academic-years', 'import', 'settings'];
    const h = () => {
      const s = location.hash.replace(/^#\//, '') as Screen;
      if (valid.includes(s)) { setScreen(s); setParams({}); }
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  // تنقل عبر أحداث مخصصة (من شاشة الإعدادات)
  useEffect(() => {
    const h = () => go('categories');
    window.addEventListener('goto-categories', h);
    return () => window.removeEventListener('goto-categories', h);
  }, [go]);

  useEffect(() => {
    const h = () => go('academic-years');
    window.addEventListener('goto-academic-years', h);
    return () => window.removeEventListener('goto-academic-years', h);
  }, [go]);

  // اختصارات التنقل: Alt+1..7 (إمكانية وصول)
  useEffect(() => {
    const map: Record<string, Screen> = {
      '1': 'notes', '2': 'note-form', '3': 'trainees',
      '4': 'courses', '5': 'study-terms', '6': 'categories', '7': 'import', '8': 'settings'
    };
    const h = (e: KeyboardEvent) => {
      const s = map[e.key];
      if (s && e.altKey) { e.preventDefault(); go(s); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [go]);

  return (
    <AppearanceCtx.Provider value={{ appearance, updateAppearance }}>
      {!active ? <TrainerPicker onPick={setActive} /> : (
        <ToastCtx.Provider value={toast}>
          <TrainerCtx.Provider value={active}>
            <NavContext.Provider value={{ screen, params, go }}>
              <div
                className="glass-app min-h-screen pb-24"
                data-background={appearance.background}
                data-accent={appearance.accent}
                style={{ backgroundImage: `url("${import.meta.env.BASE_URL}backgrounds/glass-${appearance.background}.png")` }}
              >
                <Header name={active.name}
                  onSwitch={() => { localStorage.removeItem(ACTIVE_KEY); setActive(null); }} />
                <main className="max-w-3xl mx-auto px-4 pt-4">
                  {screen === 'notes' && <NotesListLazy />}
                  {screen === 'note-form' && <NoteFormLazy />}
                  {screen === 'trainees' && <TraineesLazy />}
                  {screen === 'courses' && <CoursesLazy />}
                  {screen === 'study-terms' && <StudyTermsLazy />}
                  {screen === 'categories' && <CategoriesLazy />}
                  {screen === 'academic-years' && <AcademicYearsLazy />}
                  {screen === 'import' && <ImportLazy />}
                  {screen === 'settings' && <SettingsLazy />}
                </main>
                <BottomNav screen={screen} />
              </div>
            </NavContext.Provider>
          </TrainerCtx.Provider>
          <ToastHost toasts={toasts} />
        </ToastCtx.Provider>
      )}
    </AppearanceCtx.Provider>
  );
}

/* ================== التحميل الكسول ================== */
import NotesList from './screens/NotesList';
import NoteForm from './screens/NoteForm';
import Trainees from './screens/Trainees';
import Courses from './screens/Courses';
import StudyTerms from './screens/StudyTerms';
import Categories from './screens/Categories';
import AcademicYears from './screens/AcademicYears';
import ImportScreen from './screens/Import';
import Settings from './screens/Settings';
const NotesListLazy = NotesList;
const NoteFormLazy = NoteForm;
const TraineesLazy = Trainees;
const CoursesLazy = Courses;
const StudyTermsLazy = StudyTerms;
const CategoriesLazy = Categories;
const AcademicYearsLazy = AcademicYears;
const ImportLazy = ImportScreen;
const SettingsLazy = Settings;

/* ================== الترويسة ================== */
function Header({ name, onSwitch }: { name: string; onSwitch: () => void }) {
  return (
    <header className="app-header sticky top-0 z-40 text-white shadow-md">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2"><NotebookPen size={21} /> ملاحظات المدرب</h1>
        <button onClick={onSwitch}
          className="flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs font-bold transition"
          title="تبديل ملف المدرب">
          <UserRound size={15} /> {name}
        </button>
      </div>
    </header>
  );
}

/* ================== الشريط السفلي ================== */
const NAV: { s: Screen; icon: LucideIcon; label: string }[] = [
  { s: 'notes', icon: NotebookTabs, label: 'الملاحظات' },
  { s: 'note-form', icon: CirclePlus, label: 'جديدة' },
  { s: 'trainees', icon: UsersRound, label: 'المتدربون' },
  { s: 'courses', icon: BookCopy, label: 'المقررات' },
  { s: 'study-terms', icon: Layers3, label: 'الفصول' },
  { s: 'settings', icon: Settings2, label: 'الإعدادات' }
];
function BottomNav({ screen }: { screen: Screen }) {
  const { go } = useNav();
  return (
    <nav className="app-bottom-nav fixed bottom-0 inset-x-0 z-40 border-t shadow-[0_-2px_10px_rgba(0,0,0,.04)]">
      <div className="max-w-3xl mx-auto grid grid-cols-6">
        {NAV.map(n => {
          const Icon = n.icon;
          return (
          <button key={n.s} onClick={() => go(n.s)} aria-label={n.label}
            className={`app-nav-button flex flex-col items-center py-2.5 text-[10px] font-semibold transition
              ${screen === n.s ? 'text-brand-700' : 'text-slate-500 hover:text-brand-600'}`}>
            <span className={`leading-none mb-1 ${n.s === 'note-form' ? 'app-create-nav grid place-items-center w-11 h-11 -mt-6 rounded-full text-white shadow-lg' : ''}`}>
              <Icon size={n.s === 'note-form' ? 23 : 21} strokeWidth={1.8} />
            </span>
            {n.label}
          </button>
        );})}
      </div>
    </nav>
  );
}

/* ================== شاشة اختيار المدرب ================== */
function TrainerPicker({ onPick }: { onPick: (t: ActiveTrainer) => void }) {
  const [trainers, setTrainers] = React.useState<Trainer[]>([]);
  const [mode, setMode] = useState<'home' | 'create' | 'open'>('home');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [encryptFile, setEncryptFile] = useState(true);
  const [picked, setPicked] = useState<PickedPortableFile | null>(null);
  const [pickedInfo, setPickedInfo] = useState<PortableFileInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const refresh = () => db.trainers.orderBy('name').toArray().then(setTrainers);
  useEffect(() => { refresh(); }, []);

  async function add() {
    const n = name.trim();
    setError('');
    if (!n) { setError('اكتب اسم المدرب أولاً'); return; }
    if (encryptFile && password.length < 6) { setError('استخدم كلمة مرور من 6 أحرف على الأقل'); return; }
    if (encryptFile && password !== passwordAgain) { setError('كلمتا المرور غير متطابقتين'); return; }
    setBusy(true);
    let trainerId: number | undefined;
    try {
      const handle = await pickPortableSaveHandle(n);
      trainerId = await db.trainers.add({ name: n, createdAt: Date.now() });
      await linkPortableTrainer(trainerId, n, password, handle, encryptFile);
      await saveLinkedTrainer(trainerId, { userInitiated: true, downloadFallback: true });
      onPick({ id: trainerId, name: n });
    } catch (cause) {
      if (trainerId) {
        await db.portableFiles.delete(trainerId);
        await db.trainers.delete(trainerId);
      }
      if ((cause as DOMException)?.name !== 'AbortError') {
        setError(cause instanceof Error ? cause.message : 'تعذر إنشاء ملف المدرب');
      }
    } finally { setBusy(false); }
  }

  async function acceptPreviousFile(selected: PickedPortableFile) {
    setError('');
    try {
      const info = await inspectPortableFile(selected.file);
      setPicked(selected);
      setPickedInfo(info);
      if (!info.encrypted) setPassword('');
    } catch (cause) {
      setPicked(null);
      setPickedInfo(null);
      setError(cause instanceof Error ? cause.message : 'الملف غير صالح');
    }
  }

  async function choosePreviousFile() {
    setError('');
    try {
      const selected = await pickPortableOpenFile();
      if (selected) await acceptPreviousFile(selected);
      else fileRef.current?.click();
    } catch (cause) {
      if ((cause as DOMException)?.name !== 'AbortError') setError('تعذر فتح منتقي الملفات');
    }
  }

  async function openPrevious() {
    if (!picked) { setError('اختر ملف المدرب أولاً'); return; }
    if (pickedInfo?.encrypted && !password) { setError('أدخل كلمة مرور الملف'); return; }
    if (trainers.length && !confirm('فتح الملف السابق سيستبدل البيانات المحلية الحالية على هذا المتصفح. هل تريد المتابعة؟')) return;
    setBusy(true); setError('');
    try {
      const trainer = await importPortableTrainer(picked, password);
      onPick(trainer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر فتح ملف المدرب');
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-700 to-brand-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center text-white mb-6">
          <NotebookPen className="w-12 h-12 mx-auto mb-2" strokeWidth={1.7} />
          <h1 className="text-2xl font-extrabold">ملاحظات المدرب</h1>
          <p className="text-brand-100 text-sm mt-1">سجّل ملاحظاتك عن متدربيك — أينما كنت، حتى دون إنترنت</p>
        </div>
        <div className="card p-5 space-y-3">
          {mode === 'home' && (
            <>
              {trainers.length > 0 && <h2 className="font-bold">ملفات المدربين على هذا الجهاز</h2>}
              {trainers.map(trainer => (
                <button key={trainer.id} onClick={() => onPick({ id: trainer.id!, name: trainer.name })}
                  className="w-full btn-ghost justify-between gap-3">
                  <span className="flex items-center gap-2"><UserRound className="w-4 h-4" />{trainer.name}</span>
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
              ))}
              <div className={trainers.length ? 'pt-3 border-t border-slate-200/60 space-y-2' : 'space-y-2'}>
                <button className="btn-primary w-full" onClick={() => { setMode('create'); setError(''); }}>
                  <FilePlus2 className="w-5 h-5" /> إنشاء ملف مدرب جديد
                </button>
                <button className="btn-ghost w-full" onClick={() => { setMode('open'); setError(''); }}>
                  <FolderOpen className="w-5 h-5" /> فتح ملف مدرب سابق
                </button>
              </div>
            </>
          )}

          {mode === 'create' && (
            <div className="space-y-3">
              <button className="text-sm text-slate-500 flex items-center gap-1" onClick={() => setMode('home')}>
                <ArrowRight className="w-4 h-4" /> رجوع
              </button>
              <div>
                <h2 className="font-bold">إنشاء ملف مدرب جديد</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {supportsDirectPortableFiles()
                    ? 'ستختار مكان الملف، ثم تُحفظ التغييرات فيه تلقائياً.'
                    : 'سيُنزل ملف يمكنك حفظه في الملفات أو iCloud.'}
                </p>
              </div>
              <label className="block"><span className="label">اسم المدرب</span>
                <input className="input" autoComplete="name" placeholder="اسم المدرب..." value={name} onChange={e => setName(e.target.value)} />
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer">
                <input type="checkbox" className="mt-1 accent-[var(--app-accent)]" checked={encryptFile}
                  onChange={e => setEncryptFile(e.target.checked)} />
                <span><span className="font-semibold text-sm flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> تشفير الملف بكلمة مرور</span>
                  <span className="block text-xs text-slate-500 mt-1">موصى به، ويمكن إيقافه إذا كنت تريد ملفاً بلا كلمة مرور.</span></span>
              </label>
              {encryptFile ? <>
                <label className="block"><span className="label">كلمة مرور الملف</span>
                  <div className="relative"><KeyRound className="absolute right-3 top-3 w-4 h-4 text-slate-400" />
                    <input className="input !pr-10" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
                  </div>
                </label>
                <label className="block"><span className="label">تأكيد كلمة المرور</span>
                  <input className="input" type="password" autoComplete="new-password" value={passwordAgain}
                    onChange={e => setPasswordAgain(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
                </label>
              </> : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  الملف غير المشفر يمكن فتحه وقراءة محتوياته خارج التطبيق.
                </p>
              )}
              <button className="btn-primary w-full" disabled={busy} onClick={add}>
                <FilePlus2 className="w-5 h-5" /> {busy ? 'جارٍ الإنشاء...' : 'إنشاء واختيار مكان الحفظ'}
              </button>
            </div>
          )}

          {mode === 'open' && (
            <div className="space-y-3">
              <button className="text-sm text-slate-500 flex items-center gap-1" onClick={() => setMode('home')}>
                <ArrowRight className="w-4 h-4" /> رجوع
              </button>
              <div><h2 className="font-bold">فتح ملف مدرب سابق</h2>
                <p className="text-xs text-slate-500 mt-1">اختر ملف `.trainer-notes`، وسيكتشف التطبيق تلقائياً هل يحتاج كلمة مرور.</p>
              </div>
              <button className="btn-ghost w-full" onClick={choosePreviousFile}>
                <FolderOpen className="w-5 h-5" /> {picked ? picked.file.name : 'اختيار الملف'}
              </button>
              <input ref={fileRef} hidden type="file" accept=".trainer-notes,application/vnd.trainer-notes+json"
                onChange={e => { const file = e.target.files?.[0]; if (file) void acceptPreviousFile({ file }); e.target.value = ''; }} />
              {pickedInfo && (
                <p className={`text-xs rounded-lg border p-2.5 ${pickedInfo.encrypted ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                  {pickedInfo.encrypted ? 'هذا الملف مشفر ويتطلب كلمة مرور.' : 'هذا الملف غير مشفر ويمكن فتحه مباشرة.'}
                </p>
              )}
              {pickedInfo?.encrypted && (
                <label className="block"><span className="label">كلمة مرور الملف</span>
                  <input className="input" type="password" autoComplete="current-password" value={password}
                    onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && openPrevious()} />
                </label>
              )}
              <button className="btn-primary w-full" disabled={busy || !picked} onClick={openPrevious}>
                <FolderOpen className="w-5 h-5" /> {busy ? 'جارٍ فتح الملف...' : 'فتح ومتابعة العمل'}
              </button>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-2.5">{error}</p>}
        </div>
        <p className="text-center text-brand-100/70 text-xs mt-4">
          أنت تختار مستوى الحماية، ولا تُرسل الملاحظات إلى GitHub أو أي خادم
        </p>
      </div>
    </div>
  );
}
