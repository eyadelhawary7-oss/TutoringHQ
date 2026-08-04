'use client';

/**
 * `Merged-Admin-Accounts` §01 — the account-detail header, centre half.
 *
 * The design's information architecture, in the design's order:
 *   identity → status chips → three KPI tiles → MANAGE → ACTIONS
 *
 * The live screen is an eleven-section management form and stays exactly that
 * underneath. This block is the header the design draws on top of it, and the
 * MANAGE rows jump to the section that already owns each concern rather than
 * duplicating it.
 *
 * The **Verified chip** is now BUILT and state-driven — see the chip row below.
 * It reads the one verification state machine and says whatever is true, which
 * today is "Not configured" with the named cause. It was previously omitted for
 * a missing column; omission left the design's unconditional "Verified" chip
 * with no honest counterpart, so an operator could not tell "unverified" from
 * "we never built this".
 *
 * **"National ID on file · Valify · 2 9805 15 01 02345" is still NOT drawn, and
 * will not be.** The design renders the full number on four frames of §01.
 * `design/VERIFICATION-SPEC.md` §9.2 item 3 and §9.7 settle it: none of the
 * twelve verified screens needs the number, internal staff have less reason to
 * see it than the owner does, and §7.7/§7.8 flag that admin has no
 * least-privilege control over it. The chip carries no ID and has no prop that
 * could take one.
 *
 * OMITTED, each for a named missing column — never stubbed, never greyed:
 *  - **Branches row.** No `branches` table exists.
 *  - **"Log in as center" action.** No impersonation exists anywhere in the
 *    codebase; the row would be a button with nothing behind it.
 *
 * The teacher half of §01 (`/admin/teachers/[id]`) is R7, which was built on
 * 28 July and closed unmerged on Eyad's call — one teacher console, not two.
 * This component is centre-only by that decision.
 */

import { useLocale, useTranslations } from 'next-intl';
import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  CreditCard,
  FileText,
  Package,
  Users,
  GraduationCap,
  History,
  StickyNote,
  Ban,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/formatNumber';
import { initialsOf } from '@/lib/initials';
import AdminVerificationChip from '@/components/verification/AdminVerificationChip';
import { useAdminVerificationAvailability } from '@/hooks/useAdminVerificationAvailability';

export interface AccountMetrics {
  studentCount: number;
  teacherStaffCount: number;
  invoiceCount: number;
  addOnCount: number;
  attendanceRatePct: number | null;
  attendanceWindowDays: number;
}

