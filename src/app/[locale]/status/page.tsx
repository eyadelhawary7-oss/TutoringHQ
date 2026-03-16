'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';
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
      return <AlertTriangle className="h-5 w-5 text-slate-400" />;
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
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
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
    <div className="min-h-screen bg-slate-50" dir={isRTL ? 'rtl' : 'ltr'}>
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-xl font-bold text-slate-900">
          CenterHQ — {t('حالة المنصة', 'Platform Status')}
        </h1>
        <div className="flex items-center gap-3 mt-2">
          <StatusIcon status={d.overall as Status} />
          <span className="text-slate-600">
            {StatusLabel({ status: d.overall as Status, locale })}
          </span>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-8">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
            {error}
          </div>
        )}

        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {t('خدمات النظام', 'System Services')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {SERVICES.map(({ key, labelAr, labelEn }) => {
              const svc = d.services[key];
              const status = (svc?.status ?? 'unknown') as Status;
              return (
                <div
                  key={key}
                  className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between"
                >
                  <span className="font-medium text-slate-700">
                    {locale === 'ar' ? labelAr : labelEn}
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusIcon status={status} />
                    <span className="text-sm text-slate-600">
                      {StatusLabel({ status, locale })}
                    </span>
                    {svc?.response_time_ms != null && (
                      <span className="text-xs text-slate-400">
                        {svc.response_time_ms}ms
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {t('سجل الرفعية ٩٠ يوم', '90-Day Uptime History')}
          </h2>
          <div className="bg-white rounded-lg border border-slate-200 p-4 overflow-x-auto">
            <div className="flex gap-0.5 min-w-max">
              {dayKeys.map((day) => (
                <div key={day} className="flex flex-col gap-0.5" title={day}>
                  {SERVICES.map(({ key }) => {
                    const s = (d.uptime_90d?.[day]?.[key] ?? 'unknown') as Status;
                    const color =
                      s === 'operational'
                        ? 'bg-green-500'
                        : s === 'degraded'
                          ? 'bg-amber-500'
                          : s === 'outage'
                            ? 'bg-red-500'
                            : 'bg-slate-200';
                    return (
                      <div
                        key={`${day}-${key}`}
                        className={`w-2 h-2 rounded-sm ${color}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-green-500" />
                {t('يعمل', 'Operational')}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-amber-500" />
                {t('تدهور', 'Degraded')}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-red-500" />
                {t('تعطل', 'Outage')}
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {t('آخر ٥ حوادث', 'Last 5 Incidents')}
          </h2>
          <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
            {d.incidents.length === 0 ? (
              <p className="p-6 text-slate-500 text-center">
                {t('لا توجد حوادث مسجلة', 'No incidents recorded')}
              </p>
            ) : (
              d.incidents.map((inc) => (
                <div key={inc.id} className="p-4 flex justify-between items-start">
                  <div>
                    <p className="font-medium text-slate-900">{inc.title}</p>
                    <p className="text-sm text-slate-500">
                      {new Date(inc.started_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                      {inc.resolved_at && (
                        <> — {t('تم الحل', 'Resolved')} {new Date(inc.resolved_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}</>
                      )}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      inc.severity === 'critical'
                        ? 'bg-red-100 text-red-700'
                        : inc.severity === 'major'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
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
