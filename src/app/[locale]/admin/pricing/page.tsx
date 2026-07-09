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
import { getAnnualChargeRounded } from '@/lib/pricing';
import { useToast } from '@/hooks/useToast';
import { ArrowLeft, Banknote, ChevronDown } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { SectionHeader } from '@/components/shared';
import { formatNumber } from '@/lib/formatNumber';
import type {
  BannerStyle,
  PricingConfigSnapshot,
} from '@/lib/pricingConfig';

const BANNER_STYLE_PREVIEW: Record<BannerStyle, string> = {
  promo: 'bg-teal-600 text-white',
  info: 'bg-blue-600 text-white',
  warning: 'bg-amber-500 text-[var(--color-text-inverse)]',
  success: 'bg-emerald-600 text-white',
};

/**
 * Correlates `platform_config` write logs on the server (`[PATCH /api/admin/pricing-config]` /
 * `[PATCH /api/admin/pricing/pack]`). Writes on this page come from:
 * - Page load `GET /api/admin/pricing/pack` (bootstrap insert if `pack_price_per_parent` missing - no button).
 * - WhatsApp Pack section Save → `PATCH /api/admin/pricing/pack` (value below).
 * - "Save all changes" → `PATCH /api/admin/pricing-config` (value below).
 * Per-plan saves use `pricing_plans` only - not `platform_config`.
 */
const PRICING_PLATFORM_CONFIG_SAVE_SOURCE = 'X-CHQ-Pricing-Save-Source' as const;

type PlanRow = {
  plan_key: string;
  arabic_name: string;
  english_name: string;
  weekly_student_limit: number;
  cost_per_student: number;
  setup_fee: number;
  is_active: boolean;
  all_in_price: number;
};

type PlanDraft = {
  weekly_student_limit: string;
  all_in_price: string;
  is_active: boolean;
};

function fmtMoney(n: number, loc: string): string {
  if (!Number.isFinite(n)) return '-';
  return formatNumber(n, loc, { maximumFractionDigits: 0 });
}

