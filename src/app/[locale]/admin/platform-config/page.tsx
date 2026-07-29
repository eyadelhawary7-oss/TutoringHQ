'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { mergeMissingPlatformConfigRows } from '@/lib/platformConfigUi';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { useToast } from '@/hooks/useToast';
import { ArrowLeft, Settings } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';

type ConfigRow = { key: string; value: unknown };

function asBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function coerceNumericLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Use for row UI: treat jsonb number-like strings and *_percent keys as numeric editors. */
function inferRowEditor(value: unknown, key: string): 'bool' | 'number' | 'text' | 'json' {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'object' && value !== null) return 'json';
  const n = coerceNumericLike(value);
  if (n !== null && key.includes('_percent')) return 'number';
  if (typeof value === 'number') return 'number';
  return 'text';
}

function formatDraftValue(key: string, value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    try {
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return '{}';
    }
  }
  if (value === null || value === undefined) return '';

  const n = coerceNumericLike(value);
  if (n !== null) {
    if (key.includes('_percent')) {
      if (n > 0 && n <= 1) return String(Math.round(n * 100));
      return String(Math.round(n));
    }
    return typeof value === 'number' ? String(value) : String(n);
  }

  return String(value);
}

/**
 * `Merged-Admin-Platform` §03 groups the switches as FEATURES and SYSTEM rather
 * than one undifferentiated list. These are the LIVE `platform_config` keys that
 * fill each group, read from the catalog on 29 July — not the design's labels.
 *
 * The design also draws Referrals, Card orders, Attendance scanner, App version
 * and Force update. **None of them has a config key**: card ordering is
 * per-centre (`centers.card_orders_enabled`), and referrals, the scanner and the
 * two app-version controls have no key at all. They are omitted rather than
 * rendered as switches that toggle nothing.
 */
const FEATURE_KEYS = [
  'digital_student_fee_collection.enabled',
  'pricing.promo.enabled',
  'summer.promo.enabled',
  'processing_fee_enabled',
  'wa_sending_enabled',
  'pack_invoice_enabled',
  'auto_approve_pack',
  'auto_approve_signups',
] as const;

const SYSTEM_KEYS = [
  'pause_new_signups',
  'maintenance_mode',
  'read_only_mode',
  'cron_paused',
] as const;

function isFeatureKey(key: string): boolean {
  return (FEATURE_KEYS as readonly string[]).includes(key);
}

function isSystemKey(key: string): boolean {
  return (SYSTEM_KEYS as readonly string[]).includes(key);
}

function isLateFeesDormancyKey(key: string): boolean {
  // The five late_fee_* keys were removed with the switch to the single-day lock
  // (Job 3, Part 4): the first late fee triggered on day 4 overdue but the lockout
  // closes the account on day 1, so they were unreachable. This grouping now covers
  // only the remaining dormancy / reactivation-discount keys.
  return (
    key.startsWith('dormancy_') ||
    key.startsWith('reactivation_discount_')
  );
}

function numberStepForKey(key: string): string {
  if (key.includes('_percent')) return '1';
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
    const list = mergeMissingPlatformConfigRows((data.config || []) as ConfigRow[]);
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
      const editor = inferRowEditor(byKey[key], key);
      let parsed: unknown;

      if (editor === 'number') {
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) {
          toast.error(t('platformConfigNumberInvalid'));
          return;
        }
        if (key.includes('_percent')) {
          let pct = Math.round(n);
          if (n > 0 && n < 1) pct = Math.round(n * 100);
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

  const { lateKeys, featureKeys, systemKeys, otherKeys } = useMemo(() => {
    const keys = rows.map((r) => r.key);
    const late: string[] = [];
    const feature: string[] = [];
    const system: string[] = [];
    const other: string[] = [];
    for (const k of keys) {
      if (isLateFeesDormancyKey(k)) late.push(k);
      else if (isFeatureKey(k)) feature.push(k);
      else if (isSystemKey(k)) system.push(k);
      else other.push(k);
    }
    late.sort((a, b) => a.localeCompare(b));
    other.sort((a, b) => a.localeCompare(b));
    // FEATURES and SYSTEM keep the declared order, which is the design's — the
    // rest stay alphabetical because there is no meaningful order for them.
    const inDeclaredOrder = (declared: readonly string[], present: string[]) =>
      declared.filter((k) => present.includes(k));
    return {
      lateKeys: late,
      featureKeys: inDeclaredOrder(FEATURE_KEYS, feature),
      systemKeys: inDeclaredOrder(SYSTEM_KEYS, system),
      otherKeys: other,
    };
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
    const editor = inferRowEditor(val, key);
    const busy = savingKey === key;

    if (editor === 'bool') {
      const checked = asBool(val);
      return (
        <div
          key={key}
          className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-[var(--color-border-subtle)] last:border-0 pb-4 last:pb-0"
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
              style={{ backgroundColor: checked ? 'var(--color-brand-500)' : 'var(--color-navy-500)' }}
            >
              <span
                className="absolute top-[3px] h-5 w-5 rounded-full bg-[var(--color-surface-3)] shadow transition-[inset-inline-start]"
                style={{ insetInlineStart: checked ? 25 : 3 }}
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
        className="flex flex-col gap-2 border-b border-[var(--color-border-subtle)] last:border-0 pb-4 last:pb-0"
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
        ) : editor === 'number' && key.includes('_percent') ? (
          <div className="flex max-w-md items-center gap-2">
            <input
              type="number"
              step={numberStepForKey(key)}
              min={0}
              max={key.includes('_percent') ? 100 : undefined}
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
      <AdminSidebar activeRoute="/admin/platform-config" />

      <main className="lg:ms-56 px-4 py-6 max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => router.push('/admin')}
          className="inline-flex items-center gap-2 text-sm text-teal-700 hover:underline mb-4"
        >
          <DirectionalIcon icon={ArrowLeft} className="h-4 w-4" aria-hidden />
          {t('platformConfigBack')}
        </button>

        <div className="flex items-start gap-3 mb-2">
          <Settings className="h-8 w-8 text-teal-600 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('platformConfigTitle')}</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('platformConfigSubtitle')}</p>
          </div>
        </div>

        {loading ? (
          <p className="text-[var(--color-text-muted)] mt-8">{tCommon('loading')}</p>
        ) : error ? (
          <p className="text-red-600 mt-8">{error}</p>
        ) : (
          <div className="mt-8 space-y-10">
            {/* Merged-Admin-Platform §03 — FEATURES then SYSTEM, the design's order. */}
            {featureKeys.length > 0 ? (
              <section>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                  {t('platformConfigGroupFeatures')}
                </h2>
                <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
                  {featureKeys.map((k) => renderRow(k))}
                </div>
              </section>
            ) : null}

            {systemKeys.length > 0 ? (
              <section>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                  {t('platformConfigGroupSystem')}
                </h2>
                <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
                  {systemKeys.map((k) => renderRow(k))}
                </div>
              </section>
            ) : null}

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
