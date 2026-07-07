'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/formatNumber';
import { CheckCircle, AlertTriangle, XCircle, RefreshCw, Loader2 } from 'lucide-react';

const SERVICES = [
  { key: 'api', labelAr: 'واجهة البرمجة', labelEn: 'API' },
  { key: 'scanner', labelAr: 'الماسح', labelEn: 'Scanner' },
  { key: 'payments', labelAr: 'المدفوعات', labelEn: 'Payments' },
] as const;

type Status = 'operational' | 'degraded' | 'outage' | 'unknown';

interface StatusData {
  overall: Status;
  services: Record<string, { status: string; response_time_ms: number | null; checked_at: string }>;
  uptime_90d: Record<string, Record<string, Status>>;
  incidents: { id: string; title: string; severity: string; started_at: string; resolved_at: string | null; services_affected: string[] }[];
}

function StatusIcon({ status }: { status: Status }) {
  switch (status) {
    case 'operational':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'degraded':
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    case 'outage':
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <AlertTriangle className="h-5 w-5 text-[var(--color-text-muted)]" />;
  }
}

function StatusLabel({ status, locale }: { status: Status; locale: string }) {
  const labels: Record<Status, { ar: string; en: string }> = {
    operational: { ar: 'يعمل', en: 'Operational' },
    degraded: { ar: 'تدهور', en: 'Degraded' },
    outage: { ar: 'تعطل', en: 'Outage' },
    unknown: { ar: 'غير معروف', en: 'Unknown' },
  };
  return locale === 'ar' ? labels[status].ar : labels[status].en;
}

/** Share of days in `uptime_90d` where the service was fully operational (vs total days in range). */
function computeUptimePercent90d(
  uptime90d: Record<string, Record<string, Status>>,
  serviceKey: string,
): number {
  const dayKeys = Object.keys(uptime90d).sort();
  if (dayKeys.length === 0) return 0;
  let operationalDays = 0;
  for (const day of dayKeys) {
    if (uptime90d[day]?.[serviceKey] === 'operational') operationalDays += 1;
  }
  return (operationalDays / dayKeys.length) * 100;
}

/** Uptime % for UI; em dash when there is no day-level history yet. */
function formatUptime90dPercent(
  uptime90d: Record<string, Record<string, Status>> | undefined,
  serviceKey: string,
  locale: string,
): string {
  const dayKeys = Object.keys(uptime90d ?? {});
  if (dayKeys.length === 0) return ',';
  return formatPercent(computeUptimePercent90d(uptime90d ?? {}, serviceKey), locale);
}

export default function StatusPage() {
  const locale = useLocale();
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const isRTL = locale === 'ar';
  const pickLocale = (ar: string, en: string) => (locale === 'ar' ? ar : en);

  if (loading && !data) {
    return (
      <div
        className="chq-page min-h-screen flex flex-col bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <header className="bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            TutoringHQ - {pickLocale('حالة المنصة', 'Platform Status')}
          </h1>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        </div>
      </div>
    );
  }

  const d = data ?? {
    overall: 'unknown' as Status,
    services: {},
    uptime_90d: {},
    incidents: [],
  };

  const dayKeys = Object.keys(d.uptime_90d ?? {}).sort();

  return (
    <div
      className="chq-page min-h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <header className="bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] px-6 py-4">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
          TutoringHQ - {pickLocale('حالة المنصة', 'Platform Status')}
        </h1>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <StatusIcon status={d.overall as Status} />
          <span className="text-[var(--color-text-secondary)]">
            {StatusLabel({ status: d.overall as Status, locale })}
          </span>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1.5 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-8">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm">
            {error}
          </div>
        )}

        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            {pickLocale('خدمات النظام', 'System Services')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {SERVICES.map(({ key, labelAr, labelEn }) => {
              const svc = d.services[key];
              const status = (svc?.status ?? 'unknown') as Status;
              return (
                <div
                  key={key}
                  className="bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border-subtle)] p-4 flex items-center justify-between"
                >
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {locale === 'ar' ? labelAr : labelEn}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap justify-end min-w-0">
                    <StatusIcon status={status} />
                    <span className="text-sm tabular-nums text-[var(--color-text-primary)] font-medium shrink-0">
                      {formatUptime90dPercent(d.uptime_90d, key, locale)}
                    </span>
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {StatusLabel({ status, locale })}
                    </span>
                    {svc?.response_time_ms != null && (
                      <span className="text-xs text-[var(--color-text-muted)]">{svc.response_time_ms}ms</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            {locale === 'ar'
              ? `سجل الرفعية ${formatNumber(90, locale)} يوم`
              : '90-Day Uptime History'}
          </h2>
          <div className="bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border-subtle)] p-4 overflow-x-auto">
            <div className="flex gap-0.5 min-w-max">
              {dayKeys.map((day) => (
                <div key={day} className="flex flex-col gap-0.5" title={day}>
                  {SERVICES.map(({ key, labelAr, labelEn }) => {
                    const s = (d.uptime_90d?.[day]?.[key] ?? 'unknown') as Status;
                    const color =
                      s === 'operational'
                        ? 'bg-green-500'
                        : s === 'degraded'
                          ? 'bg-amber-500'
                          : s === 'outage'
                            ? 'bg-red-500'
                            : 'bg-[var(--color-border-subtle)]';
                    return (
                      <div
                        key={`${day}-${key}`}
                        className={`w-2 h-2 rounded-sm shrink-0 ${color}`}
                        title={`${day} · ${pickLocale(labelAr, labelEn)} · ${StatusLabel({ status: s, locale })}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-[var(--color-text-primary)]">
              {SERVICES.map(({ key, labelAr, labelEn }) => (
                <span key={key} className="inline-flex items-center gap-2">
                  <span className="font-medium">{locale === 'ar' ? labelAr : labelEn}</span>
                  <span className="tabular-nums text-[var(--color-text-secondary)] shrink-0">
                    {formatUptime90dPercent(d.uptime_90d, key, locale)}
                  </span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 mt-3 text-xs text-[var(--color-text-secondary)]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-green-500" />
                {pickLocale('يعمل', 'Operational')}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-amber-500" />
                {pickLocale('تدهور', 'Degraded')}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-red-500" />
                {pickLocale('تعطل', 'Outage')}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-[var(--color-border-subtle)]" />
                {pickLocale('لا بيانات', 'No data')}
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            {locale === 'ar' ? `آخر ${formatNumber(5, locale)} حوادث` : 'Last 5 Incidents'}
          </h2>
          <div className="bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)]">
            {d.incidents.length === 0 ? (
              <p className="p-6 text-[var(--color-text-secondary)] text-center">
                {pickLocale('لا توجد حوادث مسجلة', 'No incidents recorded')}
              </p>
            ) : (
              d.incidents.map((inc) => (
                <div key={inc.id} className="p-4 flex justify-between items-start">
                  <div>
                    <p className="font-medium text-[var(--color-text-primary)]">{inc.title}</p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {formatDateTime(inc.started_at, locale)}
                      {inc.resolved_at && (
                        <> - {pickLocale('تم الحل', 'Resolved')} {formatDateTime(inc.resolved_at, locale)}</>
                      )}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${inc.severity === 'critical' ? 'bg-destructive/15 text-destructive' : inc.severity === 'major' ? 'bg-amber-500/15 text-amber-700' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'}`}
                  >
                    {inc.severity}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
