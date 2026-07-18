'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import { isProOrAbove } from '@/lib/teacherPlans';
import { useToast } from '@/hooks/useToast';
import { formatCurrency } from '@/lib/formatNumber';
import {
  fetchTeacherSubscription,
  teacherSubscriptionPost,
  type TeacherSubscriptionStatus,
} from './teacherSubscriptionClient';
import UpgradeFlow from './UpgradeFlow';
import DowngradeFlow from './DowngradeFlow';
import PlanComparison from './PlanComparison';

const STATUS_KEY: Record<string, string> = {
  active: 'statusActive',
  trialing: 'statusTrialing',
  past_due: 'statusPastDue',
  suspended: 'statusSuspended',
  cancelled: 'statusCancelled',
};

/**
 * Current plan + upgrade/downgrade surface for /teacher/billing. Reads the
 * subscription status endpoint (plan, period, credits, payments_enabled) and
 * renders the right CTA. On return from Paymob (?payment_status=) it toasts
 * the result and refetches.
 */
export default function TeacherPlanSection() {
  const t = useTranslations('teacherBilling');
  const locale = useLocale();
  const toast = useToast();
  const searchParams = useSearchParams();

  const [sub, setSub] = useState<TeacherSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchTeacherSubscription();
    setSub(data);
    setLoading(false);
  }, []);

  const switchInterval = useCallback(
    async (next: 'monthly' | 'annual') => {
      if (switching) return;
      setSwitching(true);
      try {
        const res = await teacherSubscriptionPost('/api/teacher/subscription/switch-interval', {
          interval: next,
        });
        const json = (await res?.json().catch(() => ({}))) as {
          ok?: boolean;
          paymob_disabled?: boolean;
          paymob_url?: string;
        };
        if (res?.ok && json.paymob_url) {
          window.location.href = json.paymob_url;
          return;
        }
        if (res?.ok && json.paymob_disabled) {
          // Online payment is not live yet, so the active monthly->annual switch charged
          // and saved NOTHING (switch-interval returns paymob_disabled BEFORE writing
          // billing_interval; the flip only happens later in the payment webhook). Do NOT
          // report success here (that was the bug: the teacher saw "saved" while the row
          // stayed monthly). Show an honest "coming soon" state and skip the reload —
          // nothing changed.
          toast.info(t('intervalComingSoon'));
          return;
        }
        if (res?.ok && json.ok) {
          toast.success(t('intervalSaved'));
          await load();
          return;
        }
        toast.error(t('upgradeError'));
      } catch {
        toast.error(t('upgradeError'));
      } finally {
        setSwitching(false);
      }
    },
    [switching, toast, t, load],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Paymob return handling: toast once, then refetch to reflect the new plan.
  useEffect(() => {
    const status = searchParams?.get('payment_status');
    if (!status) return;
    if (status === 'paid' || status === 'success') {
      toast.success(t('upgradeSuccess'));
    } else {
      toast.error(t('upgradeError'));
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (loading && !sub) {
    return (
      <div className="h-32 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
    );
  }
  if (!sub) return null;

  const isPro = isProOrAbove(sub.plan_key);
  const statusKey = sub.status ? STATUS_KEY[sub.status] ?? 'statusActive' : 'statusActive';

  return (
    <div className="flex flex-col gap-6">
      {/* CURRENT PLAN */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('currentPlan')}</h2>
          <span
            className={
              isPro
                ? 'rounded-full bg-[var(--color-brass)] px-3 py-0.5 text-xs font-medium text-white'
                : 'rounded-full bg-[var(--color-teal-soft)] px-3 py-0.5 text-xs font-medium text-[var(--color-teal-deep)]'
            }
          >
            {isPro ? t('planPro') : t('planStandard')}
          </span>
        </div>

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--color-text-muted)]">{t('statusLabel')}</dt>
            <dd className="font-medium text-[var(--color-text-primary)]">{t(statusKey)}</dd>
          </div>
          {sub.current_period_start && (
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--color-text-muted)]">{t('periodStart')}</dt>
              <dd className="font-medium text-[var(--color-text-primary)]">
                {formatDate(sub.current_period_start, locale, 'long')}
              </dd>
            </div>
          )}
          {sub.current_period_end && (
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--color-text-muted)]">{t('periodEnd')}</dt>
              <dd className="font-medium text-[var(--color-text-primary)]">
                {formatDate(sub.current_period_end, locale, 'long')}
              </dd>
            </div>
          )}
          {isPro && (
            <>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">{t('creditsSubscription')}</dt>
                <dd className="font-medium text-[var(--color-text-primary)]">
                  {formatNumber(sub.blast_credits_subscription, locale)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">{t('creditsPurchased')}</dt>
                <dd className="font-medium text-[var(--color-text-primary)]">
                  {formatNumber(sub.blast_credits_purchased, locale)}
                </dd>
              </div>
            </>
          )}
        </dl>

        {/* Billing interval: Monthly | Annual (annual = monthly × 10, "2 months free") */}
        {(sub.status === 'active' || sub.status === 'trialing') &&
          (() => {
            const mult = sub.annual_multiplier && sub.annual_multiplier > 0 ? sub.annual_multiplier : 10;
            const current = sub.billing_interval === 'annual' ? 'annual' : 'monthly';
            const annualTotal = Math.round((sub.price_gross || 0) * mult);
            const annualPerMonth = Math.round(annualTotal / 12);
            return (
              <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">
                <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                  {t('billingIntervalLabel')}
                </p>
                <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
                  {(['monthly', 'annual'] as const).map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      disabled={switching}
                      onClick={() => current !== iv && switchInterval(iv)}
                      className="rounded-full px-4 py-1 text-sm font-semibold transition-colors disabled:opacity-60"
                      style={
                        current === iv
                          ? { background: 'var(--color-brass)', color: '#ffffff' }
                          : { color: 'var(--color-text-secondary)' }
                      }
                    >
                      {iv === 'monthly' ? t('billMonthly') : t('billAnnual')}
                    </button>
                  ))}
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span>
                    {t('annualPriceHint', {
                      perMonth: formatCurrency(annualPerMonth, locale),
                      total: formatCurrency(annualTotal, locale),
                    })}
                  </span>
                  <span
                    className="inline-block rounded-full px-2 py-0.5 font-medium"
                    style={{ background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }}
                  >
                    {t('annualBadge')}
                  </span>
                </p>
              </div>
            );
          })()}

        <div className="mt-4">
          {isPro ? (
            <DowngradeFlow currentPeriodEnd={sub.current_period_end} onDowngraded={load} />
          ) : sub.payments_enabled ? (
            <UpgradeFlow label={t('upgradeCta')} variant="brass" />
          ) : (
            <p className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-3 py-2 text-sm font-medium text-[var(--color-warning)]">
              {t('paymentsUnavailable')}
            </p>
          )}
        </div>
      </section>

      {/* UPGRADE (Standard only) */}
      {!isPro && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">
            {t('upgradeTitle')}
          </h2>
          <PlanComparison
            currentPlanKey={sub.plan_key}
            stdPrice={sub.std_price_gross}
            proPrice={sub.pro_price_gross}
            paymentsEnabled={sub.payments_enabled}
          />
        </section>
      )}
    </div>
  );
}
