'use client';

import { useTranslations } from 'next-intl';
import {
  Share2,
  Users,
  CheckCircle,
  TrendingUp,
  Banknote,
  MapPin,
  ArrowRightLeft,
  Clock,
  Target,
  ArrowRight,
} from 'lucide-react';
import type { GrowthPanelResponse } from '@/types/founder-dash';

const ACTIVE_STAGES = ['lead', 'demo', 'trial', 'closed'] as const;

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

const DEFAULT_REFERRAL = {
  totalReferrers: 0,
  totalReferrals: 0,
  converted: 0,
  conversionRate: 0,
  commissionsOwed: 0,
  commissionsPaid: 0,
};

function formatDistrictLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function FounderGrowthPanel(props: GrowthPanelResponse) {
  const t = useTranslations('founderDash');
  const tCommon = useTranslations('common');

  const stages = Array.isArray(props.pipeline?.stages) ? props.pipeline.stages : [];
  const totalActive = n(props.pipeline?.totalActive);
  const geography = Array.isArray(props.geography) ? props.geography : [];
  const referral = { ...DEFAULT_REFERRAL, ...props.referral };

  const stageLabels: Record<string, string> = {
    lead: t('stageLead'),
    demo: t('stageDemo'),
    trial: t('stageTrial'),
    closed: t('stageClosed'),
    lost: t('stageLost'),
  };

  const geoStatusLabel = (centerCount: number, leadCount: number): string => {
    if (centerCount >= 5) return t('geoSaturated');
    if (centerCount >= 2) return t('geoGrowing');
    if (centerCount === 1) return t('geoSeeding');
    if (leadCount > 0) return t('geoOpportunity');
    return tCommon('notSet');
  };

  const convRate = (from: number, to: number): string =>
    from === 0 ? '0%' : `${Math.round((to / from) * 100).toLocaleString('en-US')}%`;

  const lostCount = n(stages.find((s) => s.stage === 'lost')?.count);
  const lostLabel = stageLabels['lost'];

  const pipelineEmpty =
    totalActive === 0 && stages.every((s) => n(s.count) === 0);

  const statusChipClass = (centerCount: number, leadCount: number): string => {
    if (centerCount >= 5) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    if (centerCount >= 2) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    if (centerCount === 1) return 'bg-sky-500/15 text-sky-600 dark:text-sky-400';
    return 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]';
  };

  return (
    <div className="space-y-8 mb-8">
      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('pipelineTitle')}
        </h2>
        {pipelineEmpty ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-[var(--color-text-secondary)]">
            <Target className="h-10 w-10 text-[var(--color-text-tertiary)] mb-3" />
            <p className="font-medium text-[var(--color-text-primary)]">{t('pipelineEmpty')}</p>
            <p className="text-sm mt-1">{t('pipelineEmptyDesc')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className="flex flex-wrap items-center justify-center gap-2 md:gap-3"
              dir="ltr"
            >
              {ACTIVE_STAGES.flatMap((stageKey, idx) => {
                const stageEntry = stages.find((s) => s.stage === stageKey);
                const count = n(stageEntry?.count);
                const nextKey = ACTIVE_STAGES[idx + 1];
                const nextCount = nextKey ? n(stages.find((s) => s.stage === nextKey)?.count) : 0;

                const box = (
                  <div
                    key={`stage-${stageKey}`}
                    className={`rounded-lg border px-4 py-3 min-w-[100px] text-center ${
                      stageKey === 'closed'
                        ? 'border-teal-600/40 bg-teal-600/10'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]'
                    }`}
                  >
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">
                      {stageLabels[stageKey]}
                    </p>
                    <p className="text-lg font-bold font-mono text-[var(--color-text-primary)]">
                      {count.toLocaleString('en-US')}
                    </p>
                  </div>
                );

                if (idx >= ACTIVE_STAGES.length - 1) {
                  return [box];
                }

                const connector = (
                  <div
                    key={`conn-${stageKey}`}
                    className="flex flex-col items-center gap-0.5 text-[var(--color-text-secondary)] shrink-0"
                  >
                    <ArrowRight className="h-4 w-4" aria-hidden />
                    <span className="text-[10px] rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-mono">
                      {convRate(count, nextCount)}
                    </span>
                  </div>
                );

                return [box, connector];
              })}
            </div>
            <div className="flex justify-center">
              <span className="text-xs rounded-md bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1.5 font-mono">
                {`${lostCount.toLocaleString('en-US')} ${lostLabel}`}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('geoTitle')}
        </h2>
        {geography.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-[var(--color-text-secondary)]">
            <MapPin className="h-10 w-10 text-[var(--color-text-tertiary)] mb-3" />
            <p className="font-medium text-[var(--color-text-primary)]">{t('geoEmpty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[320px]">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                    {t('colDistrict')}
                  </th>
                  <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                    {t('colActiveCenters')}
                  </th>
                  <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                    {t('colOpenLeads')}
                  </th>
                  <th className="text-start py-2 font-medium text-[var(--color-text-primary)]">
                    {t('colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {geography.map((row, i) => {
                  const districtDisplay =
                    row.district === null ? t('geoUnknown') : formatDistrictLabel(row.district);
                  const centerCount = n(row.centerCount);
                  const leadCount = n(row.leadCount);
                  return (
                    <tr key={`${row.district ?? 'null'}-${i}`} className="border-b border-[var(--color-border-subtle)]">
                      <td className="py-2 pe-3 text-[var(--color-text-primary)]">{districtDisplay}</td>
                      <td
                        className={`py-2 pe-3 font-mono font-semibold ${
                          centerCount > 0
                            ? 'text-teal-600 dark:text-teal-400'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {centerCount.toLocaleString('en-US')}
                      </td>
                      <td
                        className={`py-2 pe-3 font-mono font-semibold ${
                          leadCount > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {leadCount.toLocaleString('en-US')}
                      </td>
                      <td className="py-2">
                        <span
                          className={`inline-block text-xs rounded-full px-2.5 py-0.5 font-medium ${statusChipClass(centerCount, leadCount)}`}
                        >
                          {geoStatusLabel(centerCount, leadCount)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('referralTitle')}
        </h2>
        {n(referral.totalReferrals) === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-[var(--color-text-secondary)]">
            <Share2 className="h-10 w-10 text-[var(--color-text-tertiary)] mb-3" />
            <p className="font-medium text-[var(--color-text-primary)]">{t('referralEmpty')}</p>
            <p className="text-sm mt-1 max-w-md">{t('referralEmptyDesc')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4">
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-xs mb-2">
                <Users className="h-4 w-4 shrink-0" />
                {t('referralReferrers')}
              </div>
              <p className="text-xl font-bold font-mono text-[var(--color-text-primary)]">
                {n(referral.totalReferrers).toLocaleString('en-US')}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4">
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-xs mb-2">
                <ArrowRightLeft className="h-4 w-4 shrink-0" />
                {t('referralTotal')}
              </div>
              <p className="text-xl font-bold font-mono text-[var(--color-text-primary)]">
                {n(referral.totalReferrals).toLocaleString('en-US')}
              </p>
            </div>
            <div className="rounded-xl border border-teal-600/30 bg-teal-600/5 p-4">
              <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300 text-xs mb-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                {t('referralConverted')}
              </div>
              <p className="text-xl font-bold font-mono text-teal-700 dark:text-teal-300">
                {n(referral.converted).toLocaleString('en-US')}
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                n(referral.conversionRate) >= 50
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : n(referral.conversionRate) >= 20
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-red-500/30 bg-red-500/5'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs mb-2 ${
                  n(referral.conversionRate) >= 50
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : n(referral.conversionRate) >= 20
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                <TrendingUp className="h-4 w-4 shrink-0" />
                {t('referralRate')}
              </div>
              <p
                className={`text-xl font-bold font-mono ${
                  n(referral.conversionRate) >= 50
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : n(referral.conversionRate) >= 20
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                {n(referral.conversionRate).toLocaleString('en-US')}%
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                n(referral.commissionsOwed) > 0
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs mb-2 ${
                  n(referral.commissionsOwed) > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                <Clock className="h-4 w-4 shrink-0" />
                {t('referralOwed')}
              </div>
              <p
                className={`text-xl font-bold font-mono ${
                  n(referral.commissionsOwed) > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-[var(--color-text-primary)]'
                }`}
              >
                {n(referral.commissionsOwed).toLocaleString('en-US')} {t('egpAbbrev')}
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                n(referral.commissionsPaid) > 0
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs mb-2 ${
                  n(referral.commissionsPaid) > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                <Banknote className="h-4 w-4 shrink-0" />
                {t('referralPaid')}
              </div>
              <p
                className={`text-xl font-bold font-mono ${
                  n(referral.commissionsPaid) > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[var(--color-text-primary)]'
                }`}
              >
                {n(referral.commissionsPaid).toLocaleString('en-US')} {t('egpAbbrev')}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
