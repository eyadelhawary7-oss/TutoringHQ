'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { Activity, ArrowLeft, AlertTriangle } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { formatDate, formatNumber } from '@/lib/formatNumber';

type CronRecentFailure = {
  ran_at: string;
  error_message: string | null;
  error_stack: string | null;
};

type CronStatus = {
  path: string;
  schedule: string;
  name: string;
  last_ran: string | null;
  last_status: 'success' | 'failure' | 'partial' | null;
  last_duration_ms: number | null;
  last_error: string | null;
  last_error_stack: string | null;
  recent_failures: CronRecentFailure[];
};

type HealthPayload = {
  paymob_mode: 'live' | 'sandbox';
  wa_mode: 'live' | 'test';
  active_centers: number;
  pending_signups: number;
  stuck_sessions: number;
  pending_cancellations: number;
  pending_withdrawals: number;
  zero_billing_centers: number;
  cron_status: CronStatus[];
};

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const FREQUENT_CRONS = new Set(['check-stuck-payments', 'status-ping']);

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const ADMIN_RAN_AT_OPTS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
};

function formatCronRanAt(iso: string | null, locale: string): string {
  if (!iso) return '-';
  try {
    return formatDate(iso, locale, ADMIN_RAN_AT_OPTS);
  } catch {
    return iso;
  }
}

