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
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

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

type TargetType = 'center' | 'teacher' | 'all';
type RequestStatus = 'pending' | 'approved' | 'rejected';

type PromoRequest = {
  id: string;
  code: string | null;
  discount_pct: number;
  max_uses_total: number | null;
  expires_at: string | null;
  target_type: TargetType;
  status: RequestStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_promo_code_id: string | null;
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
  // Merged-Admin-Platform §05 — "Given" is EGP actually discounted and lives on
  // promo_code_redemptions. null when unreadable, never 0.
  const [totalGivenEgp, setTotalGivenEgp] = useState<number | null>(null);
  const [requests, setRequests] = useState<PromoRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newCode, setNewCode] = useState('');
  const [newDiscountPct, setNewDiscountPct] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);

  // Manager request form
  const [reqCode, setReqCode] = useState('');
  const [reqDiscountPct, setReqDiscountPct] = useState('');
  const [reqMaxUses, setReqMaxUses] = useState('');
  const [reqExpiresAt, setReqExpiresAt] = useState('');
  const [reqTarget, setReqTarget] = useState<TargetType>('all');
  const [submitting, setSubmitting] = useState(false);

  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const isSuperAdmin = adminRole === 'super_admin';
  const isManager = adminRole === 'sales_manager';
  const canWrite =
    adminRole === 'super_admin' || adminRole === 'admin' || adminRole === 'internal_admin';
  // A manager gets the request-only experience (no full table / create form).
  const managerView = isManager && !canWrite;

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
      const role = data.role ?? 'admin';
      // Reps and other non-managing roles have no business on this screen — send them home.
      const allowed =
        role === 'super_admin' ||
        role === 'admin' ||
        role === 'internal_admin' ||
        role === 'sales_manager';
      if (!allowed) { router.replace('/admin'); return; }
      setAdminRole(role);
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
    setTotalGivenEgp(typeof data.totalGivenEgp === 'number' ? data.totalGivenEgp : null);
  }, [getSession]);

  const loadRequests = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const res = await fetch('/api/admin/promo-code-requests', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Load failed');
    const data = await res.json();
    setRequests((data.requests ?? []) as PromoRequest[]);
  }, [getSession]);

  useEffect(() => {
    if (!gateOk) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const tasks: Promise<void>[] = [];
    // Managers see only their own requests; everyone else sees the codes table.
    if (!managerView) tasks.push(loadCodes());
    if (managerView || isSuperAdmin) tasks.push(loadRequests());
    Promise.all(tasks)
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gateOk, managerView, isSuperAdmin, loadCodes, loadRequests]);

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

  const handleSubmitRequest = async () => {
    const discountPct = parseFloat(reqDiscountPct);
    if (!Number.isFinite(discountPct) || discountPct < 1 || discountPct > 100) {
      toast.error('Discount must be 1-100.'); return;
    }
    const maxUses = reqMaxUses.trim() ? parseInt(reqMaxUses.trim(), 10) : NaN;
    if (!Number.isFinite(maxUses) || maxUses < 1) {
      toast.error(t('promoCodesMaxUsesLabel')); return;
    }
    const headers = await getAuthHeaders();
    if (!headers) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/promo-code-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: reqCode.trim() ? reqCode.trim().toUpperCase() : null,
          discountPct: Math.round(discountPct),
          maxUsesTotal: maxUses,
          expiresAt: reqExpiresAt.trim() || null,
          targetType: reqTarget,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('promoRequestError'));
        return;
      }
      setReqCode('');
      setReqDiscountPct('');
      setReqMaxUses('');
      setReqExpiresAt('');
      setReqTarget('all');
      await loadRequests();
      toast.success(t('promoRequestSubmitted'));
    } finally {
      setSubmitting(false);
    }
  };

  const reviewRequest = async (id: string, action: 'approve' | 'reject', reason?: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionBusy(id);
    try {
      const res = await fetch(`/api/admin/promo-code-requests/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(action === 'reject' ? { action, reason } : { action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('promoRequestsActionError'));
        return;
      }
      await Promise.all([loadRequests(), loadCodes().catch(() => undefined)]);
      toast.success(action === 'approve' ? t('promoRequestsApproved') : t('promoRequestsRejected'));
    } finally {
      setActionBusy(null);
    }
  };

  const approveRequest = (id: string) => void reviewRequest(id, 'approve');
  const rejectRequest = (id: string) => {
    const reason = window.prompt(t('promoRequestsRejectPrompt'));
    if (reason === null) return;
    if (!reason.trim()) { toast.error(t('promoRequestsRejectReasonRequired')); return; }
    void reviewRequest(id, 'reject', reason.trim());
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

  const targetLabel = (target: TargetType) =>
    target === 'center' ? t('promoRequestsTargetCenter')
    : target === 'teacher' ? t('promoRequestsTargetTeacher')
    : t('promoRequestsTargetAll');

  const requestStatusBadge = (s: RequestStatus) => {
    const label =
      s === 'pending' ? t('promoRequestsStatusPending')
      : s === 'approved' ? t('promoRequestsStatusApproved')
      : t('promoRequestsStatusRejected');
    const cls =
      s === 'approved' ? 'bg-teal-600/20 text-teal-400 border-teal-700/40'
      : s === 'rejected' ? 'bg-red-900/30 text-red-400 border-red-700/40'
      : 'bg-amber-500/15 text-amber-400 border-amber-600/40';
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
        {label}
      </span>
    );
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

  const pendingRequests = requests.filter((r) => r.status === 'pending');

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
              className="p-1.5 rounded-lg hover:bg-tile"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <Tag className="h-6 w-6 text-[var(--color-brand-500)]" aria-hidden />
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                {managerView ? t('promoRequestManagerTitle') : t('promoCodesPageTitle')}
              </h1>
            </div>
          </div>

          {/* Merged-Admin-Platform §05 — the three summary tiles above the list. */}
          {!managerView && codes.length > 0 ? (
            <div className="mb-5 grid grid-cols-3 gap-3">
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
                <p className="text-lg font-bold text-[var(--color-text-primary)]">
                  {formatNumber(codes.filter((c) => promoStatus(c) === 'active').length, locale)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t('promoSummaryActive')}</p>
              </div>
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
                <p className="text-lg font-bold text-[var(--color-text-primary)]">
                  {formatNumber(
                    codes.reduce((sum, c) => sum + Number(c.uses_count || 0), 0),
                    locale,
                  )}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {t('promoSummaryRedemptions')}
                </p>
              </div>
              {/*
                The Given tile drops out when the redemptions read failed. A 0
                there would read as "we discounted nothing", which is a claim the
                data did not make.
              */}
              {totalGivenEgp != null ? (
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
                  <p className="text-lg font-bold text-[var(--color-text-primary)]">
                    {formatCurrency(totalGivenEgp, locale)}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t('promoSummaryGiven')}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 mb-4">
              {error}
            </div>
          ) : null}

          {/* ── Manager: request form ─────────────────────────────────────────── */}
          {managerView ? (
            <section className="mb-8 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-4 md:p-6">
              <p className="text-xs text-[var(--color-text-secondary)] mb-4">
                {t('promoRequestCapsNote')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {t('promoCodesCodeLabel')}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    maxLength={32}
                    placeholder={t('promoRequestCodePlaceholder')}
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm tracking-wider uppercase"
                    value={reqCode}
                    onChange={(e) => setReqCode(e.target.value.toUpperCase())}
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
                    value={reqDiscountPct}
                    onChange={(e) => setReqDiscountPct(e.target.value)}
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
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                    value={reqMaxUses}
                    onChange={(e) => setReqMaxUses(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {t('promoCodesExpiresAtLabel')}
                  </label>
                  <LocalizedDateInput
                    value={reqExpiresAt}
                    onChange={(e) => setReqExpiresAt(e.target.value)}
                    locale={locale}
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    {t('promoRequestTargetLabel')}
                  </label>
                  <select
                    className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                    value={reqTarget}
                    onChange={(e) => setReqTarget(e.target.value as TargetType)}
                  >
                    <option value="all">{t('promoRequestsTargetAll')}</option>
                    <option value="center">{t('promoRequestsTargetCenter')}</option>
                    <option value="teacher">{t('promoRequestsTargetTeacher')}</option>
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  disabled={submitting || !reqDiscountPct.trim() || !reqMaxUses.trim()}
                  onClick={() => void handleSubmitRequest()}
                  className="rounded-lg bg-[var(--color-brand-500)] text-white px-5 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? t('promoRequestSubmitting') : t('promoRequestSubmitButton')}
                </button>
              </div>
            </section>
          ) : null}

          {/* ── Manager: my requests ──────────────────────────────────────────── */}
          {managerView ? (
            <section className="mb-8">
              <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase mb-3">
                {t('promoRequestMyRequestsTitle')}
              </h2>
              <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-x-auto">
                {loading ? (
                  <p className="px-4 py-6 text-[var(--color-text-secondary)] text-sm">{tCommon('loading')}</p>
                ) : requests.length === 0 ? (
                  <p className="px-4 py-6 text-[var(--color-text-secondary)] text-sm">{t('promoRequestMyRequestsEmpty')}</p>
                ) : (
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColCode')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColDiscount')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColUses')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoRequestsColTarget')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColStatus')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoRequestRejectionLabel')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => (
                        <tr key={r.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                          <td className="p-3 font-mono font-semibold tracking-wider text-[var(--color-text-primary)]" dir="ltr">
                            {r.code ?? '—'}
                          </td>
                          <td className="p-3 text-[var(--color-text-primary)]">{r.discount_pct}%</td>
                          <td className="p-3 tabular-nums text-[var(--color-text-secondary)]">
                            {r.max_uses_total ?? t('promoCodesUnlimited')}
                          </td>
                          <td className="p-3 text-[var(--color-text-secondary)]">{targetLabel(r.target_type)}</td>
                          <td className="p-3">{requestStatusBadge(r.status)}</td>
                          <td className="p-3 text-[var(--color-text-secondary)]">{r.rejection_reason ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ) : null}

          {/* ── CEO: pending requests to approve/reject ───────────────────────── */}
          {isSuperAdmin ? (
            <section className="mb-8">
              <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase mb-3">
                {t('promoRequestsSectionTitle')}
              </h2>
              <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] overflow-x-auto">
                {pendingRequests.length === 0 ? (
                  <p className="px-4 py-6 text-[var(--color-text-secondary)] text-sm">{t('promoRequestsEmpty')}</p>
                ) : (
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColCode')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColDiscount')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColUses')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoCodesColExpires')}</th>
                        <th className="text-start p-3 text-xs font-semibold tracking-widest uppercase">{t('promoRequestsColTarget')}</th>
                        <th className="p-3 w-40" />
                      </tr>
                    </thead>
                    <tbody>
                      {pendingRequests.map((r) => {
                        const busy = actionBusy === r.id;
                        return (
                          <tr key={r.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                            <td className="p-3 font-mono font-semibold tracking-wider text-[var(--color-text-primary)]" dir="ltr">
                              {r.code ?? '—'}
                            </td>
                            <td className="p-3 text-[var(--color-text-primary)]">{r.discount_pct}%</td>
                            <td className="p-3 tabular-nums text-[var(--color-text-secondary)]">
                              {r.max_uses_total ?? t('promoCodesUnlimited')}
                            </td>
                            <td className="p-3 text-[var(--color-text-secondary)]">
                              {r.expires_at
                                ? formatDate(r.expires_at, locale, { dateStyle: 'medium' })
                                : t('promoCodesNoExpiry')}
                            </td>
                            <td className="p-3 text-[var(--color-text-secondary)]">{targetLabel(r.target_type)}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => approveRequest(r.id)}
                                  className="text-xs font-medium text-teal-500 hover:text-teal-400 disabled:opacity-50"
                                >
                                  {t('promoRequestsApprove')}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => rejectRequest(r.id)}
                                  className="text-xs font-medium text-red-500 hover:text-red-400 disabled:opacity-50"
                                >
                                  {t('promoRequestsReject')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ) : null}

          {/* ── Create form (full admins only) ────────────────────────────────── */}
          {!managerView && canWrite ? (
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

          {/* ── Codes table (everyone except the manager-only view) ───────────── */}
          {!managerView ? (
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
          ) : null}
        </main>
      </div>
    </div>
  );
}
