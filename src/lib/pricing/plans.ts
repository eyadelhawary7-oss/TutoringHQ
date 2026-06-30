/**
 * Subscription tier rows - single source for `PLANS` in `@/lib/pricing.ts`.
 * Order = lowest → highest (excluding `top_centers`, defined only in pricing.ts).
 *
 * `annualEffectiveMonthly` - whole EGP/month when billed annually = annual total ÷ 12,
 *   where annual total = `quarterlyAllIn` × 10 ("true 2 months free"). Mirrors the
 *   `pricing.interval.annual_multiplier` (=10) default; the live admin value wins at runtime.
 */
export const SUBSCRIPTION_PLAN_DEFINITIONS = [
  {
    key: 'solo',
    arabicName: 'فردي',
    englishName: 'Solo',
    weeklyStudentLimit: 50,
    quarterlyAllIn: 999,
    monthlyListPrice: 1149,
    annualEffectiveMonthly: 833,
    landingBadge: 'entry' as const,
  },
  {
    key: 'nano',
    arabicName: 'سنتر نانو',
    englishName: 'Nano',
    weeklyStudentLimit: 120,
    quarterlyAllIn: 1999,
    monthlyListPrice: 2499,
    annualEffectiveMonthly: 1666,
  },
  {
    key: 'starter',
    arabicName: 'أساسي',
    englishName: 'Starter',
    weeklyStudentLimit: 200,
    quarterlyAllIn: 4499,
    monthlyListPrice: 5199,
    annualEffectiveMonthly: 3749,
    landingBadge: 'popular' as const,
  },
  {
    key: 'pro',
    arabicName: 'محترف',
    englishName: 'Pro',
    weeklyStudentLimit: 500,
    quarterlyAllIn: 7999,
    monthlyListPrice: 9199,
    annualEffectiveMonthly: 6666,
  },
  {
    key: 'business',
    arabicName: 'أعمال',
    englishName: 'Business',
    weeklyStudentLimit: 1000,
    quarterlyAllIn: 12999,
    monthlyListPrice: 14999,
    annualEffectiveMonthly: 10833,
  },
  {
    key: 'enterprise',
    arabicName: 'مؤسسات',
    englishName: 'Enterprise',
    weeklyStudentLimit: 2000,
    quarterlyAllIn: 18499,
    monthlyListPrice: 21299,
    annualEffectiveMonthly: 15416,
    isMegaCenter: true,
  },
] as const;
