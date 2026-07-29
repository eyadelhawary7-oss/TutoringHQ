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
import { formatCurrency, formatDateTime, formatNumber, formatPlainInteger } from '@/lib/formatNumber';
import { ArrowLeft, Wallet } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
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
              className="rounded-lg p-1.5 hover:bg-[var(--color-surface-2)]"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5 text-[var(--color-text-primary)]" />
            </button>
            <Wallet className="h-6 w-6 text-teal-600" aria-hidden />
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
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
                    : 'border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
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
            <div className="mb-6 rounded-xl border border-teal-500/30 bg-teal-950/20 p-4">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('summary', {
                  quarter: formatPlainInteger(quarter, locale),
                  year: String(year),
                  count: formatNumber(summaryCount, locale),
                  sum: formatCurrency(summarySum, locale),
                })}
              </p>
            </div>
          ) : null}

          {loading ? (
            <p className="text-[var(--color-text-muted)]">{tCommon('loading')}</p>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">{tAdmin('noWithdrawals')}</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
              <table className="w-full min-w-[880px] border-collapse text-start text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                    <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                      {t('colCenter')}
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                      {t('colCredits')}
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                      {t('colCash')}
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                      {t('colInstapay')}
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                      {t('colRequested')}
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                      {tAdmin('status')}
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
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
                        className="border-b border-[var(--color-border-subtle)]"
                      >
                        <td className="px-3 py-2 text-[var(--color-text-primary)]">
                          {r.center_name ?? '-'}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--color-text-primary)]">
                          {formatNumber(r.credits_deducted, locale)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--color-text-primary)]">
                          {formatNumber(r.cash_amount, locale)} {tCommon('egp')}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-secondary)]" dir="ltr">
                          {r.instapay_number ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {r.requested_at
                            ? formatDateTime(r.requested_at, locale)
                            : '-'}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                          {st === 'paid' && r.processed_at
                            ? `${t('statusPaid')} · ${formatDateTime(r.processed_at, locale)}`
                            : st === 'rejected' && r.processed_at
                              ? `${t('statusRejected')} · ${formatDateTime(r.processed_at, locale)}`
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
                                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
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
                                className="rounded-lg border-2 border-red-500 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-950/30 disabled:opacity-50"
                              >
                                {t('reject')}
                              </button>
                            </div>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">-</span>
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