interface AccountDetailHeaderProps {
  center: Record<string, unknown>;
  metrics: AccountMetrics | null;
  planLabel: string;
  statusLabel: string;
  statusClass: string;
  /** Scrolls the live section that owns a MANAGE row into view. */
  onJump: (anchorId: string) => void;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export default function AccountDetailHeader({
  center,
  metrics,
  planLabel,
  statusLabel,
  statusClass,
  onJump,
}: AccountDetailHeaderProps) {
  const t = useTranslations('admin.accountDetail');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  // Feature-level availability, not per-centre: with no verification column in
  // the live schema there is no per-centre state to fetch. When the migration
  // lands, this becomes a per-centre read and the chip needs no change.
  const { state: verification } = useAdminVerificationAvailability();
  const isRTL = locale === 'ar';
  const Chevron = isRTL ? ChevronLeft : ChevronRight;

  const name = str(center.name) ?? tCommon('notAvailable');
  const location = [str(center.district)?.replace(/_/g, ' '), str(center.city)].filter(Boolean).join(', ');
  const createdAt = str(center.created_at);
  const allInPrice = center.all_in_price != null ? Number(center.all_in_price) : null;

  const manageRows: {
    key: string;
    icon: LucideIcon;
    label: string;
    value: string | null;
    anchor: string | null;
  }[] = [
    { key: 'profile', icon: Building2, label: t('manage.profile'), value: null, anchor: 'acct-profile' },
    { key: 'plan', icon: CreditCard, label: t('manage.plan'), value: planLabel, anchor: 'acct-plan' },
    {
      key: 'addons',
      icon: Package,
      label: t('manage.addOns'),
      value: metrics ? t('addOnsActive', { count: formatNumber(metrics.addOnCount, locale) }) : null,
      anchor: 'acct-addons',
    },
    {
      key: 'invoices',
      icon: FileText,
      label: t('manage.invoices'),
      value: metrics ? formatNumber(metrics.invoiceCount, locale) : null,
      anchor: 'acct-invoices',
    },
    // Students and Teachers & staff have no admin-side roster screen to open,
    // so they carry their figure and no chevron. The count is real; the
    // destination is what does not exist.
    {
      key: 'students',
      icon: GraduationCap,
      label: t('manage.students'),
      value: metrics ? formatNumber(metrics.studentCount, locale) : null,
      anchor: null,
    },
    {
      key: 'staff',
      icon: Users,
      label: t('manage.staff'),
      value: metrics ? formatNumber(metrics.teacherStaffCount, locale) : null,
      anchor: null,
    },
    { key: 'activity', icon: History, label: t('manage.activityLog'), value: null, anchor: 'acct-activity' },
    { key: 'notes', icon: StickyNote, label: t('manage.notes'), value: null, anchor: 'acct-notes' },
  ];

  const kpis: { key: string; value: string; label: string }[] = [
    {
      key: 'students',
      value: metrics ? formatNumber(metrics.studentCount, locale) : '—',
      label: t('kpi.students'),
    },
    {
      key: 'mrr',
      value: allInPrice != null ? formatCurrency(allInPrice, locale) : '—',
      label: t('kpi.mrr'),
    },
  ];
  // Attendance is null when the window held no finished session with an
  // enrolled group. A centre with nothing to measure has no rate, and 0%
  // would be a claim the data does not make — so the tile drops out.
  if (metrics?.attendanceRatePct != null) {
    kpis.push({
      key: 'attendance',
      value: formatPercent(metrics.attendanceRatePct, locale),
      label: t('kpi.attendance', { days: formatNumber(metrics.attendanceWindowDays, locale) }),
    });
  }

  return (
    <section className="mb-6 space-y-5">
      <div className="flex items-start gap-3">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mint)] text-lg font-semibold text-[var(--color-accent-deep)]"
          aria-hidden
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold text-[var(--color-text-primary)]">{name}</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
            {[t('centerKind'), location].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[var(--color-mint)] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-deep)]">
              {planLabel}
            </span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize ${statusClass}`}>
              {statusLabel}
            </span>
            <AdminVerificationChip state={verification} />
            {createdAt && (
              <span className="text-xs text-[var(--color-text-muted)]">
                {t('customerSince', { date: formatDate(createdAt, locale) })}
              </span>
            )}
          </div>
          {/* The named cause, spelled out once per screen rather than on every
              chip. An operator seeing "Not configured" needs to know whether to
              set credentials or apply a migration. */}
          <AdminVerificationChip state={verification} variant="cause" className="mt-2" />
        </div>
      </div>

      <div className={`grid gap-3 ${kpis.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {kpis.map((k) => (
          <div
            key={k.key}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3 text-center"
          >
            <p className="text-3xl font-bold leading-tight text-[var(--color-text-primary)]">{k.value}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {t('manageHeading')}
        </h3>
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
          {manageRows.map((row, i) => {
            const Icon = row.icon;
            const inner = (
              <>
                <Icon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-start text-sm font-medium text-[var(--color-text-primary)]">
                  {row.label}
                </span>
                {row.value && (
                  <span className="shrink-0 text-sm text-[var(--color-text-secondary)]">{row.value}</span>
                )}
                {row.anchor && <Chevron className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />}
              </>
            );
            const shell = `flex w-full items-center gap-3 px-4 py-3 min-h-[44px] ${
              i > 0 ? 'border-t border-[var(--color-border)]' : ''
            }`;
            return row.anchor ? (
              <button
                key={row.key}
                type="button"
                onClick={() => onJump(row.anchor as string)}
                className={`${shell} btn-press chq-focus hover:bg-[var(--color-surface-2)]`}
              >
                {inner}
              </button>
            ) : (
              <div key={row.key} className={shell}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {t('actionsHeading')}
        </h3>
        {/*
          "Log in as center" is not here. No impersonation exists in the
          codebase, so the row would be a control with nothing behind it.
        */}
        <button
          type="button"
          onClick={() => onJump('acct-plan')}
          className="btn-press chq-focus flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3 text-start hover:bg-[var(--color-surface-2)]"
        >
          <Ban className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <span className="min-w-0 flex-1 text-sm font-medium text-red-600">{t('actions.suspend')}</span>
          <Chevron className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
        </button>
      </div>
    </section>
  );
}
