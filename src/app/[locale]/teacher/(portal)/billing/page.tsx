'use client';

import { useTranslations, useLocale } from 'next-intl';
import BillingHistory from '../../BillingHistory';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';
import TeacherPlanSection from '@/components/teacher/TeacherPlanSection';
import SummerFirstInvoiceCard from '@/components/summer/SummerFirstInvoiceCard';

/**
 * /teacher/billing - attendance and billing history across private groups.
 * Free-zone teachers see a locked upsell.
 */
export default function TeacherBillingPage() {
  const t = useTranslations('teacherPortal.pages');
  const locale = useLocale();
  const { ctx, loading, reload } = useTeacherContext();

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, reload);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('billing')}</h1>

      {/* Summer 2026: live first-invoice projection (renders only when summer mode is on). */}
      <SummerFirstInvoiceCard locale={locale} portal="teachers" />

      {loading && !ctx ? (
        <div className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : ctx?.hasPrivateAccess ? (
        <>
          <TeacherPlanSection />
          <BillingHistory />
        </>
      ) : (
        <>
          <PrivateUpsellCard
            tone={state === 'lapsed' ? 'resume' : 'trial'}
            title={t('billing')}
            body={t('billingLockedBody')}
            ctaLabel={state === 'lapsed' ? t('resumeCta') : t('startTrialCta')}
            onCta={startTrial}
          />
          {modal}
        </>
      )}
    </div>
  );
}
