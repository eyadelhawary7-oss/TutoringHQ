/**
 * Authoritative PAYG (pay-as-you-go) billing: tier by active student count, monthly cap per tier.
 */

export const PAYG_RATES = {
  nano: { maxStudents: 100, ratePerStudent: 27.5 },
  starter: { maxStudents: 250, ratePerStudent: 22.88 },
  pro: { maxStudents: 500, ratePerStudent: 20.24 },
  business: { maxStudents: 1000, ratePerStudent: 16.5 },
  enterprise: { maxStudents: 2000, ratePerStudent: 11.72 },
} as const;

export type PaygTierPlan = keyof typeof PAYG_RATES;

export function getPaygTier(studentCount: number) {
  if (studentCount <= 100)
    return { plan: 'nano' as const, ratePerStudent: 27.5, maxStudents: 100 };
  if (studentCount <= 250)
    return { plan: 'starter' as const, ratePerStudent: 22.88, maxStudents: 250 };
  if (studentCount <= 500)
    return { plan: 'pro' as const, ratePerStudent: 20.24, maxStudents: 500 };
  if (studentCount <= 1000)
    return { plan: 'business' as const, ratePerStudent: 16.5, maxStudents: 1000 };
  return { plan: 'enterprise' as const, ratePerStudent: 11.72, maxStudents: 2000 };
}

/** Monthly list ceilings (EGP) × 1.10 — same tier keys as PAYG_RATES. */
const MONTHLY_CAPS: Record<PaygTierPlan, number> = {
  nano: 2500 * 1.1,
  starter: 5200 * 1.1,
  pro: 9200 * 1.1,
  business: 15000 * 1.1,
  enterprise: 21300 * 1.1,
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

export function getPaygEstimate(studentCount: number): string {
  const { cappedAmount } = calculatePaygBill(studentCount);
  return cappedAmount.toLocaleString('en-US');
}

/** Tier breakpoints for sliders (labels are AR defaults; UI may override via i18n). */
export const PAYG_TIER_BREAKPOINTS = [
  { plan: 'nano' as const, label: 'ناشئ', maxStudents: 100, ratePerStudent: 27.5 },
  { plan: 'starter' as const, label: 'أساسي', maxStudents: 250, ratePerStudent: 22.88 },
  { plan: 'pro' as const, label: 'محترف', maxStudents: 500, ratePerStudent: 20.24 },
  { plan: 'business' as const, label: 'أعمال', maxStudents: 1000, ratePerStudent: 16.5 },
  { plan: 'enterprise' as const, label: 'مؤسسات', maxStudents: 2000, ratePerStudent: 11.72 },
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