export default function AdminHealthPage() {
  const t = useTranslations('admin');
  const tHealth = useTranslations('adminHealth');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();
  const isRTL = locale === 'ar';

  const [gateOk, setGateOk] = useState(false);
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [cronDetailRow, setCronDetailRow] = useState<CronStatus | null>(null);

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }, []);

  const fetchHealth = useCallback(
    async (opts?: { silent?: boolean }) => {
      const session = await getSession();
      if (!session?.access_token) return;
      const res = await fetch('/api/admin/health', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || t('healthLoadError'));
      }
      const json = (await res.json()) as HealthPayload;
      setData(json);
      setUpdatedAt(new Date());
      if (!opts?.silent) setError(null);
    },
    [getSession, t],
  );

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
      const j = await res.json().catch(() => ({}));
      if (!j?.isAdmin || j.role !== 'super_admin') {
        router.replace('/dashboard');
        return;
      }
      setGateOk(true);
    };
    void gate();
  }, [getSession, router]);

  useEffect(() => {
    if (!gateOk) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchHealth();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('healthLoadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [gateOk, fetchHealth, t]);

  useEffect(() => {
    if (!gateOk) return;
    const id = window.setInterval(() => {
      void fetchHealth({ silent: true }).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [gateOk, fetchHealth]);

  const isStaleFrequent = (row: CronStatus): boolean => {
    if (!row.last_ran || !FREQUENT_CRONS.has(row.name)) return false;
    return Date.now() - new Date(row.last_ran).getTime() > STALE_AFTER_MS;
  };

  if (!gateOk) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">
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
      <AdminSidebar activeTab="billing" activeRoute="/admin/health" />

      <main className="lg:ms-56 px-4 py-6 max-w-5xl mx-auto">
        <button
          type="button"
          onClick={() => router.push('/admin')}
          className="inline-flex items-center gap-2 text-sm text-teal-600 dark:text-teal-400 hover:underline mb-4"
        >
          <DirectionalIcon icon={ArrowLeft} className="h-4 w-4" />
          {t('healthBack')}
        </button>

        <div className="flex items-start gap-3 mb-1">
          <Activity className="h-8 w-8 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('healthTitle')}</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('healthSubtitle')}</p>
            {updatedAt ? (
              <p className="text-xs text-[var(--color-text-muted)] mt-2 font-mono" suppressHydrationWarning>
                {t('healthLastUpdated')}{' '}
                {formatDate(updatedAt, locale, ADMIN_RAN_AT_OPTS)}
              </p>
            ) : null}
          </div>
        </div>

        {loading && !data ? (
          <p className="text-[var(--color-text-muted)] mt-10">{tCommon('loading')}</p>
        ) : error && !data ? (
          <p className="text-red-600 dark:text-red-400 mt-10">{error}</p>
        ) : data ? (
          <div className="mt-8 space-y-10">
            <section className="flex flex-wrap gap-3">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
                  data.paymob_mode === 'live'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                }`}
              >
                {t('healthPaymob')}: {data.paymob_mode === 'live' ? 'LIVE' : 'SANDBOX'}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
                  data.wa_mode === 'live'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                }`}
              >
                {t('healthWhatsApp')}: {data.wa_mode === 'live' ? 'LIVE' : 'TEST'}
              </span>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                {t('healthQuickStats')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {(
                  [
                    {
                      label: t('healthActiveCenters'),
                      value: data.active_centers,
                      tone: 'neutral' as const,
                    },
                    {
                      label: t('healthPendingSignups'),
                      value: data.pending_signups,
                      tone: 'neutral' as const,
                    },
                    {
                      label: t('healthStuckPayments'),
                      value: data.stuck_sessions,
                      tone: 'alert' as const,
                    },
                    {
                      label: t('healthZeroBilling'),
                      value: data.zero_billing_centers,
                      tone: 'alert' as const,
                    },
                  ] as const
                ).map((c) => {
                  const bad = c.tone === 'alert' && c.value > 0;
                  const ok = c.tone === 'alert' && c.value === 0;
                  return (
                    <div
                      key={c.label}
                      className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 ${
                        bad
                          ? 'border-red-200 dark:border-red-500/40 bg-red-50 dark:bg-red-950/20'
                          : ok
                            ? 'border-green-200 dark:border-emerald-500/40 bg-green-50 dark:bg-emerald-950/20'
                            : ''
                      }`}
                    >
                      <p className="text-xs text-[var(--color-text-muted)] font-medium">{c.label}</p>
                      <p
                        className={`text-2xl font-bold font-mono mt-2 ${
                          bad
                            ? 'text-red-600 dark:text-red-400'
                            : ok
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-[var(--color-text-primary)]'
                        }`}
                      >
                        {formatNumber(Number(c.value), locale)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                {t('healthCronStatus')}
              </h2>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] overflow-x-auto">
                <table className="w-full text-sm text-start">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="p-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                        {t('healthColCron')}
                      </th>
                      <th className="p-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                        {t('healthColSchedule')}
                      </th>
                      <th className="p-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                        {t('healthColLastRun')}
                      </th>
                      <th className="p-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                        {t('healthColStatus')}
                      </th>
                      <th className="p-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                        {t('healthColDuration')}
                      </th>
                      <th className="p-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                        {t('health.lastError.columnHeader')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cron_status.map((row) => {
                      const failedLast = row.last_status === 'failure';
                      const errRow = failedLast && row.last_error != null && row.last_error !== '';
                      const stale = isStaleFrequent(row);
                      return (
                        <tr
                          key={row.path}
                          role="button"
                          tabIndex={0}
                          onClick={() => setCronDetailRow(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setCronDetailRow(row);
                            }
                          }}
                          className={`border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface-2)] cursor-pointer ${
                            errRow ? 'bg-red-50 dark:bg-red-950/35' : stale ? 'bg-amber-50 dark:bg-amber-950/20' : ''
                          }`}
                        >
                          <td className="p-3 font-mono text-[var(--color-text-primary)] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {failedLast ? (
                                <span
                                  className="inline-block h-2 w-2 rounded-full bg-red-600 dark:bg-red-400 shrink-0"
                                  title={tHealth('statusError')}
                                  aria-hidden
                                />
                              ) : null}
                              {row.path}
                              {stale ? (
                                <AlertTriangle
                                  className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
                                  aria-label={t('healthStaleCron')}
                                />
                              ) : null}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-[var(--color-text-secondary)] whitespace-nowrap">
                            {row.schedule}
                          </td>
                          <td className="p-3 whitespace-nowrap text-[var(--color-text-secondary)]">
                            {formatCronRanAt(row.last_ran, locale)}
                          </td>
                          <td className="p-3 text-[var(--color-text-primary)]">
                            {!row.last_status ? (
                              <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                                {tHealth('statusPending')}
                              </span>
                            ) : row.last_status === 'success' ? (
                              <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                ✓ {tHealth('statusSuccess')}
                              </span>
                            ) : row.last_status === 'failure' ? (
                              <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                ✗ {tHealth('statusError')}
                              </span>
                            ) : (
                              <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                ⚠ {tHealth('statusPartial')}
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-[var(--color-text-secondary)]">
                            {formatDuration(row.last_duration_ms)}
                          </td>
                          <td
                            className={`p-3 max-w-xs font-mono ${
                              row.last_error
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-[var(--color-text-secondary)]'
                            }`}
                          >
                            {(() => {
                              const errText = row.last_error?.trim() ?? '';
                              if (!errText) {
                                return <span className="font-sans">{t('health.lastError.empty')}</span>;
                              }
                              const truncated = errText.length > 80 ? `${errText.slice(0, 80)}…` : errText;
                              return (
                                <div className="flex flex-col gap-1 items-start">
                                  <span className="break-words whitespace-pre-wrap">{truncated}</span>
                                  {errText.length > 80 ? (
                                    <button
                                      type="button"
                                      className="text-xs font-sans font-medium text-teal-600 dark:text-teal-400 hover:underline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCronDetailRow(row);
                                      }}
                                    >
                                      {t('health.lastError.viewFull')}
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                {t('healthPendingActions')}
              </h2>
              <ul className="space-y-2 text-[var(--color-text-secondary)]">
                <li>
                  <Link
                    href="/admin"
                    className="text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-2"
                  >
                    {t('healthPendingCancellations')}{' '}
                    <span className="font-mono text-[var(--color-text-muted)]">({data.pending_cancellations})</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/withdrawals"
                    className="text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-2"
                  >
                    {t('healthPendingWithdrawals')}{' '}
                    <span className="font-mono text-[var(--color-text-muted)]">({data.pending_withdrawals})</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin"
                    className="text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-2"
                  >
                    {t('healthPendingSignupsLink')}{' '}
                    <span className="font-mono text-[var(--color-text-muted)]">({data.pending_signups})</span>
                  </Link>
                </li>
              </ul>
            </section>
          </div>
        ) : null}

        {cronDetailRow ? (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setCronDetailRow(null)}
            role="presentation"
          >
            <div
              className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-labelledby="cron-error-title"
            >
              <h2 id="cron-error-title" className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                {t('health.errorModal.title')}
              </h2>
              <p className="text-sm font-mono text-[var(--color-text-secondary)] mb-4">{cronDetailRow.path}</p>

              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                {t('health.errorModal.stackHeading')}
              </h3>
              {cronDetailRow.last_error_stack?.trim() ? (
                <pre className="text-xs whitespace-pre-wrap break-words font-mono text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg p-3 mb-6">
                  {cronDetailRow.last_error_stack}
                </pre>
              ) : (
                <p className="text-sm text-[var(--color-text-secondary)] mb-6">{t('health.errorModal.noStack')}</p>
              )}

              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                {t('health.errorModal.recentErrorsHeading')}
              </h3>
              {cronDetailRow.recent_failures.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                  {t('health.errorModal.noRecentFailures')}
                </p>
              ) : (
                <ul className="space-y-3 mb-4">
                  {cronDetailRow.recent_failures.map((f, idx) => (
                    <li
                      key={`recent-fail-${idx}-${f.ran_at}`}
                      className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-0)]"
                    >
                      <p className="text-xs text-[var(--color-text-secondary)] font-mono mb-1">
                        {formatCronRanAt(f.ran_at, locale)}
                      </p>
                      {f.error_message ? (
                        <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">
                          {f.error_message}
                        </p>
                      ) : null}
                      {f.error_stack?.trim() ? (
                        <pre className="mt-2 text-[10px] whitespace-pre-wrap break-words font-mono text-[var(--color-text-secondary)] max-h-32 overflow-y-auto">
                          {f.error_stack}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                className="mt-2 w-full py-2 rounded-lg bg-[var(--color-surface-2)] text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
                onClick={() => setCronDetailRow(null)}
              >
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
