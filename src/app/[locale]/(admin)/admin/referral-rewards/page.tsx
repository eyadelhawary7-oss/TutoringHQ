'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Gift } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';

type EmbedCenter = {
  id: string;
  name: string;
  center_code: string | null;
  phone?: string | null;
  plan?: string | null;
} | null;

interface RewardRecord {
  id: string;
  referrer_center_id: string;
  referred_center_id: string;
  month_number: number;
  reward_percentage: number | string;
  base_amount: number | string;
  reward_amount: number | string;
  status: string;
  held_until: string | null;
  paid_at: string | null;
  period_month: string;
  created_at: string;
  referrer?: EmbedCenter | EmbedCenter[];
  referred?: EmbedCenter | EmbedCenter[];
}

interface ReferrerTotal {
  center_id: string;
  center_name: string;
  pending: number;
  paid: number;
  total_records: number;
}

function relCenter(x: EmbedCenter | EmbedCenter[] | null | undefined): EmbedCenter {
  if (x == null) return null;
  if (Array.isArray(x)) return x[0] ?? null;
  return x;
}

function canSelectForPay(r: RewardRecord): boolean {
  if (r.status === 'pending' || r.status === 'available') return true;
  if (r.status === 'held' && r.held_until) {
    return new Date(r.held_until).getTime() <= Date.now();
  }
  return false;
}

type ReferralRewardsErrorKey =
  | 'referralRewards.errors.unauthorized'
  | 'referralRewards.errors.config'
  | 'referralRewards.errors.listFailed'
  | 'referralRewards.errors.superAdminOnly'
  | 'referralRewards.errors.invalidBody'
  | 'referralRewards.errors.recordIdsRequired';

function isReferralRewardsErrorKey(k: string | undefined): k is ReferralRewardsErrorKey {
  return (
    k === 'referralRewards.errors.unauthorized' ||
    k === 'referralRewards.errors.config' ||
    k === 'referralRewards.errors.listFailed' ||
    k === 'referralRewards.errors.superAdminOnly' ||
    k === 'referralRewards.errors.invalidBody' ||
    k === 'referralRewards.errors.recordIdsRequired'
  );
}

