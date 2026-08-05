'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { MobileWrapper } from '@/components/shell/MobileWrapper';
import { formatCurrency, formatNumber, formatDate } from '@/lib/formatNumber';
import type { CeoTeacherData } from '@/types/ceoTeachers';
import {
  NONE,
  presentValues,
  hasActiveFilter,
  teacherSummary,
  referralSummary,
  attachmentSummary,
  creditSummary,
  filterSubscriptions,
  filterReferrals,
  filterTeachers,
  filterAttachments,
  filterCredits,
  EMPTY_SUBSCRIPTION_FILTERS,
  EMPTY_REFERRAL_FILTERS,
  EMPTY_TEACHER_FILTERS,
  EMPTY_ATTACHMENT_FILTERS,
  EMPTY_CREDIT_FILTERS,
  type SubscriptionFilters,
  type ReferralFilters,
  type TeacherFilters,
  type AttachmentFilters,
  type CreditFilters,
} from '@/lib/ceoTeachersView';

type TabKey = 'subscriptions' | 'referrals' | 'teachers' | 'attachments' | 'credits';

const TABS: TabKey[] = ['subscriptions', 'referrals', 'teachers', 'attachments', 'credits'];

type SelectOption = { value: string; label: string };

// ── Module-level presentational components ───────────────────────────────────
// Defined outside the page component so their identity is stable across renders;
// otherwise each keystroke would remount the inputs and drop focus.

