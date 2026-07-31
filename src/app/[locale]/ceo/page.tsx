'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { ChartCard } from '@/components/charts';
import { MobileWrapper } from '@/components/shell/MobileWrapper';
import type { CeoCenterHealthTierRow, CeoDashboardData, CeoTrialsWatch, LeadStage } from '@/types/ceo';
import { ChevronDown } from 'lucide-react';
import { formatNumber, formatDateTime, formatCurrency } from '@/lib/formatNumber';

const SECTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

const BOOL_CONFIG_ORDER = [
  'maintenance_mode',
  'wa_sending_enabled',
  'read_only_mode',
  'cron_paused',
] as const;

const PIPELINE_STAGES: LeadStage[] = ['lead', 'demo', 'trial', 'closed', 'lost'];

const PLAN_VALUES = ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise'] as const;

const PLAN_LABEL_KEYS: Record<
  (typeof PLAN_VALUES)[number],
  | 'pipeline.planSolo'
  | 'pipeline.planNano'
  | 'pipeline.planStarter'
  | 'pipeline.planPro'
  | 'pipeline.planBusiness'
  | 'pipeline.planEnterprise'
> = {
  solo: 'pipeline.planSolo',
  nano: 'pipeline.planNano',
  starter: 'pipeline.planStarter',
  pro: 'pipeline.planPro',
  business: 'pipeline.planBusiness',
  enterprise: 'pipeline.planEnterprise',
};

function scrollToSection(id: string) {
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth' });
}

