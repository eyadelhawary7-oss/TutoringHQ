'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Gift, Info, Loader2, Sparkles } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';

type SubscriptionStatus = {
  has_subscription: boolean;
  status: string | null;
  plan_key: string;
  price_gross: number;
  trial_ends_at: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  grace_until: string | null;
  free_months_credit: number;
};

/**
 * Teacher resubscribe page. One fixed plan (teacher_standard, price from
 * platform_config via the status route - never hardcoded here). While Paymob
 * is sandbox-gated (PAYMOB_ENABLED=false) the CTA resolves to a calm
 * "online payment coming soon" card - that is the expected state, not an
 * error. When Paymob goes live the same CTA redirects to the checkout.
 */
export default function TeacherResubscribePage() {
  const t = useTranslations('teacherResubscribe');
  const locale = useLocale();
  const router = useRouter();

  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymobSoon, setPaymobSoon] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/subscription/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const json = (await res.json()) as SubscriptionStatus;
      if (json.status === 'trialing' || json.status === 'active') {
        // Already subscribed - nothing to do here.
        router.replace('/teacher');
        return;
      }
      setStatus(json);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const subscribe = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/subscription/resubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
      });
      const json = (await res.json().catch(() => ({}))) as {
        paymob_disabled?: boolean;
        paymob_url?: string;
      };
      if (res.ok && json.paymob_disabled) {
        setPaymobSoon(true);
        return;
      }
      if (res.ok && json.paymob_url) {
        window.location.href = json.paymob_url;
        return;
      }
      setSubmitError(true);
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="mb-4 h-7 w-48 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        <div className="h-72 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      </div>
    );
  }

  if (loadError || !status) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">
          {t('errorTitle')}
        </h1>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
        <button
          type="button"
          onClick={loadStatus}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  const features = [
    t('featurePrivateGroups'),
    t('featureBilling'),
    t('featureWhatsapp'),
    t('featureProposals'),
  ];

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
      <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
        {status.has_subscription ? t('resubscribeBody') : t('startBody')}
      </p>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={18} className="text-[var(--color-brass)]" aria-hidden />
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('planName')}</h2>
        </div>
        <p className="mb-4">
          <span className="font-mono text-2xl font-bold text-[var(--color-teal-deep)]">
            {formatCurrency(status.price_gross, locale)}
          </span>
          <span className="ms-1 text-sm text-[var(--color-text-secondary)]">
            {t('priceSuffix')}
          </span>
        </p>

        <p className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
          {t('includedTitle')}
        </p>
        <ul className="mb-5 flex flex-col gap-2">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]"
            >
              <CheckCircle2
                size={16}
                className="mt-0.5 shrink-0 text-[var(--color-teal-deep)]"
                aria-hidden
              />
              {f}
            </li>
          ))}
        </ul>

        {status.free_months_credit > 0 && (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-[var(--color-brass-soft)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]">
            <Gift size={16} className="shrink-0 text-[var(--color-brass)]" aria-hidden />
            {t('freeMonths', { count: formatNumber(status.free_months_credit, locale) })}
          </p>
        )}

        {paymobSoon ? (
          <div className="flex items-start gap-3 rounded-lg border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] p-4">
            <Info size={18} className="mt-0.5 shrink-0 text-[var(--color-teal-deep)]" aria-hidden />
            <div>
              <p className="text-sm font-bold text-[var(--color-text-primary)]">
                {t('paymobSoonTitle')}
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">{t('paymobSoonBody')}</p>
            </div>
          </div>
        ) : (
          <>
            {submitError && (
              <p className="mb-3 text-sm text-[var(--color-danger)]" role="alert">
                {t('errorSubscribe')}
              </p>
            )}
            <button
              type="button"
              onClick={subscribe}
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? t('subscribing') : t('subscribeCta')}
            </button>
          </>
        )}
      </div>

      <div className="mt-4 text-center">
        <Link
          href="/teacher"
          className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline"
        >
          {t('backHome')}
        </Link>
      </div>
    </div>
  );
}
