'use client';

import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import type { HealthPanelResponse, HealthSummary } from '@/types/founder-dash';

const PLAN_KEYS = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const;

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatDistrictLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CenterHealthPanel(props: HealthPanelResponse) {
  const t = useTranslations('founderDash');
  const locale = useLocale();
  const tPlans = useTranslations('landing.pricing.plans');

  const rawSummary = props.summary ?? ({} as HealthSummary);
  const summary: HealthSummary = {
    healthy: n(rawSummary.healthy),
    engaged: n(rawSummary.engaged),
    atRisk: n(rawSummary.atRisk),
    critical: n(rawSummary.critical),
    noScore: n(rawSummary.noScore),
  };
  const centers = Array.isArray(props.centers) ? props.centers : [];

  const bandLabels: Record<string, string> = {
    Healthy: t('bandHealthy'),
    Engaged: t('bandEngaged'),
    'At Risk': t('bandAtRisk'),
    Critical: t('bandCritical'),
  };

  const subLabels: Record<string, string> = {
    active: t('subActive'),
    suspended: t('subSuspended'),
    pending: t('subPending'),
    cancelled: t('subCancelled'),
  };

  const scanDisplay = (last_scan_at: string | null): { label: string; color: string } => {
    if (!last_scan_at) return { label: t('noScansYet'), color: 'red' };
    const diffDays = Math.floor(
      (Date.now() - new Date(last_scan_at).getTime()) / 86_400_000,
    );
    if (diffDays === 0) return { label: t('today'), color: 'green' };
    if (diffDays === 1) return { label: t('yesterday'), color: 'teal' };
    if (diffDays <= 7) {
      return {
        label: `${diffDays.toLocaleString('en-US')} ${t('daysAgo')}`,
        color: 'amber',
      };
    }
    return {
      label: `${diffDays.toLocaleString('en-US')} ${t('daysAgo')}`,
      color: 'red',
    };
  };

  const bandColor = (band: string | null): 'green' | 'teal' | 'amber' | 'red' | 'slate' => {
    if (band === 'Healthy') return 'green';
    if (band === 'Engaged') return 'teal';
    if (band === 'At Risk') return 'amber';
    if (band === 'Critical') return 'red';
    return 'slate';
  };

  function planDisplayName(plan: string): string {
    if ((PLAN_KEYS as readonly string[]).includes(plan)) {
      return tPlans(`${plan}.name`);
    }
    return plan;
  }

  const scanColorClass = (color: string): string => {
    if (color === 'green') return 'text-green-600 dark:text-green-400';
    if (color === 'teal') return 'text-[#0D9488]';
    if (color === 'amber') return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  const bandFillClass = (band: string | null): string => {
    const c = bandColor(band);
    if (c === 'green') return 'bg-green-500';
    if (c === 'teal') return 'bg-[#0D9488]';
    if (c === 'amber') return 'bg-amber-500';
    if (c === 'red') return 'bg-red-500';
    return 'bg-slate-400';
  };

  const bandBadgeClass = (band: string | null): string => {
    const c = bandColor(band);
    if (c === 'green') return 'bg-green-500/15 text-green-700 dark:text-green-400';
    if (c === 'teal') return 'bg-[#0D9488]/15 text-[#0D9488]';
    if (c === 'amber') return 'bg-amber-500/15 text-amber-800 dark:text-amber-400';
    if (c === 'red') return 'bg-red-500/15 text-red-700 dark:text-red-400';
    return 'bg-slate-500/15 text-[var(--color-text-secondary)]';
  };

  const subChipClass = (sub: string): string => {
    if (sub === 'active') return 'bg-green-500/15 text-green-700 dark:text-green-400';
    if (sub === 'suspended') return 'bg-red-500/15 text-red-700 dark:text-red-400';
    if (sub === 'pending') return 'bg-amber-500/15 text-amber-800 dark:text-amber-400';
    return 'bg-slate-500/15 text-[var(--color-text-secondary)]';
  };

  const summaryChips: {
    key: keyof HealthSummary;
    label: string;
    tone: 'green' | 'teal' | 'amber' | 'red' | 'slate';
  }[] = [
    { key: 'healthy', label: t('bandHealthy'), tone: 'green' },
    { key: 'engaged', label: t('bandEngaged'), tone: 'teal' },
    { key: 'atRisk', label: t('bandAtRisk'), tone: 'amber' },
    { key: 'critical', label: t('bandCritical'), tone: 'red' },
    { key: 'noScore', label: t('bandNoScore'), tone: 'slate' },
  ];

  const summaryToneClass = (tone: (typeof summaryChips)[number]['tone'], active: boolean) => {
    if (!active) return 'border-[var(--color-border-subtle)] text-[var(--color-text-tertiary)]';
    if (tone === 'green') return 'border-green-500/40 bg-green-500/10 text-green-800 dark:text-green-300';
    if (tone === 'teal') return 'border-[#0D9488]/40 bg-[#0D9488]/10 text-[#0D9488]';
    if (tone === 'amber') return 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-300';
    if (tone === 'red') return 'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300';
    return 'border-slate-500/40 bg-slate-500/10 text-[var(--color-text-secondary)]';
  };

  return (
    <div className="space-y-6 mb-8">
      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('healthTitle')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {summaryChips.map(({ key, label, tone }) => {
            const count = summary[key];
            const active = count > 0;
            return (
              <span
                key={key}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${summaryToneClass(tone, active)}`}
              >
                <span className={active ? 'font-semibold' : 'font-normal'}>{label}</span>
                <span className={`font-mono ${active ? 'font-bold' : ''}`}>
                  {n(count).toLocaleString('en-US')}
                </span>
              </span>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        {centers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-[var(--color-text-secondary)]">
            <Activity className="h-10 w-10 text-[var(--color-text-tertiary)] mb-3" />
            <p className="font-medium text-[var(--color-text-primary)]">{t('healthEmpty')}</p>
            <p className="text-sm mt-1">{t('healthEmptyDesc')}</p>
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colCenterName')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colDistrict')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colPlan')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colHealthScore')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colLastScan')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colSubStatus')}
                    </th>
                    <th className="text-start py-2 w-24 font-medium text-[var(--color-text-primary)]" />
                  </tr>
                </thead>
                <tbody>
                  {centers.map((center) => {
                    const districtDisplay = center.district
                      ? formatDistrictLabel(center.district)
                      : '-';
                    const scan = scanDisplay(center.last_scan_at);
                    const band = center.health_score_band;
                    const bandText = band != null ? (bandLabels[band] ?? '-') : '-';
                    const healthScore = n(center.health_score);
                    return (
                      <tr key={center.id} className="border-b border-[var(--color-border-subtle)]">
                        <td className="py-2 pe-3 font-semibold text-[var(--color-text-primary)]">
                          {center.name}
                        </td>
                        <td className="py-2 pe-3 text-[var(--color-text-secondary)]">
                          {districtDisplay}
                        </td>
                        <td className="py-2 pe-3">
                          <span className="inline-block rounded-full bg-[#0D9488]/15 text-[#0D9488] text-xs px-2.5 py-0.5 font-medium">
                            {planDisplayName(center.plan)}
                          </span>
                        </td>
                        <td className="py-2 pe-3">
                          {center.health_score == null ? (
                            <span className="text-[var(--color-text-tertiary)]">-</span>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="w-16 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden shrink-0">
                                <div
                                  className={`h-full rounded-full ${bandFillClass(band)}`}
                                  style={{
                                    width: `${Math.min(100, Math.max(0, healthScore))}%`,
                                  }}
                                />
                              </div>
                              <span className="font-mono text-[var(--color-text-primary)]">
                                {healthScore.toLocaleString('en-US')}
                              </span>
                              <span
                                className={`text-xs rounded-md px-2 py-0.5 font-medium ${bandBadgeClass(band)}`}
                              >
                                {bandText}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className={`py-2 pe-3 text-sm ${scanColorClass(scan.color)}`}>
                          {scan.label}
                        </td>
                        <td className="py-2 pe-3">
                          <span
                            className={`inline-block text-xs rounded-full px-2.5 py-0.5 font-medium ${subChipClass(center.subscription_status)}`}
                          >
                            {subLabels[center.subscription_status] ?? center.subscription_status}
                          </span>
                        </td>
                        <td className="py-2">
                          <Link
                            href={`/${locale}/admin`}
                            className="inline-flex rounded-md border border-[#0D9488] text-[#0D9488] text-xs font-medium px-3 py-1.5 hover:bg-[#0D9488]/10"
                          >
                            {t('viewCenter')}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden space-y-4">
              {centers.map((center) => {
                const districtDisplay = center.district
                  ? formatDistrictLabel(center.district)
                  : '-';
                const scan = scanDisplay(center.last_scan_at);
                const band = center.health_score_band;
                const bandText = band != null ? (bandLabels[band] ?? '-') : '-';
                const healthScore = n(center.health_score);
                return (
                  <div
                    key={center.id}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4 space-y-3"
                  >
                    <p className="font-semibold text-[var(--color-text-primary)]">{center.name}</p>
                    <div className="text-sm text-[var(--color-text-secondary)]">
                      {districtDisplay}
                    </div>
                    <div>
                      <span className="inline-block rounded-full bg-[#0D9488]/15 text-[#0D9488] text-xs px-2.5 py-0.5 font-medium">
                        {planDisplayName(center.plan)}
                      </span>
                    </div>
                    {center.health_score == null ? (
                      <span className="text-[var(--color-text-tertiary)]">-</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="w-full max-w-[200px] h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${bandFillClass(band)}`}
                            style={{
                              width: `${Math.min(100, Math.max(0, healthScore))}%`,
                            }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[var(--color-text-primary)]">
                            {healthScore.toLocaleString('en-US')}
                          </span>
                          <span
                            className={`text-xs rounded-md px-2 py-0.5 font-medium ${bandBadgeClass(band)}`}
                          >
                            {bandText}
                          </span>
                        </div>
                      </div>
                    )}
                    <p className={`text-sm ${scanColorClass(scan.color)}`}>{scan.label}</p>
                    <span
                      className={`inline-block text-xs rounded-full px-2.5 py-0.5 font-medium ${subChipClass(center.subscription_status)}`}
                    >
                      {subLabels[center.subscription_status] ?? center.subscription_status}
                    </span>
                    <Link
                      href={`/${locale}/admin`}
                      className="inline-flex rounded-md border border-[#0D9488] text-[#0D9488] text-xs font-medium px-3 py-1.5 hover:bg-[#0D9488]/10"
                    >
                      {t('viewCenter')}
                    </Link>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