export default function CeoDashboardPage() {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('ceo');
  const tCommon = useTranslations('common');
  const th = useTranslations('health');
  const tPlan = useTranslations('plan');
  const tT = useTranslations('ceoTeachers');

  const formatPlanCell = (plan: string | null | undefined) => {
    const p = String(plan ?? '').trim().toLowerCase();
    if (!p) return tCommon('notSet');
    const keys = ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const;
    if ((keys as readonly string[]).includes(p)) return tPlan(p as (typeof keys)[number]);
    return String(plan);
  };

  const [data, setData] = useState<CeoDashboardData | null>(null);
  const [trials, setTrials] = useState<CeoTrialsWatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isHUnlocked, setIsHUnlocked] = useState(false);
  const [sectionHPassword, setSectionHPassword] = useState('');
  const [sectionHError, setSectionHError] = useState('');
  const [confirmConfigKey, setConfirmConfigKey] = useState<string | null>(null);
  const [confirmDangerAction, setConfirmDangerAction] = useState<string | null>(null);
  const [suspendConfirmId, setSuspendConfirmId] = useState<string | null>(null);
  const [leadFormOpen, setLeadFormOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
  const [bannerDraft, setBannerDraft] = useState('');

  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadDistrict, setLeadDistrict] = useState('');
  const [leadPlan, setLeadPlan] = useState<string>('starter');
  const [leadStage, setLeadStage] = useState<LeadStage>('lead');
  const [leadSource, setLeadSource] = useState('');
  const [leadNextFollowup, setLeadNextFollowup] = useState('');

  const announcementRef = useRef<string>('');

  const fetchDashboard = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    const authHeader = { Authorization: `Bearer ${session.access_token}` };
    try {
      const res = await fetch('/api/ceo/dashboard', { headers: authHeader });
      if (res.ok) {
        const json = (await res.json()) as CeoDashboardData;
        setData(json);
        setLastSync(new Date());
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
    // Trials watch is super_admin-only; best-effort so accountants (who can see
    // the rest of the dashboard) simply don't get the widget on a 403.
    try {
      const tRes = await fetch('/api/ceo/trials-watch', { headers: authHeader });
      if (tRes.ok) {
        setTrials((await tRes.json()) as CeoTrialsWatch);
      }
    } catch {
      // ignore — widget hidden when data unavailable
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchDashboard();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  useEffect(() => {
    if (data) {
      const v = String(data.ops.platform_config.announcement_banner ?? '');
      announcementRef.current = v;
      setBannerDraft(v);
    }
  }, [data]);

  function activationStepLabel(step: number): string {
    switch (Math.min(5, Math.max(0, step))) {
      case 0:
        return t('activation.steps.0');
      case 1:
        return t('activation.steps.1');
      case 2:
        return t('activation.steps.2');
      case 3:
        return t('activation.steps.3');
      case 4:
        return t('activation.steps.4');
      default:
        return t('activation.steps.5');
    }
  }

  const minutesSinceSync = lastSync
    ? Math.floor((Date.now() - lastSync.getTime()) / 60_000)
    : null;

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const defaultTiers = {
    green: 0,
    amber: 0,
    red: 0,
    red_centers: [] as CeoCenterHealthTierRow[],
    amber_centers: [] as CeoCenterHealthTierRow[],
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-brand-500)] animate-spin" aria-hidden />
          <p className="text-[var(--color-text-secondary)] text-sm">{tCommon('loading')}</p>
        </div>
      </div>
    );
  }

  const isHealthy =
    data.ops.platform_config.maintenance_mode !== true &&
    data.ops.platform_config.wa_sending_enabled !== false;

  async function getAuthJsonHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    const headers = await getAuthJsonHeaders();
    const nextFollowupIso = leadNextFollowup
      ? new Date(leadNextFollowup).toISOString()
      : undefined;
    const res = await fetch('/api/ceo/leads', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: leadName,
        phone: leadPhone,
        district: leadDistrict || null,
        governorate: 'cairo',
        plan_interest: leadPlan,
        stage: leadStage,
        source: leadSource || null,
        notes: null,
        next_followup: nextFollowupIso,
      }),
    });
    if (res.ok) {
      setLeadFormOpen(false);
      setLeadName('');
      setLeadPhone('');
      setLeadDistrict('');
      setLeadPlan('starter');
      setLeadStage('lead');
      setLeadSource('');
      setLeadNextFollowup('');
      void fetchDashboard();
    }
  }

  async function snoozeAction(id: string) {
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const headers = await getAuthJsonHeaders();
    await fetch(`/api/ceo/actions/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ snoozed_until: snoozedUntil }),
    });
    void fetchDashboard();
  }

  async function patchPlatformConfig(key: string, value: unknown) {
    const headers = await getAuthJsonHeaders();
    const res = await fetch('/api/ceo/platform-config', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) {
      window.alert(t('ops.configUpdateFailed'));
      return;
    }
    void fetchDashboard();
  }

  async function suspendCenter(id: string) {
    const headers = await getAuthJsonHeaders();
    await fetch(`/api/admin/centers/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'suspended' }),
    });
    setSuspendConfirmId(null);
    void fetchDashboard();
  }

  function healthScoreStyle(score: number | null): { className: string; label: string } {
    if (score == null) {
      return {
        className: 'bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]',
        label: t('health.notCalculated'),
      };
    }
    if (score >= 80) {
      return { className: 'bg-green-400/10 text-green-400', label: t('health.excellent') };
    }
    if (score >= 60) {
      return { className: 'bg-teal-500/10 text-teal-600', label: t('health.good') };
    }
    if (score >= 40) {
      return { className: 'bg-amber-400/10 text-amber-400', label: t('health.average') };
    }
    return { className: 'bg-red-400/10 text-red-400', label: t('health.critical') };
  }

  function renewalPill(days: number | null): { className: string; text: string } {
    if (days == null) {
      return { className: 'text-[var(--color-text-tertiary)]', text: tCommon('notSet') };
    }
    if (days === 0) {
      return { className: 'inline-flex rounded-full px-2 py-0.5 text-xs bg-red-400/10 text-red-400', text: t('health.expired') };
    }
    const body = `${days} ${t('health.days')}`;
    if (days <= 7) {
      return { className: 'inline-flex rounded-full px-2 py-0.5 text-xs bg-red-400/10 text-red-400', text: body };
    }
    if (days <= 14) {
      return { className: 'inline-flex rounded-full px-2 py-0.5 text-xs bg-amber-400/10 text-amber-400', text: body };
    }
    return {
      className: 'inline-flex rounded-full px-2 py-0.5 text-xs bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]',
      text: body,
    };
  }

  const actionsByPriority = {
    red: data.action_queue.actions.filter((a) => a.priority === 'red'),
    amber: data.action_queue.actions.filter((a) => a.priority === 'amber'),
    green: data.action_queue.actions.filter((a) => a.priority === 'green'),
  };

  const tiers = data.center_health_tiers ?? defaultTiers;

  function waDigits(phone: string | null): string {
    return (phone ?? '').replace(/\D/g, '');
  }

  return (
    <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen w-full min-w-0 bg-[var(--color-surface-0)] pt-14 lg:pt-0 page-enter">
      <AdminSidebar activeRoute={pathname} />
      <div className="flex-1 overflow-auto flex flex-col min-w-0 lg:ms-56">
        <MobileWrapper fullWidth>
          <div className="sticky top-0 z-20 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/95 backdrop-blur-sm px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold text-[var(--color-text-primary)]">{t('brandTitle')}</span>
              <div className="flex flex-wrap gap-1">
                {SECTION_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => scrollToSection(id)}
                    className="rounded-full px-2.5 py-1 text-xs font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
                  >
                    {id.toUpperCase()} · {t(`sections.${id}`)}
                  </button>
                ))}
              </div>
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ background: isHealthy ? '#22c55e' : '#ef4444' }}
                title={isHealthy ? t('healthDotOk') : t('healthDotIssue')}
              />
              <span className="text-xs text-[var(--color-text-secondary)] ms-auto">
                {t('lastSync')}:{' '}
                {minutesSinceSync != null ? t('lastSyncMinutes', { minutes: minutesSinceSync }) : tCommon('notSet')}
              </span>
            </div>
          </div>

          <div className="px-4 py-6 space-y-10">

            <section id="section-a">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{t('sections.a')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-[var(--color-brand-500)]">
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('hero.activeCenters')}</p>
                  <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                    {formatNumber(data.hero.active_centers, locale)}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-amber-400">
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('hero.cashMtd')}</p>
                  <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                    {formatCurrency(data.hero.cash_collected_mtd, locale)}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('hero.liveTrials')}</p>
                  <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                    {formatNumber(data.hero.live_trials, locale)}
                  </p>
                </div>
                <div
                  className={`rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 ${
                    data.hero.at_risk_centers > 0 ? 'border-s-red-400' : 'border-s-[var(--color-border-default)]'
                  }`}
                >
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('hero.atRisk')}</p>
                  <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                    {formatNumber(data.hero.at_risk_centers, locale)}
                  </p>
                </div>
                <div
                  className={`rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 sm:col-span-1 col-span-2 ${
                    data.hero.open_alerts > 0 ? 'border-s-red-400' : 'border-s-[var(--color-border-default)]'
                  }`}
                >
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('hero.openAlerts')}</p>
                  <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                    {formatNumber(data.hero.open_alerts, locale)}
                  </p>
                </div>
              </div>
            </section>

            {trials && (
              <section id="section-trials" aria-labelledby="trials-watch-heading">
                <h2
                  id="trials-watch-heading"
                  className="text-sm font-semibold text-[var(--color-text-primary)] mb-3"
                >
                  {t('trialsWatch.title')}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-[var(--color-brand-500)]">
                    <p className="text-xs text-[var(--color-text-secondary)]">{t('trialsWatch.centersInTrial')}</p>
                    <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                      {formatNumber(trials.centers_in_trial, locale)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-teal-500">
                    <p className="text-xs text-[var(--color-text-secondary)]">{t('trialsWatch.teachersInTrial')}</p>
                    <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                      {formatNumber(trials.teachers_in_trial, locale)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-[var(--color-border-default)]">
                    <p className="text-xs text-[var(--color-text-secondary)]">{t('trialsWatch.convertedToPaid')}</p>
                    <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                      {formatNumber(trials.converted_to_paid, locale)}
                    </p>
                  </div>
                  <div
                    className={`rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 ${
                      trials.trials_ending_7d > 0 ? 'border-s-amber-400' : 'border-s-[var(--color-border-default)]'
                    }`}
                  >
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {t('trialsWatch.endingSoon', { days: formatNumber(7, locale) })}
                    </p>
                    <p
                      className={`text-xl font-mono font-bold mt-1 ${
                        trials.trials_ending_7d > 0 ? 'text-amber-400' : 'text-[var(--color-text-primary)]'
                      }`}
                    >
                      {formatNumber(trials.trials_ending_7d, locale)}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {data.teacher_combined && (
              <section id="section-combined" aria-labelledby="combined-heading">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h2
                    id="combined-heading"
                    className="text-sm font-semibold text-[var(--color-text-primary)]"
                  >
                    {tT('combined.title')}
                  </h2>
                  <a
                    href={`/${locale}/ceo/teachers`}
                    className="text-xs font-medium text-[var(--color-brand-500)] underline ms-auto"
                  >
                    {tT('combined.openSection')}
                  </a>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-[var(--color-border-default)]">
                    <p className="text-xs text-[var(--color-text-secondary)]">{tT('combined.centerMrr')}</p>
                    <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                      {formatCurrency(data.teacher_combined.center_mrr, locale)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-teal-500">
                    <p className="text-xs text-[var(--color-text-secondary)]">{tT('combined.teacherMrr')}</p>
                    <p className="text-xl font-mono font-bold text-[var(--color-text-primary)] mt-1">
                      {formatCurrency(data.teacher_combined.teacher_mrr, locale)}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
                      {tT('combined.teacherBreakdown', {
                        active: formatNumber(data.teacher_combined.teacher_active_subs, locale),
                        trials: formatNumber(data.teacher_combined.teacher_trials, locale),
                      })}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-[var(--color-brand-500)]">
                    <p className="text-xs text-[var(--color-text-secondary)]">{tT('combined.combinedMrr')}</p>
                    <p className="text-xl font-mono font-bold text-[var(--color-brand-500)] mt-1">
                      {formatCurrency(data.teacher_combined.combined_mrr, locale)}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
                      {tT('combined.totalTeachers', {
                        count: formatNumber(data.teacher_combined.total_teachers, locale),
                      })}
                    </p>
                  </div>
                </div>
              </section>
            )}

            <section id="section-center-health" aria-labelledby="center-health-heading">
              <h2
                id="center-health-heading"
                className="text-sm font-semibold text-[var(--color-text-primary)] mb-3"
              >
                {th('title')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <ChartCard title={th('green')} value={tiers.green} minHeight={88} loading={false}>
                  <div className="flex items-center gap-2 pt-1">
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ background: 'var(--color-brand-500)' }}
                      aria-hidden
                    />
                  </div>
                </ChartCard>
                <ChartCard title={th('amber')} value={tiers.amber} minHeight={88} loading={false}>
                  <div className="flex items-center gap-2 pt-1">
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ background: 'var(--color-warning)' }}
                      aria-hidden
                    />
                  </div>
                </ChartCard>
                <ChartCard title={th('red')} value={tiers.red} minHeight={88} loading={false}>
                  <div className="flex items-center gap-2 pt-1">
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ background: 'var(--color-danger)' }}
                      aria-hidden
                    />
                  </div>
                </ChartCard>
              </div>

              <ChartCard title={th('redTableTitle')} minHeight={120} loading={false}>
                <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] -mx-1">
                  <table className="w-full text-sm text-start">
                    <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 font-medium">{th('colCenter')}</th>
                        <th className="px-3 py-2 font-medium">{th('colPlan')}</th>
                        <th className="px-3 py-2 font-medium">{th('colDaysSinceLogin')}</th>
                        <th className="px-3 py-2 font-medium">{th('score')}</th>
                        <th className="px-3 py-2 font-medium w-12">{th('whatsapp')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiers.red_centers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-[var(--color-text-secondary)]">
                            {tCommon('empty')}
                          </td>
                        </tr>
                      ) : (
                        tiers.red_centers.map((row) => {
                          const d = waDigits(row.owner_phone);
                          return (
                            <tr
                              key={row.id}
                              className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                            >
                              <td className="px-3 py-2 font-medium">{row.name}</td>
                              <td className="px-3 py-2">{formatPlanCell(row.plan)}</td>
                              <td className="px-3 py-2">
                                {row.days_since_owner_login == null
                                  ? tCommon('notSet')
                                  : th('daysAgo', {
                                      days: formatNumber(row.days_since_owner_login, locale, {
                                        useGrouping: false,
                                      }),
                                    })}
                              </td>
                              <td className="px-3 py-2 font-mono tabular-nums">
                                {row.health_score == null
                                  ? tCommon('notSet')
                                  : formatNumber(row.health_score, locale)}
                              </td>
                              <td className="px-3 py-2">
                                {d.length > 0 ? (
                                  <a
                                    href={`https://wa.me/${d}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[var(--color-brand-500)] font-medium underline"
                                    aria-label={th('whatsapp')}
                                  >
                                    {th('whatsapp')}
                                  </a>
                                ) : (
                                  <span className="text-[var(--color-text-tertiary)]">
                                    {tCommon('notSet')}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </ChartCard>

              <div className="h-4" />

              <ChartCard title={th('amberTableTitle')} minHeight={120} loading={false}>
                <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] -mx-1">
                  <table className="w-full text-sm text-start">
                    <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 font-medium">{th('colCenter')}</th>
                        <th className="px-3 py-2 font-medium">{th('colPlan')}</th>
                        <th className="px-3 py-2 font-medium">{th('colDaysSinceLogin')}</th>
                        <th className="px-3 py-2 font-medium">{th('score')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiers.amber_centers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-[var(--color-text-secondary)]">
                            {tCommon('empty')}
                          </td>
                        </tr>
                      ) : (
                        tiers.amber_centers.map((row) => (
                          <tr
                            key={row.id}
                            className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                          >
                            <td className="px-3 py-2 font-medium">{row.name}</td>
                            <td className="px-3 py-2">{formatPlanCell(row.plan)}</td>
                            <td className="px-3 py-2">
                              {row.days_since_owner_login == null
                                ? tCommon('notSet')
                                : th('daysAgo', {
                                    days: formatNumber(row.days_since_owner_login, locale, {
                                      useGrouping: false,
                                    }),
                                  })}
                            </td>
                            <td className="px-3 py-2 font-mono tabular-nums">
                              {row.health_score == null
                                ? tCommon('notSet')
                                : formatNumber(row.health_score, locale)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            </section>

            <section id="section-b">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{t('sections.b')}</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-3">
                  {data.action_queue.actions.length === 0 ? (
                    <p className="text-green-400 text-sm">✓ {t('actions.noActions')}</p>
                  ) : (
                    data.action_queue.actions.map((action) => (
                      <div
                        key={action.id}
                        className="flex gap-3 items-start border-b border-[var(--color-border-subtle)] pb-3 last:border-0 last:pb-0"
                      >
                        <span
                          className={`mt-1 size-2 rounded-full shrink-0 ${
                            action.priority === 'red'
                              ? 'bg-red-400'
                              : action.priority === 'amber'
                                ? 'bg-amber-400'
                                : 'bg-green-400'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[var(--color-text-primary)]">{action.title}</p>
                          {action.subtitle && (
                            <p className="text-sm text-[var(--color-text-secondary)]">{action.subtitle}</p>
                          )}
                          {action.revenue_at_risk > 0 && (
                            <span className="inline-block mt-1 bg-amber-400/10 text-amber-400 text-xs px-2 py-0.5 rounded-full">
                              {formatCurrency(Number(action.revenue_at_risk), locale)} {t('actions.revenueAtRisk')}
                            </span>
                          )}
                          <div className="flex flex-wrap gap-2 mt-2">
                            {action.action_url ? (
                              <a
                                href={action.action_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-[var(--color-brand-500)] underline"
                              >
                                {action.action_label ?? t('actions.view')}
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void snoozeAction(action.id)}
                              className="text-xs font-medium text-[var(--color-text-secondary)] underline"
                            >
                              {t('actions.snooze')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-3">{t('actions.alertsSummary')}</p>
                  <div className="flex gap-2 mb-4">
                    <span className="rounded-full bg-red-400/15 text-red-400 text-xs px-2 py-0.5">
                      {data.action_queue.red}
                    </span>
                    <span className="rounded-full bg-amber-400/15 text-amber-400 text-xs px-2 py-0.5">
                      {data.action_queue.amber}
                    </span>
                    <span className="rounded-full bg-green-400/15 text-green-400 text-xs px-2 py-0.5">
                      {data.action_queue.green}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {(['red', 'amber', 'green'] as const).map((pri) => (
                      <div key={pri}>
                        {actionsByPriority[pri].map((action) => (
                          <div
                            key={action.id}
                            className={`mb-2 rounded-lg px-3 py-2 text-sm ${
                              pri === 'red'
                                ? 'bg-[var(--color-surface-2)] border-s-2 border-s-red-400'
                                : 'bg-[var(--color-surface-2)]'
                            }`}
                          >
                            <p className="font-medium text-[var(--color-text-primary)]">{action.title}</p>
                            {action.subtitle && (
                              <p className="text-[var(--color-text-tertiary)] text-xs">{action.subtitle}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section id="section-c">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('pipeline.title')}</h2>
                {data.pipeline.overdue_followups > 0 && (
                  <span className="rounded-full bg-red-400/15 text-red-400 text-xs px-2 py-0.5">
                    {t('pipeline.overdueFollowups')}: {formatNumber(data.pipeline.overdue_followups, locale)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                {PIPELINE_STAGES.map((st) => (
                  <div
                    key={st}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-center"
                  >
                    <p className="text-xs text-[var(--color-text-secondary)]">{t(`pipeline.stages.${st}`)}</p>
                    <p className="font-mono font-bold text-[var(--color-text-primary)]">
                      {formatNumber(data.pipeline[st], locale)}
                    </p>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setLeadFormOpen((o) => !o)}
                className="text-sm font-medium text-[var(--color-brand-500)] mb-2"
              >
                {t('pipeline.addLead')}
              </button>
              <button
                type="button"
                className="block text-xs text-[var(--color-text-tertiary)] mb-2 text-start hover:underline"
              >
                {t('pipeline.viewDetails')}
              </button>
              {leadFormOpen && (
                <form
                  onSubmit={(e) => void submitLead(e)}
                  className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 grid gap-3 max-w-md"
                >
                  <input
                    required
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    placeholder={tCommon('name')}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <input
                    required
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    placeholder={tCommon('phone')}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <input
                    value={leadDistrict}
                    onChange={(e) => setLeadDistrict(e.target.value)}
                    placeholder={t('pipeline.fieldDistrict')}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <select
                    value={leadPlan}
                    onChange={(e) => setLeadPlan(e.target.value)}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {PLAN_VALUES.map((pk) => (
                      <option key={pk} value={pk}>
                        {t(PLAN_LABEL_KEYS[pk])}
                      </option>
                    ))}
                  </select>
                  <select
                    value={leadStage}
                    onChange={(e) => setLeadStage(e.target.value as LeadStage)}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {PIPELINE_STAGES.map((st) => (
                      <option key={st} value={st}>
                        {t(`pipeline.stages.${st}`)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value)}
                    placeholder={t('pipeline.fieldSource')}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <input
                    type="datetime-local"
                    value={leadNextFollowup}
                    onChange={(e) => setLeadNextFollowup(e.target.value)}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--color-brand-500)] text-white py-2 text-sm font-medium"
                  >
                    {t('pipeline.submitLead')}
                  </button>
                </form>
              )}
            </section>

            <section id="section-d">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{t('activation.title')}</h2>
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
                <table className="w-full text-sm text-start">
                  <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('activation.colCenter')}</th>
                      <th className="px-3 py-2 font-medium">{t('activation.colPlan')}</th>
                      <th className="px-3 py-2 font-medium">{t('activation.colStep')}</th>
                      <th className="px-3 py-2 font-medium">{t('activation.colScan')}</th>
                      <th className="px-3 py-2 font-medium">{t('activation.colPayment')}</th>
                      <th className="px-3 py-2 font-medium">{t('activation.colCreated')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activation.centers.map((row) => {
                      const stuck = row.onboarding_step < 2 && row.created_at < threeDaysAgo;
                      return (
                        <tr
                          key={row.id}
                          className={`border-t border-[var(--color-border-subtle)] ${
                            stuck ? 'bg-[var(--color-surface-2)] border-s-2 border-s-red-400' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-[var(--color-text-primary)]">{row.name}</td>
                          <td className="px-3 py-2">{formatPlanCell(row.plan)}</td>
                          <td className="px-3 py-2 min-w-[120px]">
                            <div className="h-1.5 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                              <div
                                className="h-full bg-[var(--color-brand-500)]"
                                style={{ width: `${(row.onboarding_step / 5) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-[var(--color-text-secondary)] mt-1 block">
                              {activationStepLabel(row.onboarding_step)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={row.has_scanned ? 'text-[var(--color-brand-500)]' : 'text-[var(--color-text-tertiary)]'}>
                              {row.has_scanned ? '✓' : '✗'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={row.has_payment ? 'text-[var(--color-brand-500)]' : 'text-[var(--color-text-tertiary)]'}>
                              {row.has_payment ? '✓' : '✗'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text-secondary)] font-mono text-xs">
                            {formatDateTime(row.created_at, locale)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="section-e">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{t('health.title')}</h2>
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
                <table className="w-full text-sm text-start">
                  <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('health.colCenter')}</th>
                      <th className="px-3 py-2 font-medium">{t('health.colPlan')}</th>
                      <th className="px-3 py-2 font-medium">{t('health.colStatus')}</th>
                      <th className="px-3 py-2 font-medium">{t('health.colScore')}</th>
                      <th className="px-3 py-2 font-medium">{t('health.colScansToday')}</th>
                      <th className="px-3 py-2 font-medium">{t('health.colRenewal')}</th>
                      <th className="px-3 py-2 font-medium">{t('health.colDistrict')}</th>
                      <th className="px-3 py-2 font-medium">{t('health.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.centers_health.map((row) => {
                      const hp = healthScoreStyle(row.health_score);
                      const rp = renewalPill(row.days_to_renewal);
                      const digits = (row.phone ?? '').replace(/\D/g, '');
                      return (
                        <tr key={row.id} className="border-t border-[var(--color-border-subtle)]">
                          <td className="px-3 py-2 text-[var(--color-text-primary)] font-medium">{row.name}</td>
                          <td className="px-3 py-2">{formatPlanCell(row.plan)}</td>
                          <td className="px-3 py-2">{row.status}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${hp.className}`}>{hp.label}</span>
                          </td>
                          <td className="px-3 py-2 font-mono">{formatNumber(row.scans_today, locale)}</td>
                          <td className="px-3 py-2">
                            <span className={rp.className}>{rp.text}</span>
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.district ?? tCommon('notSet')}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <a
                                href={`/${locale}/admin?center=${row.id}`}
                                target="_blank"
                                rel="noreferrer"
                                title={t('actions.view')}
                                className="p-1.5 rounded-md hover:bg-[var(--color-surface-2)]"
                              >
                                👁
                              </a>
                              {digits.length > 0 ? (
                                <a
                                  href={`https://wa.me/${digits}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={t('actions.whatsapp')}
                                  className="p-1.5 rounded-md hover:bg-[var(--color-surface-2)]"
                                >
                                  💬
                                </a>
                              ) : null}
                              <button
                                type="button"
                                title={t('actions.suspend')}
                                onClick={() => setSuspendConfirmId(row.id)}
                                className="p-1.5 rounded-md hover:bg-[var(--color-surface-2)]"
                              >
                                ⏸
                              </button>
                            </div>
                            {suspendConfirmId === row.id && (
                              <div className="mt-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-2 text-xs">
                                <p className="text-[var(--color-text-primary)] mb-2">{t('health.suspendConfirm', { name: row.name })}</p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void suspendCenter(row.id)}
                                    className="rounded-md bg-red-400/20 text-red-400 px-2 py-1"
                                  >
                                    {t('actions.confirm')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSuspendConfirmId(null)}
                                    className="rounded-md border border-[var(--color-border-default)] px-2 py-1"
                                  >
                                    {t('actions.cancel')}
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="section-f">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{t('cash.title')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 border-s-teal-500">
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('cash.quarter')}</p>
                  <p className="text-lg font-mono font-bold text-teal-600 mt-1">
                    {formatCurrency(data.cash.collected_this_quarter, locale)}
                  </p>
                </div>
                <div
                  className={`rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 ${
                    data.cash.overdue_count > 0 ? 'border-s-red-400' : 'border-s-[var(--color-border-default)]'
                  }`}
                >
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('cash.overdue')}</p>
                  <p className={`text-lg font-mono font-bold mt-1 ${data.cash.overdue_count > 0 ? 'text-red-400' : 'text-[var(--color-text-primary)]'}`}>
                    {formatNumber(data.cash.overdue_count, locale)}
                  </p>
                </div>
                <div
                  className={`rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 border-s-2 ${
                    data.cash.due_soon_count > 0 ? 'border-s-amber-400' : 'border-s-[var(--color-border-default)]'
                  }`}
                >
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('cash.dueSoon')}</p>
                  <p className={`text-lg font-mono font-bold mt-1 ${data.cash.due_soon_count > 0 ? 'text-amber-400' : 'text-[var(--color-text-primary)]'}`}>
                    {formatNumber(data.cash.due_soon_count, locale)}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('cash.packRevenue')}</p>
                  <p className="text-lg font-mono font-bold text-[var(--color-text-primary)] mt-1">
                    {formatCurrency(data.cash.pack_revenue_mtd, locale)}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
                    {t('cash.totalCentersHint')}: {formatNumber(data.cash.total_centers, locale)}
                  </p>
                </div>
              </div>
            </section>

            <section id="section-g">
              <button
                type="button"
                onClick={() => setOpsOpen((o) => !o)}
                className="flex items-center gap-2 w-full text-start mb-3"
              >
                <ChevronDown size={18} className={`text-[var(--color-text-secondary)] transition-transform ${opsOpen ? 'rotate-180' : ''}`} />
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('ops.title')}</h2>
              </button>
              {opsOpen && (
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-4">
                  <div>
                    <p className={`text-sm ${data.ops.wa_queue_pending > 0 ? 'text-red-400' : 'text-[var(--color-text-secondary)]'}`}>
                      {t('ops.waPending')}: {formatNumber(data.ops.wa_queue_pending, locale)}
                    </p>
                    <p className={`text-sm ${data.ops.wa_queue_failed > 0 ? 'text-red-400' : 'text-[var(--color-text-secondary)]'}`}>
                      {t('ops.waFailed')}: {formatNumber(data.ops.wa_queue_failed, locale)}
                    </p>
                  </div>
                  {data.ops.last_status_check && (
                    <div className="text-xs text-[var(--color-text-secondary)] space-y-1">
                      <p>{t('ops.statusService')}: {data.ops.last_status_check.service}</p>
                      <p>{t('ops.statusState')}: {data.ops.last_status_check.status}</p>
                      <p>{t('ops.statusChecked')}: {data.ops.last_status_check.checked_at}</p>
                    </div>
                  )}
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{t('ops.platformConfig')}</p>
                  <div className="space-y-3">
                    {BOOL_CONFIG_ORDER.map((key) => {
                      const currentBool = data.ops.platform_config[key] === true;
                      return (
                        <label key={key} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-[var(--color-text-primary)]">{t(`ops.configKeys.${key}`)}</span>
                          <input
                            type="checkbox"
                            checked={currentBool}
                            onChange={() => setConfirmConfigKey(key)}
                          />
                        </label>
                      );
                    })}
                    <label className="block text-sm">
                      <span className="text-[var(--color-text-primary)] block mb-1">{t('ops.announcementLabel')}</span>
                      <input
                        value={bannerDraft}
                        onChange={(e) => setBannerDraft(e.target.value)}
                        onBlur={() => {
                          if (bannerDraft !== announcementRef.current) {
                            announcementRef.current = bannerDraft;
                            void patchPlatformConfig('announcement_banner', bannerDraft);
                          }
                        }}
                        className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                      />
                    </label>
                  </div>
                </div>
              )}
            </section>

            <section id="section-h">
              <button
                type="button"
                onClick={() => setControlOpen((o) => !o)}
                className="flex items-center gap-2 w-full text-start mb-3"
              >
                <ChevronDown size={18} className={`text-[var(--color-text-secondary)] transition-transform ${controlOpen ? 'rotate-180' : ''}`} />
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('control.title')}</h2>
              </button>
              {controlOpen && (
                <div>
                  <div className="bg-red-400/10 border border-red-400/20 text-red-400 rounded-lg p-4 mb-4 text-sm">
                    {t('control.warning')}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <input
                      type="password"
                      value={sectionHPassword}
                      onChange={(e) => setSectionHPassword(e.target.value)}
                      placeholder={t('control.passwordPlaceholder')}
                      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] min-w-[200px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (sectionHPassword === 'CENTERHQ-ADMIN') {
                          setIsHUnlocked(true);
                          setSectionHError('');
                        } else {
                          setSectionHError(t('control.wrongPassword'));
                        }
                      }}
                      className="rounded-lg border border-[var(--color-border-default)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)]"
                    >
                      {t('control.unlock')}
                    </button>
                  </div>
                  {sectionHError && <p className="text-red-400 text-sm mb-4">{sectionHError}</p>}
                  {isHUnlocked && (
                    <div className="grid gap-2 max-w-md">
                      {(
                        [
                          ['maintenance_mode', 'control.maintenance'],
                          ['wa_sending_enabled', 'control.disableWa'],
                          ['cron_paused', 'control.pauseCron'],
                          ['read_only_mode', 'control.readOnly'],
                        ] as const
                      ).map(([k, labelKey]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setConfirmDangerAction(k)}
                          className="bg-red-400/10 border border-red-400/20 text-red-400 w-full rounded-lg py-2 text-sm"
                        >
                          {t(labelKey)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </MobileWrapper>
      </div>

      {confirmConfigKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 max-w-sm w-full">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{t('ops.confirmToggleTitle')}</p>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('ops.confirmToggleBody')}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmConfigKey(null)}
                className="rounded-lg border border-[var(--color-border-default)] px-3 py-1.5 text-sm"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = data.ops.platform_config[confirmConfigKey] === true;
                  void patchPlatformConfig(confirmConfigKey, !val);
                  setConfirmConfigKey(null);
                }}
                className="rounded-lg bg-[var(--color-brand-500)] text-white px-3 py-1.5 text-sm"
              >
                {t('actions.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDangerAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 max-w-sm w-full">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{t('control.confirmDangerTitle')}</p>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('control.confirmDangerBody')}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDangerAction(null)}
                className="rounded-lg border border-[var(--color-border-default)] px-3 py-1.5 text-sm"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const keyValueMap: Record<string, unknown> = {
                    maintenance_mode: true,
                    wa_sending_enabled: false,
                    cron_paused: true,
                    read_only_mode: true,
                  };
                  void patchPlatformConfig(confirmDangerAction, keyValueMap[confirmDangerAction]);
                  setConfirmDangerAction(null);
                }}
                className="rounded-lg bg-red-400 text-white px-3 py-1.5 text-sm"
              >
                {t('actions.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
