'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { signOutToLogin } from '@/lib/auth/sign-out-client';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatNumber';
import LanguageToggle from '@/components/LanguageToggle';
import type { PlanKey, BillingPeriod } from '@/lib/pricing';

type PlanRow = {
  key: PlanKey;
  arabicName: string;
  englishName: string;
  weeklyStudentLimit: number | null;
  nextPeriodAmount: number;
  reactivationTotal: number;
  fineOrFee: number;
  isCurrent: boolean;
};

type InfoResponse = {
  center: { name: string; plan: PlanKey; billingPeriod: BillingPeriod; suspendedAt: string };
  tier: 'tier1' | 'tier2';
  plans: PlanRow[];
};

async function authHeader(): Promise<HeadersInit | null> {
  // getUser() validates server-side and forces a token refresh if the cached
  // access_token is expired — needed because a suspended owner may land here
  // after a long idle gap. getSession() alone can return a stale cached token
  // that the API would reject with 401.
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

export default function ReactivatePage() {
  const t = useTranslations('reactivate');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<InfoResponse | null>(null);
  const [selected, setSelected] = useState<PlanKey | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hdr = await authHeader();
      if (!hdr) {
        window.location.href = `/${locale}/login`;
        return;
      }
      try {
        const res = await fetch('/api/reactivate/info', { headers: hdr });
        const json = (await res.json()) as InfoResponse | { error: string; message?: string };
        if (cancelled) return;
        if (!res.ok) {
          const errMsg =
            (json as { message?: string }).message ??
            (json as { error?: string }).error ??
            'Failed to load';
          if ((json as { error?: string }).error === 'Center is not suspended') {
            window.location.href = `/${locale}/dashboard`;
            return;
          }
          setError(errMsg);
        } else {
          const data = json as InfoResponse;
          setInfo(data);
          setSelected(data.center.plan);
        }
      } catch {
        if (!cancelled) setError(t('loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, t]);

  const onPay = async () => {
    if (!selected || paying) return;
    setPaying(true);
    setError(null);
    try {
      const hdr = await authHeader();
      if (!hdr) {
        window.location.href = `/${locale}/login`;
        return;
      }
      const res = await fetch('/api/reactivate/start', {
        method: 'POST',
        headers: { ...hdr, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selected }),
      });
      const json = (await res.json()) as { paymobUrl?: string; error?: string; message?: string };
      if (!res.ok || !json.paymobUrl) {
        setError(json.message ?? json.error ?? t('payError'));
        return;
      }
      window.location.href = json.paymobUrl;
    } catch {
      setError(t('payError'));
    } finally {
      setPaying(false);
    }
  };

  const handleLogout = async () => {
    await signOutToLogin(locale);
  };

  const selectedRow = info?.plans.find((p) => p.key === selected) ?? null;

  return (
    <div
      className="relative flex min-h-screen items-start justify-center bg-[var(--color-surface-0)] p-6"
      dir={dir}
    >
      <div className="absolute end-4 top-4 z-10">
        <LanguageToggle />
      </div>

      <div className="chq-spring-in mt-12 w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="mt-2 text-sm text-slate-400">{t('subtitle')}</p>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-[var(--color-surface-2)] p-6 text-center text-sm text-slate-400">
            {t('loading')}
          </div>
        ) : error && !info ? (
          <div className="rounded-2xl border border-red-800/40 bg-red-900/20 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : info ? (
          <>
            <div className="rounded-2xl bg-[var(--color-surface-2)] p-4 text-sm">
              <p className="text-slate-300">
                {t('centerLabel')}: <span className="font-semibold text-white">{info.center.name}</span>
              </p>
              <p className="mt-1 text-slate-400">
                {t('tierLabel')}: {t(`tier.${info.tier}`)}
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="px-1 text-sm font-semibold text-slate-300">{t('choosePlan')}</legend>
              {info.plans.map((p) => {
                const isSel = p.key === selected;
                const name = isAr ? p.arabicName : p.englishName;
                return (
                  <label
                    key={p.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                      isSel
                        ? 'border-teal-500/70 bg-teal-900/20'
                        : 'border-transparent bg-[var(--color-surface-2)] hover:border-teal-800/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={p.key}
                      checked={isSel}
                      onChange={() => setSelected(p.key)}
                      className="mt-1 accent-teal-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white">{name}</span>
                        {p.isCurrent ? (
                          <span className="rounded-full bg-teal-700/40 px-2 py-0.5 text-xs text-teal-200">
                            {t('currentPlan')}
                          </span>
                        ) : null}
                      </div>
                      {p.weeklyStudentLimit != null ? (
                        <p className="mt-1 text-xs text-slate-400">
                          {t('weeklyLimit', { count: p.weeklyStudentLimit })}
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm text-slate-200">
                        {t('reactivationTotal')}:{' '}
                        <span className="font-semibold text-white">
                          {formatCurrency(p.reactivationTotal, locale)}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {t('nextPeriod')}: {formatCurrency(p.nextPeriodAmount, locale)}
                        {p.fineOrFee > 0
                          ? ` · ${t('fineOrFee')}: ${formatCurrency(p.fineOrFee, locale)}`
                          : ''}
                      </p>
                    </div>
                  </label>
                );
              })}
            </fieldset>

            {selectedRow ? (
              <div className="rounded-2xl bg-[var(--color-surface-2)] p-4 text-center text-sm">
                <p className="text-slate-300">{t('youWillPay')}</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {formatCurrency(selectedRow.reactivationTotal, locale)}
                </p>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-xl border border-red-800/40 bg-red-900/20 p-3 text-sm text-red-300">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void onPay()}
              disabled={paying || !selected}
              className="w-full rounded-xl bg-teal-500 px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-teal-900/40 btn-press chq-focus"
            >
              {paying ? t('redirecting') : t('payNow')}
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mx-auto block text-sm text-slate-500 transition-colors hover:text-slate-400 btn-press chq-focus rounded-lg px-2 py-1"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  );
}
