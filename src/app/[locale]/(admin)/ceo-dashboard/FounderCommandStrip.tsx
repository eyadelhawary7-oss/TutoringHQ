'use client';

import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { Clock, MessageSquare, AlertTriangle, Activity, CheckCircle } from 'lucide-react';
import type { CommandStripResponse, ActionQueueItem } from '@/types/founder-dash';

const PLAN_KEYS = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const;

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export default function FounderCommandStrip(props: CommandStripResponse) {
  const t = useTranslations('founderDash');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const tPlans = useTranslations('landing.pricing.plans');

  const rawStats = props.stats ?? {};
  const stats = {
    pendingApprovals: n(rawStats.pendingApprovals),
    leadsNeedingReply: n(rawStats.leadsNeedingReply),
    overduePayments: n(rawStats.overduePayments),
    atRiskCenters: n(rawStats.atRiskCenters),
  };
  const rawBreakeven = props.breakeven ?? { target: 0, activePayingCenters: 0 };
  const target = n(rawBreakeven.target);
  const activePayingCenters = n(rawBreakeven.activePayingCenters);
  const actionQueue: ActionQueueItem[] = Array.isArray(props.actionQueue) ? props.actionQueue : [];
  const pendingCenters = Array.isArray(props.pendingCenters) ? props.pendingCenters : [];

  const typeLabels: Record<string, string> = {
    churn_risk: t('actionType_churnRisk'),
    activation: t('actionType_activation'),
    collection: t('actionType_collection'),
    sales: t('actionType_sales'),
    ops: t('actionType_ops'),
    renewal: t('actionType_renewal'),
    cancellation_request: t('actionType_cancellationRequest'),
  };

  function planDisplayName(plan: string): string {
    if ((PLAN_KEYS as readonly string[]).includes(plan)) {
      return tPlans(`${plan}.name`);
    }
    return plan;
  }

  const pct = target > 0 ? Math.min(100, Math.round((activePayingCenters / target) * 100)) : 0;

  return (
    <div className="space-y-8 mb-8">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          className={`rounded-xl border p-4 ${
            stats.pendingApprovals > 0
              ? 'border-amber-500/40 bg-amber-500/10'
              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]'
          }`}
        >
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
            <Clock className="h-4 w-4 shrink-0" />
            <span>{t('pendingApprovals')}</span>
          </div>
          <p className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {stats.pendingApprovals.toLocaleString('en-US')}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            stats.leadsNeedingReply > 0
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]'
          }`}
        >
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span>{t('leadsNeedingReply')}</span>
          </div>
          <p className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {stats.leadsNeedingReply.toLocaleString('en-US')}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            stats.overduePayments > 0
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-emerald-500/30 bg-emerald-500/5'
          }`}
        >
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t('overduePayments')}</span>
          </div>
          <p className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {stats.overduePayments.toLocaleString('en-US')}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            stats.atRiskCenters > 0
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-emerald-500/30 bg-emerald-500/5'
          }`}
        >
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
            <Activity className="h-4 w-4 shrink-0" />
            <span>{t('atRiskCenters')}</span>
          </div>
          <p className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {stats.atRiskCenters.toLocaleString('en-US')}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {t('breakevenTitle')}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {t('breakevenSubtitle')}
        </p>
        <div className="mt-4 h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#0D9488] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono text-[var(--color-text-primary)]">
            {`${activePayingCenters.toLocaleString('en-US')} / ${target} ${t('centers')}`}
          </span>
          <span className="rounded-full bg-[#0D9488]/15 text-[#0D9488] px-2.5 py-0.5 text-xs font-medium font-mono">
            {`${pct.toLocaleString('en-US')}%`}
          </span>
          {pct === 0 && (
            <span className="text-[var(--color-text-secondary)]">{t('breakevenNotStarted')}</span>
          )}
          {pct >= 100 && <span className="text-green-600 dark:text-green-400">{t('breakevenSelfFunded')}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('actionQueueTitle')}
        </h2>
        {actionQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-[var(--color-text-secondary)]">
            <CheckCircle className="h-10 w-10 text-emerald-500 mb-3" />
            <p className="font-medium text-[var(--color-text-primary)]">{t('noActions')}</p>
            <p className="text-sm mt-1">{t('noActionsDesc')}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {actionQueue.map((item) => {
              const startBorderClass =
                item.priority === 'red'
                  ? 'border-s-red-500'
                  : item.priority === 'amber'
                    ? 'border-s-amber-500'
                    : 'border-s-emerald-500';
              const dotColor =
                item.priority === 'red'
                  ? 'bg-red-500'
                  : item.priority === 'amber'
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';
              return (
                <li
                  key={item.id}
                  className={`rounded-lg border-y border-e border-[var(--color-border-subtle)] border-s-2 ${startBorderClass} bg-[var(--color-surface-0)]`}
                >
                  <div className="p-4 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} aria-hidden />
                      <span className="text-xs rounded-md bg-slate-200/80 dark:bg-slate-700 px-2 py-0.5 text-[var(--color-text-secondary)]">
                        {typeLabels[item.type] ?? item.type}
                      </span>
                    </div>
                    <p className="font-semibold text-[var(--color-text-primary)]">{item.title}</p>
                    {item.subtitle != null && item.subtitle !== '' && (
                      <p className="text-sm text-[var(--color-text-secondary)]">{item.subtitle}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {n(item.revenue_at_risk) > 0 && (
                        <span className="text-xs rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-1 font-mono">
                          {n(item.revenue_at_risk).toLocaleString('en-US')} {t('egpAbbrev')}
                        </span>
                      )}
                      {item.action_label && item.action_url && (
                        <Link
                          href={item.action_url}
                          className="inline-flex items-center rounded-md bg-[#0D9488] text-white text-xs font-medium px-3 py-1.5 hover:bg-[#0f766e]"
                        >
                          {item.action_label}
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('approvalQueueTitle')}
        </h2>
        {pendingCenters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-[var(--color-text-secondary)]">
            <CheckCircle className="h-10 w-10 text-emerald-500 mb-3" />
            <p className="font-medium text-[var(--color-text-primary)]">{t('noApprovals')}</p>
            <p className="text-sm mt-1">{t('noApprovalsDesc')}</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colCenterName')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colOwner')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colLocation')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colPlan')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colSignupDate')}
                    </th>
                    <th className="text-start py-2 pe-3 font-medium text-[var(--color-text-primary)]">
                      {t('colNotes')}
                    </th>
                    <th className="text-start py-2 font-medium text-[var(--color-text-primary)] w-28">
                      {' '}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendingCenters.map((center) => {
                    const location =
                      [center.city, center.district].filter(Boolean).join(', ') || tCommon('notAvailable');
                    const notesPreview = center.signup_notes
                      ? center.signup_notes.slice(0, 60) +
                        (center.signup_notes.length > 60 ? '...' : '')
                      : tCommon('notSet');
                    return (
                      <tr key={center.id} className="border-b border-[var(--color-border-subtle)]">
                        <td className="py-2 pe-3 font-semibold text-[var(--color-text-primary)]">
                          {center.name}
                        </td>
                        <td className="py-2 pe-3 text-[var(--color-text-secondary)]">
                          {center.owner_name ?? tCommon('notAvailable')}
                        </td>
                        <td className="py-2 pe-3 text-[var(--color-text-secondary)]">{location}</td>
                        <td className="py-2 pe-3">
                          <span className="inline-block rounded-full bg-[#0D9488]/15 text-[#0D9488] text-xs px-2.5 py-0.5 font-medium">
                            {planDisplayName(center.plan)}
                          </span>
                        </td>
                        <td className="py-2 pe-3 font-mono text-[var(--color-text-secondary)]">
                          {new Date(center.created_at).toLocaleDateString('en-US')}
                        </td>
                        <td className="py-2 pe-3 text-[var(--color-text-secondary)] max-w-[200px]">
                          {notesPreview}
                        </td>
                        <td className="py-2">
                          <Link
                            href={`/${locale}/admin`}
                            className="inline-flex rounded-md border border-[#0D9488] text-[#0D9488] text-xs font-medium px-3 py-1.5 hover:bg-[#0D9488]/10"
                          >
                            {t('reviewCenter')}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-4">
              {pendingCenters.map((center) => {
                const location =
                  [center.city, center.district].filter(Boolean).join(', ') || tCommon('notAvailable');
                const notesPreview = center.signup_notes
                  ? center.signup_notes.slice(0, 60) +
                    (center.signup_notes.length > 60 ? '...' : '')
                  : tCommon('notSet');
                return (
                  <div
                    key={center.id}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4 space-y-2"
                  >
                    <p className="font-semibold text-[var(--color-text-primary)]">{center.name}</p>
                    <div className="text-sm text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-text-tertiary)]">{t('colOwner')}: </span>
                      {center.owner_name ?? tCommon('notAvailable')}
                    </div>
                    <div className="text-sm text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-text-tertiary)]">{t('colLocation')}: </span>
                      {location}
                    </div>
                    <div className="text-sm">
                      <span className="text-[var(--color-text-tertiary)]">{t('colPlan')}: </span>
                      <span className="inline-block rounded-full bg-[#0D9488]/15 text-[#0D9488] text-xs px-2.5 py-0.5 font-medium">
                        {planDisplayName(center.plan)}
                      </span>
                    </div>
                    <div className="text-sm font-mono text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-text-tertiary)] font-sans">
                        {t('colSignupDate')}:{' '}
                      </span>
                      {new Date(center.created_at).toLocaleDateString('en-US')}
                    </div>
                    <div className="text-sm text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-text-tertiary)]">{t('colNotes')}: </span>
                      {notesPreview}
                    </div>
                    <Link
                      href={`/${locale}/admin`}
                      className="inline-flex rounded-md border border-[#0D9488] text-[#0D9488] text-xs font-medium px-3 py-1.5 hover:bg-[#0D9488]/10 mt-2"
                    >
                      {t('reviewCenter')}
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
