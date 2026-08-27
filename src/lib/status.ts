import type { Severity, AppSettings } from '../db/schema';
import { DEFAULT_SETTINGS } from '../db/schema';

/** نقاط درجة المخالفة حسب إعدادات المدرب */
export function sevWeight(sev: Exclude<Severity, ''>, s: AppSettings): number {
  return sev === 'yellow' ? s.wYellow : sev === 'orange' ? s.wOrange : s.wRed;
}

export const SEV_LABEL: Record<string, string> = {
  '': 'بدون', yellow: '🟡 خفيفة', orange: '🟠 متوسطة', red: '🔴 خطرة'
};

/** لون الشريط الجانبي لبطاقة الملاحظة حسب الخطورة */
export const SEV_BORDER: Record<string, string> = {
  yellow: 'border-r-4 border-r-yellow-400',
  orange: 'border-r-4 border-r-orange-500',
  red: 'border-r-4 border-r-red-500'
};

/** نقطة ملونة تعرض بجانب اسم التصنيف */
export const SEV_DOT: Record<string, string> = {
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-500',
  red: 'bg-red-500'
};

/** شرائح الخطورة */
export const SEV_CHIP_CLS: Record<string, string> = {
  yellow: '!bg-yellow-100 !text-yellow-700',
  orange: '!bg-orange-100 !text-orange-700',
  red: '!bg-red-100 !text-red-700'
};

export interface TraineeStatus {
  key: 'green' | 'yellow' | 'orange' | 'red';
  emoji: string;
  label: string;
  cls: string;
  points: number;
  count: number;
}

/**
 * حالة المتدرب وفق قواعد المدرب المخصصة:
 * - كل مخالفة تُجمع بنقاطها (قابلة للتخصيص)
 * - 🟡 حتى yellowMax، ثم 🟠 حتى orangeMax، ثم 🔴
 * مثال افتراضي: صفراء=1، برتقالية=2، حمراء=3 → حمراء بعد 5 نقاط (مخالفتان حمراوان = 6 = 🔴)
 */
export function statusOf(items: { sev?: Severity }[], s?: AppSettings): TraineeStatus {
  const cfg = s ?? { ...DEFAULT_SETTINGS, trainerId: 0 };
  let points = 0, count = 0;
  for (const it of items) {
    if (it.sev) {
      points += sevWeight(it.sev, cfg);
      count++;
    }
  }
  if (count === 0) return { key: 'green', emoji: '🟢', label: 'لا مخالفات', cls: '!bg-emerald-100 !text-emerald-700', points, count };
  if (points <= cfg.yellowMax) return { key: 'yellow', emoji: '🟡', label: 'مخالفات خفيفة', cls: '!bg-yellow-100 !text-yellow-700', points, count };
  if (points <= cfg.orangeMax) return { key: 'orange', emoji: '🟠', label: 'مخالفات متوسطة', cls: '!bg-orange-100 !text-orange-700', points, count };
  return { key: 'red', emoji: '🔴', label: 'كثير المخالفات', cls: '!bg-red-100 !text-red-700', points, count };
}
