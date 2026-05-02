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

function inferEditor(value: unknown): 'bool' | 'number' | 'text' | 'json' {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'text';
}

function isLateFeesDormancyKey(key: string): boolean {
  return (
    key.startsWith('late_fee_') ||
    key.startsWith('dormancy_') ||
    key.startsWith('reactivation_discount_')
  );
}

function formatDraftValue(key: string, value: unknown): string {
  const ed = inferEditor(value);
  if (ed === 'json') {
    try {
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return '{}';
    }
  }
  if (value === null || value === undefined) return '';
  if (ed === 'number' && typeof value === 'number') {
    if (key.includes('_percent')) {
      return String(Math.round(value));
    }
    if ((key === 'late_fee_tier1_rate' || key === 'late_fee_tier2_rate') && value > 0 && value <= 1) {
      return String(Math.round(value * 100));
    }
  }
  return String(value);
}

function numberStepForKey(key: string): string {
  if (key.includes('_percent')) return '1';
  if (key === 'late_fee_tier1_rate' || key === 'late_fee_tier2_rate') return '1';
  if (key.includes('_rate') || key.includes('reactivation_discount')) return '0.01';
  return '1';
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
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [byKey, setByKey] = useState<Record<string, unknown>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

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
    const list = (data.config || []) as ConfigRow[];
    setRows(list);
    const next: Record<string, unknown> = {};
    const d: Record<string, string> = {};
    for (const r of list) {
      next[r.key] = r.value;
      d[r.key] = formatDraftValue(r.key, r.value);
    }
    setByKey(next);
    setDrafts(d);
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
        await load();
      } catch (e) {
        setByKey((m) => ({ ...m, [key]: prevVal }));
        toast.error(e instanceof Error ? e.message : tCommon('error'));
      } finally {
        setSavingKey(null);
      }
    },
    [getAuthHeaders, load, t, tCommon, toast],
  );

  const saveDraft = useCallback(
    async (key: string) => {
      const raw = drafts[key] ?? '';
      const editor = inferEditor(byKey[key]);
      let parsed: unknown;

      if (editor === 'number') {
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) {
          toast.error(t('platformConfigNumberInvalid'));
          return;
        }
        if (key.includes('_percent')) {
          parsed = Math.min(100, Math.max(0, Math.round(n)));
        } else if (key === 'late_fee_tier1_rate' || key === 'late_fee_tier2_rate') {
          let pct = Math.round(n);
          if (n > 0 && n <= 1) pct = Math.round(n * 100);
          parsed = Math.min(100, Math.max(0, pct));
        } else {
          parsed = numberStepForKey(key) === '1' ? Math.trunc(n) : n;
        }
      } else if (editor === 'json') {
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            toast.error(t('platformConfigJsonInvalid'));
            return;
          }
        } catch {
          toast.error(t('platformConfigJsonInvalid'));
          return;
        }
      } else {
        const trimmed = raw.trim();
        parsed = trimmed === '' ? null : trimmed;
      }

      const headers = await getAuthHeaders();
      if (!headers) return;
      setSavingKey(key);
      try {
        const res = await fetch('/api/admin/platform-config', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ key, value: parsed }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || tCommon('error'));
        }
        toast.success(t('platformConfigSaved'));
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : tCommon('error'));
      } finally {
        setSavingKey(null);
      }
    },
    [byKey, drafts, getAuthHeaders, load, t, tCommon, toast],
  );

  const { lateKeys, otherKeys } = useMemo(() => {
    const keys = rows.map((r) => r.key);
    const late: string[] = [];
    const other: string[] = [];
    for (const k of keys) {
      if (isLateFeesDormancyKey(k)) late.push(k);
      else other.push(k);
    }
    late.sort((a, b) => a.localeCompare(b));
    other.sort((a, b) => a.localeCompare(b));
    return { lateKeys: late, otherKeys: other };
  }, [rows]);

  const labelFor = useCallback(
    (key: string) => t(`platformConfig_${key}_label` as Parameters<typeof t>[0]),
    [t],
  );

  const descFor = useCallback(
    (key: string) => t(`platformConfig_${key}_desc` as Parameters<typeof t>[0]),
    [t],
  );

  const renderRow = (key: string) => {
    const val = byKey[key];
    const editor = inferEditor(val);
    const busy = savingKey === key;

    if (editor === 'bool') {
      const checked = asBool(val);
      return (
        <div
          key={key}
          className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 last:border-0 pb-4 last:pb-0"
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[var(--color-text-primary)]">{labelFor(key)}</p>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{descFor(key)}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={labelFor(key)}
            disabled={busy}
            onClick={() => void patchToggle(key, !checked, checked)}
            className="shrink-0 flex items-center gap-2 disabled:opacity-50"
          >
            <span
              className="relative inline-block h-[26px] w-12 rounded-[13px] transition-colors"
              style={{ backgroundColor: checked ? '#0d9488' : '#64748b' }}
            >
              <span
                className="absolute top-[3px] h-5 w-5 rounded-full bg-slate-200 shadow"
                style={{ left: checked ? 25 : 3 }}
              />
            </span>
            {busy ? <span className="text-xs text-[var(--color-text-secondary)]">{tCommon('loading')}</span> : null}
          </button>
        </div>
      );
    }

    return (
      <div
        key={key}
        className="flex flex-col gap-2 border-b border-slate-100 dark:border-slate-800 last:border-0 pb-4 last:pb-0"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[var(--color-text-primary)]">{labelFor(key)}</p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{descFor(key)}</p>
        </div>
        {editor === 'json' ? (
          <textarea
            className="w-full min-h-[120px] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
            dir="ltr"
            value={drafts[key] ?? ''}
            disabled={busy}
            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
            spellCheck={false}
          />
        ) : editor === 'number' &&
          (key.includes('_percent') ||
            key === 'late_fee_tier1_rate' ||
            key === 'late_fee_tier2_rate') ? (
          <div className="flex max-w-md items-center gap-2">
            <input
              type="number"
              step={numberStepForKey(key)}
              min={0}
              max={key.includes('_percent') || key === 'late_fee_tier1_rate' || key === 'late_fee_tier2_rate' ? 100 : undefined}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)]"
              value={drafts[key] ?? ''}
              disabled={busy}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              dir="ltr"
              aria-describedby={`${key}-pct-hint`}
            />
            <span
              id={`${key}-pct-hint`}
              className="shrink-0 text-sm font-medium text-[var(--color-text-secondary)] tabular-nums"
            >
              %
            </span>
          </div>
        ) : (
          <input
            type={editor === 'number' ? 'number' : 'text'}
            step={editor === 'number' ? numberStepForKey(key) : undefined}
            min={editor === 'number' ? 0 : undefined}
            className="w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)]"
            value={drafts[key] ?? ''}
            disabled={busy}
            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
            dir={editor === 'number' ? 'ltr' : undefined}
          />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveDraft(key)}
          className="self-start rounded-lg bg-[var(--color-brand-500)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? tCommon('loading') : t('platformConfigSaveRow')}
        </button>
      </div>
    );
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
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeRoute="/admin/platform-config" />

      <main className="lg:ms-56 px-4 py-6 max-w-3xl mx-auto">
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
            {lateKeys.length > 0 ? (
              <section>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                  {t('platformConfigGroupLateFeesDormancy')}
                </h2>
                <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
                  {lateKeys.map((k) => renderRow(k))}
                </div>
              </section>
            ) : null}

            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                {t('platformConfigGroupAll')}
              </h2>
              <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
                {otherKeys.map((k) => renderRow(k))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
