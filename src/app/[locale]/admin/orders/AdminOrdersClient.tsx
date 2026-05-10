'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/routing';
import {
  Package,
  Clock,
  Printer,
  Truck,
  CheckCircle,
  X,
  MessageCircle,
  Eye,
  CircleDollarSign,
  PackageOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CardTemplatePreview from '@/components/CardTemplatePreview';
import { AdminSidebar } from '@/components/AdminSidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import type { AdminCardOrderRow, CardOrderFulfillmentStatus } from '@/types/admin-card-orders';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { formatDate, formatDateTime, formatCurrency } from '@/lib/formatNumber';
import { formatShippingZoneForLocale } from '@/lib/bostaShipping';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

const STATUS_ORDER: CardOrderFulfillmentStatus[] = [
  'pending',
  'paid',
  'printing',
  'ready_for_pickup',
  'shipped',
  'delivered',
  'confirmed',
];

const STATUS_CONFIG: Record<
  CardOrderFulfillmentStatus,
  { color: string; bg: string; icon: React.ElementType; label: string }
> = {
  pending: {
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10',
    icon: Clock,
    label: 'statusPending',
  },
  paid: {
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
    icon: CircleDollarSign,
    label: 'statusPaid',
  },
  printing: {
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-500/10',
    icon: Printer,
    label: 'statusPrinting',
  },
  ready_for_pickup: {
    color: 'text-cyan-600 dark:text-cyan-400',
    bg: 'bg-cyan-500/10',
    icon: PackageOpen,
    label: 'statusReadyPickup',
  },
  shipped: {
    color: 'text-teal-600 dark:text-teal-400',
    bg: 'bg-teal-500/10',
    icon: Truck,
    label: 'statusShipped',
  },
  delivered: {
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10',
    icon: CheckCircle,
    label: 'statusDelivered',
  },
  confirmed: {
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
    icon: CheckCircle,
    label: 'statusConfirmed',
  },
};

function cfgFor(status: CardOrderFulfillmentStatus) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
}

function waDigits(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('20')) return d;
  if (d.startsWith('0')) return `20${d.slice(1)}`;
  return `20${d}`;
}