function titleCaseToken(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Display plan names in Title Case (e.g. STARTER → Starter, nano → Nano). */
function formatPlanDisplayName(raw: string): string {
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(' ');
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
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({});
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);

  const [packPrice, setPackPrice] = useState('12');
  const [savingPack, setSavingPack] = useState(false);
  const [packLoaded, setPackLoaded] = useState(false);

  // ── Pricing Control extension state ──────────────────────────────────────
  const [pricingCfg, setPricingCfg] = useState<PricingConfigSnapshot | null>(null);
  const [pricingCfgDraft, setPricingCfgDraft] = useState<PricingConfigSnapshot | null>(null);
  const [savingPricingCfg, setSavingPricingCfg] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    plans: true,
    interval: false,
    addons: false,
    banner: false,
    popup: false,
    summer: false,
  });
  const toggleSection = useCallback((key: string) => {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  }, []);

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
      if (!data?.isAdmin) {
        router.replace('/dashboard');
        return;
      }
      // internal_admin / internal_viewer can view pricing read-only;
      // only super_admin can save changes.
      setReadOnly(data.role !== 'super_admin');
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
    const tierOrder: Record<string, number> = {
      solo: 0,
      nano: 1,
      starter: 2,
      pro: 3,
      business: 4,
      enterprise: 5,
      top_centers: 6,
    };
    const list = ((data.plans || []) as PlanRow[])
      .filter((p) => p.plan_key !== ['pro', '_plus'].join(''))
      .sort((a, b) => {
        const aRank = tierOrder[a.plan_key] ?? 99;
        const bRank = tierOrder[b.plan_key] ?? 99;
        if (aRank !== bRank) return aRank - bRank;
        return a.plan_key.localeCompare(b.plan_key);
      });
    setPlans(list);
    const next: Record<string, PlanDraft> = {};
    for (const p of list) {
      next[p.plan_key] = {
        weekly_student_limit: String(p.weekly_student_limit ?? ''),
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

  const loadPricingCfg = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const res = await fetch('/api/admin/pricing-config', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || t('pricingLoadError'));
    }
    const data = (await res.json()) as { config: PricingConfigSnapshot };
    // Deep-clone via JSON round-trip so pricingCfg and pricingCfgDraft are always
    // separate objects - prevents shared-reference mutation from triggering a spurious
    // dirty flag on load.
    setPricingCfg(JSON.parse(JSON.stringify(data.config)) as PricingConfigSnapshot);
    setPricingCfgDraft(JSON.parse(JSON.stringify(data.config)) as PricingConfigSnapshot);
  }, [getSession, t]);

  useEffect(() => {
    if (!gateOk) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadPlans(), loadPack(), loadPricingCfg()]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('pricingLoadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateOk, loadPlans, loadPack, loadPricingCfg, t]);

  const pricingCfgDirty = useMemo(() => {
    if (!pricingCfg || !pricingCfgDraft) return false;
    return JSON.stringify(pricingCfg) !== JSON.stringify(pricingCfgDraft);
  }, [pricingCfg, pricingCfgDraft]);

  const savePricingCfg = useCallback(async () => {
    if (!pricingCfg || !pricingCfgDraft) return;
    const headers = await getAuthHeaders();
    if (!headers) return;

    // Send only the changed sections (PATCH partial).
    const body: Record<string, unknown> = {};
    if (JSON.stringify(pricingCfg.interval) !== JSON.stringify(pricingCfgDraft.interval)) {
      body.interval = pricingCfgDraft.interval;
    }
    if (JSON.stringify(pricingCfg.addons) !== JSON.stringify(pricingCfgDraft.addons)) {
      body.addons = pricingCfgDraft.addons;
    }
    if (JSON.stringify(pricingCfg.banner) !== JSON.stringify(pricingCfgDraft.banner)) {
      body.banner = pricingCfgDraft.banner;
    }
    if (JSON.stringify(pricingCfg.popup) !== JSON.stringify(pricingCfgDraft.popup)) {
      body.popup = pricingCfgDraft.popup;
    }
    if (JSON.stringify(pricingCfg.summer) !== JSON.stringify(pricingCfgDraft.summer)) {
      body.summer = pricingCfgDraft.summer;
    }
    if (Object.keys(body).length === 0) return;

    setSavingPricingCfg(true);
    try {
      headers[PRICING_PLATFORM_CONFIG_SAVE_SOURCE] = 'pricing-config-save-all';
      const res = await fetch('/api/admin/pricing-config', {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : tCommon('errorGeneric'));
        return;
      }
      const savedCfg = JSON.parse(JSON.stringify(data.config)) as PricingConfigSnapshot;
      setPricingCfg(savedCfg);
      setPricingCfgDraft(JSON.parse(JSON.stringify(data.config)) as PricingConfigSnapshot);
      toast.success(t('pricingSaved'));
    } finally {
      setSavingPricingCfg(false);
    }
  }, [getAuthHeaders, pricingCfg, pricingCfgDraft, t, tCommon, toast]);

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
    const all_in_price = parseFloat(d.all_in_price);
    const weekly_student_limit = Math.round(parseFloat(d.weekly_student_limit));
    if (!Number.isFinite(all_in_price) || all_in_price <= 0) {
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
      headers[PRICING_PLATFORM_CONFIG_SAVE_SOURCE] = 'whatsapp-pack-save';
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
      <div className="flex flex-col flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <AdminHeader />
        <div className="flex flex-1">
          <AdminSidebar activeRoute="/admin/pricing" />
          <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
            <div className="flex items-center gap-2 mb-4">
              <div className="chq-skeleton h-8 w-8 rounded-lg" />
              <div className="chq-skeleton h-7 w-40 rounded-md" />
            </div>
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="chq-skeleton h-14 w-full rounded-xl" />
              ))}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/pricing" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <Banknote className="h-6 w-6 text-[var(--color-brand-500)]" aria-hidden />
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('pricingPageTitle')}</h1>
            </div>
          </div>

          {readOnly ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 text-amber-700 px-4 py-3 mb-4 text-sm">
              {t('pricing.readOnlyBanner')}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 mb-4">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="chq-skeleton h-14 w-full rounded-xl"
                />
              ))}
            </div>
          ) : (
            <>
              <section className="mb-10">
                <div className="mb-3">
                  <SectionHeader title={t('pricingSectionSubscriptions')} />
                </div>
                <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)]">
                        <th className="text-start p-3 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingPlanName')}</th>
                        <th className="text-start p-3 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingStudentLimit')}</th>
                        <th className="text-start p-3 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingQuarterlyAllIn')}</th>
                        <th className="text-start p-3 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingAnnualDerived')}</th>
                        <th className="text-start p-3 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingMonthlyPremiumDerived')}</th>
                        <th className="text-start p-3 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingActive')}</th>
                        <th className="p-3 w-28" />
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p) => {
                        const d = drafts[p.plan_key];
                        if (!d) return null;
                        const allIn = parseFloat(d.all_in_price);
                        const annual = Number.isFinite(allIn) ? getAnnualChargeRounded(allIn) : NaN;
                        const prem = Number.isFinite(allIn) ? allIn * 1.15 : NaN;
                        const busy = savingPlanId === p.plan_key;
                        return (
                          <tr
                            key={p.plan_key}
                            className="border-b border-[var(--color-border-subtle)] last:border-0 text-[var(--color-text-primary)]"
                          >
                            <td className="p-3 font-medium">
                              {locale === 'ar' ? p.arabic_name : formatPlanDisplayName(p.english_name)}
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
                                value={d.all_in_price}
                                onChange={(e) => updateDraft(p.plan_key, { all_in_price: e.target.value })}
                              />
                            </td>
                            <td className="p-3 tabular-nums text-[var(--color-text-secondary)]">{fmtMoney(annual, locale)}</td>
                            <td className="p-3 tabular-nums text-[var(--color-text-secondary)]">{fmtMoney(prem, locale)}</td>
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
                              {readOnly ? null : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void savePlan(p.plan_key)}
                                  className="w-full rounded-lg bg-[var(--color-brand-500)] text-white px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                                >
                                  {busy ? t('pricingSaving') : t('pricingSave')}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mb-10">
                <div className="mb-3">
                  <SectionHeader title={t('pricingSectionPack')} />
                </div>
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
                    {readOnly ? null : (
                      <button
                        type="button"
                        disabled={savingPack || !packLoaded}
                        onClick={() => void savePack()}
                        className="rounded-lg bg-[var(--color-brand-500)] text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50 shrink-0"
                      >
                        {savingPack ? t('pricingSaving') : t('pricingSave')}
                      </button>
                    )}
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
                            <th className="text-start p-2 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingPlanKey')}</th>
                            <th className="text-start p-2 text-xs font-medium text-[var(--color-text-muted)]">{t('pricingMinimumEgp')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packMinimumsRows.map(([key, val]) => (
                            <tr key={key} className="border-t border-[var(--color-border-subtle)]">
                              <td className="p-2 text-[var(--color-text-primary)]">{formatPlanDisplayName(key)}</td>
                              <td className="p-2 tabular-nums">
                                {key === 'top_centers' || val === 0 ? t('pricingMinimumCustom') : fmtMoney(val, locale)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>

              {pricingCfgDraft ? (
                <>
                  {/* SECTION: Billing Intervals */}
                  <CollapsibleSection
                    title={t('pricingSectionIntervals')}
                    open={openSections.interval}
                    onToggle={() => toggleSection('interval')}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingAnnualMonths')}
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          step="1"
                          className="w-full max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.interval.annualMultiplier}
                          onChange={(e) => {
                            const months = parseFloat(e.target.value);
                            if (!Number.isFinite(months)) return;
                            setPricingCfgDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    interval: { ...d.interval, annualMultiplier: months },
                                  }
                                : d,
                            );
                          }}
                        />
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {t('pricingAnnualMonthsHint', {
                            free: formatNumber(
                              Math.max(0, 12 - pricingCfgDraft.interval.annualMultiplier),
                              locale,
                            ),
                          })}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingAnnualLabelEn')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={60}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.interval.annualLabelEn}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, interval: { ...d.interval, annualLabelEn: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingAnnualLabelAr')}
                        </label>
                        <input
                          type="text"
                          dir="rtl"
                          maxLength={60}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.interval.annualLabelAr}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, interval: { ...d.interval, annualLabelAr: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-xs">
                      <span className="text-[var(--color-text-secondary)]">{t('pricingPreview')}:</span>
                      <span className="rounded-full bg-teal-600/20 px-2 py-0.5 text-teal-400">
                        {locale === 'ar'
                          ? pricingCfgDraft.interval.annualLabelAr
                          : pricingCfgDraft.interval.annualLabelEn}
                      </span>
                    </div>
                  </CollapsibleSection>

                  {/* SECTION: Add-on Pricing */}
                  <CollapsibleSection
                    title={t('pricingSectionAddons')}
                    open={openSections.addons}
                    onToggle={() => toggleSection('addons')}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingAddonWhatsappPack')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.addons.whatsappParentPack}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            setPricingCfgDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    addons: { ...d.addons, whatsappParentPack: Number.isFinite(n) ? n : 0 },
                                  }
                                : d,
                            );
                          }}
                        />
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {t('pricingAddonWhatsappPackDesc')}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingAddonCardBase')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.addons.cardOrderBase}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            setPricingCfgDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    addons: { ...d.addons, cardOrderBase: Number.isFinite(n) ? n : 0 },
                                  }
                                : d,
                            );
                          }}
                        />
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {t('pricingAddonCardBaseDesc')}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingAddonShipping')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.addons.shippingCost}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            setPricingCfgDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    addons: { ...d.addons, shippingCost: Number.isFinite(n) ? n : 0 },
                                  }
                                : d,
                            );
                          }}
                        />
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {t('pricingAddonShippingDesc')}
                        </p>
                      </div>
                    </div>
                  </CollapsibleSection>

                  {/* SECTION: Landing Banner */}
                  <CollapsibleSection
                    title={t('pricingSectionBanner')}
                    open={openSections.banner}
                    onToggle={() => toggleSection('banner')}
                  >
                    <label className="inline-flex items-center gap-2 cursor-pointer mb-4">
                      <input
                        type="checkbox"
                        checked={pricingCfgDraft.banner.enabled}
                        onChange={(e) =>
                          setPricingCfgDraft((d) =>
                            d ? { ...d, banner: { ...d.banner, enabled: e.target.checked } } : d,
                          )
                        }
                        className="rounded border-[var(--color-border-default)]"
                      />
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">
                        {t('pricingBannerEnabled')}
                      </span>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerStyle')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {(['promo', 'info', 'warning', 'success'] as const).map((s) => {
                            const active = pricingCfgDraft.banner.style === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() =>
                                  setPricingCfgDraft((d) =>
                                    d ? { ...d, banner: { ...d.banner, style: s } } : d,
                                  )
                                }
                                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                                  active
                                    ? 'border-teal-500 ring-2 ring-teal-500/30'
                                    : 'border-[var(--color-border-default)]'
                                }`}
                              >
                                <span className={`inline-block h-3 w-3 rounded-full ${BANNER_STYLE_PREVIEW[s]}`} />
                                {t(`pricingBannerStyle_${s}` as 'pricingBannerStyle_promo')}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerTextEn')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={200}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.banner.textEn}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, banner: { ...d.banner, textEn: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerTextAr')}
                        </label>
                        <input
                          type="text"
                          dir="rtl"
                          maxLength={200}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.banner.textAr}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, banner: { ...d.banner, textAr: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerSubtextEn')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={200}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.banner.subtextEn}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, banner: { ...d.banner, subtextEn: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerSubtextAr')}
                        </label>
                        <input
                          type="text"
                          dir="rtl"
                          maxLength={200}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.banner.subtextAr}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, banner: { ...d.banner, subtextAr: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerCtaTextEn')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={60}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.banner.ctaTextEn}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, banner: { ...d.banner, ctaTextEn: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerCtaTextAr')}
                        </label>
                        <input
                          type="text"
                          dir="rtl"
                          maxLength={60}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.banner.ctaTextAr}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, banner: { ...d.banner, ctaTextAr: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingBannerCtaUrl')}
                        </label>
                        <input
                          type="url"
                          dir="ltr"
                          maxLength={500}
                          placeholder="https://"
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.banner.ctaUrl}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, banner: { ...d.banner, ctaUrl: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                    </div>

                    {pricingCfgDraft.banner.enabled && pricingCfgDraft.banner.textEn ? (
                      <div className="mt-4 space-y-3">
                        <p className="text-xs text-[var(--color-text-secondary)]">{t('pricingPreview')}:</p>
                        <BannerPreview cfg={pricingCfgDraft.banner} locale="en" />
                        <BannerPreview cfg={pricingCfgDraft.banner} locale="ar" />
                      </div>
                    ) : null}
                  </CollapsibleSection>

                  {/* SECTION: Landing Page Popup */}
                  <CollapsibleSection
                    title={t('pricingSectionPopup')}
                    open={openSections.popup}
                    onToggle={() => toggleSection('popup')}
                  >
                    <label className="inline-flex items-center gap-2 cursor-pointer mb-4">
                      <input
                        type="checkbox"
                        checked={pricingCfgDraft.popup.enabled}
                        onChange={(e) =>
                          setPricingCfgDraft((d) =>
                            d ? { ...d, popup: { ...d.popup, enabled: e.target.checked } } : d,
                          )
                        }
                        className="rounded border-[var(--color-border-default)]"
                      />
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">
                        {t('pricingPopupEnabled')}
                      </span>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupDelaySeconds')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          step={1}
                          className="w-full max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.popup.delaySeconds}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            setPricingCfgDraft((d) =>
                              d
                                ? { ...d, popup: { ...d.popup, delaySeconds: Number.isFinite(n) ? n : 0 } }
                                : d,
                            );
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupPromoCode')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={50}
                          placeholder="e.g. LAUNCH30"
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 font-mono tracking-widest"
                          value={pricingCfgDraft.popup.promoCode}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d
                                ? { ...d, popup: { ...d.popup, promoCode: e.target.value.toUpperCase() } }
                                : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupTitleEn')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={120}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.popup.titleEn}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, popup: { ...d.popup, titleEn: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupTitleAr')}
                        </label>
                        <input
                          type="text"
                          dir="rtl"
                          maxLength={120}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.popup.titleAr}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, popup: { ...d.popup, titleAr: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupBodyEn')}
                        </label>
                        <textarea
                          dir="ltr"
                          maxLength={400}
                          rows={3}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 resize-none"
                          value={pricingCfgDraft.popup.bodyEn}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, popup: { ...d.popup, bodyEn: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupBodyAr')}
                        </label>
                        <textarea
                          dir="rtl"
                          maxLength={400}
                          rows={3}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 resize-none"
                          value={pricingCfgDraft.popup.bodyAr}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, popup: { ...d.popup, bodyAr: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupCtaTextEn')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={60}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.popup.ctaTextEn}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, popup: { ...d.popup, ctaTextEn: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupCtaTextAr')}
                        </label>
                        <input
                          type="text"
                          dir="rtl"
                          maxLength={60}
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.popup.ctaTextAr}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, popup: { ...d.popup, ctaTextAr: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingPopupCtaUrl')}
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          maxLength={500}
                          placeholder="/pricing"
                          className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.popup.ctaUrl}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, popup: { ...d.popup, ctaUrl: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                    </div>

                    {pricingCfgDraft.popup.enabled && (pricingCfgDraft.popup.titleEn || pricingCfgDraft.popup.titleAr || pricingCfgDraft.popup.promoCode) ? (
                      <div className="mt-6 space-y-3">
                        <p className="text-xs text-[var(--color-text-secondary)]">{t('pricingPreview')}:</p>
                        <PopupPreview cfg={pricingCfgDraft.popup} locale="en" />
                        <PopupPreview cfg={pricingCfgDraft.popup} locale="ar" />
                      </div>
                    ) : null}
                  </CollapsibleSection>

                  {/* SECTION: Summer 2026 promo */}
                  <CollapsibleSection
                    title={t('pricingSectionSummer')}
                    open={openSections.summer}
                    onToggle={() => toggleSection('summer')}
                  >
                    <label className="inline-flex items-center gap-2 cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={pricingCfgDraft.summer.enabled}
                        onChange={(e) =>
                          setPricingCfgDraft((d) =>
                            d ? { ...d, summer: { ...d.summer, enabled: e.target.checked } } : d,
                          )
                        }
                        className="rounded border-[var(--color-border-default)]"
                      />
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">
                        {t('pricingSummerEnabled')}
                      </span>
                    </label>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-4">
                      {t('pricingSummerEnabledDesc')}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingSummerFreeUntil')}
                        </label>
                        <input
                          type="date"
                          dir="ltr"
                          className="w-full max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.summer.freeUntil}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, summer: { ...d.summer, freeUntil: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingSummerFirstChargeFloor')}
                        </label>
                        <input
                          type="date"
                          dir="ltr"
                          className="w-full max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.summer.firstChargeFloor}
                          onChange={(e) =>
                            setPricingCfgDraft((d) =>
                              d ? { ...d, summer: { ...d.summer, firstChargeFloor: e.target.value } } : d,
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingSummerTrialDays')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={365}
                          step={1}
                          className="w-full max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.summer.trialDays}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            setPricingCfgDraft((d) =>
                              d ? { ...d, summer: { ...d.summer, trialDays: Number.isFinite(n) ? n : 0 } } : d,
                            );
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                          {t('pricingSummerPayWindowDays')}
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          step={1}
                          className="w-full max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                          value={pricingCfgDraft.summer.payWindowDays}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            setPricingCfgDraft((d) =>
                              d ? { ...d, summer: { ...d.summer, payWindowDays: Number.isFinite(n) ? n : 1 } } : d,
                            );
                          }}
                        />
                      </div>
                    </div>

                    <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                      {t('pricingSummerDatesHint')}
                    </p>

                    <div className="mt-5">
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                        {t('pricingSummerFirstChargeRelease')}
                      </label>
                      <select
                        className="w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2"
                        value={pricingCfgDraft.summer.firstChargeRelease}
                        onChange={(e) =>
                          setPricingCfgDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  summer: {
                                    ...d.summer,
                                    firstChargeRelease: e.target.value === 'RELEASED' ? 'RELEASED' : 'HELD',
                                  },
                                }
                              : d,
                          )
                        }
                      >
                        <option value="HELD">{t('pricingSummerHeld')}</option>
                        <option value="RELEASED">{t('pricingSummerReleased')}</option>
                      </select>
                      <p className="mt-2 text-xs text-amber-500">{t('pricingSummerReleaseWarning')}</p>
                    </div>
                  </CollapsibleSection>

                  {/* Global save bar */}
                  {readOnly ? null : (
                    <div className="sticky bottom-0 -mx-4 md:-mx-6 mt-6 border-t border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-4 py-3 md:px-6 flex items-center justify-end gap-2">
                      {pricingCfgDirty ? (
                        <span className="text-xs text-amber-500">{t('pricingUnsavedChanges')}</span>
                      ) : null}
                      <button
                        type="button"
                        disabled={!pricingCfgDirty || savingPricingCfg}
                        onClick={() => void savePricingCfg()}
                        className="rounded-lg bg-[var(--color-brand-500)] text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                      >
                        {savingPricingCfg ? t('pricingSaving') : t('pricingSaveAll')}
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({ title, open, onToggle, children }: CollapsibleSectionProps) {
  return (
    <section className="mb-6 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-start"
      >
        <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
          {title}
        </h2>
        <ChevronDown
          size={16}
          className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? <div className="px-4 pb-4 md:px-6 md:pb-6">{children}</div> : null}
    </section>
  );
}

interface BannerPreviewProps {
  cfg: PricingConfigSnapshot['banner'];
  locale: 'en' | 'ar';
}

function BannerPreview({ cfg, locale }: BannerPreviewProps) {
  const isAr = locale === 'ar';
  const bg = BANNER_STYLE_PREVIEW[cfg.style];
  const text = isAr ? cfg.textAr : cfg.textEn;
  const subtext = isAr ? cfg.subtextAr : cfg.subtextEn;
  const cta = isAr ? cfg.ctaTextAr : cfg.ctaTextEn;
  if (!text) return null;
  return (
    <div className={`w-full rounded-lg ${bg} px-3 py-2 text-xs`} dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{text}</span>
        {subtext ? <span className="opacity-90">{subtext}</span> : null}
        {cta && cfg.ctaUrl ? (
          <span className="ms-2 inline-flex items-center rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-inverse)]">
            {cta}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface PopupPreviewProps {
  cfg: PricingConfigSnapshot['popup'];
  locale: 'en' | 'ar';
}

function PopupPreview({ cfg, locale }: PopupPreviewProps) {
  const isAr = locale === 'ar';
  const title = isAr ? cfg.titleAr : cfg.titleEn;
  const body = isAr ? cfg.bodyAr : cfg.bodyEn;
  const cta = isAr ? cfg.ctaTextAr : cfg.ctaTextEn;
  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="mx-auto max-w-xs rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-0)] p-4 shadow-lg text-xs"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-semibold text-sm text-[var(--color-text-primary)] leading-tight">{title || (isAr ? '(عنوان)' : '(Title)')}</p>
        <span className="shrink-0 rounded-full p-0.5 text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] text-[10px] px-1.5">x</span>
      </div>
      {body ? <p className="mb-3 text-[var(--color-text-secondary)] leading-relaxed">{body}</p> : null}
      {cfg.promoCode ? (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-teal-700/50 bg-teal-950/30 px-3 py-2">
          <span className="font-mono font-bold tracking-widest text-teal-400 text-sm">{cfg.promoCode}</span>
          <span className="text-[10px] text-teal-600 border border-teal-800/60 rounded px-1.5 py-0.5">{isAr ? 'نسخ' : 'Copy'}</span>
        </div>
      ) : null}
      {cta && cfg.ctaUrl ? (
        <div className="mt-2 w-full rounded-lg bg-teal-600 px-3 py-1.5 text-center text-white font-semibold text-xs">
          {cta}
        </div>
      ) : null}
    </div>
  );
}
