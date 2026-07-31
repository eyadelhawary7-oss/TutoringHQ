'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import {
  formatShippingZoneForLocale,
  getShippingFee,
  getShippingZone,
} from '@/lib/bostaShipping';
import { cardOrderProductInclusiveFromQty } from '@/lib/pricing/taxMath';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CardOrderCartHeader } from '@/components/orders/CardOrderCartHeader';
import { CardOrderCartContents } from '@/components/orders/CardOrderCartContents';
import { CardOrderMobileStickyFooter } from '@/components/orders/CardOrderMobileStickyFooter';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useToast } from '@/components/ui/ToastProvider';
import { SectionHeader } from '@/components/shared';

export type CardOrdersShippingQuote = {
  hasGovernorate: boolean;
  fee: number;
  zoneEn: string;
};

interface StudentLite {
  id: string;
  name: string;
  student_number?: string | null;
}

interface CenterInfoState {
  governorate?: string | null;
}

interface CardOrderRow {
  id: string;
  center_id: string;
  students: unknown;
  quantity: number;
  price_per_card?: number | null;
  delivery_fee?: number | null;
  shipping_zone?: string | null;
  total_amount: number;
  status: string;
  delivery_address?: string | null;
  notes?: string | null;
  created_at: string;
}

const CARD_UNIT_INCLUSIVE_EGP = cardOrderProductInclusiveFromQty(1);

function parseStudentLines(studentsJson: unknown): string[] {
  if (!Array.isArray(studentsJson) || studentsJson.length === 0) return [];
  const first = studentsJson[0];
  if (typeof first === 'string') {
    return (studentsJson as string[]).map((id) => `Student ${id}`);
  }
  if (typeof first === 'object' && first !== null && 'name' in first) {
    return (studentsJson as { name?: string }[]).map((s) => (s.name?.trim() ? s.name : '-'));
  }
  return [];
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':
    case 'pending_payment':
      return 'bg-amber-100 text-amber-800';
    case 'paid':
    case 'vendor_assigned':
      return 'bg-blue-100 text-blue-800';
    case 'printing':
    case 'processing':
    case 'in_production':
      return 'bg-purple-100 text-purple-800';
    case 'ready_for_pickup':
      return 'bg-cyan-100 text-cyan-800';
    case 'shipped':
    case 'in_transit':
      return 'bg-teal-100 text-teal-800';
    case 'delivered':
    case 'issued':
    case 'confirmed':
      return 'bg-green-100 text-green-800';
    case 'cancelled':
    case 'refunded':
      return 'bg-red-100 text-red-800';
    case 'failed':
      return 'bg-amber-100 text-amber-900';
    default:
      return 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border)]';
  }
}

type CardOrderStatusKey =
  | 'statusPending'
  | 'statusConfirmed'
  | 'statusProcessing'
  | 'statusShipped'
  | 'statusDelivered'
  | 'statusCancelled'
  | 'statusVendorAssigned'
  | 'statusInProduction'
  | 'statusReadyPickup'
  | 'statusInTransit'
  | 'statusIssued'
  | 'statusRefunded'
  | 'statusFailed';

function statusLabelKey(status: string): CardOrderStatusKey {
  if (status === 'vendor_assigned') return 'statusVendorAssigned';
  if (status === 'in_production' || status === 'printing' || status === 'processing') return 'statusInProduction';
  if (status === 'ready_for_pickup') return 'statusReadyPickup';
  if (status === 'in_transit' || status === 'shipped') return 'statusInTransit';
  if (status === 'delivered') return 'statusDelivered';
  if (status === 'issued' || status === 'confirmed') return 'statusIssued';
  if (status === 'refunded') return 'statusRefunded';
  if (status === 'failed') return 'statusFailed';
  if (status === 'cancelled') return 'statusCancelled';
  return 'statusPending';
}

