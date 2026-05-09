'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
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
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CardOrderCartHeader } from '@/components/orders/CardOrderCartHeader';
import { CardOrderCartContents } from '@/components/orders/CardOrderCartContents';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';

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
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
    case 'confirmed':
    case 'paid':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200';
    case 'printing':
    case 'processing':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200';
    case 'shipped':
      return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200';
    case 'delivered':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200';
    case 'cancelled':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200';
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
  | 'statusCancelled';

function statusLabelKey(status: string): CardOrderStatusKey {
  if (status === 'confirmed') return 'statusConfirmed';
  if (status === 'printing' || status === 'processing') return 'statusProcessing';
  if (status === 'shipped') return 'statusShipped';
  if (status === 'delivered') return 'statusDelivered';
  if (status === 'cancelled') return 'statusCancelled';
  return 'statusPending';
}

export default function OrdersPageClient({
  initialShippingQuote,
  bostaShippingRates,
}: {
  initialShippingQuote: CardOrdersShippingQuote | null;
  bostaShippingRates: Record<string, number> | null;
}) {
  const t = useTranslations('cardOrders');
  const tOrders = useTranslations('orders');
  const locale = useLocale();
  const { refresh } = useCardOrderCart();

  const [centerInfo, setCenterInfo] = useState<CenterInfoState | null>(null);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [orders, setOrders] = useState<CardOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const loadData = useCallback(async () => {
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
      setCenterInfo({
        governorate: meData.user.center?.governorate ?? null,
      });

      const [studentsRes, ordersRes] = await Promise.all([
        dbSelect({
          table: 'students',
          select: 'id, name, student_number',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
          order: { column: 'name', ascending: true },
        }),
        dbSelect({
          table: 'card_orders',
          select: '*',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
          order: { column: 'created_at', ascending: false },
        }),
      ]);

      if (studentsRes.data && Array.isArray(studentsRes.data)) {
        setStudents(studentsRes.data as StudentLite[]);
      }
      if (ordersRes.data && Array.isArray(ordersRes.data)) {
        setOrders(ordersRes.data as CardOrderRow[]);
      }
      await refresh();
    } catch {
      setLoadError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, refresh]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  const liveGov = centerInfo?.governorate?.trim();
  const showGovernorateHint = !loading && !!centerInfo && !liveGov?.length;
  const showShippingEstimate = !loading && !!centerInfo && !!liveGov?.length;
  const estimateFee = liveGov ? getShippingFee(liveGov, bostaShippingRates) : 0;
  const estimateZoneEn = liveGov ? getShippingZone(liveGov, bostaShippingRates) : '';

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] animate-fade-in pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0">
      <div className="px-4 pt-4 pb-6 max-w-3xl mx-auto w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('ordersTitle')}</h1>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">{t('ordersSubtitle')}</p>
          </div>
        </div>

        {loading && initialShippingQuote?.hasGovernorate === false ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
            {t('governorateShippingHint')}
          </div>
        ) : null}

        {centerInfo && showGovernorateHint ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
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
                cardTotal: formatCurrency(62, locale),
                ship: formatCurrency(estimateFee, locale),
                total: formatCurrency(62 + estimateFee, locale),
              })}
            </p>
          </div>
        ) : null}

        <CardOrderCartHeader />
        <CardOrderCartContents studentsForPicker={students} />

        <div className="mt-10 border-t border-[var(--color-border-subtle)] pt-8">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{t('orderHistorySection')}</h2>

          {loadError && !loading ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100 mb-4">
              <p>{loadError}</p>
              <button
                type="button"
                onClick={() => startTransition(() => void loadData())}
                className="mt-2 text-xs font-semibold text-teal-400 underline"
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
          ) : orders.length === 0 ? (
            <div className="card p-8 text-center border border-[var(--color-border-subtle)]">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('ordersEmpty')}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {orders.map((order) => {
                const shortId = order.id.replace(/-/g, '').slice(-8).toUpperCase();
                const expanded = expandedId === order.id;
                const lines = parseStudentLines(order.students);
                const pricePer = order.price_per_card ?? 62;
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
                            #{shortId}
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
                          className="inline-block mt-2 text-xs font-semibold text-teal-600 dark:text-teal-400 underline"
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
          )}
        </div>
      </div>
    </div>
  );
}
