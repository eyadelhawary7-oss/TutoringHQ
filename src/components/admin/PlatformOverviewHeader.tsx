'use client';

/**
 * `Merged-Admin-Platform` §01 — the overview header, in the design's order:
 *
 *   MRR hero + month-over-month → CUSTOMERS → four tiles → REVENUE MIX → JUMP TO
 *
 * The live screen's Platform-health and Revenue KPI grids stay underneath; this
 * is the block the design leads with and the one that had nothing behind it,
 * because `/api/admin/overview` only ever knew about centres.
 *
 * The **Unverified filter chip** is no longer omitted from the lists this
 * header links to. `/admin/centers` now draws it DISABLED with its named cause
 * ("the verification columns are not in the live database"), because a filter
 * that is simply absent tells an operator nothing and they keep hunting for it.
 * It is not drawn *here* — this is a header, and the chip belongs on the list.
 *
 * `Merged-Admin-Platform` §02 also draws a Vendors row reading
 * "Valify · Identity verification · **Connected**" with a green dot. That is a
 * design-side fabrication: nothing is connected, and no Valify credential
 * exists on any deployment. There is no vendors screen in live code to correct,
 * so nothing is built for it here — but if one is ever added it must read from
 * `/api/admin/verification/availability`, never from a hard-coded status.
 *
 * OMITTED, with the reason:
 *  - **`/admin/teachers`**, the design's third §01 frame, is R7 — built 28 July
 *    and closed unmerged on Eyad's call, one teacher console not two. The
 *    teachers row here is a figure, not a link, because the destination was
 *    deliberately not built.
 */

import { useLocale, useTranslations } from 'next-intl';
import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  GraduationCap,
  Wallet,
  TrendingUp,
  BarChart3,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatNumber';

export interface CustomerSegmentView {
  accounts: number;
  students: number;
  mrr: number;
}

export interface CustomerSplitView {
  centers: CustomerSegmentView;
  teachers: CustomerSegmentView;
  totalStudents: number;
  totalMrr: number;
  totalAccounts: number;
  newAccountsThisMonth: number;
  onTrial: number;
}

export interface RevenueMixView {
  key: 'subscriptions' | 'addons' | 'whatsapp_packs' | 'other';
  amount: number;
}

interface Props {
  split: CustomerSplitView | null;
  revenueMix: RevenueMixView[] | null;
  /** Percent change vs last month, or null when last month was zero. */
  mrrGrowthPct: number | null;
  mrrLastMonth: number | null;
  overdueAccounts: number;
  withdrawalsPending: number;
}

export default function PlatformOverviewHeader({
  split,
  revenueMix,
  mrrGrowthPct,
  mrrLastMonth,
  overdueAccounts,
  withdrawalsPending,
}: Props) {
  const t = useTranslations('admin.platformOverview');
  const locale = useLocale();
  const isRtl = locale === 'ar' || locale.startsWith('ar-');
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  if (!split) return null;

  const customerRows: { key: string; icon: LucideIcon; label: string; seg: CustomerSegmentView }[] = [
    { key: 'centers', icon: Building2, label: t('centers'), seg: split.centers },
    { key: 'teachers', icon: GraduationCap, label: t('soloTeachers'), seg: split.teachers },
  ];

  const tiles = [
    { key: 'students', value: formatNumber(split.totalStudents, locale), label: t('activeStudents') },
    {
      key: 'newAccounts',
      value: `+${formatNumber(split.newAccountsThisMonth, locale)}`,
      label: t('newAccountsThisMonth'),
    },
    { key: 'onTrial', value: formatNumber(split.onTrial, locale), label: t('onTrial') },
    { key: 'overdue', value: formatNumber(overdueAccounts, locale), label: t('overdueAccounts') },
  ];

  const jumpTo: { key: string; icon: LucideIcon; label: string; href: string; badge?: number }[] = [
    {
      key: 'withdrawals',
      icon: Wallet,
      label: t('jumpWithdrawals'),
      href: '/admin/withdrawals',
      badge: withdrawalsPending,
    },
    { key: 'finance', icon: TrendingUp, label: t('jumpFinance'), href: '/admin/finance' },
    { key: 'analytics', icon: BarChart3, label: t('jumpAnalytics'), href: '/admin/analytics' },
    { key: 'health', icon: Activity, label: t('jumpHealth'), href: '/admin/health' },
  ];

  return (
    <section className="mb-6 space-y-5">
      {/* MRR hero */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">{t('mrrHeading')}</p>
        <div className="mt-1 flex items-baseline justify-center gap-2">
          <p className="text-3xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(split.totalMrr, locale)}
          </p>
          {mrrGrowthPct != null && (
            <span
              className={`text-sm font-semibold ${
                mrrGrowthPct >= 0 ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {mrrGrowthPct >= 0 ? '+' : '−'}
              {formatPercent(Math.abs(mrrGrowthPct), locale)}
            </span>
          )}
        </div>
        {mrrLastMonth != null && (
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {t('vsLastMonth', { amount: formatCurrency(mrrLastMonth, locale) })}
          </p>
        )}
      </div>

      {/* CUSTOMERS — the split the design leads with */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {t('customersHeading')}
        </h3>
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
          {customerRows.map((row, i) => {
            const Icon = row.icon;
            return (
              <div
                key={row.key}
                className={`flex items-center gap-3 px-4 py-3 ${
                  i > 0 ? 'border-t border-[var(--color-border)]' : ''
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{row.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {t('studentsCount', { count: formatNumber(row.seg.students, locale) })}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-[var(--color-text-secondary)]">
                  {formatNumber(row.seg.accounts, locale)}
                </span>
                <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
                  {formatCurrency(row.seg.mrr, locale)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Four tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3"
          >
            <p className="text-lg font-bold text-[var(--color-text-primary)]">{tile.value}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{tile.label}</p>
          </div>
        ))}
      </div>

      {/* REVENUE MIX */}
      {revenueMix && revenueMix.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t('revenueMixHeading')}
          </h3>
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {revenueMix.map((row, i) => (
              <div
                key={row.key}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                  i > 0 ? 'border-t border-[var(--color-border)]' : ''
                }`}
              >
                <span className="text-sm text-[var(--color-text-primary)]">{t(`mix_${row.key}`)}</span>
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {formatCurrency(row.amount, locale)}
                </span>
              </div>
            ))}
          </div>
          {/*
            The design draws these three summing to the MRR hero. They do not:
            subscriptions and the parent pack recur, WhatsApp packs are a
            one-time top-up. This is paid-this-month by source, which is the
            figure that has a column behind it — the caption says so rather than
            letting the numbers imply a decomposition they are not.
          */}
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
            {t('revenueMixNote')}
          </p>
        </div>
      )}

      {/* JUMP TO */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {t('jumpToHeading')}
        </h3>
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
          {jumpTo.map((item, i) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex min-h-[44px] items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-2)] ${
                  i > 0 ? 'border-t border-[var(--color-border)]' : ''
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                <span className="min-w-0 flex-1 text-sm font-medium text-[var(--color-text-primary)]">
                  {item.label}
                </span>
                {item.badge != null && item.badge > 0 && (
                  <span className="shrink-0 rounded-md bg-[var(--color-mint)] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-deep)]">
                    {formatNumber(item.badge, locale)}
                  </span>
                )}
                <Chevron className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
