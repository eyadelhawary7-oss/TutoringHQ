'use client';

import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { ArrowLeft, Gift, CheckCircle, Users } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { EmptyState } from '@/components/shared';
import { ListRow } from '@/components/patterns';
import { initialsOf } from '@/lib/initials';
import type { ProgramSummary, TopReferrer } from '@/lib/referralProgram';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPlainInteger,
} from '@/lib/formatNumber';

function formatRatePct(
  row: {
    commission_rate: number | string | null;
    commission_amount: number;
    referred_plan_fee: number | null;
  },
  locale: string,
): string {
  const r = row.commission_rate != null ? Number(row.commission_rate) : NaN;
  if (Number.isFinite(r)) {
    if (r > 1) return formatPercent(r, locale);
    return formatPercent(r * 100, locale);
  }
  const fee = row.referred_plan_fee != null ? Number(row.referred_plan_fee) : 0;
  const amt = row.commission_amount;
  if (fee > 0 && amt >= 0) return formatPercent((amt / fee) * 100, locale);
  return '-';
}

type ReferralRow = {
  id: string;
  referrer_name: string;
  referred_name: string;
  referral_code: string;
  status: string;
  created_at: string;
};

type PendingPayout = { center_id: string; center_name: string; code: string; amount: number };

type CommissionRow = {
  id: string;
  referrer_center_id: string;
  referred_center_id: string | null;
  referrer_name: string;
  referred_name: string;
  period_month: string;
  commission_rate: number | string | null;
  commission_amount: number;
  referred_plan_fee: number | null;
  status: string | null;
  hold_until: string | null;
  paid_at: string | null;
};

type Summary = {
  quarter: number | null;
  year: number | null;
  quarterAll: boolean;
  totalOwed: number;
  totalPaid: number;
  referrersOwedCount: number;
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
};

