'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import type { CardOrderLifecycleEvent } from '@/lib/cardOrderState';
import { isFeatureEnabled } from '@/lib/features';
import { buildLegalInvoiceLines, cardOrderProductInclusiveFromQty } from '@/lib/pricing/taxMath';
import { formatCurrency, formatDate, formatDateTime, formatRelativeMinutesAgo } from '@/lib/formatNumber';
import { formatShippingZoneForLocale } from '@/lib/bostaShipping';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { CardOrderStatusTimeline } from '@/components/orders/CardOrderStatusTimeline';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import type { AdminCardOrderExtra } from '@/lib/loadCardOrderDetail';

type UnknownRecord = Record<string, unknown>;

function lastCharsRef(uuid: string): string {
  return uuid.replace(/-/g, '').slice(-8).toUpperCase();
}

function normStatus(s: string): string {
  return String(s ?? '').trim().toLowerCase();
}

function manualTransitionFor(statusRaw: string): CardOrderLifecycleEvent | null {
  const s = normStatus(statusRaw);
  if (s === 'paid') return 'vendor_assigned';
  if (s === 'vendor_assigned') return 'production_started';
  if (s === 'in_production' || s === 'printing' || s === 'processing') return 'ready_for_pickup';
  if (s === 'ready_for_pickup') return 'bosta_picked_up';
  if (s === 'in_transit' || s === 'shipped') return 'bosta_delivered';
  if (s === 'delivered') return 'centre_confirmed_issued';
  return null;
}

function manualTransitionsBlocked(statusRaw: string): boolean {
  const s = normStatus(statusRaw);
  return (
    s === 'pending_payment' ||
    s === 'cancelled' ||
    s === 'refunded' ||
    s === 'failed' ||
    s === 'issued' ||
    s === 'confirmed'
  );
}

function eventLabel(event: CardOrderLifecycleEvent): string {
  switch (event) {
    case 'vendor_assigned':
      return 'vendor_assigned';
    case 'production_started':
      return 'production_started';
    case 'ready_for_pickup':
      return 'ready_for_pickup';
    case 'bosta_picked_up':
      return 'bosta_picked_up';
    case 'bosta_delivered':
      return 'bosta_delivered';
    case 'centre_confirmed_issued':
      return 'centre_confirmed_issued';
    default:
      return event;
  }
}

