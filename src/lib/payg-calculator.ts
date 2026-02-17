/**
 * PAYG (Pay-As-You-Go) pricing calculator.
 * 30-50% premium over fixed plans.
 */

const MONTHLY_WEEKS = 4.333;

export const PAYG_RATES: { min: number; max: number; rate: number }[] = [
  { min: 0, max: 150, rate: 4 },
  { min: 151, max: 500, rate: 3 },
  { min: 501, max: 1000, rate: 2.5 },
  { min: 1001, max: 2000, rate: 2 },
  { min: 2001, max: 99999, rate: 1.75 },
];

export function getPaygRate(studentsPerWeek: number): number {
  for (const tier of PAYG_RATES) {
    if (studentsPerWeek >= tier.min && studentsPerWeek <= tier.max) {
      return tier.rate;
    }
  }
  return PAYG_RATES[PAYG_RATES.length - 1].rate;
}

export function calculatePaygCharge(studentsPerWeek: number): {
  weeklyCharge: number;
  monthlyEstimate: number;
  ratePerStudent: number;
} {
  const rate = getPaygRate(studentsPerWeek);
  const weeklyCharge = studentsPerWeek * rate;
  const monthlyEstimate = Math.round(weeklyCharge * MONTHLY_WEEKS);
  return { weeklyCharge, monthlyEstimate, ratePerStudent: rate };
}

/** Compare PAYG cost to fixed plan - return best fixed plan if cheaper */
export const FIXED_PLAN_PRICES: Record<string, number> = {
  starter: 2000,
  pro: 4500,
  business: 6500,
  enterprise: 9000,
};

export function getRecommendedFixedPlan(monthlyPaygCost: number): { plan: string; price: number; savings: number } | null {
  if (monthlyPaygCost <= 0) return null;
  const plans = ['starter', 'pro', 'business', 'enterprise'] as const;
  for (const plan of plans) {
    const price = FIXED_PLAN_PRICES[plan];
    if (price < monthlyPaygCost) {
      return { plan, price, savings: monthlyPaygCost - price };
    }
  }
  return null;
}
