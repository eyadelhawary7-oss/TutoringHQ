/**
 * Subscription tier rows — single source for `PLANS` in `@/lib/pricing.ts`.
 * Order = lowest → highest (excluding `top_centers`, defined only in pricing.ts).
 */
export const SUBSCRIPTION_PLAN_DEFINITIONS = [
  {
    key: 'solo',
    arabicName: 'فردي',
    englishName: 'Solo',
    weeklyStudentLimit: 50,
    quarterlyAllIn: 999,
    monthlyListPrice: 1149,
  },
  {
    key: 'nano',
    arabicName: 'سنتر نانو',
    englishName: 'Nano',
    weeklyStudentLimit: 75,
    quarterlyAllIn: 1999,
    monthlyListPrice: 2499,
  },
  {
    key: 'starter',
    arabicName: 'أساسي',
    englishName: 'Starter',
    weeklyStudentLimit: 150,
    quarterlyAllIn: 4499,
    monthlyListPrice: 5199,
  },
  {
    key: 'pro',
    arabicName: 'محترف',
    englishName: 'Pro',
    weeklyStudentLimit: 500,
    quarterlyAllIn: 7999,
    monthlyListPrice: 9199,
  },
  {
    key: 'business',
    arabicName: 'أعمال',
    englishName: 'Business',
    weeklyStudentLimit: 1000,
    quarterlyAllIn: 12999,
    monthlyListPrice: 14999,
  },
  {
    key: 'enterprise',
    arabicName: 'مؤسسات',
    englishName: 'Enterprise',
    weeklyStudentLimit: 2000,
    quarterlyAllIn: 18499,
    monthlyListPrice: 21299,
    isMegaCenter: true,
  },
] as const;
