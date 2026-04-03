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

type CronStatus = {
  name: string;
  last_ran: string | null;
  last_status: 'success' | 'failure' | 'partial' | null;
  last_duration_ms: number | null;
  last_error: string | null;
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
const FREQUENT_CRONS = new Set(['check-stuck-payments']);

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatRanAt(iso: string | null, locale: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

export default function AdminHealthPage() {
  const t = useTranslations('admin');
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
      <div className="min-h-screen flex items-center justify-center text-slate-500 dark:text-slate-400">
        {tCommon('loading')}
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeTab="billing" activeRoute="/admin/health" />

      <main className="lg:ms-56 pt-14 lg:pt-0 px-4 py-6 max-w-5xl mx-auto">
        <button
          type="button"
          onClick={() => router.push('/admin')}
          className="inline-flex items-center gap-2 text-sm text-teal-400 hover:underline mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('healthBack')}
        </button>

        <div className="flex items-start gap-3 mb-1">
          <Activity className="h-8 w-8 text-teal-400 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('healthTitle')}</h1>
            <p className="text-sm text-slate-400 mt-1">{t('healthSubtitle')}</p>
            {updatedAt ? (
              <p className="text-xs text-slate-500 mt-2 font-mono" suppressHydrationWarning>
                {t('healthLastUpdated')}{' '}
                {updatedAt.toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
                  timeStyle: 'medium',
                })}
              </p>
            ) : null}
          </div>
        </div>

        {loading && !data ? (
          <p className="text-slate-500 mt-10">{tCommon('loading')}</p>
        ) : error && !data ? (
          <p className="text-red-400 mt-10">{error}</p>
        ) : data ? (
          <div className="mt-8 space-y-10">
            <section className="flex flex-wrap gap-3">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
                  data.paymob_mode === 'live'
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                }`}
              >
                {t('healthPaymob')}: {data.paymob_mode === 'live' ? 'LIVE' : 'SANDBOX'}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
                  data.wa_mode === 'live'
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                }`}
              >
                {t('healthWhatsApp')}: {data.wa_mode === 'live' ? 'LIVE' : 'TEST'}
              </span>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
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
                      className={`rounded-xl border p-4 ${
                        bad
                          ? 'border-red-500/50 bg-red-950/30'
                          : ok
                            ? 'border-emerald-500/40 bg-emerald-950/20'
                            : 'border-slate-700 bg-slate-900/80'
                      }`}
                    >
                      <p className="text-xs text-slate-400 font-medium">{c.label}</p>
                      <p
                        className={`text-2xl font-bold font-mono mt-2 ${
                          bad ? 'text-red-300' : ok ? 'text-emerald-400' : 'text-slate-100'
                        }`}
                      >
                        {c.value}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
                {t('healthCronStatus')}
              </h2>
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="p-3 font-medium">{t('healthColCron')}</th>
                      <th className="p-3 font-medium">{t('healthColLastRun')}</th>
                      <th className="p-3 font-medium">{t('healthColStatus')}</th>
                      <th className="p-3 font-medium">{t('healthColDuration')}</th>
                      <th className="p-3 font-medium">{t('healthColError')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cron_status.map((row) => {
                      const errRow = row.last_error != null && row.last_error !== '';
                      const stale = isStaleFrequent(row);
                      return (
                        <tr
                          key={row.name}
                          className={`border-b border-slate-800 last:border-0 ${
                            errRow ? 'bg-red-950/35' : stale ? 'bg-amber-950/20' : ''
                          }`}
                        >
                          <td className="p-3 font-mono text-slate-200 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {row.name}
                              {stale ? (
                                <AlertTriangle
                                  className="h-4 w-4 text-amber-400 shrink-0"
                                  aria-label={t('healthStaleCron')}
                                />
                              ) : null}
                            </span>
                          </td>
                          <td className="p-3 text-slate-300 whitespace-nowrap">
                            {formatRanAt(row.last_ran, locale)}
                          </td>
                          <td className="p-3">
                            {!row.last_status ? (
                              <span className="text-slate-500">—</span>
                            ) : row.last_status === 'success' ? (
                              <span className="text-emerald-400 font-medium">✓ success</span>
                            ) : row.last_status === 'failure' ? (
                              <span className="text-red-400 font-medium">✗ failure</span>
                            ) : (
                              <span className="text-amber-400 font-medium">⚠ partial</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400 font-mono">
                            {formatDuration(row.last_duration_ms)}
                          </td>
                          <td className="p-3 text-red-300/90 max-w-xs truncate" title={row.last_error ?? ''}>
                            {row.last_error ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
                {t('healthPendingActions')}
              </h2>
              <ul className="space-y-2 text-slate-300">
                <li>
                  <Link
                    href="/admin"
                    className="text-teal-400 hover:underline inline-flex items-center gap-2"
                  >
                    {t('healthPendingCancellations')}{' '}
                    <span className="font-mono text-slate-400">({data.pending_cancellations})</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/withdrawals"
                    className="text-teal-400 hover:underline inline-flex items-center gap-2"
                  >
                    {t('healthPendingWithdrawals')}{' '}
                    <span className="font-mono text-slate-400">({data.pending_withdrawals})</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin"
                    className="text-teal-400 hover:underline inline-flex items-center gap-2"
                  >
                    {t('healthPendingSignupsLink')}{' '}
                    <span className="font-mono text-slate-400">({data.pending_signups})</span>
                  </Link>
                </li>
              </ul>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
