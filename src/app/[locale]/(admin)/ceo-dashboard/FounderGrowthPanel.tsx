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

function formatDistrictLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function FounderGrowthPanel(props: GrowthPanelResponse) {
  const t = useTranslations('founderDash');

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
    return '—';
  };

  const convRate = (from: number, to: number): string =>
    from === 0 ? '0%' : `${Math.round((to / from) * 100).toLocaleString('en-US')}%`;

  const lostCount = props.pipeline.stages.find((s) => s.stage === 'lost')?.count ?? 0;
  const lostLabel = stageLabels['lost'];

  const pipelineEmpty =
    props.pipeline.totalActive === 0 &&
    props.pipeline.stages.every((s) => s.count === 0);

  const statusChipClass = (centerCount: number, leadCount: number): string => {
    if (centerCount >= 5) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    if (centerCount >= 2) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    if (centerCount === 1) return 'bg-sky-500/15 text-sky-600 dark:text-sky-400';
    return 'bg-slate-500/15 text-[var(--color-text-secondary)]';
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
                const stageEntry = props.pipeline.stages.find((s) => s.stage === stageKey);
                const count = stageEntry?.count ?? 0;
                const nextKey = ACTIVE_STAGES[idx + 1];
                const nextCount = nextKey
                  ? (props.pipeline.stages.find((s) => s.stage === nextKey)?.count ?? 0)
                  : 0;

                const box = (
                  <div
                    key={`stage-${stageKey}`}
                    className={`rounded-lg border px-4 py-3 min-w-[100px] text-center ${
                      stageKey === 'closed'
                        ? 'border-[#0D9488]/40 bg-[#0D9488]/10'
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
                    <span className="text-[10px] rounded-full bg-slate-200/80 dark:bg-slate-700 px-2 py-0.5 font-mono">
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
        {props.geography.length === 0 ? (
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
                {props.geography.map((row, i) => {
                  const districtDisplay =
                    row.district === null ? t('geoUnknown') : formatDistrictLabel(row.district);
                  return (
                    <tr key={`${row.district ?? 'null'}-${i}`} className="border-b border-[var(--color-border-subtle)]">
                      <td className="py-2 pe-3 text-[var(--color-text-primary)]">{districtDisplay}</td>
                      <td
                        className={`py-2 pe-3 font-mono font-semibold ${
                          row.centerCount > 0
                            ? 'text-[#0D9488]'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {row.centerCount.toLocaleString('en-US')}
                      </td>
                      <td
                        className={`py-2 pe-3 font-mono font-semibold ${
                          row.leadCount > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {row.leadCount.toLocaleString('en-US')}
                      </td>
                      <td className="py-2">
                        <span
                          className={`inline-block text-xs rounded-full px-2.5 py-0.5 font-medium ${statusChipClass(row.centerCount, row.leadCount)}`}
                        >
                          {geoStatusLabel(row.centerCount, row.leadCount)}
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
        {props.referral.totalReferrals === 0 ? (
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
                {props.referral.totalReferrers.toLocaleString('en-US')}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4">
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-xs mb-2">
                <ArrowRightLeft className="h-4 w-4 shrink-0" />
                {t('referralTotal')}
              </div>
              <p className="text-xl font-bold font-mono text-[var(--color-text-primary)]">
                {props.referral.totalReferrals.toLocaleString('en-US')}
              </p>
            </div>
            <div className="rounded-xl border border-[#0D9488]/30 bg-[#0D9488]/5 p-4">
              <div className="flex items-center gap-2 text-[#0D9488] text-xs mb-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                {t('referralConverted')}
              </div>
              <p className="text-xl font-bold font-mono text-[#0D9488]">
                {props.referral.converted.toLocaleString('en-US')}
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                props.referral.conversionRate >= 50
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : props.referral.conversionRate >= 20
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-red-500/30 bg-red-500/5'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs mb-2 ${
                  props.referral.conversionRate >= 50
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : props.referral.conversionRate >= 20
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                <TrendingUp className="h-4 w-4 shrink-0" />
                {t('referralRate')}
              </div>
              <p
                className={`text-xl font-bold font-mono ${
                  props.referral.conversionRate >= 50
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : props.referral.conversionRate >= 20
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                {props.referral.conversionRate.toLocaleString('en-US')}%
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                props.referral.commissionsOwed > 0
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs mb-2 ${
                  props.referral.commissionsOwed > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                <Clock className="h-4 w-4 shrink-0" />
                {t('referralOwed')}
              </div>
              <p
                className={`text-xl font-bold font-mono ${
                  props.referral.commissionsOwed > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-[var(--color-text-primary)]'
                }`}
              >
                {props.referral.commissionsOwed.toLocaleString('en-US')} {t('egpAbbrev')}
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                props.referral.commissionsPaid > 0
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs mb-2 ${
                  props.referral.commissionsPaid > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                <Banknote className="h-4 w-4 shrink-0" />
                {t('referralPaid')}
              </div>
              <p
                className={`text-xl font-bold font-mono ${
                  props.referral.commissionsPaid > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[var(--color-text-primary)]'
                }`}
              >
                {props.referral.commissionsPaid.toLocaleString('en-US')} {t('egpAbbrev')}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