export default function AdminOrdersClient({ initialOrders }: { initialOrders: AdminCardOrderRow[] }) {
  const tIdCards = useTranslations('idCards');
  const tCommon = useTranslations('common');
  const tAdmin = useTranslations('admin');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { closeMainSidebar } = useSidebar() ?? {};
  const [orders, setOrders] = useState<AdminCardOrderRow[]>(initialOrders);
  const [filter, setFilter] = useState<'all' | CardOrderFulfillmentStatus>(() => {
    const f = searchParams?.get('filter');
    if (f && STATUS_ORDER.includes(f as CardOrderFulfillmentStatus)) {
      return f as CardOrderFulfillmentStatus;
    }
    return 'all';
  });
  const [slideOverId, setSlideOverId] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [bookingCourier, setBookingCourier] = useState<string | null>(null);

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    if (typeof closeMainSidebar === 'function') closeMainSidebar();
  }, [closeMainSidebar]);

  const filteredOrders = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
  const slideOrder = orders.find((o) => o.id === slideOverId);

  const applyFilter = useCallback(
    (f: 'all' | CardOrderFulfillmentStatus) => {
      setFilter(f);
      if (f === 'all') {
        router.replace(pathname);
      } else {
        router.replace(`${pathname}?filter=${encodeURIComponent(f)}`);
      }
    },
    [pathname, router],
  );

  const kpis = [
    { label: tIdCards('totalOrders'), value: orders.length, icon: Package, color: '#3B82F6' },
    {
      label: tIdCards('statusPending'),
      value: orders.filter((o) => o.status === 'pending').length,
      icon: Clock,
      color: '#F59E0B',
    },
    {
      label: tIdCards('statusPrinting'),
      value: orders.filter((o) => o.status === 'printing').length,
      icon: Printer,
      color: '#7C3AED',
    },
    {
      label: tIdCards('statusDelivered'),
      value: orders.filter((o) => o.status === 'delivered').length,
      icon: CheckCircle,
      color: '#16A34A',
    },
  ];

  const downloadOrderPdf = useCallback(
    async (orderId: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error(tCommon('errorGeneric'));
        return;
      }
      try {
        const res = await fetch(`/api/admin/card-orders/${orderId}/pdf`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          toast.error(tCommon('errorGeneric'));
          return;
        }
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition');
        let filename = `CenterHQ-${orderId}.pdf`;
        const m = cd?.match(/filename="([^"]+)"/);
        if (m?.[1]) filename = m[1];
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        toast.error(tCommon('errorGeneric'));
      }
    },
    [toast, tCommon],
  );

  const updateStatus = useCallback(
    async (orderId: string, newStatus: CardOrderFulfillmentStatus) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      setStatusSavingId(orderId);
      try {
        const res = await fetch('/api/admin/card-orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id: orderId, status: newStatus }),
        });
        if (!res.ok) return;
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
      } finally {
        setStatusSavingId(null);
      }
    },
    [],
  );

  const cardsSubtotal = (o: AdminCardOrderRow) =>
    Math.round(o.quantity * o.price_per_card * 100) / 100;

  return (
    <div className="-mt-14">
      <div className="flex flex-1 min-h-0 min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100dvh-3.5rem)]">
        <AdminSidebar activeRoute={pathname} />
        <div className="w-full flex-1 p-6 space-y-5 overflow-auto animate-fade-in min-w-0 lg:ms-56">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{tIdCards('adminTitle')}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{tIdCards('adminSubtitle')}</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {kpis.map(({ label, value, icon: Icon, color }) => (
            <div
              key={label}
              className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-1">{label}</p>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">{value}</p>
                </div>
                <div
                  className="p-3 rounded-full shrink-0 flex items-center justify-center"
                  style={{ background: `${color}22` }}
                >
                  <Icon className="w-5 h-5" style={{ color }} aria-hidden />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => applyFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              filter === 'all'
                ? 'bg-primary/10 text-primary'
                : 'text-[var(--color-text-secondary)] hover:bg-muted',
            )}
          >
            {tCommon('all')}
          </button>
          {STATUS_ORDER.map((f) => {
            const cfg = cfgFor(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => applyFilter(f)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  filter === f
                    ? 'bg-primary/10 text-primary'
                    : 'text-[var(--color-text-secondary)] hover:bg-muted',
                )}
              >
                {tIdCards(cfg.label)}
              </button>
            );
          })}
        </div>

        {filteredOrders.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-center py-16 px-4 text-[var(--color-text-secondary)]">
            <div className="mx-auto mb-4 w-20 h-20 relative">
              <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-[var(--color-border-default)]/40" />
              <div className="absolute top-3 start-3 end-3 h-3 rounded bg-[var(--color-text-tertiary)]/10" />
              <div className="absolute top-8 start-3 end-6 h-2 rounded bg-[var(--color-text-tertiary)]/8" />
              <div className="absolute top-12 start-3 end-8 h-2 rounded bg-[var(--color-text-tertiary)]/6" />
            </div>
            <p className="font-medium text-[var(--color-text-primary)]">{tIdCards('noOrders')}</p>
            <p className="text-sm mt-1">{tIdCards('noOrdersDesc')}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border-subtle)] overflow-hidden bg-[var(--color-surface-1)]">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--color-surface-2)]">
                  <tr>
                    <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {tIdCards('orderNumber')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {tAdmin('center')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {tIdCards('cards')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {tIdCards('total')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {tCommon('status')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {tCommon('date')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {tCommon('actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const cfg = cfgFor(order.status);
                    const StatusIcon = cfg.icon;
                    const returnToBase = filter === 'all' ? pathname : `${pathname}?filter=${encodeURIComponent(filter)}`;
                    const detailUrl = `/admin/card-orders/${order.id}?returnTo=${encodeURIComponent(returnToBase)}`;
                    const idLast8 = order.id.replace(/-/g, '').slice(-8).toUpperCase();
                    return (
                      <tr
                        key={order.id}
                        role="link"
                        tabIndex={0}
                        onClick={() => router.push(detailUrl)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            router.push(detailUrl);
                          }
                        }}
                        className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-0)] transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono">
                          #{idLast8}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-medium">
                          {order.center_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono">
                          {order.quantity}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono font-bold">
                          {formatCurrency(Number(order.total_amount), locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              cfg.bg,
                              cfg.color,
                            )}
                          >
                            <StatusIcon size={10} aria-hidden /> {tIdCards(cfg.label)}
                          </span>
                          {order.vendor_notify_failed ? (
                            <span
                              title={tIdCards('vendorNotifyFailed')}
                              className="ms-1 text-amber-400 text-sm"
                            >
                              ⚠️
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                          {formatDate(order.created_at, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSlideOverId(order.id);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Eye size={12} aria-hidden /> {tCommon('view')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {slideOrder && (
          <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSlideOverId(null)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-md bg-[var(--color-surface-1)] border-s border-border h-full overflow-y-auto animate-fade-in"
              onClick={(e) => e.stopPropagation()}
              style={{ animation: 'slideInRight 0.3s ease' }}
            >
              <div className="sticky top-0 bg-[var(--color-surface-1)] border-b border-border px-5 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-[var(--color-text-primary)]">
                    {slideOrder.orderNumber}
                  </span>
                  {(() => {
                    const cfg = cfgFor(slideOrder.status);
                    const Icon = cfg.icon;
                    return (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          cfg.bg,
                          cfg.color,
                        )}
                      >
                        <Icon size={10} /> {tIdCards(cfg.label)}
                      </span>
                    );
                  })()}
                </div>
                <button type="button" onClick={() => setSlideOverId(null)} className="p-1.5 rounded-lg hover:bg-muted">
                  <X size={18} className="text-[var(--color-text-secondary)]" />
                </button>
              </div>

              <div className="p-5 space-y-5">
                <div>
                  <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-3">
                    {tIdCards('cardPreview')}
                  </h4>
                  <div className="flex justify-center">
                    <CardTemplatePreview
                      centerName={slideOrder.center_name}
                      centerLogo={slideOrder.center_logo_url}
                      studentName={slideOrder.students[0]?.name || '-'}
                      studentNumber={
                        slideOrder.students[0]?.student_number
                          ? formatStudentNumberForDisplay(slideOrder.students[0].student_number)
                          : '-'
                      }
                      qrCode={slideOrder.students[0]?.qr_code}
                      cardStyle={slideOrder.card_style}
                      color={slideOrder.card_color}
                      className="scale-[0.85] origin-top"
                    />
                  </div>
                  <a
                    href={`/api/admin/card-orders/${slideOrder.id}/pdf`}
                    onClick={(e) => {
                      e.preventDefault();
                      void downloadOrderPdf(slideOrder.id);
                    }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-2 py-2 px-4 rounded-lg border border-slate-600 text-slate-300 text-sm font-medium text-center block hover:border-teal-500 hover:text-teal-300 transition-colors"
                  >
                    ⬇ {tIdCards('downloadPdf')}
                  </a>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-2">
                    {tCommon('students')} ({slideOrder.students.length})
                  </h4>
                  <div className="ch-card p-3 max-h-[200px] overflow-y-auto space-y-1">
                    {slideOrder.students.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 py-1">
                        <span className="text-sm text-[var(--color-text-primary)]">{s.name}</span>
                        <span className="font-mono text-[10px] text-[var(--color-text-secondary)] ms-auto">
                          {s.student_number ? formatStudentNumberForDisplay(s.student_number) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-1">
                    {tIdCards('deliveryAddress')}
                  </h4>
                  <p className="text-sm text-[var(--color-text-primary)]">
                    {slideOrder.delivery_address || '-'}
                  </p>
                </div>
                {slideOrder.notes && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-1">
                      {tIdCards('notes')}
                    </h4>
                    <p className="text-sm text-[var(--color-text-primary)]">{slideOrder.notes}</p>
                  </div>
                )}

                <div className="ch-card p-4">
                  <div className="flex justify-between text-sm text-[var(--color-text-primary)] mb-2">
                    <span>
                      {slideOrder.quantity} {tIdCards('cards')} × {slideOrder.price_per_card} {tCommon('egp')}
                    </span>
                    <span className="font-mono font-bold">{formatCurrency(cardsSubtotal(slideOrder), locale)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-[var(--color-text-primary)] mb-1 gap-2">
                    <span className="min-w-0">
                      {tIdCards('shippingFee')}{' '}
                      {slideOrder.shipping_zone ? (
                        <span className="text-[var(--color-text-secondary)]">
                          ({formatShippingZoneForLocale(slideOrder.shipping_zone, locale)})
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono font-bold shrink-0">
                      {formatCurrency(slideOrder.delivery_fee, locale)}
                    </span>
                  </div>
                  <div className="border-t border-border pt-3 mt-2 flex justify-between">
                    <span className="font-bold text-[var(--color-text-primary)]">{tIdCards('total')}</span>
                    <span className="font-mono font-black text-lg text-[color:var(--color-teal)]">
                      {formatCurrency(slideOrder.total_amount, locale)}
                    </span>
                  </div>
                </div>

                {slideOrder.vendor_notify_failed ? (
                  <div className="bg-red-950 border border-red-800 rounded-lg p-3 mb-3 flex items-start gap-2">
                    <span className="text-red-400 text-base shrink-0">⚠️</span>
                    <div>
                      <p className="text-sm font-semibold text-red-300">
                        {tIdCards('vendorNotifyFailed')}
                      </p>
                      <p className="text-xs text-red-400 mt-1">
                        {tIdCards('vendorNotifyFailedDesc')}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div>
                  <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-1.5">
                    {tIdCards('updateStatus')}
                  </h4>
                  <select
                    value={slideOrder.status}
                    disabled={statusSavingId === slideOrder.id}
                    onChange={(e) =>
                      updateStatus(slideOrder.id, e.target.value as CardOrderFulfillmentStatus)
                    }
                    className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {tIdCards(cfgFor(s).label)}
                      </option>
                    ))}
                  </select>
                  {slideOrder.vendor_sent_at ? (
                    <p className="text-xs text-teal-600 dark:text-teal-400 mt-2">
                      ✓ {tIdCards('sentToVendor')} -{' '}
                      {formatDateTime(slideOrder.vendor_sent_at, locale, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  ) : null}
                </div>

                {slideOrder.status === 'ready_for_pickup' && !slideOrder.bosta_order_id ? (
                  <button
                    type="button"
                    title={tIdCards('bookCourierTooltip')}
                    onClick={async () => {
                      setBookingCourier(slideOrder.id);
                      const {
                        data: { session },
                      } = await supabase.auth.getSession();
                      const token = session?.access_token;
                      if (!token) {
                        setBookingCourier(null);
                        return;
                      }
                      try {
                        const res = await fetch(`/api/admin/card-orders/${slideOrder.id}/book-courier`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        if (res.ok) {
                          const data = (await res.json()) as {
                            trackingNumber?: string;
                            bostaOrderId?: string;
                          };
                          setOrders((prev) =>
                            prev.map((o) =>
                              o.id === slideOrder.id
                                ? {
                                    ...o,
                                    status: 'shipped',
                                    tracking_number: data.trackingNumber ?? o.tracking_number,
                                    bosta_order_id: data.bostaOrderId ?? o.bosta_order_id,
                                  }
                                : o,
                            ),
                          );
                          toast.success(tIdCards('courierBooked'));
                        } else {
                          const err = (await res.json().catch(() => ({}))) as { error?: string };
                          toast.error(
                            err.error === 'no_active_vendor'
                              ? tIdCards('noVendorConfigured')
                              : tCommon('errorGeneric'),
                          );
                        }
                      } finally {
                        setBookingCourier(null);
                      }
                    }}
                    disabled={bookingCourier === slideOrder.id}
                    className="w-full mt-1 py-2 px-4 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {bookingCourier === slideOrder.id
                      ? tIdCards('bookingCourier')
                      : tIdCards('bookCourier')}
                  </button>
                ) : null}

                {slideOrder.tracking_number ? (
                  <div className="mt-1 p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)]">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">
                      {tIdCards('trackingNumber')}
                    </p>
                    <a
                      href={`https://bosta.co/tracking?trackingNumber=${encodeURIComponent(slideOrder.tracking_number)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-teal-600 dark:text-teal-400 hover:underline font-mono"
                    >
                      {slideOrder.tracking_number}
                    </a>
                  </div>
                ) : null}

                {waDigits(slideOrder.center_phone) ? (
                  <a
                    href={`https://wa.me/${waDigits(slideOrder.center_phone)}?text=${encodeURIComponent(
                      tIdCards('whatsappOrderReadyMessage', { orderNumber: slideOrder.orderNumber }),
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
                    style={{ background: '#25D366' }}
                  >
                    <MessageCircle size={14} /> {tIdCards('whatsappCenterButton')}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
        </div>
      </div>
    </div>
  );
}
