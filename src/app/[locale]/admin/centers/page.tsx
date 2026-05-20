'use client';

import { Suspense, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { useSearchParams, usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession, getAdminAuthHeaders } from '@/lib/adminAuth-client';
import {
  STATUS_STYLES,
  centerStatusLabel,
  formatAdminLastActiveDisplay,
  isAdminLastActiveStaleRaw,
} from '@/lib/adminUtils';
import { PlanBadge } from '@/components/shared';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Download,
  X,
  Check,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  Trash2,
  MoreVertical,
  CreditCard,
} from 'lucide-react';
import { canonicalPlanId } from '@/lib/plans';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import type { CenterRow } from '@/types/admin';

const PLAN_SORT_ORDER: Record<string, number> = {
  nano: 1,
  starter: 2,
  pro: 3,
  business: 4,
  enterprise: 5,
  top_centers: 6,
};

function AdminCentersPageInner() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('status');
  const tBilling = useTranslations('billing');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const statusFilter = searchParams?.get('status') ?? 'all';
  const filterPlan = searchParams?.get('plan') ?? 'all';
  const centerSearch = searchParams?.get('q') ?? '';
  const sortBy = searchParams?.get('sort') ?? 'newest';
  const centersPage = Math.max(1, parseInt(searchParams?.get('page') ?? '1', 10) || 1);

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '' || v === 'all' || (k === 'page' && v === '1')) {
          params.delete(k);
        } else {
          params.set(k, v);
        }
      }
      const q = params.toString();
      const localePath = pathname ?? '/admin/centers';
      router.replace((q ? `${localePath}?${q}` : localePath) as never, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [centers, setCenters] = useState<CenterRow[]>([]);
  const [centersTotalPages, setCentersTotalPages] = useState(1);
  const [centersLoading, setCentersLoading] = useState(false);
  const [centersFirstLoadDone, setCentersFirstLoadDone] = useState(false);
  const [centersError, setCentersError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [detailCenter, setDetailCenter] = useState<CenterRow | null>(null);
  const [showSuspendConfirm, setShowSuspendConfirm] = useState<CenterRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [blacklistModal, setBlacklistModal] = useState<CenterRow | null>(null);
  const [blacklistReasonInput, setBlacklistReasonInput] = useState('');
  const [changePlanModal, setChangePlanModal] = useState<{
    centerId: string;
    centerName: string;
    currentPlan: string;
  } | null>(null);
  const [newPlan, setNewPlan] = useState('');
  const [changingPlan, setChangingPlan] = useState(false);
  const [passwordConfirm, setPasswordConfirm] = useState<{ center: CenterRow } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string } | null>(null);

  const loadCenters = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams({
      page: String(centersPage),
      limit: '50',
    });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (filterPlan !== 'all') params.set('plan', filterPlan);
    if (centerSearch.trim()) params.set('search', centerSearch.trim());
    if (sortBy === 'oldest') params.set('sort', 'oldest');
    setCentersError(null);
    setCentersLoading(true);
    try {
      const res = await fetch(`/api/admin/centers?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setCentersError(errBody.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        centers?: unknown;
        pagination?: { total_pages?: number };
      };
      setCenters(Array.isArray(data.centers) ? (data.centers as CenterRow[]) : []);
      const tp = data.pagination?.total_pages ?? 0;
      setCentersTotalPages(Math.max(1, tp || 1));
    } catch (err) {
      setCentersError(err instanceof Error ? err.message : tCommon('errorGeneric'));
    } finally {
      setCentersLoading(false);
      setCentersFirstLoadDone(true);
    }
  }, [centerSearch, centersPage, filterPlan, router, sortBy, statusFilter, tCommon]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    loadCenters();
  }, [loadCenters]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [centersPage, statusFilter, filterPlan, centerSearch]);

  const toggleAllCenterSelection = useCallback(() => {
    setSelectedIds((prev) => {
      const pageIds = centers.map((c) => c.id);
      if (pageIds.length === 0) return prev;
      const allOnPageSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }, [centers]);

  const toggleOneCenterSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const executeBulkAction = useCallback(async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    const headers = await getAdminAuthHeaders();
    if (!headers) {
      setBulkLoading(false);
      setBulkError(t('bulk.errors.unauthorized'));
      return;
    }
    try {
      const res = await fetch('/api/admin/centers/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: bulkAction,
          center_ids: Array.from(selectedIds),
          ...(bulkAction === 'send_wa' && { message: bulkMessage }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        errorKey?: string;
        error?: string;
        errors?: string[];
      };
      if (!res.ok) {
        setBulkError(data.errorKey ? t(data.errorKey) : data.error ?? t('bulk.errors.unknown'));
        setBulkLoading(false);
        return;
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setBulkError(t('bulk.completedWithErrors', { count: formatNumber(data.errors.length, locale) }));
      }
      setBulkLoading(false);
      setSelectedIds(new Set());
      setBulkAction('');
      setBulkMessage('');
      await loadCenters();
    } catch {
      setBulkError(t('bulk.errors.unknown'));
      setBulkLoading(false);
    }
  }, [bulkAction, bulkMessage, loadCenters, locale, selectedIds, t]);

  const handleDeleteCenter = async (centerId: string) => {
    setDeleteConfirm(null);
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/centers?id=${centerId}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tCommon('errorGeneric'));
      setCenters((prev) => prev.filter((c) => c.id !== centerId));
      setToast({ msg: t('centerDeleted') });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setCentersError(err instanceof Error ? err.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleBlacklistCenter = async () => {
    if (!blacklistModal) return;
    const reason = blacklistReasonInput.trim();
    if (!reason) {
      setCentersError(t('blacklistReasonRequired'));
      return;
    }
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/centers/${blacklistModal.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'blacklist', blacklist_reason: reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || tCommon('errorGeneric'));
      setBlacklistModal(null);
      setBlacklistReasonInput('');
      setOpenActionsId(null);
      loadCenters();
      setToast({ msg: t('centerBlacklistedToast') });
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setCentersError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCenterAction = async (
    centerId: string,
    action: 'suspend' | 'reactivate' | 'change_plan',
    extra?: { newPlan?: string; password?: string },
  ) => {
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = { centerId, action, ...extra };
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || tCommon('errorGeneric'));
      setShowSuspendConfirm(null);
      setDetailCenter(null);
      loadCenters();
    } catch (e) {
      setCentersError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const displayedCenters = useMemo(() => {
    const result = [...centers];
    if (sortBy === 'plan_high') {
      result.sort(
        (a, b) =>
          (PLAN_SORT_ORDER[canonicalPlanId(b.plan)] ?? 0) -
          (PLAN_SORT_ORDER[canonicalPlanId(a.plan)] ?? 0),
      );
    } else if (sortBy === 'plan_low') {
      result.sort(
        (a, b) =>
          (PLAN_SORT_ORDER[canonicalPlanId(a.plan)] ?? 0) -
          (PLAN_SORT_ORDER[canonicalPlanId(b.plan)] ?? 0),
      );
    }
    return result;
  }, [centers, sortBy]);

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/centers" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold">{t('centers')}</h1>
          </div>

          {centersError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 mb-3 flex flex-wrap items-center gap-3 justify-between">
              <p className="text-sm font-medium">{centersError}</p>
              <button
                type="button"
                onClick={() => void loadCenters()}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs"
              >
                {t('retry')}
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 items-center justify-end mb-3">
            <a
              href="/api/admin/export/centers"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] rounded-lg text-sm transition-colors"
            >
              <Download className="w-4 h-4 shrink-0" />
              {t('exportCenters')}
            </a>
            <a
              href="/api/admin/export/invoices"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] rounded-lg text-sm transition-colors"
            >
              <Download className="w-4 h-4 shrink-0" />
              {t('exportInvoices')}
            </a>
            <a
              href="/api/admin/export/commissions"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] rounded-lg text-sm transition-colors"
            >
              <Download className="w-4 h-4 shrink-0" />
              {t('exportCommissions')}
            </a>
          </div>

          <div className="flex gap-3 flex-wrap mb-3">
            <select
              value={filterPlan}
              onChange={(e) => updateParams({ plan: e.target.value, page: '1' })}
              className="px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-1)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="all">{t('allPlans')}</option>
              <option value="nano">{tBilling('planNames.nano')}</option>
              <option value="starter">{tBilling('planNames.starter')}</option>
              <option value="pro">{tBilling('planNames.pro')}</option>
              <option value="business">{tBilling('planNames.business')}</option>
              <option value="enterprise">{tBilling('planNames.enterprise')}</option>
              <option value="top_centers">{tBilling('planNames.top_centers')}</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => updateParams({ sort: e.target.value, page: '1' })}
              className="px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-1)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="newest">{t('newestFirst')}</option>
              <option value="oldest">{t('oldestFirst')}</option>
              <option value="plan_high">{t('planHighestFirst')}</option>
              <option value="plan_low">{t('planLowestFirst')}</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-3 items-center mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-secondary)]" />
              <input
                type="search"
                value={centerSearch}
                onChange={(e) => updateParams({ q: e.target.value, page: '1' })}
                placeholder={t('searchCenters')}
                className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {['all', 'active', 'pending', 'suspended', 'at_risk'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateParams({ status: s, page: '1' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-primary/20 text-primary'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  {s === 'all'
                    ? tCommon('all')
                    : s === 'at_risk'
                      ? t('atRisk')
                      : s === 'active'
                        ? tCommon('active')
                        : s === 'pending'
                          ? t('pending')
                          : t('suspended')}
                </button>
              ))}
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 flex-wrap bg-primary/10 border border-primary/25 rounded-xl p-4 mb-4">
              <span className="text-primary text-sm font-medium">
                {formatNumber(selectedIds.size, locale)} {t('selected')}
              </span>
              <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">{t('bulkSelectAction')}</option>
                <option value="approve">{t('bulkApprove')}</option>
                <option value="suspend">{t('bulkSuspend')}</option>
                <option value="reactivate">{t('bulkReactivate')}</option>
                <option value="send_wa">{t('bulkSendWA')}</option>
              </select>
              {bulkAction === 'send_wa' && (
                <input
                  type="text"
                  value={bulkMessage}
                  onChange={(e) => setBulkMessage(e.target.value)}
                  placeholder={t('bulkWAMessage')}
                  className="flex-1 min-w-[12rem] px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              )}
              {bulkError ? <span className="text-red-600 text-xs">{bulkError}</span> : null}
              <button
                type="button"
                onClick={() => void executeBulkAction()}
                disabled={bulkLoading || !bulkAction || (bulkAction === 'send_wa' && !bulkMessage.trim())}
                className="px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
              >
                {bulkLoading ? t('applying') : t('applyAction')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedIds(new Set());
                  setBulkError(null);
                }}
                className="px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors border border-[var(--color-border-subtle)]"
              >
                {t('clearSelection')}
              </button>
            </div>
          )}

          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                    <th className="py-3 px-4 w-10" aria-label={t('bulkSelectAction')}>
                      <input
                        type="checkbox"
                        checked={centers.length > 0 && centers.every((c) => selectedIds.has(c.id))}
                        onChange={toggleAllCenterSelection}
                        className="rounded border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-primary focus:ring-primary"
                      />
                    </th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{tCommon('name')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] hidden md:table-cell">{t('owner')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] hidden lg:table-cell">{tCommon('phone')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{t('plan')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{tCommon('status')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] hidden md:table-cell">{t('studentsCount')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] hidden lg:table-cell">{t('lastActive')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] hidden lg:table-cell">{t('usage')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] hidden lg:table-cell">{t('createdAt')}</th>
                    <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{tCommon('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {centersLoading && !centersFirstLoadDone ? (
                    <>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <tr key={`skel-${i}`} className="animate-pulse">
                          <td colSpan={11} className="py-3.5 px-4">
                            <div className="h-5 w-full rounded bg-[var(--color-surface-2)]" />
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : displayedCenters.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                        {t('noCenters')}
                      </td>
                    </tr>
                  ) : null}
                  {displayedCenters.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                      <td className="py-3.5 px-4 w-10 align-middle">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleOneCenterSelection(c.id)}
                          className="rounded border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-primary focus:ring-primary"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {c.name}
                          {c.is_blacklisted ? (
                            <span className="inline-flex rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white">
                              {t('blacklisted')}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                        {c.owner?.name ?? c.owner_name ?? tCommon('notAvailable')}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)] hidden lg:table-cell" dir="ltr">
                        {c.phone ?? tCommon('notSet')}
                      </td>
                      <td className="py-3.5 px-4"><PlanBadge plan={c.plan} /></td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            STATUS_STYLES[c.status || 'active'] || STATUS_STYLES.active
                          }`}
                        >
                          {centerStatusLabel(c.status, tStatus)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] font-mono hidden md:table-cell">
                        {c.students_count ?? 0}
                      </td>
                      <td
                        className={`py-3.5 px-4 text-xs hidden lg:table-cell ${
                          isAdminLastActiveStaleRaw(c.last_active)
                            ? 'text-red-600 font-semibold'
                            : 'text-[var(--color-text-secondary)]'
                        }`}
                      >
                        {formatAdminLastActiveDisplay(c.last_active, locale, t)}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)] hidden lg:table-cell">
                        {c.usage_scans ?? 0}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[var(--color-text-secondary)] hidden lg:table-cell">
                        {c.created_at ? formatDate(c.created_at, locale) : tCommon('notSet')}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-end gap-3">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setOpenActionsId(openActionsId === c.id ? null : c.id)}
                              className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
                              title={tCommon('actions')}
                            >
                              <MoreVertical size={16} />
                            </button>
                            {openActionsId === c.id && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setOpenActionsId(null)} aria-hidden />
                                <div className="absolute top-full end-0 mt-1 z-50 min-w-[180px] py-1 rounded-lg border border-border shadow-lg bg-[var(--color-surface-1)]">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDetailCenter(c);
                                      setOpenActionsId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start"
                                  >
                                    <ExternalLink size={14} />
                                    {t('viewDetails')}
                                  </button>
                                  {c.status === 'active' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowSuspendConfirm(c);
                                        setOpenActionsId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start"
                                    >
                                      <AlertTriangle size={14} />
                                      {t('suspend')}
                                    </button>
                                  )}
                                  {!c.is_blacklisted && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBlacklistModal(c);
                                        setBlacklistReasonInput('');
                                        setOpenActionsId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-start"
                                    >
                                      <ShieldAlert size={14} />
                                      {t('blacklistMenu')}
                                    </button>
                                  )}
                                  {c.status === 'suspended' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleCenterAction(c.id, 'reactivate');
                                        setOpenActionsId(null);
                                      }}
                                      disabled={actionLoading}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start disabled:opacity-50"
                                    >
                                      <Check size={14} />
                                      {t('reactivate')}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setChangePlanModal({
                                        centerId: c.id,
                                        centerName: c.name ?? '',
                                        currentPlan: c.plan ?? 'starter',
                                      });
                                      setOpenActionsId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start"
                                  >
                                    <CreditCard size={14} />
                                    {t('changePlan')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteConfirm(c.id);
                                      setOpenActionsId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-start"
                                  >
                                    <Trash2 size={14} />
                                    {tCommon('delete')}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                          <Link
                            href={`/admin/centers/${c.id}`}
                            className="text-teal-400 hover:text-teal-300 text-sm font-medium transition-colors shrink-0"
                          >
                            {t('centersManage')}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {centersTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border-subtle)]">
                <span className="text-sm text-[var(--color-text-secondary)]">
                  {t('pageOf', { page: centersPage, total: centersTotalPages })}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => updateParams({ page: String(Math.max(1, centersPage - 1)) })}
                    disabled={centersPage === 1}
                    className="px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] disabled:opacity-40 text-[var(--color-text-primary)] rounded-lg text-sm transition-colors border border-[var(--color-border-subtle)]"
                  >
                    {t('prevPage')}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateParams({ page: String(Math.min(centersTotalPages, centersPage + 1)) })}
                    disabled={centersPage === centersTotalPages}
                    className="px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] disabled:opacity-40 text-[var(--color-text-primary)] rounded-lg text-sm transition-colors border border-[var(--color-border-subtle)]"
                  >
                    {t('nextPage')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-4 start-4 end-4 md:start-auto md:end-4 md:max-w-sm z-50 p-4 rounded-xl bg-[var(--color-surface-1)] border border-border shadow-lg">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{toast.msg}</p>
        </div>
      )}

      {detailCenter && (
        <div className="fixed inset-0 z-50" onClick={() => setDetailCenter(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute top-0 end-0 bottom-0 w-full max-w-md overflow-y-auto rounded-s-2xl border-s border-border bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-[var(--color-text-primary)] text-lg">{detailCenter.name}</h2>
              <button
                type="button"
                onClick={() => setDetailCenter(null)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {(
                [
                  {
                    label: t('owner'),
                    value: detailCenter.owner?.name ?? detailCenter.owner_name ?? null,
                    empty: tCommon('notAvailable'),
                  },
                  { label: tCommon('phone'), value: detailCenter.phone ?? null, empty: tCommon('notSet') },
                  { label: tCommon('email'), value: detailCenter.email ?? null, empty: tCommon('notSet') },
                  { label: t('plan'), value: detailCenter.plan ?? '', isPlan: true },
                  {
                    label: t('billingPeriod'),
                    value: detailCenter.billing_period ?? null,
                    empty: tCommon('notSet'),
                  },
                  { label: t('studentsCount'), value: String(detailCenter.students_count ?? 0) },
                  {
                    label: tCommon('status'),
                    value:
                      detailCenter.status != null && detailCenter.status !== ''
                        ? centerStatusLabel(detailCenter.status, tStatus)
                        : null,
                    empty: tCommon('notSet'),
                  },
                  { label: t('nextDue'), value: detailCenter.next_due ?? null, empty: tCommon('notSet') },
                  {
                    label: t('referralCode'),
                    value: detailCenter.referral_code ?? null,
                    empty: tCommon('notSet'),
                  },
                  {
                    label: t('lastActive'),
                    value: formatAdminLastActiveDisplay(detailCenter.last_active, locale, t),
                  },
                  { label: t('usage'), value: String(detailCenter.usage_scans ?? 0) },
                  {
                    label: t('createdAt'),
                    value: detailCenter.created_at ? formatDate(detailCenter.created_at, locale) : null,
                    empty: tCommon('notSet'),
                  },
                ] as Array<{ label: string; value: string | null; isPlan?: boolean; empty?: string }>
              ).map((row) => {
                const showEmpty = row.value == null || row.value === '';
                const rendered: ReactNode = row.isPlan ? (
                  <PlanBadge plan={row.value ?? ''} />
                ) : showEmpty ? (
                  <span className="text-[var(--color-text-muted)] text-xs italic">{row.empty ?? tCommon('notSet')}</span>
                ) : (
                  <p className="font-medium text-[var(--color-text-primary)]">{row.value}</p>
                );
                return (
                  <div key={row.label}>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{row.label}</p>
                    {rendered}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showSuspendConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowSuspendConfirm(null)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-sm mx-4 w-full bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-2">{t('confirmSuspend')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {t('suspendConfirmBody', { name: showSuspendConfirm.name })}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowSuspendConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={() => setPasswordConfirm({ center: showSuspendConfirm })}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700"
              >
                {tCommon('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="rounded-xl bg-[var(--color-surface-1)] p-6 w-[360px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2 text-[var(--color-text-primary)]">{t('deleteCenters')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-5">{t('deleteCenterPermanent')}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded text-sm border border-[var(--color-border-default)] bg-[var(--color-surface-2)]"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteCenter(deleteConfirm)}
                className="px-4 py-2 rounded text-sm font-medium text-white bg-red-600"
              >
                {tCommon('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {changePlanModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('changePlan')}</h2>
                <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{changePlanModal.centerName}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChangePlanModal(null);
                  setNewPlan('');
                }}
                className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                  {t('changePlanCurrent')}{' '}
                  <span className="font-semibold text-[var(--color-text-primary)] capitalize">
                    {changePlanModal.currentPlan}
                  </span>
                </p>
                <label className="text-sm font-medium text-[var(--color-text-primary)] block mb-2">
                  {t('changePlanNewLabel')}
                </label>
                <select
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                >
                  <option value="">{t('selectPlanPlaceholder')}</option>
                  <option value="nano">{tBilling('planNames.nano')}</option>
                  <option value="starter">{tBilling('planNames.starter')}</option>
                  <option value="pro">{tBilling('planNames.pro')}</option>
                  <option value="business">{tBilling('planNames.business')}</option>
                  <option value="enterprise">{tBilling('planNames.enterprise')}</option>
                  <option value="top_centers">{tBilling('planNames.top_centers')}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 pt-0">
              <button
                type="button"
                onClick={() => {
                  setChangePlanModal(null);
                  setNewPlan('');
                }}
                className="px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                disabled={!newPlan || newPlan === changePlanModal.currentPlan || changingPlan}
                onClick={async () => {
                  if (!newPlan || !changePlanModal) return;
                  setChangingPlan(true);
                  try {
                    await handleCenterAction(changePlanModal.centerId, 'change_plan', { newPlan });
                    setChangePlanModal(null);
                    setNewPlan('');
                  } finally {
                    setChangingPlan(false);
                  }
                }}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg"
              >
                {changingPlan ? t('changePlanSaving') : t('changePlan')}
              </button>
            </div>
          </div>
        </div>
      )}

      {blacklistModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setBlacklistModal(null)}
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">{t('blacklistCenter')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">{blacklistModal.name}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mb-2">{t('blacklistConfirm')}</p>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('blacklistReasonLabel')}
            </label>
            <textarea
              value={blacklistReasonInput}
              onChange={(e) => setBlacklistReasonInput(e.target.value)}
              className="w-full min-h-[88px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              placeholder={t('blacklistReasonPlaceholder')}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setBlacklistModal(null)}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border-subtle)]"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void handleBlacklistCenter()}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium disabled:opacity-50"
              >
                {actionLoading ? t('blacklistSaving') : t('blacklistMenu')}
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordConfirm && (
        <PasswordConfirmModal
          isOpen={!!passwordConfirm}
          onClose={() => setPasswordConfirm(null)}
          title={t('confirmSuspend')}
          onConfirm={async (password) => {
            await handleCenterAction(passwordConfirm.center.id, 'suspend', { password });
            setPasswordConfirm(null);
          }}
        />
      )}
    </div>
  );
}

export default function AdminCentersPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full flex items-center justify-center bg-[var(--color-surface-0)]">
          <div className="animate-spin h-8 w-8 border-2 border-teal-600 border-t-transparent rounded-full" />
        </div>
      }
    >
      <AdminCentersPageInner />
    </Suspense>
  );
}
