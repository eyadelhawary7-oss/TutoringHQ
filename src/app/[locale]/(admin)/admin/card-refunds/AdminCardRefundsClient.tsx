'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { RotateCcw } from 'lucide-react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { AdminSidebar } from '@/components/AdminSidebar';
import { RefundActionModal, type RefundModalVariant } from '@/components/admin/RefundActionModal';
import { useLayout } from '@/contexts/LayoutContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/lib/formatNumber';
import { useToast } from '@/hooks/useToast';

export type CardRefundRow = {
  id: string;
  center_id?: string;
  quantity?: number | null;
  total_amount?: number | null;
  status?: string;
  refund_status?: string | null;
  refund_requested_at?: string | null;
  created_at?: string | null;
  centers?: { name?: string | null } | null;
  card_order_items?: { count?: number }[] | null;
};

export type CardRefundsApiPayload = {
  orders: CardRefundRow[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
};

function shortOrderRef(id: string): string {
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}

function itemsCount(row: CardRefundRow): number {
  const emb = row.card_order_items;
  if (Array.isArray(emb) && emb[0] != null && typeof emb[0].count === 'number') {
    return Math.max(0, Math.round(emb[0].count));
  }
  return Math.max(0, Math.round(Number(row.quantity ?? 0)));
}

function centreName(row: CardRefundRow): string {
  const n = row.centers?.name;
  return n != null && String(n).trim() ? String(n) : '—';
}

function daysWaiting(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'paid' | 'rejected';

type SortKey = 'refund_requested_at' | 'total_amount' | 'created_at' | 'quantity';

export default function AdminCardRefundsClient({
  initialPayload,
}: {
  initialPayload: CardRefundsApiPayload;
}) {
  const t = useTranslations('admin.cardRefunds');
  const tRoot = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const { setHideShell } = useLayout();

  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [payload, setPayload] = useState<CardRefundsApiPayload>(initialPayload);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>('refund_requested_at');
  const [dirAsc, setDirAsc] = useState(false);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalVariant, setModalVariant] = useState<RefundModalVariant | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [rejectDraft, setRejectDraft] = useState('');
  const [externalRefDraft, setExternalRefDraft] = useState('');
  const skipInitialFetch = useRef(true);

  const isRTL = locale === 'ar';

  const canSuper = adminRole === 'super_admin';
  const canMarkPaid = canSuper || adminRole === 'admin';

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token || cancelled) return;
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { role?: string };
      if (!cancelled) setAdminRole(data.role ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchList = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: filter,
        page: String(page),
        pageSize: '20',
        sort,
        dir: dirAsc ? 'asc' : 'desc',
      });
      const res = await fetch(`/api/admin/card-order-refunds?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        toast.error(tRoot('common.errorGeneric'));
        return;
      }
      const body = (await res.json()) as CardRefundsApiPayload;
      setPayload(body);
    } finally {
      setLoading(false);
    }
  }, [filter, page, sort, dirAsc, toast, tRoot]);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    const onFocus = () => {
      void fetchList();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchList]);

  const orders = payload.orders ?? [];
  const total = payload.total ?? 0;
  const pageSize = payload.pageSize ?? 20;
  const pendingCount = payload.pendingCount ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const headerBadge = useMemo(() => {
    if (pendingCount <= 0) return null;
    return (
      <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-2 text-xs font-bold text-white tabular-nums">
        {pendingCount}
      </span>
    );
  }, [pendingCount]);

  function openModal(orderId: string, variant: RefundModalVariant) {
    setActiveOrderId(orderId);
    setModalVariant(variant);
    setRejectDraft('');
    setExternalRefDraft('');
    setModalOpen(true);
  }

  function closeModal() {
    if (modalBusy) return;
    setModalOpen(false);
    setModalVariant(null);
    setActiveOrderId(null);
  }

  async function submitModal() {
    if (!activeOrderId || !modalVariant) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const body: Record<string, unknown> = { orderId: activeOrderId, action: modalVariant };
    if (modalVariant === 'reject') body.reason = rejectDraft.trim();
    if (modalVariant === 'mark_paid') body.external_reference = externalRefDraft.trim();

    setModalBusy(true);
    try {
      const res = await fetch('/api/admin/card-order-refunds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(j.error ?? tRoot('common.errorGeneric'));
        return;
      }
      toast.success(t('toastSuccess'));
      setModalOpen(false);
      setModalVariant(null);
      setActiveOrderId(null);
      await fetchList();
    } finally {
      setModalBusy(false);
    }
  }

  function toggleSort(next: SortKey) {
    setPage(1);
    if (sort === next) {
      setDirAsc((d) => !d);
    } else {
      setSort(next);
      setDirAsc(false);
    }
  }

  function pillClass(active: boolean) {
    return cn(
      'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors border',
      active
        ? 'border-teal-600 bg-teal-600 text-white'
        : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
    );
  }

  function refundStatusPill(status: string) {
    const s = status.toLowerCase();
    const map: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
      approved: 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
      paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
      rejected: 'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-100',
    };
    const cls = map[s] ?? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]';
    const label =
      s === 'pending'
        ? t('status.pending')
        : s === 'approved'
          ? t('status.approved')
          : s === 'paid'
            ? t('status.paid')
            : s === 'rejected'
              ? t('status.rejected')
              : s;
    return (
      <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', cls)}>
        {label}
      </span>
    );
  }

  const sortIndicator = (k: SortKey) => (sort === k ? (dirAsc ? ' ↑' : ' ↓') : '');

  return (
    <>
      <AdminHeader />
      <div className="flex flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <AdminSidebar activeRoute="/admin/card-refunds" />
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:ms-56">
          <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <RotateCcw className="h-8 w-8 text-teal-600 shrink-0" aria-hidden />
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
              {headerBadge}
              {loading ? (
                <span className="text-xs text-[var(--color-text-muted)] ms-auto">{t('loading')}</span>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', t('filter.all')] as const,
                  ['pending', t('filter.pending')] as const,
                  ['approved', t('filter.approved')] as const,
                  ['paid', t('filter.paid')] as const,
                  ['rejected', t('filter.rejected')] as const,
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={pillClass(filter === key)}
                  onClick={() => {
                    setFilter(key);
                    setPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {orders.length === 0 && !loading ? (
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-10 text-center text-sm text-[var(--color-text-secondary)]">
                {t('empty')}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-x-auto shadow-sm">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                      <th className="px-3 py-3 text-start font-semibold">{t('col.order')}</th>
                      <th className="px-3 py-3 text-start font-semibold">{t('col.centre')}</th>
                      <th className="px-3 py-3 text-start font-semibold">
                        <button type="button" className="font-semibold hover:text-teal-600" onClick={() => toggleSort('quantity')}>
                          {t('col.items')}
                          {sortIndicator('quantity')}
                        </button>
                      </th>
                      <th className="px-3 py-3 text-start font-semibold">
                        <button type="button" className="font-semibold hover:text-teal-600" onClick={() => toggleSort('total_amount')}>
                          {t('col.total')}
                          {sortIndicator('total_amount')}
                        </button>
                      </th>
                      <th className="px-3 py-3 text-start font-semibold">{t('col.refundStatus')}</th>
                      <th className="px-3 py-3 text-start font-semibold">
                        <button type="button" className="font-semibold hover:text-teal-600" onClick={() => toggleSort('refund_requested_at')}>
                          {t('col.requested')}
                          {sortIndicator('refund_requested_at')}
                        </button>
                      </th>
                      <th className="px-3 py-3 text-start font-semibold">{t('col.daysWaiting')}</th>
                      <th className="px-3 py-3 text-start font-semibold">{t('col.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((row) => {
                      const id = String(row.id ?? '');
                      const rs = String(row.refund_status ?? '');
                      const reqAt = row.refund_requested_at ?? null;
                      const dw = daysWaiting(reqAt);
                      return (
                        <tr key={id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                          <td className="px-3 py-3">
                            <Link
                              href={`/orders/${encodeURIComponent(id)}`}
                              className="font-mono text-teal-700 hover:underline dark:text-teal-400"
                            >
                              #{shortOrderRef(id)}
                            </Link>
                          </td>
                          <td className="px-3 py-3 max-w-[200px] truncate" title={centreName(row)}>
                            {centreName(row)}
                          </td>
                          <td className="px-3 py-3 tabular-nums">{itemsCount(row)}</td>
                          <td className="px-3 py-3 tabular-nums">{formatCurrency(Number(row.total_amount ?? 0), locale)}</td>
                          <td className="px-3 py-3">{refundStatusPill(rs)}</td>
                          <td className="px-3 py-3 text-[var(--color-text-secondary)] whitespace-nowrap">
                            {reqAt ? formatDateTime(String(reqAt), locale) : '—'}
                          </td>
                          <td className="px-3 py-3 tabular-nums">{dw}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              {canSuper && rs === 'pending' ? (
                                <>
                                  <button
                                    type="button"
                                    className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400 text-start"
                                    onClick={() => openModal(id, 'approve')}
                                  >
                                    {t('action.approve')}
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs font-semibold text-red-700 hover:underline dark:text-red-400 text-start"
                                    onClick={() => openModal(id, 'reject')}
                                  >
                                    {t('action.reject')}
                                  </button>
                                </>
                              ) : null}
                              {canMarkPaid && rs === 'approved' ? (
                                <button
                                  type="button"
                                  className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300 text-start"
                                  onClick={() => openModal(id, 'mark_paid')}
                                >
                                  {t('action.markPaid')}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {total > 0 && totalPages > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-text-secondary)]">
                <span>{t('pagination', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('prev')}
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages || loading}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    {t('next')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <RefundActionModal
        open={modalOpen}
        variant={modalVariant}
        loading={modalBusy}
        rejectReason={rejectDraft}
        onRejectReasonChange={setRejectDraft}
        externalReference={externalRefDraft}
        onExternalReferenceChange={setExternalRefDraft}
        onClose={closeModal}
        onConfirm={submitModal}
      />
    </>
  );
}
