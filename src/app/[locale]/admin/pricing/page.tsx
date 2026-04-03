'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { PACK_PLAN_MINIMUMS } from '@/lib/packBilling';
import { useToast } from '@/hooks/useToast';
import { ArrowLeft, Banknote } from 'lucide-react';

type PlanRow = {
  plan_key: string;
  english_name: string;
  arabic_name: string;
  weekly_student_limit: number;
  monthly_fee: number;
  all_in_price: number;
  is_custom: boolean;
  sort_order: number;
  is_active: boolean;
};

type PlanDraft = {
  weekly_student_limit: string;
  monthly_fee: string;
  all_in_price: string;
  is_active: boolean;
};

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export default function AdminPricingPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();
  const isRTL = locale === 'ar';

  const [gateOk, setGateOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({});
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);

  const [packPrice, setPackPrice] = useState('12');
  const [savingPack, setSavingPack] = useState(false);
  const [packLoaded, setPackLoaded] = useState(false);

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }, []);

  const getAuthHeaders = useCallback(async () => {
    const session = await getSession();
    if (!session) return null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
    const csrf = await getCsrfHeaders(session.access_token);
    Object.assign(headers, csrf);
    return headers;
  }, [getSession]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    const gate = async () => {
      const session = await getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.isAdmin || data.role !== 'super_admin') {
        router.replace('/dashboard');
        return;
      }
      setGateOk(true);
    };
    void gate();
  }, [getSession, router]);

  const loadPlans = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const res = await fetch('/api/admin/pricing/plans', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || t('pricingLoadError'));
    }
    const data = await res.json();
    const list = (data.plans || []) as PlanRow[];
    setPlans(list);
    const next: Record<string, PlanDraft> = {};
    for (const p of list) {
      next[p.plan_key] = {
        weekly_student_limit: String(p.weekly_student_limit ?? ''),
        monthly_fee: String(p.monthly_fee ?? ''),
        all_in_price: String(p.all_in_price ?? ''),
        is_active: p.is_active !== false,
      };
    }
    setDrafts(next);
  }, [getSession, t]);

  const loadPack = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const res = await fetch('/api/admin/pricing/pack', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || t('pricingLoadError'));
    }
    const data = await res.json();
    setPackPrice(String(data.pack_price_per_parent ?? 12));
    setPackLoaded(true);
  }, [getSession, t]);

  useEffect(() => {
    if (!gateOk) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadPlans(), loadPack()]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('pricingLoadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateOk, loadPlans, loadPack, t]);

  const packMinimumsRows = useMemo(
    () =>
      Object.entries(PACK_PLAN_MINIMUMS).sort(([a], [b]) => a.localeCompare(b)),
    [],
  );

  const updateDraft = useCallback((planKey: string, patch: Partial<PlanDraft>) => {
    setDrafts((d) => ({
      ...d,
      [planKey]: { ...d[planKey]!, ...patch },
    }));
  }, []);

  const savePlan = async (planKey: string) => {
    const d = drafts[planKey];
    if (!d) return;
    const monthly_fee = parseFloat(d.monthly_fee);
    const all_in_price = parseFloat(d.all_in_price);
    const weekly_student_limit = Math.round(parseFloat(d.weekly_student_limit));
    if (!Number.isFinite(monthly_fee) || monthly_fee <= 0 || !Number.isFinite(all_in_price) || all_in_price <= 0) {
      toast.error(t('pricingValidationPositive'));
      return;
    }
    if (!Number.isFinite(weekly_student_limit) || weekly_student_limit < 0) {
      toast.error(t('pricingValidationStudentLimit'));
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) return;
    setSavingPlanId(planKey);
    try {
      const res = await fetch(`/api/admin/pricing/plans/${encodeURIComponent(planKey)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          monthly_fee,
          all_in_price,
          is_active: d.is_active,
          weekly_student_limit,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : tCommon('errorGeneric'));
        return;
      }
      const plan = data.plan as PlanRow | undefined;
      if (plan) {
        setPlans((prev) => prev.map((p) => (p.plan_key === planKey ? plan : p)));
        setDrafts((prev) => ({
          ...prev,
          [planKey]: {
            weekly_student_limit: String(plan.weekly_student_limit ?? ''),
            monthly_fee: String(plan.monthly_fee ?? ''),
            all_in_price: String(plan.all_in_price ?? ''),
            is_active: plan.is_active !== false,
          },
        }));
      }
      toast.success(t('pricingSaved'));
    } finally {
      setSavingPlanId(null);
    }
  };

  const savePack = async () => {
    const n = parseFloat(packPrice);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(t('pricingValidationPositive'));
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) return;
    setSavingPack(true);
    try {
      const res = await fetch('/api/admin/pricing/pack', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ pack_price_per_parent: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : tCommon('errorGeneric'));
        return;
      }
      toast.success(t('pricingPackSaved'));
    } finally {
      setSavingPack(false);
    }
  };

  if (!gateOk) {
    return (
      <div className="flex flex-col min-h-screen">
        <AdminHeader />
        <div className="flex flex-1 pt-14 items-center justify-center text-[var(--color-text-secondary)]">
          {tCommon('loading')}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-screen bg-[var(--color-surface-0)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <div className="flex flex-1 pt-14">
        <AdminSidebar activeRoute="/admin/pricing" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <ArrowLeft size={20} className={isRTL ? 'rotate-180' : ''} />
            </button>
            <div className="flex items-center gap-2">
              <Banknote className="h-6 w-6 text-[var(--color-brand-500)]" aria-hidden />
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('pricingPageTitle')}</h1>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 mb-4">
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-[var(--color-text-secondary)]">{tCommon('loading')}</p>
          ) : (
            <>
              <section className="mb-10">
                <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase mb-3">
                  {t('pricingSectionSubscriptions')}
                </h2>
                <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                        <th className="text-start p-3 font-medium">{t('pricingPlanName')}</th>
                        <th className="text-start p-3 font-medium">{t('pricingStudentLimit')}</th>
                        <th className="text-start p-3 font-medium">{t('pricingMonthlyList')}</th>
                        <th className="text-start p-3 font-medium">{t('pricingQuarterlyAllIn')}</th>
                        <th className="text-start p-3 font-medium">{t('pricingAnnualDerived')}</th>
                        <th className="text-start p-3 font-medium">{t('pricingMonthlyPremiumDerived')}</th>
                        <th className="text-start p-3 font-medium">{t('pricingActive')}</th>
                        <th className="p-3 w-28" />
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p) => {
                        const d = drafts[p.plan_key];
                        if (!d) return null;
                        const allIn = parseFloat(d.all_in_price);
                        const annual = Number.isFinite(allIn) ? allIn * 12 * 0.85 : NaN;
                        const prem = Number.isFinite(allIn) ? allIn * 1.15 : NaN;
                        const busy = savingPlanId === p.plan_key;
                        return (
                          <tr
                            key={p.plan_key}
                            className="border-b border-[var(--color-border-subtle)] last:border-0 text-[var(--color-text-primary)]"
                          >
                            <td className="p-3 font-medium">
                              {locale === 'ar' ? p.arabic_name : p.english_name}
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min={0}
                                className="w-full min-w-[4.5rem] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-2 py-1.5"
                                value={d.weekly_student_limit}
                                onChange={(e) => updateDraft(p.plan_key, { weekly_student_limit: e.target.value })}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="w-full min-w-[5rem] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-2 py-1.5"
                                value={d.monthly_fee}
                                onChange={(e) => updateDraft(p.plan_key, { monthly_fee: e.target.value })}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="w-full min-w-[5rem] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-2 py-1.5"
                                value={d.all_in_price}
                                onChange={(e) => updateDraft(p.plan_key, { all_in_price: e.target.value })}
                              />
                            </td>
                            <td className="p-3 tabular-nums text-[var(--color-text-secondary)]">{fmtMoney(annual)}</td>
                            <td className="p-3 tabular-nums text-[var(--color-text-secondary)]">{fmtMoney(prem)}</td>
                            <td className="p-3">
                              <label className="inline-flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={d.is_active}
                                  onChange={(e) => updateDraft(p.plan_key, { is_active: e.target.checked })}
                                  className="rounded border-[var(--color-border-default)]"
                                />
                              </label>
                            </td>
                            <td className="p-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void savePlan(p.plan_key)}
                                className="w-full rounded-lg bg-[var(--color-brand-500)] text-white px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                              >
                                {busy ? t('pricingSaving') : t('pricingSave')}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase mb-3">
                  {t('pricingSectionPack')}
                </h2>
                <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-4 md:p-6 space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                        {t('pricingPackPriceLabel')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!packLoaded}
                        className="w-full max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                        value={packPrice}
                        onChange={(e) => setPackPrice(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={savingPack || !packLoaded}
                      onClick={() => void savePack()}
                      className="rounded-lg bg-[var(--color-brand-500)] text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50 shrink-0"
                    >
                      {savingPack ? t('pricingSaving') : t('pricingSave')}
                    </button>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                      {t('pricingPackMinimumsTitle')}
                    </h3>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-3">{t('pricingPackMinimumsNote')}</p>
                    <div className="rounded-lg border border-[var(--color-border-subtle)] overflow-x-auto">
                      <table className="w-full text-sm min-w-[280px]">
                        <thead>
                          <tr className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                            <th className="text-start p-2 font-medium">{t('pricingPlanKey')}</th>
                            <th className="text-start p-2 font-medium">{t('pricingMinimumEgp')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packMinimumsRows.map(([key, val]) => (
                            <tr key={key} className="border-t border-[var(--color-border-subtle)]">
                              <td className="p-2 font-mono text-[var(--color-text-primary)]">{key}</td>
                              <td className="p-2 tabular-nums">{fmtMoney(val)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
