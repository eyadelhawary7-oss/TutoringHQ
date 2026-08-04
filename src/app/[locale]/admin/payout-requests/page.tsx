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
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/formatNumber';
import { ArrowLeft, Banknote } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';

/**
 * Admin approval queue for referral payout requests — PAYOUT-SYSTEM-SPEC §2.1.
 *
 * Before this page existed there was no screen anywhere that read
 * `payout_requests` for approval, so a centre's request sat at 'pending'
 * forever with nobody able to see it, let alone act on it.
 *
 * Modelled on /admin/withdrawals (same shell, tabs, table and CSRF header
 * helper) so the two money queues read the same way.
 */

type PayoutRow = {
  id: string;
  center_id: string;
  center_name: string | null;
  amount_requested: number;
  status: string | null;
  payment_method: string | null;
  requested_at: string | null;
  processed_at: string | null;
  instapay_number: string | null;
  gross_amount: number | null;
  processing_fee: number | null;
  withdrawal_fee: number | null;
  net_amount: number | null;
  available_rewards: number;
  committed_elsewhere: number;
};

type PayoutAction = 'approve' | 'reject' | 'mark_paid';

const TABS = ['pending', 'approved', 'paid', 'rejected'] as const;
type Tab = (typeof TABS)[number];

export default function AdminPayoutRequestsPage() {
  const t = useTranslations('admin.payoutRequestsPage');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set when the API reports the approval migration is not applied yet. */
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
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
    Object.assign(headers, await getCsrfHeaders(session.access_token));
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
      const res = await fetch(`/api/admin/payout-requests?status=${tab}`, {
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
      const data = (await res.json()) as { payoutRequests?: PayoutRow[] };
      setRows(data.payoutRequests ?? []);
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

  const patchPayout = async (id: string, action: PayoutAction, reason?: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payout-requests/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(reason ? { action, reason } : { action }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        migration?: string;
      };
      if (!res.ok) {
        if (j.code === 'payout_approval_migration_not_applied') {
          // Fail visibly rather than pretending the click did something.
          setMigrationNotice(j.migration ?? t('migrationMissingFallback'));
          return;
        }
        setError(typeof j.error === 'string' ? j.error : t('actionError'));
        return;
      }
      setMigrationNotice(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('actionError'));
    } finally {
      setActionId(null);
    }
  };

  /*
   * The pending summary is labelled "net", so it must contain only net figures.
   *
   * `net_amount` is read out of `payout_requests.payment_details`, which is a
   * nullable jsonb column with no shape constraint. Rows written before
   * /api/referrals/payout started snapshotting the breakdown — or by anything
   * that ever inserts directly — have no `net_amount` at all. The previous
   * version fell back to `amount_requested`, i.e. the GROSS, folding a figure
   * that still includes the 20 EGP processing fee and the 5% withdrawal fee
   * into a total presented to the CEO as net. It overstates what leaves the
   * bank, silently, and only for the rows least likely to be looked at.
   *
   * Rows without a stored net are therefore EXCLUDED from the total and
   * counted separately, so the number stays true and the gap stays visible.
   */
  const pendingRows = tab === 'pending' ? rows : [];
  const pendingCount = pendingRows.length;
  const netRows = pendingRows.filter((r) => r.net_amount !== null);
  const pendingNetSum = netRows.reduce((s, r) => s + (r.net_amount ?? 0), 0);
  const missingNetCount = pendingCount - netRows.length;

  return (
    <div className="flex flex-1 min-h-0 min-h-screen flex-col">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/payout-requests" />
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
            <Banknote className="h-6 w-6 text-teal-600" aria-hidden />
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          </div>

          <p className="mb-4 max-w-3xl text-sm text-[var(--color-text-muted)]">{t('intro')}</p>

          <div className="mb-4 flex flex-wrap gap-2">
            {TABS.map((k) => (
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

          {migrationNotice ? (
            <div
              className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200"
              role="alert"
            >
              <p className="font-semibold">{t('migrationMissingTitle')}</p>
              <p className="mt-1">{t('migrationMissingBody')}</p>
              <p className="mt-1 font-mono text-xs break-all" dir="ltr">
                {migrationNotice}
              </p>
            </div>
          ) : null}

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
                  count: formatNumber(pendingCount, locale),
                  sum: formatCurrency(pendingNetSum, locale),
                })}
              </p>
              {missingNetCount > 0 ? (
                <p className="mt-1 text-xs text-amber-300">
                  {t('summaryMissingNet', {
                    count: formatNumber(missingNetCount, locale),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {loading ? (
            <p className="text-[var(--color-text-muted)]">{tCommon('loading')}</p>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-[var(--color-text-muted)]">{t('empty')}</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
              <table className="w-full min-w-[980px] border-collapse text-start text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                    {[
                      'colCenter',
                      'colGross',
                      'colFees',
                      'colNet',
                      'colCoverage',
                      'colInstapay',
                      'colRequested',
                      'colStatus',
                      'colActions',
                    ].map((k) => (
                      <th
                        key={k}
                        className="px-3 py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]"
                      >
                        {t(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = (r.status ?? '').toLowerCase();
                    const isPending = st === 'pending';
                    const isApproved = st === 'approved';
                    const busy = actionId === r.id;
                    const fees = (r.processing_fee ?? 0) + (r.withdrawal_fee ?? 0);
                    /*
                     * Coverage must be read NET OF COMMITMENTS, and the
                     * approver has to be able to see the commitment.
                     *
                     * `available_rewards` alone does not fall when a payout is
                     * approved or paid — the reward records are not consumed by
                     * either. So a request that is entirely a re-draw of money
                     * the centre has already been paid renders identically to a
                     * first, fully-covered request: same green number, same
                     * enabled Approve button. The approver's own screen was the
                     * thing hiding it.
                     *
                     * Subtracting `committed_elsewhere` — the centre's other
                     * requests in status 'approved' OR 'paid' — is the same
                     * arithmetic the RPC guard performs, so the badge here
                     * predicts the refusal there instead of contradicting it.
                     */
                    const netAvailable = r.available_rewards - r.committed_elsewhere;
                    const uncovered = netAvailable < r.amount_requested;
                    const hasCommitments = r.committed_elsewhere > 0;
                    return (
                      <tr key={r.id} className="border-b border-[var(--color-border-subtle)]">
                        <td className="px-3 py-2 text-[var(--color-text-primary)]">
                          {r.center_name ?? '-'}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--color-text-primary)]">
                          {formatNumber(r.gross_amount ?? r.amount_requested, locale)}{' '}
                          {tCommon('egp')}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--color-text-secondary)]">
                          {formatNumber(fees, locale)}
                        </td>
                        <td className="px-3 py-2 tabular-nums font-semibold text-[var(--color-text-primary)]">
                          {r.net_amount === null ? '-' : formatNumber(r.net_amount, locale)}
                        </td>
                        <td
                          className={`px-3 py-2 tabular-nums ${
                            uncovered ? 'text-red-400' : 'text-[var(--color-text-secondary)]'
                          }`}
                        >
                          <div>{formatNumber(r.available_rewards, locale)}</div>
                          {hasCommitments ? (
                            <>
                              <div className="text-xs text-[var(--color-text-muted)]">
                                {t('committedElsewhere', {
                                  amount: formatNumber(r.committed_elsewhere, locale),
                                })}
                              </div>
                              <div className="text-xs font-semibold">
                                {t('netAvailable', {
                                  amount: formatNumber(netAvailable, locale),
                                })}
                              </div>
                            </>
                          ) : null}
                          {uncovered ? (
                            <div className="text-xs font-semibold">{t('uncovered')}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-secondary)]" dir="ltr">
                          {r.instapay_number ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {r.requested_at ? formatDateTime(r.requested_at, locale) : '-'}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                          {t(`status_${st || 'pending'}`)}
                          {r.processed_at ? ` · ${formatDateTime(r.processed_at, locale)}` : ''}
                        </td>
                        <td className="px-3 py-2">
                          {isPending || isApproved ? (
                            <div className="flex flex-wrap gap-2">
                              {isPending ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    if (!window.confirm(t('confirmApprove'))) return;
                                    void patchPayout(r.id, 'approve');
                                  }}
                                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                                >
                                  {busy ? tCommon('loading') : t('approve')}
                                </button>
                              ) : null}
                              {isApproved ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    if (!window.confirm(t('confirmMarkPaid'))) return;
                                    void patchPayout(r.id, 'mark_paid');
                                  }}
                                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                                >
                                  {busy ? tCommon('loading') : t('markPaid')}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  const reason = window.prompt(t('rejectReasonPrompt')) ?? '';
                                  if (!reason.trim()) return;
                                  void patchPayout(r.id, 'reject', reason.trim());
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
