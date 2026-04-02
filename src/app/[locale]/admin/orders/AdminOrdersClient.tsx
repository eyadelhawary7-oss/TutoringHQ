'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import {
  Package,
  Clock,
  Printer,
  Truck,
  CheckCircle,
  X,
  MessageCircle,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CardTemplatePreview from '@/components/CardTemplatePreview';
import { AdminSidebar } from '@/components/AdminSidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import type { AdminCardOrderRow, CardOrderFulfillmentStatus } from '@/types/admin-card-orders';
import { supabase } from '@/lib/supabase';

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
  confirmed: {
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
    icon: CheckCircle,
    label: 'statusConfirmed',
  },
  printing: {
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-500/10',
    icon: Printer,
    label: 'statusPrinting',
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
};

const FILTERS: CardOrderFulfillmentStatus[] = [
  'pending',
  'confirmed',
  'printing',
  'shipped',
  'delivered',
];

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
  const pathname = usePathname();
  const { closeMainSidebar } = useSidebar() ?? {};
  const [orders, setOrders] = useState<AdminCardOrderRow[]>(initialOrders);
  const [filter, setFilter] = useState<'all' | CardOrderFulfillmentStatus>('all');
  const [slideOverId, setSlideOverId] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    if (typeof closeMainSidebar === 'function') closeMainSidebar();
  }, [closeMainSidebar]);

  const filteredOrders = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
  const slideOrder = orders.find((o) => o.id === slideOverId);

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

  const updateStatus = useCallback(async (orderId: string, newStatus: CardOrderFulfillmentStatus) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    setStatusSavingId(orderId);
    try {
      const res = await fetch('/api/admin/card-orders', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orderId, status: newStatus }),
      });
      if (!res.ok) return;
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
    } finally {
      setStatusSavingId(null);
    }
  }, []);

  const cardsSubtotal = (o: AdminCardOrderRow) =>
    Math.round(o.quantity * o.price_per_card * 100) / 100;

  return (
    <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen pt-14 lg:pt-0">
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
            onClick={() => setFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              filter === 'all'
                ? 'bg-primary/10 text-primary'
                : 'text-[var(--color-text-secondary)] hover:bg-muted',
            )}
          >
            {tCommon('all')}
          </button>
          {FILTERS.map((f) => {
            const cfg = STATUS_CONFIG[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
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
                  const cfg = STATUS_CONFIG[order.status];
                  const StatusIcon = cfg.icon;
                  return (
                    <tr
                      key={order.id}
                      className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-0)] transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono">
                        {order.orderNumber}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-medium">
                        {order.center_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono">
                        {order.quantity}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono font-bold">
                        {order.total_amount} {tCommon('egp')}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            cfg.bg,
                            cfg.color,
                          )}
                        >
                          <StatusIcon size={10} /> {tIdCards(cfg.label)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                        {new Date(order.created_at).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                        <button
                          type="button"
                          onClick={() => setSlideOverId(order.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Eye size={12} /> {tCommon('view')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredOrders.length === 0 && (
            <div className="text-center py-16 text-[var(--color-text-secondary)] border-t border-[var(--color-border-subtle)]">
              <div className="mx-auto mb-4 w-20 h-20 relative">
                <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-[var(--color-border-default)]/40" />
                <div className="absolute top-3 start-3 end-3 h-3 rounded bg-[var(--color-text-tertiary)]/10" />
                <div className="absolute top-8 start-3 end-6 h-2 rounded bg-[var(--color-text-tertiary)]/8" />
                <div className="absolute top-12 start-3 end-8 h-2 rounded bg-[var(--color-text-tertiary)]/6" />
              </div>
              <p className="font-medium text-[var(--color-text-primary)]">{tIdCards('noOrders')}</p>
              <p className="text-sm mt-1">{tIdCards('noOrdersDesc')}</p>
            </div>
          )}
        </div>

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
                    const cfg = STATUS_CONFIG[slideOrder.status];
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
                      studentName={slideOrder.students[0]?.name || '—'}
                      studentNumber={slideOrder.students[0]?.student_number || '—'}
                      qrCode={slideOrder.students[0]?.qr_code}
                      color={slideOrder.card_color}
                      className="scale-[0.85] origin-top"
                    />
                  </div>
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
                          {s.student_number}
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
                    {slideOrder.delivery_address || '—'}
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
                    <span className="font-mono font-bold">
                      {cardsSubtotal(slideOrder)} {tCommon('egp')}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-[var(--color-text-primary)] mb-3">
                    <span>{tIdCards('delivery')}</span>
                    <span className="font-mono font-bold">
                      {slideOrder.delivery_fee} {tCommon('egp')}
                    </span>
                  </div>
                  <div className="border-t border-border pt-3 flex justify-between">
                    <span className="font-bold text-[var(--color-text-primary)]">{tIdCards('total')}</span>
                    <span
                      className="font-mono font-black text-lg"
                      style={{ color: slideOrder.card_color }}
                    >
                      {slideOrder.total_amount} {tCommon('egp')}
                    </span>
                  </div>
                </div>

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
                    {FILTERS.map((s) => (
                      <option key={s} value={s}>
                        {tIdCards(STATUS_CONFIG[s].label)}
                      </option>
                    ))}
                  </select>
                </div>

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
  );
}