function TransitionConfirmModal({
  open,
  event,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  event: CardOrderLifecycleEvent | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) {
  const ta = useTranslations('admin.cardOrderDetail');
  const [reason, setReason] = useState('');
  if (!open || !event) return null;
  const ok = reason.trim().length >= 10 && reason.trim().length <= 500 && !busy;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 shadow-lg">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {ta('detail.actions.advanceStatus.confirm')}
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1 font-mono">{eventLabel(event)}</p>
        <label className="block mt-4 text-sm font-medium text-[var(--color-text-primary)]">
          {ta('detail.actions.advanceStatus.reasonLabel')}
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
          placeholder={ta('detail.actions.advanceStatus.reasonPlaceholder')}
        />
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{reason.trim().length}/500</p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--color-border-subtle)] text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            data-testid="admin-card-order-transition-confirm"
            onClick={() => onConfirm(reason.trim())}
            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {ta('detail.actions.advanceStatus.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function transitionToStatusHelper(tr: UnknownRecord): string {
  const v = tr.to_status ?? tr.new_status ?? tr.status_after ?? tr.next_status ?? '';
  return String(v ?? '').trim();
}

export default function AdminCardOrderDetailClient({
  initialOrder,
  returnTo,
}: {
  initialOrder: UnknownRecord & Partial<AdminCardOrderExtra>;
  returnTo?: string;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { closeMainSidebar } = useSidebar() ?? {};
  const ta = useTranslations('admin.cardOrderDetail');
  const ts = useTranslations('orderDetail');
  const tc = useTranslations('cardOrders');

  const localeShort: 'en' | 'ar' = locale.startsWith('ar') ? 'ar' : 'en';

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [pendingEvent, setPendingEvent] = useState<CardOrderLifecycleEvent | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [expandedMetaId, setExpandedMetaId] = useState<string | null>(null);

  const order = initialOrder;
  const orderId = String(order.id ?? '');
  const shortRef = lastCharsRef(orderId);
  const status = String(order.status ?? '');
  const paymentStatus = String(order.payment_status ?? '');
  const trackingNo =
    typeof order.bosta_tracking_number === 'string' ? order.bosta_tracking_number.trim() : '';
  const centreSnap = order.centre_snapshot;

  const transitions = (order.transitions as UnknownRecord[]) ?? [];

  const statusLabel = useMemo(() => {
    const map: Record<string, string> = {
      pending_payment: ts('status.pending_payment'),
      paid: ts('status.paid'),
      vendor_assigned: ts('status.vendor_assigned'),
      in_production: ts('status.in_production'),
      ready_for_pickup: ts('status.ready_for_pickup'),
      in_transit: ts('status.in_transit'),
      delivered: ts('status.delivered'),
      issued: ts('status.issued'),
      cancelled: ts('status.cancelled'),
      refunded: ts('status.refunded'),
      failed: ts('status.failed'),
      pending: ts('status.pending_payment'),
      printing: ts('status.in_production'),
      shipped: ts('status.in_transit'),
      confirmed: ts('status.issued'),
    };
    return map[normStatus(status)] ?? status.replace(/_/g, ' ');
  }, [status, ts]);

  const shipFee = Number(order.delivery_fee ?? 0);
  const grandTotal = Number(order.total_amount ?? 0);
  const productInclusive = useMemo(
    () => cardOrderProductInclusiveFromQty(Math.round(Number(order.quantity ?? 0))),
    [order.quantity],
  );
  // Flat processing fee = total − product − shipping.
  const processingFee = Math.max(0, Math.round((grandTotal - productInclusive - shipFee) * 100) / 100);
  const legalLines = useMemo(
    () => buildLegalInvoiceLines(productInclusive, localeShort),
    [productInclusive, localeShort],
  );
  const taxLines = legalLines.filter((l) => !l.isTotal);

  const zoneLabel =
    order.shipping_zone != null && String(order.shipping_zone).trim()
      ? formatShippingZoneForLocale(String(order.shipping_zone), locale)
      : null;

  const paymobId =
    typeof order.paymob_transaction_id === 'string' && order.paymob_transaction_id.trim()
      ? order.paymob_transaction_id.trim()
      : null;

  const paidAtIso =
    typeof order.derived_paid_at === 'string'
      ? order.derived_paid_at
      : paymentStatus === 'paid' && typeof order.created_at === 'string'
        ? String(order.created_at)
        : null;

  const nextManual = manualTransitionFor(status);
  const blockedManual = manualTransitionsBlocked(status);

  async function submitTransition(reason: string, event: CardOrderLifecycleEvent) {
    setTransitionBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('auth');
      const res = await fetch(`/api/admin/card-orders/${encodeURIComponent(orderId)}/transition`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        if (body.error === 'event_not_admin_allowed') {
          toast.error(ta('detail.errors.invalidEvent'));
        } else if (res.status === 409) {
          toast.error(body.message ?? ta('detail.errors.transitionFailed'));
        } else {
          toast.error(ta('detail.errors.transitionFailed'));
        }
        return;
      }
      toast.success(ta('detail.toast.transitionOk'));
      setTransitionOpen(false);
      setPendingEvent(null);
      router.refresh();
    } finally {
      setTransitionBusy(false);
    }
  }

  async function downloadReceipt() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/receipt`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 422) {
      toast.error(ts('receiptUnavailable'));
      return;
    }
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tutoringhq-order-${shortRef}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function statusPillClass(s: string): string {
    const x = normStatus(s);
    if (x === 'pending_payment' || x === 'failed') return 'bg-amber-100 text-amber-900';
    if (x === 'cancelled' || x === 'refunded') return 'bg-red-100 text-red-900';
    if (x === 'delivered' || x === 'issued' || x === 'confirmed') return 'bg-emerald-100 text-emerald-900';
    return 'bg-teal-100 text-teal-900';
  }

  const showTimeline = !['cancelled', 'refunded', 'failed'].includes(normStatus(status));

  const backHref = returnTo?.startsWith('/') ? returnTo : '/admin/orders';

  const paymobPayload = order.paymob_webhook_inbox as UnknownRecord | null | undefined;
  const bostaPayload = order.bosta_webhook_inbox as UnknownRecord | null | undefined;

  const bostaStatusLast =
    order.bosta_shipment_status != null ? String(order.bosta_shipment_status) : null;
  const bostaUpdated =
    typeof order.bosta_shipment_updated_at === 'string' ? order.bosta_shipment_updated_at : null;

  useEffect(() => {
    if (typeof closeMainSidebar === 'function') closeMainSidebar();
  }, [closeMainSidebar]);

  return (
    <div className="-mt-14">
      <div className="flex flex-1 min-h-0 min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100dvh-3.5rem)]">
        <AdminSidebar activeRoute={pathname} />
        <div className="w-full flex-1 flex flex-col min-w-0 lg:ms-56">
          <AdminHeader />
          <div
            className="flex-1 overflow-auto p-4 md:p-6 pb-28 lg:pb-8 space-y-6 max-w-6xl mx-auto w-full"
            data-testid="admin-card-order-detail"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={backHref}
                  className="text-sm text-[var(--color-text-secondary)] hover:text-teal-600 mb-2 inline-block"
                >
                  ← {ta('detail.back')}
                </Link>
                <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                  {ta('detail.title', { id: shortRef })}
                </h1>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  <Link
                    href={`/admin/centers/${encodeURIComponent(String(order.center_id ?? centreSnap?.center_id ?? ''))}`}
                    className="font-medium text-teal-600 hover:underline"
                  >
                    {typeof centreSnap?.name === 'string' ? centreSnap.name : ','}
                  </Link>
                  {' · '}
                  {order.created_at
                    ? formatDateTime(String(order.created_at), locale)
                    : ','}
                </p>
              </div>
              <span
                className={cn(
                  'text-xs font-semibold px-3 py-1 rounded-full capitalize',
                  statusPillClass(status),
                )}
              >
                {statusLabel}
              </span>
            </div>

            {showTimeline ? (
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
                <CardOrderStatusTimeline
                  status={status}
                  transitions={
                    transitions as { to_status?: string | null; created_at?: string | null }[]
                  }
                />
              </div>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-start">
              <div className="space-y-6 min-w-0">
                <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
                  <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-3">
                    {ta('detail.sections.items')}
                  </h2>
                  <ul className="space-y-2 text-sm">
                    {((order.items as UnknownRecord[]) ?? []).length ? (
                      (order.items as UnknownRecord[]).map((it, idx) => {
                        const kind = String(it.kind ?? '');
                        if (kind === 'student') {
                          const name = String(it.student_name ?? ',');
                          const num = it.student_number != null ? String(it.student_number) : '';
                          return (
                            <li key={idx} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[var(--color-text-primary)]">{name}</span>
                              <span className="flex items-center gap-2">
                                <span className="text-[var(--color-text-secondary)] tabular-nums">
                                  {formatStudentNumberForDisplay(num)}
                                </span>
                                <span
                                  className={cn(
                                    'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                                    statusPillClass(status),
                                  )}
                                >
                                  {statusLabel}
                                </span>
                              </span>
                            </li>
                          );
                        }
                        if (kind === 'blank') {
                          const q = Math.max(1, Math.round(Number(it.quantity ?? 1)));
                          return (
                            <li key={idx} className="flex justify-between gap-2">
                              <span>{ts('blankLine')}</span>
                              <span className="tabular-nums">×{q}</span>
                            </li>
                          );
                        }
                        return null;
                      })
                    ) : (
                      <li className="text-[var(--color-text-secondary)]">{ts('itemsFallback')}</li>
                    )}
                  </ul>
                </section>

                <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
                  <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-1">
                    {ta('detail.sections.delivery')}
                  </h2>
                  <p>{String(order.delivery_governorate ?? ',')}</p>
                  <p className="whitespace-pre-wrap">{String(order.delivery_address ?? '').trim() || ','}</p>
                  <p className="tabular-nums direction-ltr text-end">{String(order.delivery_phone ?? ',')}</p>
                  {order.notes?.toString().trim() ? (
                    <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap">{String(order.notes)}</p>
                  ) : null}
                </section>

                <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
                  <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-2">
                    {ta('detail.sections.pricing')}
                  </h2>
                  <div className="space-y-1">
                    {taxLines.map((ln, i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <span className="text-[var(--color-text-secondary)]">{ln.label}</span>
                        <span className="tabular-nums font-medium">{formatCurrency(ln.amount, locale)}</span>
                      </div>
                    ))}
                    {processingFee > 0 ? (
                      <div className="flex justify-between gap-2">
                        <span className="text-[var(--color-text-secondary)]">{tc('processingFee')}</span>
                        <span className="tabular-nums font-medium">{formatCurrency(processingFee, locale)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-2 pt-1 border-t border-[var(--color-border-subtle)]">
                      <span className="text-[var(--color-text-secondary)]">{zoneLabel ?? tc('deliveryFee')}</span>
                      <span className="tabular-nums font-medium">{formatCurrency(shipFee, locale)}</span>
                    </div>
                    <div className="flex justify-between gap-2 font-semibold pt-1">
                      <span>{tc('totalAmount')}</span>
                      <span className="tabular-nums">{formatCurrency(grandTotal, locale)}</span>
                    </div>
                  </div>
                </section>
              </div>

              <div className="space-y-6 lg:sticky lg:top-4 self-start">
                <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
                  <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{ta('detail.sections.payment')}</h2>
                  <p className="font-mono text-xs break-all">{paymobId ?? ','}</p>
                  <span
                    className={cn(
                      'inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full',
                      paymentStatus === 'paid'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
                    )}
                  >
                    {paymentStatus}
                  </span>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {paidAtIso ? formatDateTime(paidAtIso, locale) : ','}
                  </p>
                  {isFeatureEnabled('PAYMOB_ENABLED') && paymobId ? (
                    <a
                      href="https://accept.paymob.com"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-teal-600 font-semibold text-sm hover:underline"
                    >
                      Paymob portal →
                    </a>
                  ) : null}
                </section>

                {trackingNo ? (
                  <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
                    <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{ta('detail.sections.tracking')}</h2>
                    <p className="font-mono text-xs break-all">{trackingNo}</p>
                    <a
                      href={`https://bosta.co/tracking/${encodeURIComponent(trackingNo)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-teal-600 font-semibold text-sm hover:underline"
                    >
                      Bosta tracking →
                    </a>
                    <p>
                      {ta('detail.tracking.shippingCost')}:{' '}
                      {order.bosta_shipping_cost != null
                        ? formatCurrency(Number(order.bosta_shipping_cost), locale)
                        : formatCurrency(shipFee, locale)}
                    </p>
                    <p>
                      {ta('detail.tracking.lastStatus')}: {bostaStatusLast ?? ','}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {bostaUpdated ? formatDateTime(bostaUpdated, locale) : ','}
                    </p>
                  </section>
                ) : null}

                <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
                  <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{ta('detail.sections.centre')}</h2>
                  <p className="font-medium">{centreSnap?.name ?? ','}</p>
                  <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap">
                    {centreSnap?.address_text ?? ','}
                  </p>
                  <p>
                    {ta('detail.centre.plan')}: {centreSnap?.plan ?? ','}
                  </p>
                  <p>
                    {ta('detail.centre.planPrice')}:{' '}
                    {centreSnap?.plan_price != null ? formatCurrency(centreSnap.plan_price, locale) : ','}
                  </p>
                  <p>
                    {ta('detail.centre.subscription')}: {centreSnap?.subscription_status ?? ','}
                  </p>
                  <Link
                    href={`/admin/centers/${encodeURIComponent(String(centreSnap?.center_id ?? order.center_id ?? ''))}`}
                    className="inline-flex text-teal-600 font-semibold text-sm hover:underline"
                  >
                    {ta('detail.centre.openAdmin')} →
                  </Link>
                </section>

                <div
                  className={cn(
                    'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-3',
                    'fixed bottom-0 start-0 end-0 z-30 lg:relative lg:z-0 lg:border lg:rounded-xl lg:start-auto lg:end-auto',
                  )}
                  data-testid="admin-card-order-actions"
                >
                  <h3 className="text-sm font-bold">{ta('detail.actions.title')}</h3>
                  {!blockedManual && nextManual ? (
                    <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                      {ta('detail.actions.advanceStatus.label')}
                      <select
                        data-testid="admin-card-order-advance-select"
                        className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                        defaultValue=""
                        onChange={(e) => {
                          const v = e.target.value as CardOrderLifecycleEvent;
                          if (!v) return;
                          setPendingEvent(v);
                          setTransitionOpen(true);
                          e.target.selectedIndex = 0;
                        }}
                      >
                        <option value="">{ta('detail.actions.advanceStatus.placeholder')}</option>
                        <option value={nextManual}>{eventLabel(nextManual)}</option>
                      </select>
                    </label>
                  ) : (
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {ta('detail.actions.advanceStatus.unavailable')}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void downloadReceipt()}
                    className="w-full py-2 rounded-lg border border-[var(--color-border-subtle)] text-sm font-semibold"
                  >
                    {ta('detail.actions.downloadReceipt')}
                  </button>

                  <details className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                    <summary className="cursor-pointer text-sm font-medium">{ta('detail.actions.viewBostaData')}</summary>
                    <pre className="mt-2 text-[10px] overflow-auto max-h-64 whitespace-pre-wrap break-all">
                      {bostaPayload ? JSON.stringify(bostaPayload, null, 2) : ','}
                    </pre>
                  </details>
                  <details className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                    <summary className="cursor-pointer text-sm font-medium">{ta('detail.actions.viewPaymobLog')}</summary>
                    <pre className="mt-2 text-[10px] overflow-auto max-h-64 whitespace-pre-wrap break-all">
                      {paymobPayload ? JSON.stringify(paymobPayload, null, 2) : ','}
                    </pre>
                  </details>
                </div>
              </div>
            </div>

            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 overflow-x-auto">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{ta('detail.transitions.title')}</h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-surface-2)]">
                  {ta('detail.transitions.count', { count: transitions.length })}
                </span>
              </div>
              {transitions.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">{ta('detail.transitions.empty')}</p>
              ) : (
                <table className="w-full text-sm" data-testid="admin-card-order-transitions">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] text-start text-xs text-[var(--color-text-secondary)]">
                      <th className="py-2 pe-3">{ta('detail.transitions.cols.from')}</th>
                      <th className="py-2 pe-3">{ta('detail.transitions.cols.to')}</th>
                      <th className="py-2 pe-3">{ta('detail.transitions.cols.date')}</th>
                      <th className="py-2 pe-3">{ta('detail.transitions.cols.actor')}</th>
                      <th className="py-2 pe-3">{ta('detail.transitions.cols.reason')}</th>
                      <th className="py-2">{ta('detail.transitions.cols.metadata')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transitions.map((tr, i) => {
                      const rowKey = String(tr.id ?? i);
                      const from = String(tr.from_status ?? tr.previous_status ?? ',');
                      const to = String(tr.to_status ?? transitionToStatusHelper(tr) ?? ',');
                      const tsIso =
                        typeof tr.transitioned_at === 'string'
                          ? tr.transitioned_at
                          : typeof tr.created_at === 'string'
                            ? tr.created_at
                            : '';
                      const actor = String(tr.transitioned_by_role ?? tr.actor_role ?? ',');
                      const reason = String(tr.reason ?? '');
                      const meta = tr.metadata;
                      const expanded = expandedMetaId === rowKey;
                      return (
                        <tr key={rowKey} className="border-t border-[var(--color-border-subtle)] align-top">
                          <td className="py-2 pe-3">{from}</td>
                          <td className="py-2 pe-3">{to}</td>
                          <td className="py-2 pe-3 whitespace-nowrap">
                            <div>{tsIso ? formatDateTime(tsIso, locale) : ','}</div>
                            <div className="text-[10px] text-[var(--color-text-tertiary)]">
                              {tsIso ? formatRelativeMinutesAgo(tsIso, locale) : ''}
                            </div>
                          </td>
                          <td className="py-2 pe-3">{actor}</td>
                          <td className="py-2 pe-3 max-w-[200px] break-words">{reason || ','}</td>
                          <td className="py-2">
                            {meta != null ? (
                              <button
                                type="button"
                                className="text-teal-600 text-xs font-semibold"
                                onClick={() => setExpandedMetaId(expanded ? null : rowKey)}
                              >
                                {expanded ? '▼' : '▶'} JSON
                              </button>
                            ) : (
                              ','
                            )}
                            {expanded && meta != null ? (
                              <pre className="mt-1 text-[10px] max-h-40 overflow-auto whitespace-pre-wrap">
                                {JSON.stringify(meta, null, 2)}
                              </pre>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      </div>

      <TransitionConfirmModal
        open={transitionOpen}
        event={pendingEvent}
        busy={transitionBusy}
        onClose={() => {
          setTransitionOpen(false);
          setPendingEvent(null);
        }}
        onConfirm={(reason) => {
          if (pendingEvent) void submitTransition(reason, pendingEvent);
        }}
      />
    </div>
  );
}