export default function OrdersPageClient({
  checkoutError,
  initialShippingQuote,
  bostaShippingRates,
}: {
  checkoutError?: string | null;
  initialShippingQuote: CardOrdersShippingQuote | null;
  bostaShippingRates: Record<string, number> | null;
}) {
  const t = useTranslations('cardOrders');
  const tHist = useTranslations('orderHistory');
  const tOrders = useTranslations('orders');
  const tCheckoutErr = useTranslations('checkout.errors');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const { refresh, activeItemCount } = useCardOrderCart();

  const pageSize = 20;

  const [centerInfo, setCenterInfo] = useState<CenterInfoState | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [orders, setOrders] = useState<CardOrderRow[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [histLoading, setHistLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [page, setPage] = useState(1);
  const [histFilter, setHistFilter] = useState<'all' | 'active' | 'delivered' | 'cancelled' | 'failed'>('all');
  const [sortCol, setSortCol] = useState<'created_at' | 'status' | 'quantity' | 'total_amount'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const tid = window.setTimeout(() => setDebouncedQ(searchQ.trim()), 320);
    return () => window.clearTimeout(tid);
  }, [searchQ]);

  useEffect(() => {
    setPage(1);
  }, [histFilter, debouncedQ, sortCol, sortDir]);

  const loadBootstrap = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        return;
      }

      const meRes = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!meRes.ok) {
        setLoadError(t('loadFailed'));
        return;
      }
      const meData = await meRes.json();
      if (!meData?.user?.center_id) {
        return;
      }

      const cid = meData.user.center_id as string;
      setCenterId(cid);
      setCenterInfo({
        governorate: meData.user.center?.governorate ?? null,
      });

      const studentsRes = await dbSelect({
        table: 'students',
        select: 'id, name, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name', ascending: true },
      });

      if (studentsRes.data && Array.isArray(studentsRes.data)) {
        setStudents(studentsRes.data as StudentLite[]);
      }
      await refresh();
    } catch {
      setLoadError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, refresh]);

  const loadHistory = useCallback(async () => {
    if (!centerId) return;
    setHistLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const params = new URLSearchParams({
        page: String(page),
        filter: histFilter,
        sort: sortCol,
        dir: sortDir,
      });
      if (debouncedQ) params.set('q', debouncedQ);

      const res = await fetch(`/api/orders/history?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setLoadError(t('loadFailed'));
        return;
      }
      const body = (await res.json()) as { orders?: CardOrderRow[]; total?: number };
      setOrders(body.orders ?? []);
      setOrdersTotal(Number(body.total ?? 0));
    } catch {
      setLoadError(t('loadFailed'));
    } finally {
      setHistLoading(false);
    }
  }, [centerId, page, histFilter, sortCol, sortDir, debouncedQ, t]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!checkoutError?.trim()) return;
    const key = checkoutError.trim();
    const msg =
      key === 'no_center'
        ? tCheckoutErr('noCenter')
        : key === 'no_cart'
          ? tCheckoutErr('noCart')
          : key === 'below_minimum'
            ? tCheckoutErr('belowMinimum')
            : tCheckoutErr('generic');
    toast.error(msg);
    router.replace('/orders');
  }, [checkoutError, router, toast, tCheckoutErr]);

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setLoadError((prev) => prev ?? t('loadTimeout'));
    }, 10000);
    return () => window.clearTimeout(timeout);
  }, [loading, t]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const totalPages = Math.max(1, Math.ceil(ordersTotal / pageSize));
  const rangeFrom = ordersTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, ordersTotal);

  function onSort(col: typeof sortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'status' ? 'asc' : 'desc');
    }
  }

  const trulyNoOrders =
    ordersTotal === 0 && page === 1 && !debouncedQ && histFilter === 'all';

  const liveGov = centerInfo?.governorate?.trim();
  const showGovernorateHint = !loading && !!centerInfo && !liveGov?.length;
  const showShippingEstimate = !loading && !!centerInfo && !!liveGov?.length;
  const estimateFee = liveGov ? getShippingFee(liveGov, bostaShippingRates) : 0;
  const estimateZoneEn = liveGov ? getShippingZone(liveGov, bostaShippingRates) : '';

  return (
    <div
      className={`min-h-screen w-full bg-[var(--color-surface-0)] animate-fade-in md:pb-0 ${
        activeItemCount > 0
          ? 'pb-[calc(120px+env(safe-area-inset-bottom,0px)+56px)] md:pb-0'
          : 'pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0'
      }`}
    >
      <div className="px-4 pt-4 pb-6 max-w-3xl mx-auto w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('ordersTitle')}</h1>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">{t('ordersSubtitle')}</p>
          </div>
        </div>

        {loading && initialShippingQuote?.hasGovernorate === false ? (
          <div className="mb-4 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-4 py-3 text-sm text-[var(--color-warning)]">
            {t('governorateShippingHint')}
          </div>
        ) : null}

        {centerInfo && showGovernorateHint ? (
          <div className="mb-4 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-4 py-3 text-sm text-[var(--color-warning)]">
            {t('governorateShippingHint')}
          </div>
        ) : null}

        {centerInfo && showShippingEstimate ? (
          <div className="mb-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3 text-sm text-[var(--color-text-primary)] space-y-1">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
              {t('shippingEstimateTitle')}
            </p>
            <p>
              {t('shippingToZone', {
                zone: formatShippingZoneForLocale(estimateZoneEn, locale),
                fee: formatCurrency(estimateFee, locale),
              })}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {t('shippingEstimateExample', {
                qty: 1,
                cardTotal: formatCurrency(CARD_UNIT_INCLUSIVE_EGP, locale),
                ship: formatCurrency(estimateFee, locale),
                total: formatCurrency(CARD_UNIT_INCLUSIVE_EGP + estimateFee, locale),
              })}
            </p>
          </div>
        ) : null}

        <CardOrderCartHeader />
        <CardOrderCartContents studentsForPicker={students} centerId={centerId} />
        <CardOrderMobileStickyFooter />

        <div className="mt-10 border-t border-[var(--color-border-subtle)] pt-8">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{t('orderHistorySection')}</h2>

          {!loading ? (
            <div className="space-y-3 mb-4">
              <input
                type="search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder={tHist('searchPlaceholder')}
                className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {(['all', 'active', 'delivered', 'cancelled', 'failed'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setHistFilter(f)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                      histFilter === f
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {tHist(f === 'all' ? 'filterAll' : f === 'active' ? 'filterActive' : f === 'delivered' ? 'filterDelivered' : f === 'cancelled' ? 'filterCancelled' : 'filterFailed')}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                {tHist('showing', { from: rangeFrom, to: rangeTo, total: ordersTotal })}
              </p>
            </div>
          ) : null}

          {loadError && !loading ? (
            <div className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-4 py-3 text-sm text-[var(--color-warning)] mb-4">
              <p>{loadError}</p>
              <button
                type="button"
                onClick={() =>
                  startTransition(() => {
                    void loadBootstrap();
                    if (centerId) void loadHistory();
                  })
                }
                className="mt-2 text-xs font-semibold text-teal-700 underline"
              >
                {t('tryAgain')}
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] animate-pulse"
                />
              ))}
            </div>
          ) : trulyNoOrders && !histLoading ? (
            <div className="card p-8 text-center border border-[var(--color-border-subtle)]">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('ordersEmpty')}</p>
            </div>
          ) : orders.length === 0 && !histLoading ? (
            <div className="card p-8 text-center border border-[var(--color-border-subtle)]">
              <p className="text-sm text-[var(--color-text-secondary)]">{tHist('emptyFiltered')}</p>
            </div>
          ) : (
            <>
              <ul className={`space-y-3 ${histLoading ? 'opacity-60 pointer-events-none' : ''}`}>
              {orders.map((order) => {
                const shortId = order.id.replace(/-/g, '').slice(-8).toUpperCase();
                const expanded = expandedId === order.id;
                const lines = parseStudentLines(order.students);
                const pricePer = order.price_per_card ?? CARD_UNIT_INCLUSIVE_EGP;
                const deliveryFee = Number(order.delivery_fee ?? 0);
                const subtotal = Math.round(order.quantity * pricePer * 100) / 100;
                const zoneLabel =
                  order.shipping_zone != null && String(order.shipping_zone).trim()
                    ? formatShippingZoneForLocale(String(order.shipping_zone), locale)
                    : null;

                return (
                  <li
                    key={order.id}
                    className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(order.id)}
                      className="w-full flex items-center gap-3 p-4 text-start hover:bg-[var(--color-surface-0)]/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">
                            <bdi>#{shortId}</bdi>
                          </span>
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(order.status)}`}
                          >
                            {t(statusLabelKey(order.status))}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--color-text-tertiary)]">
                          {t('orderDate')}:{' '}
                          {formatDate(order.created_at, locale, {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                          {formatNumber(order.quantity, locale)}{' '}
                          {order.quantity === 1 ? tOrders('card') : tOrders('cards')} · {t('orderTotal')}:{' '}
                          {formatCurrency(Number(order.total_amount), locale)}
                        </p>
                        <Link
                          href={`/orders/${order.id}`}
                          className="inline-block mt-2 text-xs font-semibold text-teal-600 underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t('viewOrder')}
                        </Link>
                      </div>
                      {expanded ? (
                        <ChevronUp className="w-5 h-5 text-[var(--color-text-tertiary)] shrink-0" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-[var(--color-text-tertiary)] shrink-0" />
                      )}
                    </button>
                    {expanded && (
                      <div className="px-4 pb-4 pt-0 border-t border-[var(--color-border-subtle)] space-y-3 text-sm">
                        <div>
                          <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                            {t('orderDetails')}
                          </p>
                          <ul className="list-disc list-inside text-[var(--color-text-primary)] space-y-0.5">
                            {lines.length > 0 ? (
                              lines.map((line, i) => <li key={i}>{line}</li>)
                            ) : (
                              <li>-</li>
                            )}
                          </ul>
                        </div>
                        {order.delivery_address ? (
                          <div>
                            <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                              {t('deliveryAddress')}
                            </p>
                            <p className="text-[var(--color-text-primary)]">{order.delivery_address}</p>
                          </div>
                        ) : null}
                        <div className="rounded-lg border border-[var(--color-border-subtle)] p-3 space-y-1.5 bg-[var(--color-surface-0)]/40">
                          <div className="flex justify-between gap-2">
                            <span className="text-[var(--color-text-secondary)]">
                              {t('orderLineCards', {
                                qty: order.quantity,
                                unit: formatCurrency(Number(pricePer), locale),
                                sub: formatCurrency(subtotal, locale),
                              })}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-[var(--color-text-secondary)]">
                              {zoneLabel ? t('orderLineShippingZone', { zone: zoneLabel }) : t('deliveryFee')}
                            </span>
                            <span className="font-mono font-medium">{formatCurrency(deliveryFee, locale)}</span>
                          </div>
                          <div className="border-t border-[var(--color-border-subtle)] pt-1.5 flex justify-between gap-2 font-semibold">
                            <span>{t('totalAmount')}</span>
                            <span className="font-mono">{formatCurrency(Number(order.total_amount), locale)}</span>
                          </div>
                        </div>
                        {order.notes?.trim() ? (
                          <div>
                            <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                              {t('notesLabel')}
                            </p>
                            <p className="text-[var(--color-text-primary)]">{order.notes}</p>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
              </ul>
              {totalPages > 1 ? (
                <div className="flex items-center justify-between gap-3 mt-4 text-sm">
                  <button
                    type="button"
                    disabled={page <= 1 || histLoading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 rounded-lg border border-[var(--color-border-subtle)] disabled:opacity-40"
                  >
                    {tHist('pagePrev')}
                  </button>
                  <span className="text-[var(--color-text-secondary)]">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages || histLoading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1 rounded-lg border border-[var(--color-border-subtle)] disabled:opacity-40"
                  >
                    {tHist('pageNext')}
                  </button>
                </div>
              ) : null}
            </>
          )}

          {!loading ? (
            <div className="mt-6 pt-4 border-t border-[var(--color-border-subtle)]">
              <div className="mb-2">
                <SectionHeader title={tCommon('moreActions')} />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-[var(--color-text-tertiary)]">{tHist('sortBy')}</span>
                <button type="button" className="font-semibold text-teal-700 underline-offset-2 hover:underline" onClick={() => onSort('created_at')}>
                  {tHist('colDate')}
                  {sortCol === 'created_at' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
                <button type="button" className="font-semibold text-teal-700 underline-offset-2 hover:underline" onClick={() => onSort('status')}>
                  {tHist('colStatus')}
                  {sortCol === 'status' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
                <button type="button" className="font-semibold text-teal-700 underline-offset-2 hover:underline" onClick={() => onSort('quantity')}>
                  {tHist('colItems')}
                  {sortCol === 'quantity' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
                <button type="button" className="font-semibold text-teal-700 underline-offset-2 hover:underline" onClick={() => onSort('total_amount')}>
                  {tHist('colTotal')}
                  {sortCol === 'total_amount' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
