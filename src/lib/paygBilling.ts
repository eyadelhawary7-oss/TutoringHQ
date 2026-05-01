/**
 * Authoritative PAYG (pay-as-you-go) billing: tier by active student count, monthly cap per tier.
 */

import { formatNumber } from '@/lib/formatNumber';
import { PLANS } from '@/lib/pricing';

/** Tier caps align with fixed-plan `weekly_student_limit` (solo → enterprise). */
export const PAYG_RATES = {
  solo: { maxStudents: 50, ratePerStudent: 30 },
  nano: { maxStudents: 75, ratePerStudent: 27.5 },
  starter: { maxStudents: 150, ratePerStudent: 22.88 },
  pro: { maxStudents: 500, ratePerStudent: 20.24 },
  business: { maxStudents: 1000, ratePerStudent: 16.5 },
  enterprise: { maxStudents: 2000, ratePerStudent: 11.72 },
} as const;

export type PaygTierPlan = keyof typeof PAYG_RATES;

/**
 * Converts a monthly per-student rate to the weekly display rate shown in the UI.
 * Billing math always uses the monthly rate. Display only.
 */
export function getWeeklyDisplayRate(monthlyRate: number): number {
  return Math.round((monthlyRate / 4) * 100) / 100;
}

/** Weekly display rates (monthly ÷ 4, rounded) — convenience for UI. */
export const PAYG_WEEKLY_DISPLAY_RATES = {
  solo: getWeeklyDisplayRate(PAYG_RATES.solo.ratePerStudent),
  nano: getWeeklyDisplayRate(PAYG_RATES.nano.ratePerStudent),
  starter: getWeeklyDisplayRate(PAYG_RATES.starter.ratePerStudent),
  pro: getWeeklyDisplayRate(PAYG_RATES.pro.ratePerStudent),
  business: getWeeklyDisplayRate(PAYG_RATES.business.ratePerStudent),
  enterprise: getWeeklyDisplayRate(PAYG_RATES.enterprise.ratePerStudent),
} as const;

export function formatWeeklyRate(monthlyRate: number, locale = 'en'): string {
  return formatNumber(getWeeklyDisplayRate(monthlyRate), locale);
}

export function getPaygTier(studentCount: number) {
  if (studentCount <= 50)
    return { plan: 'solo' as const, ratePerStudent: PAYG_RATES.solo.ratePerStudent, maxStudents: 50 };
  if (studentCount <= 75)
    return { plan: 'nano' as const, ratePerStudent: PAYG_RATES.nano.ratePerStudent, maxStudents: 75 };
  if (studentCount <= 150)
    return { plan: 'starter' as const, ratePerStudent: PAYG_RATES.starter.ratePerStudent, maxStudents: 150 };
  if (studentCount <= 500)
    return { plan: 'pro' as const, ratePerStudent: PAYG_RATES.pro.ratePerStudent, maxStudents: 500 };
  if (studentCount <= 1000)
    return { plan: 'business' as const, ratePerStudent: PAYG_RATES.business.ratePerStudent, maxStudents: 1000 };
  return { plan: 'enterprise' as const, ratePerStudent: PAYG_RATES.enterprise.ratePerStudent, maxStudents: 2000 };
}

/** Monthly list ceilings (EGP) × 1.10 — same tier keys as PAYG_RATES. */
const MONTHLY_CAPS: Record<PaygTierPlan, number> = {
  solo: PLANS.solo.monthlyListPrice * 1.1,
  nano: PLANS.nano.monthlyListPrice * 1.1,
  starter: PLANS.starter.monthlyListPrice * 1.1,
  pro: PLANS.pro.monthlyListPrice * 1.1,
  business: PLANS.business.monthlyListPrice * 1.1,
  enterprise: PLANS.enterprise.monthlyListPrice * 1.1,
};

export function calculatePaygBill(studentCount: number): {
  tier: ReturnType<typeof getPaygTier>;
  rawAmount: number;
  cappedAmount: number;
  isCapped: boolean;
  capAmount: number;
} {
  const tier = getPaygTier(studentCount);
  const rawAmount = studentCount * tier.ratePerStudent;
  const cap = MONTHLY_CAPS[tier.plan];
  const cappedAmount = Math.min(rawAmount, cap);
  return {
    tier,
    rawAmount: Math.round(rawAmount * 100) / 100,
    cappedAmount: Math.round(cappedAmount * 100) / 100,
    isCapped: rawAmount > cap,
    capAmount: Math.round(cap * 100) / 100,
  };
}

export function getPaygEstimate(studentCount: number, locale = 'en'): string {
  const { cappedAmount } = calculatePaygBill(studentCount);
  return formatNumber(cappedAmount, locale);
}

/** Tier breakpoints for sliders (labels are AR defaults; UI may override via i18n). */
export const PAYG_TIER_BREAKPOINTS = [
  {
    plan: 'solo' as const,
    label: 'فردي',
    maxStudents: 50,
    ratePerStudent: PAYG_RATES.solo.ratePerStudent,
    weeklyDisplayRate: PAYG_WEEKLY_DISPLAY_RATES.solo,
  },
  {
    plan: 'nano' as const,
    label: 'ناشئ',
    maxStudents: 75,
    ratePerStudent: 27.5,
    weeklyDisplayRate: PAYG_WEEKLY_DISPLAY_RATES.nano,
  },
  {
    plan: 'starter' as const,
    label: 'أساسي',
    maxStudents: 150,
    ratePerStudent: 22.88,
    weeklyDisplayRate: PAYG_WEEKLY_DISPLAY_RATES.starter,
  },
  {
    plan: 'pro' as const,
    label: 'محترف',
    maxStudents: 500,
    ratePerStudent: 20.24,
    weeklyDisplayRate: PAYG_WEEKLY_DISPLAY_RATES.pro,
  },
  {
    plan: 'business' as const,
    label: 'أعمال',
    maxStudents: 1000,
    ratePerStudent: 16.5,
    weeklyDisplayRate: PAYG_WEEKLY_DISPLAY_RATES.business,
  },
  {
    plan: 'enterprise' as const,
    label: 'مؤسسات',
    maxStudents: 2000,
    ratePerStudent: 11.72,
    weeklyDisplayRate: PAYG_WEEKLY_DISPLAY_RATES.enterprise,
  },
];

/** First calendar day of next month in Africa/Cairo (YYYY-MM-DD). */
export function firstDayNextMonthCairoYmd(): string {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const [y, m] = s.split('-').map((x) => parseInt(x, 10));
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return `${nextY}-${String(nextM).padStart(2, '0')}-01`;
}

/** True when Cairo "today" is the last day of that calendar month. */
export function isLastDayOfMonthCairo(now = new Date()): boolean {
  const s = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  const lastDay = new Date(y, m, 0).getDate();
  return d === lastDay;
}