function SummaryCards({ cards }: { cards: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-center"
        >
          <p className="text-xs text-[var(--color-text-secondary)]">{c.label}</p>
          <p className="font-mono font-bold text-[var(--color-text-primary)]">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

const controlClass =
  'rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] min-w-[8rem]';

function TextFilter({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={controlClass}
      />
    </label>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  allLabel: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={controlClass}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterBar({
  children,
  onClear,
  clearLabel,
  active,
}: {
  children: React.ReactNode;
  onClear: () => void;
  clearLabel: string;
  active: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {children}
      <button
        type="button"
        onClick={onClear}
        disabled={!active}
        className="rounded-lg border border-[var(--color-border-default)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {clearLabel}
      </button>
    </div>
  );
}

export default function CeoTeachersPage() {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('ceoTeachers');
  const tCommon = useTranslations('common');

  const [data, setData] = useState<CeoTeacherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('subscriptions');

  // Per-tab filter state (persists per tab while the page is mounted).
  const [subFilters, setSubFilters] = useState<SubscriptionFilters>(EMPTY_SUBSCRIPTION_FILTERS);
  const [refFilters, setRefFilters] = useState<ReferralFilters>(EMPTY_REFERRAL_FILTERS);
  const [teacherFilters, setTeacherFilters] = useState<TeacherFilters>(EMPTY_TEACHER_FILTERS);
  const [attFilters, setAttFilters] = useState<AttachmentFilters>(EMPTY_ATTACHMENT_FILTERS);
  const [credFilters, setCredFilters] = useState<CreditFilters>(EMPTY_CREDIT_FILTERS);

  const fetchData = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/ceo/teachers', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const json = (await res.json()) as CeoTeacherData;
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const tierLabel = (planKey: string | null): string => {
    if (planKey === 'teacher_standard') return t('tiers.standard');
    if (planKey === 'teacher_pro') return t('tiers.pro');
    if (planKey === 'teacher_scale') return t('tiers.scale');
    return tCommon('notSet');
  };

  const statusLabel = (status: string | null): string => {
    const known = ['trialing', 'active', 'past_due', 'suspended', 'cancelled'];
    if (status && known.includes(status)) {
      return t(`statuses.${status}` as Parameters<typeof t>[0]);
    }
    return status ?? tCommon('notSet');
  };

  const statusClass = (status: string | null): string => {
    switch (status) {
      case 'active':
        return 'bg-green-400/10 text-green-500';
      case 'trialing':
        return 'bg-teal-500/10 text-teal-600';
      case 'past_due':
        return 'bg-amber-400/10 text-amber-500';
      case 'suspended':
      case 'cancelled':
        return 'bg-red-400/10 text-red-400';
      default:
        return 'bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]';
    }
  };

  const dateCell = (value: string | null) =>
    value ? formatDate(value, locale) : tCommon('notSet');

  // Select-option builders from values actually present in the loaded rows.
  const tierOptionsFor = (rows: Array<{ plan_key: string | null }>): SelectOption[] =>
    presentValues(rows, (r) => r.plan_key).map((v) => ({
      value: v,
      label: v === NONE ? tCommon('notSet') : tierLabel(v),
    }));
  const statusOptionsFor = (rows: Array<{ status: string | null }>): SelectOption[] =>
    presentValues(rows, (r) => r.status).map((v) => ({
      value: v,
      label: v === NONE ? t('noSubscription') : statusLabel(v),
    }));
  const conversionOptions: SelectOption[] = [
    { value: 'converted', label: t('referralConverted') },
    { value: 'pending', label: t('referralPending') },
  ];
  const stateOptions: SelectOption[] = [
    { value: 'current', label: t('attachmentCurrent') },
    { value: 'private', label: t('attachmentPrivate') },
  ];

  const TeacherIdentity = ({
    name,
    code,
    isTest,
  }: {
    name: string | null;
    code: string | null;
    isTest: boolean;
  }) => (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-[var(--color-text-primary)]">
        {name ?? tCommon('notSet')}
        {isTest && (
          <span className="ms-2 inline-flex rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] text-[10px] px-1.5 py-0.5 align-middle">
            {t('testBadge')}
          </span>
        )}
      </span>
      {code && (
        <span className="font-mono text-xs text-[var(--color-text-tertiary)]" dir="ltr">
          {code}
        </span>
      )}
    </div>
  );

  /**
   * §01 quiet variant, reused across all five tabs of this screen. Every one of
   * them is a read-only CEO view of data produced elsewhere — nothing here is
   * waiting on the reader — so they take the muted tile and no action. This was
   * a file-local helper repeated five times; it still is one, but the thing it
   * repeats is now the shared component rather than a fifth private empty-state
   * shape.
   */
  const EmptyRow = ({ colSpan, message }: { colSpan: number; message: string }) => (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState icon={Inbox} title={message} quiet />
      </td>
    </tr>
  );

  /** "Nothing yet" when the tab has no data at all; "no rows match" when filters exclude everything. */
  const emptyMessage = (totalLen: number, nothingYetKey: string) =>
    totalLen === 0 ? t(nothingYetKey as Parameters<typeof t>[0]) : t('filters.noMatch');

  const thClass = 'px-3 py-2 font-medium text-start';
  const tableWrap =
    'overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]';
  const theadClass = 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]';

  function renderSubscriptions(d: CeoTeacherData) {
    const s = d.subscriptions_summary;
    const rows = filterSubscriptions(d.subscriptions, subFilters);
    const upd = (patch: Partial<SubscriptionFilters>) => setSubFilters((p) => ({ ...p, ...patch }));
    return (
      <div className="space-y-4">
        {/* Existing status cards — unchanged. */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(
            [
              ['active', s.active],
              ['trialing', s.trialing],
              ['past_due', s.past_due],
              ['suspended', s.suspended],
              ['cancelled', s.cancelled],
            ] as const
          ).map(([key, count]) => (
            <div
              key={key}
              className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-center"
            >
              <p className="text-xs text-[var(--color-text-secondary)]">{statusLabel(key)}</p>
              <p className="font-mono font-bold text-[var(--color-text-primary)]">
                {formatNumber(count, locale)}
              </p>
            </div>
          ))}
        </div>
        <FilterBar
          onClear={() => setSubFilters(EMPTY_SUBSCRIPTION_FILTERS)}
          clearLabel={t('filters.clear')}
          active={hasActiveFilter(subFilters)}
        >
          <TextFilter label={t('cols.teacher')} value={subFilters.teacher} onChange={(v) => upd({ teacher: v })} placeholder={t('filters.search')} />
          <SelectFilter label={t('cols.tier')} value={subFilters.tier} onChange={(v) => upd({ tier: v })} options={tierOptionsFor(d.subscriptions)} allLabel={t('filters.all')} />
          <SelectFilter label={t('cols.status')} value={subFilters.status} onChange={(v) => upd({ status: v })} options={statusOptionsFor(d.subscriptions)} allLabel={t('filters.all')} />
          <TextFilter label={t('cols.trialEnds')} value={subFilters.trialEnds} onChange={(v) => upd({ trialEnds: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.periodEnd')} value={subFilters.periodEnd} onChange={(v) => upd({ periodEnd: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.nextBilling')} value={subFilters.nextBilling} onChange={(v) => upd({ nextBilling: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.freeMonths')} value={subFilters.freeMonths} onChange={(v) => upd({ freeMonths: v })} placeholder={t('filters.search')} />
        </FilterBar>
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>{t('cols.teacher')}</th>
                <th className={thClass}>{t('cols.tier')}</th>
                <th className={thClass}>{t('cols.status')}</th>
                <th className={thClass}>{t('cols.trialEnds')}</th>
                <th className={thClass}>{t('cols.periodEnd')}</th>
                <th className={thClass}>{t('cols.nextBilling')}</th>
                <th className={thClass}>{t('cols.freeMonths')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={7} message={emptyMessage(d.subscriptions.length, 'empty.subscriptions')} />
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.teacher_id}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-3 py-2">
                      <TeacherIdentity name={row.display_name} code={row.referral_code} isTest={row.is_test} />
                    </td>
                    <td className="px-3 py-2">{tierLabel(row.plan_key)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusClass(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{dateCell(row.trial_ends_at)}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{dateCell(row.current_period_end)}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{dateCell(row.next_billing_at)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatNumber(row.free_months_credit, locale)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderReferrals(d: CeoTeacherData) {
    const sum = referralSummary(d.referrals);
    const rows = filterReferrals(d.referrals, refFilters);
    const upd = (patch: Partial<ReferralFilters>) => setRefFilters((p) => ({ ...p, ...patch }));
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: t('cards.totalReferrals'), value: formatNumber(sum.total, locale) },
            { label: t('referralConverted'), value: formatNumber(sum.converted, locale) },
            { label: t('referralPending'), value: formatNumber(sum.pending, locale) },
            { label: t('cards.freeMonthsGranted'), value: formatNumber(sum.freeMonths, locale) },
          ]}
        />
        <FilterBar
          onClear={() => setRefFilters(EMPTY_REFERRAL_FILTERS)}
          clearLabel={t('filters.clear')}
          active={hasActiveFilter(refFilters)}
        >
          <TextFilter label={t('cols.referrer')} value={refFilters.referrer} onChange={(v) => upd({ referrer: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.referee')} value={refFilters.referee} onChange={(v) => upd({ referee: v })} placeholder={t('filters.search')} />
          <SelectFilter label={t('cols.conversion')} value={refFilters.conversion} onChange={(v) => upd({ conversion: v })} options={conversionOptions} allLabel={t('filters.all')} />
          <TextFilter label={t('cols.rewardedAt')} value={refFilters.rewardedAt} onChange={(v) => upd({ rewardedAt: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.freeMonths')} value={refFilters.freeMonths} onChange={(v) => upd({ freeMonths: v })} placeholder={t('filters.search')} />
        </FilterBar>
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>{t('cols.referrer')}</th>
                <th className={thClass}>{t('cols.referee')}</th>
                <th className={thClass}>{t('cols.conversion')}</th>
                <th className={thClass}>{t('cols.rewardedAt')}</th>
                <th className={thClass}>{t('cols.freeMonths')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={5} message={emptyMessage(d.referrals.length, 'empty.referrals')} />
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.referee_id}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-3 py-2">
                      <TeacherIdentity name={row.referrer_name} code={row.referrer_code} isTest={false} />
                    </td>
                    <td className="px-3 py-2">
                      <TeacherIdentity name={row.referee_name} code={row.referee_code} isTest={row.referee_is_test} />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                          row.converted ? 'bg-green-400/10 text-green-500' : 'bg-amber-400/10 text-amber-500'
                        }`}
                      >
                        {row.converted ? t('referralConverted') : t('referralPending')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{dateCell(row.rewarded_at)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatNumber(row.free_months_credit, locale)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderTeachers(d: CeoTeacherData) {
    const sum = teacherSummary(d.teachers);
    const rows = filterTeachers(d.teachers, teacherFilters);
    const upd = (patch: Partial<TeacherFilters>) => setTeacherFilters((p) => ({ ...p, ...patch }));
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: t('cards.totalTeachers'), value: formatNumber(sum.total, locale) },
            { label: t('cards.freePlan'), value: formatNumber(sum.notSet, locale) },
            { label: t('tiers.standard'), value: formatNumber(sum.standard, locale) },
            { label: t('tiers.pro'), value: formatNumber(sum.pro, locale) },
            { label: t('tiers.scale'), value: formatNumber(sum.scale, locale) },
          ]}
        />
        <FilterBar
          onClear={() => setTeacherFilters(EMPTY_TEACHER_FILTERS)}
          clearLabel={t('filters.clear')}
          active={hasActiveFilter(teacherFilters)}
        >
          <TextFilter label={t('cols.teacher')} value={teacherFilters.teacher} onChange={(v) => upd({ teacher: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.subject')} value={teacherFilters.subject} onChange={(v) => upd({ subject: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.phone')} value={teacherFilters.phone} onChange={(v) => upd({ phone: v })} placeholder={t('filters.search')} />
          <SelectFilter label={t('cols.tier')} value={teacherFilters.tier} onChange={(v) => upd({ tier: v })} options={tierOptionsFor(d.teachers)} allLabel={t('filters.all')} />
          <SelectFilter label={t('cols.status')} value={teacherFilters.status} onChange={(v) => upd({ status: v })} options={statusOptionsFor(d.teachers)} allLabel={t('filters.all')} />
          <TextFilter label={t('cols.joined')} value={teacherFilters.joined} onChange={(v) => upd({ joined: v })} placeholder={t('filters.search')} />
        </FilterBar>
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>{t('cols.teacher')}</th>
                <th className={thClass}>{t('cols.subject')}</th>
                <th className={thClass}>{t('cols.phone')}</th>
                <th className={thClass}>{t('cols.tier')}</th>
                <th className={thClass}>{t('cols.status')}</th>
                <th className={thClass}>{t('cols.joined')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={6} message={emptyMessage(d.teachers.length, 'empty.teachers')} />
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.teacher_id}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-3 py-2">
                      <TeacherIdentity name={row.display_name} code={row.referral_code} isTest={row.is_test} />
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.subject ?? tCommon('notSet')}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]" dir="ltr">{row.phone ?? tCommon('notSet')}</td>
                    <td className="px-3 py-2">{tierLabel(row.plan_key)}</td>
                    <td className="px-3 py-2">
                      {row.status ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusClass(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-tertiary)]">{t('noSubscription')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{dateCell(row.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderAttachments(d: CeoTeacherData) {
    const sum = attachmentSummary(d.attachments);
    const rows = filterAttachments(d.attachments, attFilters);
    const upd = (patch: Partial<AttachmentFilters>) => setAttFilters((p) => ({ ...p, ...patch }));
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: t('cards.totalAttachments'), value: formatNumber(sum.total, locale) },
            { label: t('cards.currentlyAttached'), value: formatNumber(sum.current, locale) },
            { label: t('cards.detached'), value: formatNumber(sum.detached, locale) },
          ]}
        />
        <FilterBar
          onClear={() => setAttFilters(EMPTY_ATTACHMENT_FILTERS)}
          clearLabel={t('filters.clear')}
          active={hasActiveFilter(attFilters)}
        >
          <TextFilter label={t('cols.teacher')} value={attFilters.teacher} onChange={(v) => upd({ teacher: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.center')} value={attFilters.center} onChange={(v) => upd({ center: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.group')} value={attFilters.group} onChange={(v) => upd({ group: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.cut')} value={attFilters.cut} onChange={(v) => upd({ cut: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.fee')} value={attFilters.fee} onChange={(v) => upd({ fee: v })} placeholder={t('filters.search')} />
          <SelectFilter label={t('cols.attachmentState')} value={attFilters.state} onChange={(v) => upd({ state: v })} options={stateOptions} allLabel={t('filters.all')} />
        </FilterBar>
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>{t('cols.teacher')}</th>
                <th className={thClass}>{t('cols.center')}</th>
                <th className={thClass}>{t('cols.group')}</th>
                <th className={thClass}>{t('cols.cut')}</th>
                <th className={thClass}>{t('cols.fee')}</th>
                <th className={thClass}>{t('cols.attachmentState')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={6} message={emptyMessage(d.attachments.length, 'empty.attachments')} />
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.group_id}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-3 py-2 font-medium">{row.teacher_name ?? tCommon('notSet')}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.center_name ?? tCommon('notSet')}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {row.group_name ?? tCommon('notSet')}
                      {row.subject ? ` · ${row.subject}` : ''}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {row.current ? formatCurrency(row.center_cut_egp, locale) : tCommon('notSet')}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-[var(--color-text-secondary)]">
                      {row.fee_per_class != null ? formatCurrency(row.fee_per_class, locale) : tCommon('notSet')}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                          row.current
                            ? 'bg-green-400/10 text-green-500'
                            : 'bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]'
                        }`}
                      >
                        {row.current ? t('attachmentCurrent') : t('attachmentPrivate')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderCredits(d: CeoTeacherData) {
    const sum = creditSummary(d.credits);
    const rows = filterCredits(d.credits, credFilters);
    const upd = (patch: Partial<CreditFilters>) => setCredFilters((p) => ({ ...p, ...patch }));
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: t('cards.teachersWithCredits'), value: formatNumber(sum.withCredits, locale) },
            { label: t('cols.subscriptionCredits'), value: formatNumber(sum.subscription, locale) },
            { label: t('cols.purchasedCredits'), value: formatNumber(sum.purchased, locale) },
          ]}
        />
        <FilterBar
          onClear={() => setCredFilters(EMPTY_CREDIT_FILTERS)}
          clearLabel={t('filters.clear')}
          active={hasActiveFilter(credFilters)}
        >
          <TextFilter label={t('cols.teacher')} value={credFilters.teacher} onChange={(v) => upd({ teacher: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.subscriptionCredits')} value={credFilters.subscription} onChange={(v) => upd({ subscription: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.purchasedCredits')} value={credFilters.purchased} onChange={(v) => upd({ purchased: v })} placeholder={t('filters.search')} />
          <TextFilter label={t('cols.totalCredits')} value={credFilters.total} onChange={(v) => upd({ total: v })} placeholder={t('filters.search')} />
        </FilterBar>
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>{t('cols.teacher')}</th>
                <th className={thClass}>{t('cols.subscriptionCredits')}</th>
                <th className={thClass}>{t('cols.purchasedCredits')}</th>
                <th className={thClass}>{t('cols.totalCredits')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={4} message={emptyMessage(d.credits.length, 'empty.credits')} />
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.teacher_id}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-3 py-2">
                      <TeacherIdentity name={row.display_name} code={row.referral_code} isTest={row.is_test} />
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatNumber(row.subscription_credits, locale)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatNumber(row.purchased_credits, locale)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums font-bold">{formatNumber(row.total_credits, locale)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="flex flex-col items-center gap-3">
          <div
            className="size-8 rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-brand-500)] animate-spin"
            aria-hidden
          />
          <p className="text-[var(--color-text-secondary)] text-sm">{tCommon('loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen w-full min-w-0 bg-[var(--color-surface-0)] pt-14 lg:pt-0 page-enter">
      <AdminSidebar activeRoute={pathname} />
      <div className="flex-1 overflow-auto flex flex-col min-w-0 lg:ms-56">
        <MobileWrapper fullWidth>
          <div className="sticky top-0 z-20 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/95 backdrop-blur-sm px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold text-[var(--color-text-primary)]">{t('title')}</span>
              <span className="text-xs text-[var(--color-text-secondary)]">{t('subtitle')}</span>
            </div>
          </div>

          <div className="px-4 py-6 space-y-6">
            <div className="flex flex-wrap gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium border transition-colors ${
                    activeTab === tab
                      ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white'
                      : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  {t(`tabs.${tab}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>

            {activeTab === 'subscriptions' && renderSubscriptions(data)}
            {activeTab === 'referrals' && renderReferrals(data)}
            {activeTab === 'teachers' && renderTeachers(data)}
            {activeTab === 'attachments' && renderAttachments(data)}
            {activeTab === 'credits' && renderCredits(data)}
          </div>
        </MobileWrapper>
      </div>
    </div>
  );
}
