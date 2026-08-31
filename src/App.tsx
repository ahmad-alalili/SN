import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { db, type Trainer } from './db/schema';

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

export type BackgroundChoice = 'coral' | 'verdant';
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
      background: saved.background === 'coral' ? 'coral' : 'verdant',
      accent: ['aqua', 'coral', 'lime'].includes(saved.accent ?? '')
        ? saved.accent as AccentChoice
        : DEFAULT_APPEARANCE.accent
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export type Screen = 'notes' | 'note-form' | 'trainees' | 'courses' | 'categories' | 'academic-years' | 'import' | 'settings';
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

  const [screen, setScreen] = useState<Screen>(() => {
    const h = location.hash.replace(/^#\//, '') as Screen;
    return ['notes', 'note-form', 'trainees', 'courses', 'categories', 'academic-years', 'import', 'settings'].includes(h) ? h : 'notes';
  });
  const [params, setParams] = useState<Record<string, unknown>>({});
  const go = useCallback((s: Screen, p: Record<string, unknown> = {}) => {
    setScreen(s); setParams(p);
    if (location.hash !== `#/${s}`) history.replaceState(null, '', `#/${s}`);
    window.scrollTo({ top: 0 });
  }, []);

  // دعم الروابط العميقة عبر الـ hash (#/trainees ...)
  useEffect(() => {
    const valid: Screen[] = ['notes', 'note-form', 'trainees', 'courses', 'categories', 'academic-years', 'import', 'settings'];
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
      '4': 'courses', '5': 'categories', '6': 'import', '7': 'settings'
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
                style={{ '--app-background-image': `url("${import.meta.env.BASE_URL}backgrounds/glass-${appearance.background}.png")` } as React.CSSProperties}
              >
                <Header name={active.name}
                  onSwitch={() => { localStorage.removeItem(ACTIVE_KEY); setActive(null); }} />
                <main className="max-w-3xl mx-auto px-4 pt-4">
                  {screen === 'notes' && <NotesListLazy />}
                  {screen === 'note-form' && <NoteFormLazy />}
                  {screen === 'trainees' && <TraineesLazy />}
                  {screen === 'courses' && <CoursesLazy />}
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
import Categories from './screens/Categories';
import AcademicYears from './screens/AcademicYears';
import ImportScreen from './screens/Import';
import Settings from './screens/Settings';
const NotesListLazy = NotesList;
const NoteFormLazy = NoteForm;
const TraineesLazy = Trainees;
const CoursesLazy = Courses;
const CategoriesLazy = Categories;
const AcademicYearsLazy = AcademicYears;
const ImportLazy = ImportScreen;
const SettingsLazy = Settings;

/* ================== الترويسة ================== */
function Header({ name, onSwitch }: { name: string; onSwitch: () => void }) {
  return (
    <header className="app-header sticky top-0 z-40 text-white shadow-md">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <h1 className="text-lg font-bold">📝 ملاحظات المدرب</h1>
        <button onClick={onSwitch}
          className="flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs font-bold transition"
          title="تبديل ملف المدرب">
          👤 {name}
        </button>
      </div>
    </header>
  );
}

/* ================== الشريط السفلي ================== */
const NAV: { s: Screen; icon: string; label: string }[] = [
  { s: 'notes', icon: '🗒️', label: 'الملاحظات' },
  { s: 'note-form', icon: '➕', label: 'جديدة' },
  { s: 'trainees', icon: '🧑‍🎓', label: 'المتدربون' },
  { s: 'courses', icon: '📚', label: 'المقررات' },
  { s: 'settings', icon: '⚙️', label: 'الإعدادات' }
];
function BottomNav({ screen }: { screen: Screen }) {
  const { go } = useNav();
  return (
    <nav className="app-bottom-nav fixed bottom-0 inset-x-0 z-40 border-t shadow-[0_-2px_10px_rgba(0,0,0,.04)]">
      <div className="max-w-3xl mx-auto grid grid-cols-5">
        {NAV.map(n => (
          <button key={n.s} onClick={() => go(n.s)}
            className={`flex flex-col items-center py-2.5 text-[11px] font-semibold transition
              ${screen === n.s ? 'text-brand-700' : 'text-slate-500 hover:text-brand-600'}`}>
            <span className={`text-xl leading-none mb-1 ${n.s === 'note-form' ? 'app-create-nav grid place-items-center w-11 h-11 -mt-6 rounded-full text-white shadow-lg' : ''}`}>
              {n.icon}
            </span>
            {n.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ================== شاشة اختيار المدرب ================== */
function TrainerPicker({ onPick }: { onPick: (t: ActiveTrainer) => void }) {
  const [trainers, setTrainers] = React.useState<Trainer[]>([]);
  const [name, setName] = useState('');
  const refresh = () => db.trainers.orderBy('name').toArray().then(setTrainers);
  useEffect(() => { refresh(); }, []);

  async function add() {
    const n = name.trim();
    if (!n) return;
    await db.trainers.add({ name: n, createdAt: Date.now() });
    setName('');
    const all = await db.trainers.where('name').equals(n).toArray();
    const t = all[all.length - 1];
    onPick({ id: t.id!, name: t.name });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-700 to-brand-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center text-white mb-6">
          <div className="text-5xl mb-2">📝</div>
          <h1 className="text-2xl font-extrabold">ملاحظات المدرب</h1>
          <p className="text-brand-100 text-sm mt-1">سجّل ملاحظاتك عن متدربيك — أينما كنت، حتى دون إنترنت</p>
        </div>
        <div className="card p-5 space-y-3">
          {trainers.length > 0 ? (
            <>
              <h2 className="font-bold">اختر ملف المدرب</h2>
              {trainers.map(t => (
                <button key={t.id} onClick={() => onPick({ id: t.id!, name: t.name })}
                  className="w-full btn-ghost justify-between">
                  <span>👤 {t.name}</span>
                  <span>دخول ←</span>
                </button>
              ))}
            </>
          ) : (
            <div className="text-center space-y-1 pb-1">
              <h2 className="font-bold">أنشئ ملف المدرب للبدء</h2>
              <p className="text-xs text-slate-500">ستُحفظ الملاحظات والمقررات تحت هذا الملف.</p>
            </div>
          )}
          <div className={trainers.length ? 'pt-2 border-t border-dashed border-slate-200' : ''}>
            <label className="label">{trainers.length ? 'أو أنشئ ملفاً جديداً' : 'اسم المدرب'}</label>
            <div className="flex gap-2">
              <input className="input" placeholder="اسم المدرب..." value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && add()} />
              <button className="btn-primary shrink-0" onClick={add}>إضافة</button>
            </div>
          </div>
        </div>
        <p className="text-center text-brand-100/70 text-xs mt-4">
          كل مدرب له بياناته المستقلة — بياناتك محفوظة على هذا الجهاز فقط
        </p>
      </div>
    </div>
  );
}
