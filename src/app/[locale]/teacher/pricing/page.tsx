'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchTeacherSubscription,
  type TeacherSubscriptionStatus,
} from '@/components/teacher/teacherSubscriptionClient';
import PlanComparison from '@/components/teacher/PlanComparison';

/**
 * /teacher/pricing - standalone Standard vs Pro comparison for teachers. The
 * current plan is badged; a Standard teacher gets the upgrade CTA on the Pro
 * card (or a "payments unavailable" banner when payments are off).
 */
export default function TeacherPricingPage() {
  const t = useTranslations('teacherPricing');
  const [sub, setSub] = useState<TeacherSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    fetchTeacherSubscription().then((s) => {
      if (!on) return;
      setSub(s);
      setLoading(false);
    });
    return () => {
      on = false;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('pageTitle')}</h1>
      {loading ? (
        <div className="h-64 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : sub ? (
        <PlanComparison
          currentPlanKey={sub.plan_key}
          stdPrice={sub.std_price_gross}
          proPrice={sub.pro_price_gross}
          paymentsEnabled={sub.payments_enabled}
        />
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('unavailable')}</p>
      )}
    </main>
  );
}
