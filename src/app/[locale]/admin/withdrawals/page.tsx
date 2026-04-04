'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { ArrowLeft, Wallet } from 'lucide-react';
import { getTodayCairo } from '@/lib/cairoBillingCalendar';

type WithdrawalRow = {
  id: string;
  center_id: string;
  center_name: string | null;
  credits_deducted: number;
  cash_amount: number;
  fee_amount: number;
  instapay_number: string | null;
  status: string | null;
  requested_at: string | null;
  processed_at: string | null;
  processed_by: string | null;
  notes: string | null;
};

function cairoQuarterYear(ymd: string): { quarter: number; year: number } {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(5, 7), 10);
  const quarter = Math.floor((m - 1) / 3) + 1;
  return { quarter, year: y };
}

export default function AdminWithdrawalsPage() {
  const t = useTranslations('admin.withdrawalsPage');
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [tab, setTab] = useState<'pending' | 'paid' | 'rejected'>('pending');
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    const session = await getSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/withdrawals?status=${tab}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(typeof j.error === 'string' ? j.error : t('loadError'));
        return;
      }
      const data = (await res.json()) as { withdrawals?: WithdrawalRow[] };
      setRows(data.withdrawals ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [getSession, router, tab, t]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    void load();
  }, [load]);

  const todayCairo = getTodayCairo();
  const { quarter, year } = cairoQuarterYear(todayCairo);
  const summaryCount = tab === 'pending' ? rows.length : 0;
  const summarySum = tab === 'pending' ? rows.reduce((s, r) => s + r.cash_amount, 0) : 0;

  const patchWithdrawal = async (id: string, action: 'mark_paid' | 'reject') => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : t('actionError'));
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('actionError'));
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 min-h-screen flex-col">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/withdrawals" />
        <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6 lg:ms-56">
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="rounded-lg p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700"
              aria-label={tCommon('back')}
            >
              <ArrowLeft size={20} className="text-slate-800 dark:text-slate-100" />
            </button>
            <Wallet className="h-6 w-6 text-teal-600 dark:text-teal-400" aria-hidden />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('title')}</h1>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {(['pending', 'paid', 'rejected'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === k
                    ? 'bg-teal-600 text-white'
                    : 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {t(`tab_${k}`)}
              </button>
            ))}
          </div>

          {error ? (
            <div
              className="mb-4 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {tab === 'pending' && !loading ? (
            <div className="mb-6 rounded-xl border border-teal-500/30 bg-teal-950/20 p-4 dark:bg-teal-950/30">
              <p className="text-sm font-medium text-slate-800 dark:text-teal-100">
                {t('summary', {
                  quarter: String(quarter),
                  year: String(year),
                  count: summaryCount.toLocaleString('en-US'),
                  sum: summarySum.toLocaleString('en-US'),
                })}
              </p>
            </div>
          ) : null}

          {loading ? (
            <p className="text-slate-500 dark:text-slate-400">{tCommon('loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[880px] border-collapse text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {t('colCenter')}
                    </th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {t('colCredits')}
                    </th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {t('colCash')}
                    </th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {t('colInstapay')}
                    </th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {t('colRequested')}
                    </th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {tAdmin('status')}
                    </th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {t('colActions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = (r.status ?? '').toLowerCase();
                    const pending = st === 'pending';
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-slate-100 dark:border-slate-700/80"
                      >
                        <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                          {r.center_name ?? '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-800 dark:text-slate-200">
                          {r.credits_deducted.toLocaleString('en-US')}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-800 dark:text-slate-200">
                          {r.cash_amount.toLocaleString('en-US')} {tCommon('egp')}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300" dir="ltr">
                          {r.instapay_number ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                          {r.requested_at
                            ? new Date(r.requested_at).toLocaleString(
                                locale === 'ar' ? 'ar-EG' : 'en-US',
                              )
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                          {st === 'paid' && r.processed_at
                            ? `${t('statusPaid')} · ${new Date(r.processed_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}`
                            : st === 'rejected' && r.processed_at
                              ? `${t('statusRejected')} · ${new Date(r.processed_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}`
                              : t('statusPending')}
                        </td>
                        <td className="px-3 py-2">
                          {pending ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={actionId === r.id}
                                onClick={() => {
                                  if (!window.confirm(t('confirmPaid'))) return;
                                  void patchWithdrawal(r.id, 'mark_paid');
                                }}
                                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                              >
                                {actionId === r.id ? tCommon('loading') : t('markPaid')}
                              </button>
                              <button
                                type="button"
                                disabled={actionId === r.id}
                                onClick={() => {
                                  if (!window.confirm(t('confirmReject'))) return;
                                  void patchWithdrawal(r.id, 'reject');
                                }}
                                className="rounded-lg border-2 border-red-500 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-950/30 dark:text-red-400 disabled:opacity-50"
                              >
                                {t('reject')}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
