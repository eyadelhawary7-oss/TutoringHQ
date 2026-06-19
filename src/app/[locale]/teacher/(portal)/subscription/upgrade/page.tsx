'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';
import {
  fetchTeacherSubscription,
  type TeacherSubscriptionStatus,
} from '@/components/teacher/teacherSubscriptionClient';
import PlanComparison from '@/components/teacher/PlanComparison';
import { isProOrAbove } from '@/lib/teacherPlans';

/**
 * /teacher/subscription/upgrade - the Standard -> Pro upgrade surface.
 * Renders the Phase 3 PlanComparison (which carries the UpgradeFlow CTA on the
 * Pro card, or a "payments unavailable" banner when PAYMOB is off). A teacher
 * already on Pro gets a short confirmation with a link back to billing.
 */
export default function TeacherUpgradePage() {
  const t = useTranslations('teacherUpgrade');
  const locale = useLocale();
  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft;

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

  const isPro = isProOrAbove(sub?.plan_key);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        href="/teacher"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        <BackIcon size={16} aria-hidden />
        {t('back')}
      </Link>

      <div className="flex items-center gap-2">
        <Sparkles size={22} className="text-[var(--color-brass)]" aria-hidden />
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : !sub ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('unavailable')}</p>
      ) : isPro ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center shadow-card">
          <p className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">
            {t('alreadyPro')}
          </p>
          <Link
            href="/teacher/billing"
            className="inline-flex items-center justify-center rounded-lg bg-[var(--color-brass)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            {t('backToBilling')}
          </Link>
        </div>
      ) : (
        <PlanComparison
          currentPlanKey={sub.plan_key}
          stdPrice={sub.std_price_gross}
          proPrice={sub.pro_price_gross}
          paymentsEnabled={sub.payments_enabled}
        />
      )}
    </div>
  );
}
