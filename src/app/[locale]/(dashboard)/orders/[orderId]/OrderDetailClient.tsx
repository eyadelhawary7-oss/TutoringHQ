'use client';

import { useMemo, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { Link } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { formatCurrency, formatDateTime } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { buildLegalInvoiceLines, cardOrderProductInclusiveFromQty } from '@/lib/pricing/taxMath';
import { formatShippingZoneForLocale } from '@/lib/bostaShipping';
import { supabase } from '@/lib/supabase';
import { CardOrderStatusTimeline } from '@/components/orders/CardOrderStatusTimeline';
import { CancelOrderModal } from '@/components/orders/CancelOrderModal';
import { useToast } from '@/components/ui/ToastProvider';

type UnknownRecord = Record<string, unknown>;

export default function OrderDetailClient({
  initialOrder,
  viewerRole,
}: {
  initialOrder: UnknownRecord;
  viewerRole: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const locale = useLocale();
  const localeShort: 'en' | 'ar' = locale.startsWith('ar') ? 'ar' : 'en';
  const t = useTranslations('orderDetail');
  const tt = useTranslations('orderTimeline');
  const tr = useTranslations('reorder');
  const tc = useTranslations('cardOrders');

  const [order, setOrder] = useState<UnknownRecord>(initialOrder);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderPhase, setReorderPhase] = useState<'confirm' | 'result'>('confirm');
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderOutcome, setReorderOutcome] = useState<{
    addedCount: number;
    blanksAdded: number;
    skippedReasons: { student_id: string; reason: string }[];
  } | null>(null);

  const shortRef = String(order.id ?? '').replace(/-/g, '').slice(-8).toUpperCase();
  const status = String(order.status ?? '');
  const refundStatus = order.refund_status != null ? String(order.refund_status) : null;

  const statusLabel = useMemo(() => {
    const map: Record<string, string> = {
      pending_payment: t('status.pending_payment'),
      paid: t('status.paid'),
      vendor_assigned: t('status.vendor_assigned'),
      in_production: t('status.in_production'),
      ready_for_pickup: t('status.ready_for_pickup'),
      in_transit: t('status.in_transit'),
      delivered: t('status.delivered'),
      issued: t('status.issued'),
      cancelled: t('status.cancelled'),
      refunded: t('status.refunded'),
      failed: t('status.failed'),
      pending: t('status.pending_payment'),
      printing: t('status.in_production'),
      shipped: t('status.in_transit'),
      confirmed: t('status.issued'),
    };
    return map[status] ?? status.replace(/_/g, ' ');
  }, [status, t]);

  const transitions = (order.transitions as { to_status?: string; created_at?: string }[]) ?? [];
  const items = (order.items as UnknownRecord[]) ?? [];

  const shipFee = Number(order.delivery_fee ?? 0);
  const grandTotal = Number(order.total_amount ?? 0);
  const productInclusive = useMemo(
    () => cardOrderProductInclusiveFromQty(Math.round(Number(order.quantity ?? 0))),
    [order.quantity],
  );
  // Flat processing fee = total − product − shipping.
  const processingFee = Math.max(0, Math.round((grandTotal - productInclusive - shipFee) * 100) / 100);
  const legalLines = useMemo(() => buildLegalInvoiceLines(productInclusive, localeShort), [productInclusive, localeShort]);
  const taxLines = legalLines.filter((l) => !l.isTotal);

  const zoneLabel =
    order.shipping_zone != null && String(order.shipping_zone).trim()
      ? formatShippingZoneForLocale(String(order.shipping_zone), locale)
      : null;

  const trackingNo = order.bosta_tracking_number != null ? String(order.bosta_tracking_number).trim() : '';
  const showTracking = ['in_transit', 'delivered', 'issued'].includes(status);
  const showCancel = status === 'pending_payment';
  const canMarkIssued = viewerRole === 'owner' && status === 'delivered';

  async function refreshOrder() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(String(order.id))}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    setOrder((await res.json()) as UnknownRecord);
  }

  async function downloadReceipt() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(String(order.id))}/receipt`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 422) {
      toast.error(t('receiptUnavailable'));
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

  const SKIP_REASON_KEYS = new Set([
    'alreadyInCart',
    'transferredOut',
    'inactive',
    'alreadyHasCard',
    'studentNotFound',
  ]);

  function skippedReasonLabel(reason: string): string {
    if (SKIP_REASON_KEYS.has(reason)) {
      return tr(`skippedReasons.${reason}` as 'skippedReasons.alreadyInCart');
    }
    return tr('skippedReasons.unknownReason');
  }

  async function postReorder() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    setReorderBusy(true);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(String(order.id))}/reorder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as {
        addedCount?: number;
        blanksAdded?: number;
        skippedReasons?: { student_id: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? tr('failed'));
        return;
      }
      const skipped = Array.isArray(body.skippedReasons) ? body.skippedReasons : [];
      const added = Math.round(Number(body.addedCount ?? 0));
      const blanks = Math.round(Number(body.blanksAdded ?? 0));
      if (skipped.length > 0) {
        setReorderOutcome({ addedCount: added, blanksAdded: blanks, skippedReasons: skipped });
        setReorderPhase('result');
        return;
      }
      toast.success(tr('toastSuccess', { count: added }));
      setReorderOpen(false);
      setReorderPhase('confirm');
      setReorderOutcome(null);
      router.push('/orders');
    } finally {
      setReorderBusy(false);
    }
  }

  async function postMarkIssued() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(String(order.id))}/mark-issued`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    await refreshOrder();
    router.refresh();
  }

  function statusPillClass(s: string): string {
    const x = s.toLowerCase();
    if (x === 'pending_payment' || x === 'failed') return 'bg-amber-100 text-amber-900';
    if (x === 'cancelled' || x === 'refunded') return 'bg-red-100 text-red-900';
    if (x === 'delivered' || x === 'issued') return 'bg-emerald-100 text-emerald-900';
    return 'bg-teal-100 text-teal-900';
  }

  const terminalBanner =
    status === 'cancelled' || status === 'refunded' ? (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 space-y-1">
        <p className="font-semibold">
          {status === 'refunded' ? tt('banner.refunded.title') : tt('banner.cancelled.title')}
        </p>
        {order.cancelled_at ? (
          <p className="text-xs opacity-90">{formatDateTime(String(order.cancelled_at), locale)}</p>
        ) : null}
        {order.cancellation_reason ? <p className="text-xs">{String(order.cancellation_reason)}</p> : null}
        {refundStatus ? (
          <p className="text-xs font-medium">{tt('banner.refundPipeline', { status: refundStatus })}</p>
        ) : null}
        {order.refund_paid_at ? (
          <p className="text-xs">{formatDateTime(String(order.refund_paid_at), locale)}</p>
        ) : null}
      </div>
    ) : status === 'failed' ? (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        {tt('banner.failed')}
      </div>
    ) : null;

  const showTimeline = !['cancelled', 'refunded', 'failed'].includes(status);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title', { ref: shortRef })}</h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('orderedAt')}:{' '}
            {order.created_at ? formatDateTime(String(order.created_at), locale) : ','}
          </p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${statusPillClass(status)}`}>
          {statusLabel}
        </span>
      </div>

      {terminalBanner}

      {showTimeline ? (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
          <CardOrderStatusTimeline status={status} transitions={transitions} />
        </div>
      ) : null}

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
        <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-3">{t('sections.items')}</h2>
        <ul className="space-y-2 text-sm">
          {items.length ? (
            items.map((it, idx) => {
              const kind = String(it.kind ?? '');
              if (kind === 'student') {
                const name = String(it.student_name ?? ',');
                const num = it.student_number != null ? String(it.student_number) : '';
                return (
                  <li key={idx} className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-primary)]">{name}</span>
                    <span className="text-[var(--color-text-secondary)] tabular-nums">{formatStudentNumberForDisplay(num)}</span>
                  </li>
                );
              }
              if (kind === 'blank') {
                const q = Math.max(1, Math.round(Number(it.quantity ?? 1)));
                return (
                  <li key={idx} className="flex justify-between gap-2">
                    <span>{t('blankLine')}</span>
                    <span className="tabular-nums">×{q}</span>
                  </li>
                );
              }
              return null;
            })
          ) : (
            <li className="text-[var(--color-text-secondary)]">{t('itemsFallback')}</li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
        <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-1">{t('sections.delivery')}</h2>
        <p>{String(order.delivery_governorate ?? ',')}</p>
        <p className="whitespace-pre-wrap">{String(order.delivery_address ?? '').trim() || ','}</p>
        <p className="tabular-nums direction-ltr text-end">{String(order.delivery_phone ?? ',')}</p>
        {order.notes?.toString().trim() ? (
          <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap">{String(order.notes)}</p>
        ) : null}
      </section>

      {showTracking && trackingNo ? (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
          <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{t('sections.tracking')}</h2>
          <p className="font-mono text-xs break-all">{trackingNo}</p>
          <a
            href={`https://bosta.co/tracking/${encodeURIComponent(trackingNo)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-teal-600 font-semibold text-sm hover:underline"
          >
            {t('trackBosta')}
          </a>
          {order.bosta_estimated_delivery_at ? (
            <p className="text-xs text-[var(--color-text-secondary)]">
              {t('estimatedDelivery')}: {formatDateTime(String(order.bosta_estimated_delivery_at), locale)}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
        <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-2">{t('sections.pricing')}</h2>
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

      <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={() => void downloadReceipt()}
          className="inline-flex justify-center px-4 py-2 rounded-xl border border-[var(--color-border-subtle)] text-sm font-semibold"
        >
          {t('downloadReceipt')}
        </button>
        <button
          type="button"
          onClick={() => {
            setReorderPhase('confirm');
            setReorderOutcome(null);
            setReorderOpen(true);
          }}
          className="inline-flex justify-center px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold"
        >
          {t('reorder')}
        </button>
        {showCancel && viewerRole === 'owner' ? (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="inline-flex justify-center px-4 py-2 rounded-xl border border-red-200 text-red-700 text-sm font-semibold"
          >
            {t('cancel')}
          </button>
        ) : null}
        {canMarkIssued ? (
          <button
            type="button"
            onClick={() => void postMarkIssued()}
            className="inline-flex justify-center px-4 py-2 rounded-xl border border-teal-200 text-teal-800 text-sm font-semibold"
          >
            {t('markIssued')}
          </button>
        ) : null}
        <a
          href={`mailto:ops@ehgintelligence.com?subject=${encodeURIComponent(`Order #${shortRef} issue`)}`}
          className="inline-flex justify-center px-4 py-2 rounded-xl text-sm font-semibold text-teal-700 underline-offset-2 hover:underline"
        >
          {t('reportIssue')}
        </a>
      </div>

      <Link href="/orders" className="block text-sm text-[var(--color-text-secondary)] hover:text-teal-600">
        ← {tc('ordersTitle')}
      </Link>

      <CancelOrderModal
        orderId={String(order.id)}
        status={status}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onDone={() => {
          void refreshOrder();
          router.refresh();
        }}
      />

      {reorderOpen ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 space-y-4">
            {reorderPhase === 'confirm' ? (
              <>
                <h2 className="text-lg font-bold">{tr('confirmTitle')}</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">{tr('confirmBody')}</p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl border text-sm font-semibold"
                    disabled={reorderBusy}
                    onClick={() => {
                      setReorderOpen(false);
                      setReorderPhase('confirm');
                      setReorderOutcome(null);
                    }}
                  >
                    {tr('back')}
                  </button>
                  <button
                    type="button"
                    disabled={reorderBusy}
                    className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold disabled:opacity-50"
                    onClick={() => void postReorder()}
                  >
                    {reorderBusy ? tr('working') : tr('confirm')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold">{tr('resultTitle')}</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {tr('addedSummary', {
                    students: reorderOutcome?.addedCount ?? 0,
                    blanks: reorderOutcome?.blanksAdded ?? 0,
                  })}
                </p>
                {(reorderOutcome?.skippedReasons?.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{tr('skippedHeading')}</p>
                    <ul className="max-h-48 overflow-y-auto space-y-1 text-sm text-[var(--color-text-secondary)] list-disc ps-4">
                      {(reorderOutcome?.skippedReasons ?? []).map((row, idx) => (
                        <li key={`${row.student_id}-${idx}`}>{skippedReasonLabel(String(row.reason ?? ''))}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold"
                    onClick={() => {
                      setReorderOpen(false);
                      setReorderPhase('confirm');
                      setReorderOutcome(null);
                      router.push('/orders');
                    }}
                  >
                    {tr('done')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
