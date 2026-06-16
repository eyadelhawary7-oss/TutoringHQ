'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { MobileWrapper } from '@/components/shell/MobileWrapper';
import { formatCurrency, formatNumber, formatDate } from '@/lib/formatNumber';
import type { CeoTeacherData } from '@/types/ceoTeachers';

type TabKey = 'subscriptions' | 'referrals' | 'teachers' | 'attachments' | 'credits';

const TABS: TabKey[] = ['subscriptions', 'referrals', 'teachers', 'attachments', 'credits'];

export default function CeoTeachersPage() {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('ceoTeachers');
  const tCommon = useTranslations('common');

  const [data, setData] = useState<CeoTeacherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('subscriptions');

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
    if (planKey === 'teacher_299') return t('tiers.standard');
    if (planKey === 'teacher_699') return t('tiers.pro');
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
        return 'bg-teal-500/10 text-teal-600 dark:text-teal-400';
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

  const EmptyRow = ({ colSpan, message }: { colSpan: number; message: string }) => (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-[var(--color-text-secondary)]">
        {message}
      </td>
    </tr>
  );

  const thClass = 'px-3 py-2 font-medium text-start';
  const tableWrap =
    'overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]';
  const theadClass = 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]';

  function renderSubscriptions(d: CeoTeacherData) {
    const s = d.subscriptions_summary;
    return (
      <div className="space-y-4">
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
              {d.subscriptions.length === 0 ? (
                <EmptyRow colSpan={7} message={t('empty.subscriptions')} />
              ) : (
                d.subscriptions.map((row) => (
                  <tr
                    key={row.teacher_id}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-3 py-2">
                      <TeacherIdentity
                        name={row.display_name}
                        code={row.referral_code}
                        isTest={row.is_test}
                      />
                    </td>
                    <td className="px-3 py-2">{tierLabel(row.plan_key)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusClass(row.status)}`}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {dateCell(row.trial_ends_at)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {dateCell(row.current_period_end)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {dateCell(row.next_billing_at)}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {formatNumber(row.free_months_credit, locale)}
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

  function renderReferrals(d: CeoTeacherData) {
    return (
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
            {d.referrals.length === 0 ? (
              <EmptyRow colSpan={5} message={t('empty.referrals')} />
            ) : (
              d.referrals.map((row) => (
                <tr
                  key={row.referee_id}
                  className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                >
                  <td className="px-3 py-2">
                    <TeacherIdentity
                      name={row.referrer_name}
                      code={row.referrer_code}
                      isTest={false}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <TeacherIdentity
                      name={row.referee_name}
                      code={row.referee_code}
                      isTest={row.referee_is_test}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        row.converted
                          ? 'bg-green-400/10 text-green-500'
                          : 'bg-amber-400/10 text-amber-500'
                      }`}
                    >
                      {row.converted ? t('referralConverted') : t('referralPending')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                    {dateCell(row.rewarded_at)}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {formatNumber(row.free_months_credit, locale)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderTeachers(d: CeoTeacherData) {
    return (
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
            {d.teachers.length === 0 ? (
              <EmptyRow colSpan={6} message={t('empty.teachers')} />
            ) : (
              d.teachers.map((row) => (
                <tr
                  key={row.teacher_id}
                  className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                >
                  <td className="px-3 py-2">
                    <TeacherIdentity
                      name={row.display_name}
                      code={row.referral_code}
                      isTest={row.is_test}
                    />
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                    {row.subject ?? tCommon('notSet')}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]" dir="ltr">
                    {row.phone ?? tCommon('notSet')}
                  </td>
                  <td className="px-3 py-2">{tierLabel(row.plan_key)}</td>
                  <td className="px-3 py-2">
                    {row.status ? (
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusClass(row.status)}`}
                      >
                        {statusLabel(row.status)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-tertiary)]">{t('noSubscription')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                    {dateCell(row.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderAttachments(d: CeoTeacherData) {
    return (
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
            {d.attachments.length === 0 ? (
              <EmptyRow colSpan={6} message={t('empty.attachments')} />
            ) : (
              d.attachments.map((row) => (
                <tr
                  key={row.group_id}
                  className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                >
                  <td className="px-3 py-2 font-medium">{row.teacher_name ?? tCommon('notSet')}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                    {row.center_name ?? tCommon('notSet')}
                  </td>
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
    );
  }

  function renderCredits(d: CeoTeacherData) {
    return (
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
            {d.credits.length === 0 ? (
              <EmptyRow colSpan={4} message={t('empty.credits')} />
            ) : (
              d.credits.map((row) => (
                <tr
                  key={row.teacher_id}
                  className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                >
                  <td className="px-3 py-2">
                    <TeacherIdentity
                      name={row.display_name}
                      code={row.referral_code}
                      isTest={row.is_test}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {formatNumber(row.subscription_credits, locale)}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {formatNumber(row.purchased_credits, locale)}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums font-bold">
                    {formatNumber(row.total_credits, locale)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
