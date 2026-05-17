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
import { useToast } from '@/hooks/useToast';
import { ArrowLeft, Tag } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { LocalizedDateInput } from '@/components/forms/LocalizedDateInput';
import { formatDate } from '@/lib/formatNumber';

type PromoCode = {
  id: string;
  code: string;
  discount_pct: number;
  max_uses_total: number | null;
  uses_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};

function promoStatus(p: PromoCode): 'active' | 'expired' | 'exhausted' | 'inactive' {
  if (!p.is_active) return 'inactive';
  if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) return 'expired';
  if (p.max_uses_total !== null && p.uses_count >= p.max_uses_total) return 'exhausted';
  return 'active';
}

export default function AdminPromoCodesPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();
  const isRTL = locale === 'ar';

  const [gateOk, setGateOk] = useState(false);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newCode, setNewCode] = useState('');
  const [newDiscountPct, setNewDiscountPct] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);

  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
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
      if (!session) { router.replace('/login'); return; }
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.isAdmin) { router.replace('/dashboard'); return; }
      setAdminRole(data.role ?? 'admin');
      setGateOk(true);
    };
    void gate();
  }, [getSession, router]);

  const loadCodes = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const res = await fetch('/api/admin/promo-codes', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Load failed');
    const data = await res.json();
    setCodes((data.promoCodes ?? []) as PromoCode[]);
  }, [getSession]);

  useEffect(() => {
    if (!gateOk) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadCodes()
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gateOk, loadCodes]);

  const handleCreate = async () => {
    const code = newCode.trim().toUpperCase();
    const discountPct = parseFloat(newDiscountPct);
    if (!code) { toast.error('Enter a code.'); return; }
    if (!Number.isFinite(discountPct) || discountPct < 1 || discountPct > 100) {
      toast.error('Discount must be 1-100.'); return;
    }
    const headers = await getAuthHeaders();
    if (!headers) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code,
          discountPct: Math.round(discountPct),
          maxUsesTotal: newMaxUses.trim() ? parseInt(newMaxUses.trim(), 10) : null,
          expiresAt: newExpiresAt.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('promoCodesCreateError'));
        return;
      }
      setNewCode('');
      setNewDiscountPct('');
      setNewMaxUses('');
      setNewExpiresAt('');
      await loadCodes();
      toast.success(t('pricingSaved'));
    } finally {
      setCreating(false);
    }
  };

  const patchCode = async (id: string, patch: Record<string, unknown>) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionBusy(id);
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('promoCodesUpdateError'));
        return;
      }
      await loadCodes();
    } finally {
      setActionBusy(null);
    }
  };

  const deleteCode = async (id: string, code: string) => {
    if (!confirm(t('promoCodesConfirmDelete'))) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionBusy(id);
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('promoCodesUpdateError'));
        return;
      }
      await loadCodes();
      toast.success(`${code} deactivated.`);
    } finally {
      setActionBusy(null);
    }
  };

  const statusBadge = (p: PromoCode) => {
    const s = promoStatus(p);
    const label =
      s === 'active' ? t('promoCodesStatusActive')
      : s === 'expired' ? t('promoCodesStatusExpired')
      : s === 'exhausted' ? t('promoCodesStatusExhausted')
      : t('promoCodesStatusInactive');
    const cls =
      s === 'active' ? 'bg-teal-600/20 text-teal-400 border-teal-700/40'
      : s === 'expired' ? 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-[var(--color-border-default)]'
      : s === 'exhausted' ? 'bg-red-900/30 text-red-400 border-red-700/40'
      : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-[var(--color-border-default)]';
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
        {label}
      </span>
    );
  };

  if (!gateOk) {
    return (
      <div className="flex flex-col flex-1 min-h-screen">
        <AdminHeader />
        <div className="flex flex-1 items-center justify-center text-[var(--color-text-secondary)]">
          {tCommon('loading')}
        </div>
      </div>
    );
  }

  const isSuperAdmin = adminRole === 'super_admin';
  const canWrite = adminRole === 'super_admin' || adminRole === 'admin' || adminRole === 'internal_admin';

  return (
    <div
      className="flex flex-col flex-1 min-h-screen bg-[var(--color-surface-0)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/promo-codes" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-6">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <Tag className="h-6 w-6 text-[var(--color-brand-500)]" aria-hidden />
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                {t('promoCodesPageTitle')}
              </h1>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 mb-4">
              {error}
            </div>
          ) : null}

          {/* Create form */}
          {canWrite ? (
            <section className="mb-8 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-4 md:p-6">
              <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase mb-4">
                {t('promoCodesCreateTitle')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {t('promoCodesCodeLabel')}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    maxLength={32}
                    placeholder={t('promoCodesCodePlaceholder')}
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm tracking-wider uppercase"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {t('promoCodesDiscountPctLabel')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                    value={newDiscountPct}
                    onChange={(e) => setNewDiscountPct(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {t('promoCodesMaxUsesLabel')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    placeholder={t('promoCodesMaxUsesPlaceholder')}
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                    value={newMaxUses}
                    onChange={(e) => setNewMaxUses(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {t('promoCodesExpiresAtLabel')}
                  </label>
                  <LocalizedDateInput
                    value={newExpiresAt}
                    onChange={(e) => setNewExpiresAt(e.target.value)}
                    locale={locale}
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  disabled={creating || !newCode.trim() || !newDiscountPct.trim()}
                  onClick={() => void handleCreate()}
                  className="rounded-lg bg-[var(--color-brand-500)] text-white px-5 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? t('promoCodesCreating') : t('promoCodesCreateButton')}
                </button>
              </div>
            </section>
          ) : null}

          {/* Table */}
          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-x-auto">
            {loading ? (
              <p className="px-4 py-6 text-[var(--color-text-secondary)] text-sm">{tCommon('loading')}</p>
            ) : codes.length === 0 ? (
              <p className="px-4 py-6 text-[var(--color-text-secondary)] text-sm">{t('promoCodesEmpty')}</p>
            ) : (
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                    <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColCode')}</th>
                    <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColDiscount')}</th>
                    <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColUses')}</th>
                    <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColExpires')}</th>
                    <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColStatus')}</th>
                    <th className="p-3 w-40" />
                  </tr>
                </thead>
                <tbody>
                  {codes.map((p) => {
                    const busy = actionBusy === p.id;
                    const status = promoStatus(p);
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-[var(--color-border-subtle)] last:border-0"
                      >
                        <td className="p-3 font-mono font-semibold tracking-wider text-[var(--color-text-primary)]" dir="ltr">
                          {p.code}
                        </td>
                        <td className="p-3 text-[var(--color-text-primary)]">
                          {p.discount_pct}%
                        </td>
                        <td className="p-3 tabular-nums text-[var(--color-text-secondary)]">
                          {p.uses_count}
                          {p.max_uses_total !== null ? ` / ${p.max_uses_total}` : ` / ${t('promoCodesUnlimited')}`}
                        </td>
                        <td className="p-3 text-[var(--color-text-secondary)]">
                          {p.expires_at
                            ? formatDate(p.expires_at, locale, { dateStyle: 'medium' })
                            : t('promoCodesNoExpiry')}
                        </td>
                        <td className="p-3">{statusBadge(p)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {canWrite ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void patchCode(p.id, { isActive: !p.is_active })}
                                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                              >
                                {p.is_active ? t('promoCodesDeactivate') : t('promoCodesActivate')}
                              </button>
                            ) : null}
                            {isSuperAdmin && status !== 'inactive' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void deleteCode(p.id, p.code)}
                                className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                              >
                                {t('promoCodesDelete')}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