export default function AdminReferralsPage() {
  const t = useTranslations('admin.referralsAdminPage');
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('status');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const qOpts = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const d = new Date();
    for (let i = 0; i < 5; i++) {
      const y = d.getFullYear();
      const q = Math.floor(d.getMonth() / 3) + 1;
      out.push({
        value: `${y}-Q${q}`,
        label: t('quarterOptionLabel', {
          quarter: formatPlainInteger(q, locale),
          year: formatPlainInteger(y, locale),
        }),
      });
      d.setMonth(d.getMonth() - 3);
    }
    return out;
  }, [locale, t]);
  const defaultQuarter = qOpts[0]?.value ?? '';

  const [mainTab, setMainTab] = useState<'referrals' | 'commissions'>('referrals');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [adminReferrals, setAdminReferrals] = useState<ReferralRow[]>([]);
  const [adminPendingPayouts, setAdminPendingPayouts] = useState<PendingPayout[]>([]);
  const [referralsLoading, setReferralsLoading] = useState(true);

  // Merged-Admin-Accounts §04 — the programme block and the ranked list.
  const [program, setProgram] = useState<ProgramSummary | null>(null);
  const [topReferrers, setTopReferrers] = useState<TopReferrer[]>([]);
  const [referrerFilter, setReferrerFilter] = useState<'all' | 'centers' | 'teachers' | 'owed'>('all');

  const [commissionStatus, setCommissionStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [commissionQuarter, setCommissionQuarter] = useState(defaultQuarter);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [commissionsLoading, setCommissionsLoading] = useState(false);
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const filteredReferrers = useMemo(() => {
    if (referrerFilter === 'centers') return topReferrers.filter((r) => r.kind === 'center');
    if (referrerFilter === 'teachers') return topReferrers.filter((r) => r.kind === 'teacher');
    if (referrerFilter === 'owed') return topReferrers.filter((r) => (r.owed ?? 0) > 0);
    return topReferrers;
  }, [topReferrers, referrerFilter]);

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
    void (async () => {
      const session = await getSession();
      if (!session) return;
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json()) as { isAdmin?: boolean; role?: string };
      setIsSuperAdmin(!!data?.isAdmin && data?.role === 'super_admin');
    })();
  }, [getSession]);

  useEffect(() => {
    if (!isSuperAdmin && mainTab === 'commissions') setMainTab('referrals');
  }, [isSuperAdmin, mainTab]);

  const loadReferralsData = useCallback(async () => {
    const session = await getSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setReferralsLoading(true);
    try {
      const res = await fetch('/api/admin/referrals', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        referrals?: ReferralRow[];
        pendingPayouts?: PendingPayout[];
        program?: ProgramSummary;
        topReferrers?: TopReferrer[];
      };
      setAdminReferrals(data.referrals ?? []);
      setAdminPendingPayouts(data.pendingPayouts ?? []);
      setProgram(data.program ?? null);
      setTopReferrers(data.topReferrers ?? []);
    } finally {
      setReferralsLoading(false);
    }
  }, [getSession, router]);

  useEffect(() => {
    void loadReferralsData();
  }, [loadReferralsData]);

  const loadCommissions = useCallback(async () => {
    if (!isSuperAdmin) return;
    const session = await getSession();
    if (!session) return;
    setCommissionsLoading(true);
    setCommissionError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('status', commissionStatus);
      qs.set('quarter', commissionQuarter || defaultQuarter);
      const res = await fetch(`/api/admin/referrals/commissions?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 403 || res.status === 401) {
        setCommissionError(t('loadCommissionsError'));
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setCommissionError(typeof j.error === 'string' ? j.error : t('loadCommissionsError'));
        return;
      }
      const data = (await res.json()) as { commissions?: CommissionRow[]; summary?: Summary };
      setCommissions(data.commissions ?? []);
      setSummary(data.summary ?? null);
    } catch (e) {
      setCommissionError(e instanceof Error ? e.message : t('loadCommissionsError'));
    } finally {
      setCommissionsLoading(false);
    }
  }, [commissionQuarter, commissionStatus, defaultQuarter, getSession, isSuperAdmin, t]);

  useEffect(() => {
    if (mainTab === 'commissions' && isSuperAdmin) void loadCommissions();
  }, [mainTab, isSuperAdmin, loadCommissions]);

  const patchMarkCommissionPaid = async (id: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    if (!window.confirm(t('markPaidConfirm'))) return;
    setMarkingId(id);
    setCommissionError(null);
    try {
      const res = await fetch(`/api/admin/referrals/commissions/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'mark_paid' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommissionError(typeof j.error === 'string' ? j.error : t('markCommissionError'));
        return;
      }
      await loadCommissions();
    } catch (e) {
      setCommissionError(e instanceof Error ? e.message : t('markCommissionError'));
    } finally {
      setMarkingId(null);
    }
  };

  const exportCsv = () => {
    const header = 'referrer_name,referred_name,month,amount,status\n';
    const lines = commissions.map((c) => {
      const month = (c.period_month || '').slice(0, 7);
      const amt = String(c.commission_amount);
      const st = c.status ?? '';
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [esc(c.referrer_name), esc(c.referred_name), month, amt, esc(st)].join(',');
    });
    const blob = new Blob([header + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `referral-commissions-${commissionQuarter}-${commissionStatus}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusLabel = (row: CommissionRow): string => {
    const st = (row.status ?? '').toLowerCase();
    if (st === 'paid' && row.paid_at) {
      return `${t('statusPaidRow')} · ${formatDateTime(row.paid_at, locale)}`;
    }
    if (st === 'hold') return t('statusHold');
    if (st === 'withdrawable') return t('statusWithdrawable');
    if (st === 'forfeited') return t('statusForfeited');
    if (st === 'pending') return tStatus('pending');
    if (st === 'active') return tStatus('active');
    if (st === 'paid') return tStatus('paid');
    if (st === 'cancelled') return tStatus('cancelled');
    if (st === 'suspended') return tStatus('suspended');
    return row.status ?? '-';
  };

  const referralRowStatusLabel = (raw: string) => {
    const s = raw.toLowerCase();
    if (s === 'active') return tStatus('active');
    if (s === 'pending') return tStatus('pending');
    return raw;
  };

  return (
    <div className="flex flex-1 min-h-0 min-h-screen flex-col">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/referrals" />
        <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6 lg:ms-56">
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="rounded-lg p-1.5 hover:bg-[var(--color-surface-2)]"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5 text-[var(--color-text-primary)]" />
            </button>
            <Gift className="h-6 w-6 text-teal-600" aria-hidden />
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('pageTitle')}</h1>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMainTab('referrals')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                mainTab === 'referrals'
                  ? 'bg-teal-600 text-white'
                  : 'border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
              }`}
            >
              {t('tabReferrals')}
            </button>
            {isSuperAdmin ? (
              <button
                type="button"
                onClick={() => setMainTab('commissions')}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  mainTab === 'commissions'
                    ? 'bg-teal-600 text-white'
                    : 'border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                }`}
              >
                {t('tabCommissions')}
              </button>
            ) : null}
          </div>

          {mainTab === 'referrals' && (
            <>
              {referralsLoading ? (
                <p className="text-[var(--color-text-secondary)]">{tCommon('loading')}</p>
              ) : (
                <>
                  {/* ── Merged-Admin-Accounts §04, frame 1 · the programme ──────── */}
                  {program && (
                    <section className="mb-6 space-y-4">
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-center">
                        <p className="text-sm text-[var(--color-text-muted)]">{t('program.paidThisMonth')}</p>
                        <p className="mt-1 text-3xl font-bold text-[var(--color-text-primary)]">
                          {formatCurrency(program.paidThisMonth, locale)}
                        </p>
                        {program.paidGrowthPct != null && (
                          <p
                            className={`mt-1 text-sm font-medium ${
                              program.paidGrowthPct >= 0 ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {t('program.vsLastMonth', {
                              change: formatPercent(Math.abs(program.paidGrowthPct), locale),
                              direction: program.paidGrowthPct >= 0 ? '+' : '−',
                            })}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          {
                            k: 'activeReferrers',
                            v: formatNumber(program.activeReferrers, locale),
                            l: t('program.activeReferrers'),
                          },
                          {
                            k: 'newReferrals',
                            v: formatNumber(program.newReferralsThisMonth, locale),
                            l: t('program.newReferrals'),
                          },
                          { k: 'owedNow', v: formatCurrency(program.owedNow, locale), l: t('program.owedNow') },
                          {
                            k: 'paidMtd',
                            v: formatCurrency(program.paidThisMonth, locale),
                            l: t('program.paidMtd'),
                          },
                        ].map((s) => (
                          <div
                            key={s.k}
                            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3"
                          >
                            <p className="text-lg font-bold text-[var(--color-text-primary)]">{s.v}</p>
                            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{s.l}</p>
                          </div>
                        ))}
                      </div>

                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                          {t('program.tiersHeading')}
                        </h3>
                        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
                          {program.tiers.map((tier, i) => (
                            <div
                              key={tier.fromMonth}
                              className={`flex items-center gap-3 px-4 py-3 ${
                                i > 0 ? 'border-t border-[var(--color-border)]' : ''
                              }`}
                            >
                              <span className="w-14 shrink-0 text-base font-bold text-[var(--color-accent-deep)]">
                                {formatPercent(tier.ratePct, locale)}
                              </span>
                              <span className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)]">
                                {tier.toMonth === tier.fromMonth
                                  ? t('program.tierFirstMonth')
                                  : tier.toMonth == null
                                    ? t('program.tierFrom', {
                                        from: formatNumber(tier.fromMonth, locale),
                                      })
                                    : t('program.tierRange', {
                                        from: formatNumber(tier.fromMonth, locale),
                                        to: formatNumber(tier.toMonth, locale),
                                      })}
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
                          {t('program.tiersNote')}
                        </p>
                        {/*
                          The design's SIGNUP REWARD row — "New customer credit ·
                          100 EGP applied to the referred account" — is not here.
                          No column, no code path, no ledger entry exists for it
                          anywhere in the product. Omitted rather than invented.
                        */}
                      </div>
                    </section>
                  )}

                  {/* ── §04, frame 2 · top referrers ───────────────────────────── */}
                  <section className="mb-6 space-y-3">
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                      {t('topReferrers.title')}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'centers', 'teachers', 'owed'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setReferrerFilter(f)}
                          aria-pressed={referrerFilter === f}
                          className={`btn-press chq-focus min-h-[40px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                            referrerFilter === f
                              ? 'bg-teal-600 text-white'
                              : 'border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                          }`}
                        >
                          {t(`topReferrers.filter_${f}`)}
                        </button>
                      ))}
                    </div>

                    {filteredReferrers.length === 0 ? (
                      <EmptyState
                        icon={Users}
                        title={t('topReferrers.emptyTitle')}
                        description={t('topReferrers.emptyBody')}
                        alt={t('topReferrers.emptyAlt')}
                      />
                    ) : (
                      <div className="space-y-2">
                        {filteredReferrers.map((r) => (
                          <ListRow
                            key={`${r.kind}-${r.id}`}
                            avatar={initialsOf(r.name ?? '')}
                            title={r.name ?? tCommon('notSet')}
                            meta={t('topReferrers.rowMeta', {
                              referred: formatNumber(r.referred, locale),
                              active: formatNumber(r.active, locale),
                            })}
                            badge={
                              r.owed != null ? (
                                <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
                                  {t('topReferrers.owedBadge', { amount: formatCurrency(r.owed, locale) })}
                                </span>
                              ) : (
                                // A teacher referrer is paid in free months, never
                                // in cash — showing "0 owed" would read as a debt
                                // the model never creates.
                                <span className="shrink-0 text-sm font-semibold text-[var(--color-text-secondary)]">
                                  {t('topReferrers.freeMonthsBadge', {
                                    count: formatNumber(r.freeMonths ?? 0, locale),
                                  })}
                                </span>
                              )
                            }
                            chevron={false}
                          />
                        ))}
                      </div>
                    )}
                    <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {t('topReferrers.note')}
                    </p>
                  </section>

                  <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
                    {tAdmin('allReferrals')}
                  </h2>
                  <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden mb-6">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tAdmin('referrer')}
                            </th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tAdmin('referredCenter')}
                            </th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tAdmin('code')}
                            </th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tCommon('status')}
                            </th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tAdmin('createdDate')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border-subtle)]">
                          {adminReferrals.map((r) => (
                            <tr key={r.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                                {r.referrer_name}
                              </td>
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">{r.referred_name}</td>
                              <td className="py-3.5 px-4 font-mono text-sm text-[var(--color-text-primary)]">
                                {r.referral_code}
                              </td>
                              <td className="py-3.5 px-4">
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                    r.status === 'active'
                                      ? STATUS_STYLES.active
                                      : r.status === 'pending'
                                        ? STATUS_STYLES.pending
                                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'
                                  }`}
                                >
                                  {referralRowStatusLabel(r.status)}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                                {r.created_at ? formatDate(r.created_at, locale) : '-'}
                              </td>
                            </tr>
                          ))}
                          {adminReferrals.length === 0 && (
                            <tr>
                              <td colSpan={5} className="py-8 px-4 text-center text-[var(--color-text-secondary)]">
                                {tAdmin('noReferrals')}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <h3 className="font-semibold text-[var(--color-text-primary)] mb-3">{tAdmin('pendingPayouts')}</h3>
                  <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tAdmin('centerName')}
                            </th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tAdmin('code')}
                            </th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tAdmin('amountAvailable')}
                            </th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              {tCommon('actions')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border-subtle)]">
                          {adminPendingPayouts.map((p) => (
                            <tr key={p.center_id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                                {p.center_name}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-sm text-[var(--color-text-primary)]">{p.code}</td>
                              <td className="py-3.5 px-4 font-mono font-bold text-teal-600">
                                {formatCurrency(p.amount, locale)}
                              </td>
                              <td className="py-3.5 px-4">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const headers = await getAuthHeaders();
                                    if (!headers) return;
                                    setActionLoading(true);
                                    try {
                                      const res = await fetch('/api/admin/referrals', {
                                        method: 'POST',
                                        headers,
                                        body: JSON.stringify({ action: 'mark_paid', referrer_center_id: p.center_id }),
                                      });
                                      if (res.ok) await loadReferralsData();
                                      else alert((await res.json())?.error || 'Failed');
                                    } catch (e) {
                                      alert(e instanceof Error ? e.message : 'Failed');
                                    } finally {
                                      setActionLoading(false);
                                    }
                                  }}
                                  disabled={actionLoading}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  {tAdmin('markAsPaid')}
                                </button>
                              </td>
                            </tr>
                          ))}
                          {adminPendingPayouts.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-8 px-4 text-center text-[var(--color-text-secondary)]">
                                {tAdmin('noPendingPayouts')}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {mainTab === 'commissions' && isSuperAdmin && (
            <>
              {summary ? (
                <div className="mb-6 rounded-xl border border-teal-500/30 bg-teal-950/20 p-4">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                    {!summary.quarterAll && summary.quarter != null && summary.year != null
                      ? t('commissionSummaryTitle', {
                          quarter: formatPlainInteger(summary.quarter, locale),
                          year: formatPlainInteger(summary.year, locale),
                        })
                      : t('commissionSummaryAll')}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3 text-sm text-[var(--color-text-primary)]">
                    <p>
                      <span className="text-[var(--color-text-secondary)]">{t('totalOwed')}: </span>
                      <span className="font-mono font-semibold">
                        {formatCurrency(summary.totalOwed, locale)}
                      </span>
                    </p>
                    <p>
                      <span className="text-[var(--color-text-secondary)]">{t('totalPaid')}: </span>
                      <span className="font-mono font-semibold">
                        {formatCurrency(summary.totalPaid, locale)}
                      </span>
                    </p>
                    <p>
                      <span className="text-[var(--color-text-secondary)]">{t('referrersOwed')}: </span>
                      <span className="font-mono font-semibold">
                        {formatNumber(summary.referrersOwedCount, locale)}
                      </span>
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                    {t('filterStatus')}
                  </label>
                  <select
                    value={commissionStatus}
                    onChange={(e) => setCommissionStatus(e.target.value as 'all' | 'pending' | 'paid')}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  >
                    <option value="all">{tAdmin('filterAll')}</option>
                    <option value="pending">{tAdmin('filterPending')}</option>
                    <option value="paid">{t('filterPaid')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                    {t('filterQuarter')}
                  </label>
                  <select
                    value={commissionQuarter}
                    onChange={(e) => setCommissionQuarter(e.target.value)}
                    className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {qOpts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ms-auto">
                  <button
                    type="button"
                    onClick={exportCsv}
                    disabled={commissions.length === 0}
                    className="rounded-lg border border-[var(--color-border-default)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                  >
                    {tCommon('exportCsv')}
                  </button>
                </div>
              </div>

              {commissionError ? (
                <div
                  className="mb-4 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"
                  role="alert"
                >
                  {commissionError}
                </div>
              ) : null}

              {commissionsLoading ? (
                <p className="text-[var(--color-text-muted)]">{tCommon('loading')}</p>
              ) : commissions.length === 0 ? (
                <p className="text-[var(--color-text-muted)]">{t('emptyCommissions')}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
                  <table className="w-full min-w-[900px] border-collapse text-start text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                        <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('colReferrer')}</th>
                        <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('colReferred')}</th>
                        <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('colMonth')}</th>
                        <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('colRate')}</th>
                        <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('colAmount')}</th>
                        <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('colStatus')}</th>
                        <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('colAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.map((row, idx) => {
                        const prev = idx > 0 ? commissions[idx - 1] : null;
                        const showGroup = !prev || prev.referrer_center_id !== row.referrer_center_id;
                        return (
                          <Fragment key={row.id}>
                            {showGroup ? (
                              <tr className="bg-[var(--color-surface-2)]">
                                <td colSpan={7} className="px-3 py-2 text-xs font-bold text-[var(--color-text-secondary)]">
                                  {t('groupReferrer', { name: row.referrer_name })}
                                </td>
                              </tr>
                            ) : null}
                            <tr className="border-b border-[var(--color-border-subtle)]">
                              <td className="px-3 py-2 text-[var(--color-text-primary)]">{row.referrer_name}</td>
                              <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.referred_name}</td>
                              <td className="px-3 py-2 tabular-nums text-[var(--color-text-secondary)]">
                                {(row.period_month || '').slice(0, 7)}
                              </td>
                              <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatRatePct(row, locale)}</td>
                              <td className="px-3 py-2 font-mono tabular-nums text-[var(--color-text-primary)]">
                                {formatCurrency(row.commission_amount, locale)}
                              </td>
                              <td className="px-3 py-2 text-[var(--color-text-muted)]">{statusLabel(row)}</td>
                              <td className="px-3 py-2">
                                {row.status === 'withdrawable' ? (
                                  <button
                                    type="button"
                                    disabled={markingId === row.id}
                                    onClick={() => void patchMarkCommissionPaid(row.id)}
                                    className="rounded-lg bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                                  >
                                    {markingId === row.id ? tCommon('loading') : tAdmin('markAsPaid')}
                                  </button>
                                ) : (
                                  <span className="text-[var(--color-text-muted)]">-</span>
                                )}
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