export default function ReferralRewardsPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();
  const isRTL = locale === 'ar';

  const [gateOk, setGateOk] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [records, setRecords] = useState<RewardRecord[]>([]);
  const [totals, setTotals] = useState<ReferrerTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }, []);

  const translateError = useCallback(
    (payload: { errorKey?: string }) => {
      if (payload.errorKey && isReferralRewardsErrorKey(payload.errorKey)) {
        return t(payload.errorKey);
      }
      return t('loadError');
    },
    [t],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    const session = await getSession();
    if (!session?.access_token) {
      setRecords([]);
      setTotals([]);
      setLoading(false);
      return;
    }
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const q = params.toString();
    const res = await fetch(`/api/admin/referral-rewards${q ? `?${q}` : ''}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = (await res.json()) as {
      records?: RewardRecord[];
      totals?: ReferrerTotal[];
      errorKey?: string;
    };
    if (!res.ok) {
      setListError(translateError(data));
      setRecords([]);
      setTotals([]);
      setLoading(false);
      return;
    }
    setListError(null);
    setRecords(data.records ?? []);
    setTotals(data.totals ?? []);
    setLoading(false);
  }, [getSession, statusFilter, translateError]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    const gate = async () => {
      const session = await getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = (await res.json().catch(() => ({}))) as { isAdmin?: boolean; role?: string };
      if (!j?.isAdmin) {
        router.replace('/dashboard');
        return;
      }
      setIsSuperAdmin(j.role === 'super_admin');
      setGateOk(true);
    };
    void gate();
  }, [getSession, router]);

  useEffect(() => {
    if (!gateOk) return;
    void fetchData();
  }, [gateOk, fetchData]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter]);

  const toggleSelect = (id: string, r: RewardRecord) => {
    if (!canSelectForPay(r)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const statusLabel = (s: string) => {
    if (s === 'pending') return t('referralRewards.status_pending');
    if (s === 'held') return t('referralRewards.status_held');
    if (s === 'available') return t('referralRewards.status_available');
    if (s === 'paid') return t('referralRewards.status_paid');
    return s;
  };

  async function handleMarkPaid() {
    if (selectedIds.size === 0) return;
    setMarking(true);
    setMarkError(null);
    const session = await getSession();
    if (!session?.access_token) {
      setMarking(false);
      return;
    }
    const res = await fetch('/api/admin/referral-rewards', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ record_ids: Array.from(selectedIds) }),
    });
    const data = (await res.json()) as { errorKey?: string };
    if (!res.ok) {
      setMarkError(translateError(data));
      setMarking(false);
      return;
    }
    setSelectedIds(new Set());
    setMarking(false);
    void fetchData();
  }

  if (!gateOk) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 dark:text-slate-400">
        {tCommon('loading')}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeTab="referrals" activeRoute="/admin/referral-rewards" />

      <main className="lg:ms-56 p-6 space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
            <Gift className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
              {t('referralRewards.title')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('referralRewards.subtitle')}</p>
          </div>
        </div>

        {listError && !loading ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {listError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {(['all', 'pending', 'held', 'paid'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                statusFilter === s
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {s === 'all' ? t('referralRewards.filter_all') : t(`referralRewards.filter_${s}`)}
            </button>
          ))}
        </div>

        {isSuperAdmin ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('referralRewards.select_payable')}</p>
            <button
              type="button"
              onClick={() => void handleMarkPaid()}
              disabled={marking || selectedIds.size === 0}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {marking ? t('referralRewards.marking') : t('referralRewards.mark_paid')}
            </button>
            {markError ? (
              <span className="text-xs text-red-600 dark:text-red-400">{markError}</span>
            ) : null}
          </div>
        ) : null}

        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
            {t('referralRewards.totals_heading')}
          </h2>
          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">{tCommon('loading')}</div>
            ) : totals.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                {t('referralRewards.no_records')}
              </div>
            ) : (
              <table className="w-full text-sm min-w-[640px]">
                <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[var(--color-surface-2)]">
                  <tr className={`text-slate-500 dark:text-slate-400 ${isRTL ? 'text-end' : 'text-start'}`}>
                    <th className="px-4 py-3 font-medium">{t('referralRewards.col_referrer')}</th>
                    <th className="px-4 py-3 font-medium">{t('referralRewards.col_total_pending')}</th>
                    <th className="px-4 py-3 font-medium">{t('referralRewards.col_total_paid')}</th>
                    <th className="px-4 py-3 font-medium">{t('referralRewards.col_total_records')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                  {totals.map((row) => (
                    <tr key={row.center_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                        {row.center_name || '-'}
                      </td>
                      <td className="px-4 py-3 text-teal-600 dark:text-teal-400 font-mono">
                        {Number(row.pending).toLocaleString('en-US')} {t('staff.currency_suffix')}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-mono">
                        {Number(row.paid).toLocaleString('en-US')} {t('staff.currency_suffix')}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono">
                        {row.total_records.toLocaleString('en-US')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">{tCommon('loading')}</div>
          ) : records.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              {t('referralRewards.no_records')}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[var(--color-surface-2)]">
                <tr className={`text-slate-500 dark:text-slate-400 ${isRTL ? 'text-end' : 'text-start'}`}>
                  {isSuperAdmin ? (
                    <th className="px-4 py-3 font-medium w-10" aria-label={t('referralRewards.mark_paid')}>
                      <span className="sr-only">{t('referralRewards.mark_paid')}</span>
                    </th>
                  ) : null}
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_referrer')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_referred')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_month')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_rate')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_base')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_reward')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_period')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_status')}</th>
                  <th className="px-4 py-3 font-medium">{t('referralRewards.col_held_until')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {records.map((r) => {
                  const ref = relCenter(r.referrer);
                  const rec = relCenter(r.referred);
                  const pct = Number(r.reward_percentage) * 100;
                  const selectable = isSuperAdmin && canSelectForPay(r);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                      {isSuperAdmin ? (
                        <td className="px-4 py-3 align-middle">
                          <input
                            type="checkbox"
                            disabled={!selectable}
                            checked={selectedIds.has(r.id)}
                            onChange={() => toggleSelect(r.id, r)}
                            className="rounded border-slate-300 dark:border-slate-600 disabled:opacity-30"
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{ref?.name ?? '-'}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{ref?.center_code ?? ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{rec?.name ?? '-'}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {rec?.plan ?? ''} {rec?.center_code ? `· ${rec.center_code}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {r.month_number.toLocaleString('en-US')}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {pct.toLocaleString('en-US')}%
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {Number(r.base_amount).toLocaleString('en-US')} {t('staff.currency_suffix')}
                      </td>
                      <td className="px-4 py-3 font-mono text-teal-600 dark:text-teal-400 font-medium">
                        {Number(r.reward_amount).toLocaleString('en-US')} {t('staff.currency_suffix')}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.period_month}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-md text-xs bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {r.held_until
                          ? new Date(r.held_until).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
