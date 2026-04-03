'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { useToast } from '@/hooks/useToast';
import { ArrowLeft, Settings } from 'lucide-react';

type ConfigRow = { key: string; value: unknown };

function asBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

export default function PlatformConfigPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();
  const isRTL = locale === 'ar';

  const [gateOk, setGateOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [byKey, setByKey] = useState<Record<string, unknown>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [breakevenDraft, setBreakevenDraft] = useState('77');
  const [breakevenSaving, setBreakevenSaving] = useState(false);

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
    const gate = async () => {
      const session = await getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.isAdmin || data.role !== 'super_admin') {
        router.replace('/dashboard');
        return;
      }
      setGateOk(true);
    };
    void gate();
  }, [getSession, router]);

  const load = useCallback(async () => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const res = await fetch('/api/admin/platform-config', { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || t('platformConfigLoadError'));
    }
    const data = await res.json();
    const rows = (data.config || []) as ConfigRow[];
    const next: Record<string, unknown> = {};
    for (const r of rows) {
      next[r.key] = r.value;
    }
    setByKey(next);
    const bt = next.breakeven_target;
    if (bt !== undefined && bt !== null) {
      setBreakevenDraft(String(typeof bt === 'number' ? bt : Number(bt) || 0));
    }
  }, [getAuthHeaders, t]);

  useEffect(() => {
    if (!gateOk) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('platformConfigLoadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateOk, load, t]);

  const patchToggle = useCallback(
    async (key: string, nextVal: boolean, prevVal: boolean) => {
      const headers = await getAuthHeaders();
      if (!headers) return;
      setSavingKey(key);
      setByKey((m) => ({ ...m, [key]: nextVal }));
      try {
        const res = await fetch('/api/admin/platform-config', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ key, value: nextVal }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || tCommon('error'));
        }
        toast.success(t('platformConfigSaved'));
      } catch (e) {
        setByKey((m) => ({ ...m, [key]: prevVal }));
        toast.error(e instanceof Error ? e.message : tCommon('error'));
      } finally {
        setSavingKey(null);
      }
    },
    [getAuthHeaders, toast, t, tCommon],
  );

  const saveBreakeven = useCallback(async () => {
    const n = Number(breakevenDraft);
    const rawCur = byKey.breakeven_target;
    const cur = typeof rawCur === 'number' ? rawCur : Number(rawCur);
    if (Number.isFinite(n) && Number.isFinite(cur) && n === cur) return;
    if (!Number.isFinite(n) || n < 0) {
      toast.error(t('platformConfigBreakevenInvalid'));
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) return;
    const prev = byKey.breakeven_target;
    setBreakevenSaving(true);
    setByKey((m) => ({ ...m, breakeven_target: n }));
    try {
      const res = await fetch('/api/admin/platform-config', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ key: 'breakeven_target', value: n }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || tCommon('error'));
      }
      toast.success(t('platformConfigSaved'));
    } catch (e) {
      setByKey((m) => ({ ...m, breakeven_target: prev }));
      toast.error(e instanceof Error ? e.message : tCommon('error'));
    } finally {
      setBreakevenSaving(false);
    }
  }, [breakevenDraft, byKey.breakeven_target, getAuthHeaders, toast, t, tCommon]);

  const groups = useMemo(
    () => [
      {
        titleKey: 'platformConfigGroupApproval' as const,
        keys: ['auto_approve_signups', 'pause_new_signups', 'auto_approve_pack'] as const,
      },
      {
        titleKey: 'platformConfigGroupWaBilling' as const,
        keys: ['wa_sending_enabled', 'payment_failed_enabled', 'pack_invoice_enabled'] as const,
      },
      {
        titleKey: 'platformConfigGroupOps' as const,
        keys: ['cron_paused', 'maintenance_mode', 'read_only_mode', 'bosta_auto_reship_on_lost'] as const,
      },
    ],
    [],
  );

  if (!gateOk) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 dark:text-slate-400">
        {tCommon('loading')}
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeTab="billing" activeRoute="/admin/platform-config" />

      <main className="lg:ms-56 pt-14 lg:pt-0 px-4 py-6 max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => router.push('/admin')}
          className="inline-flex items-center gap-2 text-sm text-teal-700 dark:text-teal-400 hover:underline mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('platformConfigBack')}
        </button>

        <div className="flex items-start gap-3 mb-2">
          <Settings className="h-8 w-8 text-teal-600 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('platformConfigTitle')}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('platformConfigSubtitle')}</p>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-500 mt-8">{tCommon('loading')}</p>
        ) : error ? (
          <p className="text-red-600 mt-8">{error}</p>
        ) : (
          <div className="mt-8 space-y-10">
            {groups.map((g) => (
              <section key={g.titleKey}>
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                  {t(g.titleKey)}
                </h2>
                <div className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                  {g.keys.map((k) => {
                    const labelKey = `platformConfig_${k}_label` as Parameters<typeof t>[0];
                    const descKey = `platformConfig_${k}_desc` as Parameters<typeof t>[0];
                    const checked = asBool(byKey[k]);
                    const busy = savingKey === k;
                    return (
                      <div
                        key={k}
                        className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 last:border-0 pb-4 last:pb-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 dark:text-slate-100">{t(labelKey)}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{t(descKey)}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          disabled={busy}
                          onClick={() => void patchToggle(k, !checked, checked)}
                          className="shrink-0 flex items-center gap-2 disabled:opacity-50"
                        >
                          <span
                            className="relative inline-block h-[26px] w-12 rounded-[13px] transition-colors"
                            style={{ backgroundColor: checked ? '#0d9488' : '#64748b' }}
                          >
                            <span
                              className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow"
                              style={{ left: checked ? 25 : 3 }}
                            />
                          </span>
                          {busy ? <span className="text-xs text-slate-500">{tCommon('loading')}</span> : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <section>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                {t('platformConfigGroupTargets')}
              </h2>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {t('platformConfig_breakeven_target_label')}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 mb-3">
                  {t('platformConfig_breakeven_target_desc')}
                </p>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full max-w-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100"
                  value={breakevenDraft}
                  disabled={breakevenSaving}
                  onChange={(e) => setBreakevenDraft(e.target.value)}
                  onBlur={() => void saveBreakeven()}
                />
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
