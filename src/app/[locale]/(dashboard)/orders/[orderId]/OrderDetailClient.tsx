'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatCurrency } from '@/lib/formatNumber';
import { useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';

type OrderApi = {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  total_amount?: number | null;
  quantity?: number | null;
  delivery_address?: string | null;
  delivery_governorate?: string | null;
  delivery_phone?: string | null;
  created_at?: string | null;
};

export default function OrderDetailClient({ orderId }: { orderId: string }) {
  const t = useTranslations('checkout.orderDetail');
  const tc = useTranslations('cardOrders');
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderApi | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setOrder(null);
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (!cancelled) {
          setOrder(null);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setOrder((await res.json()) as OrderApi);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--color-text-secondary)]">
        {t('loading')}
      </div>
    );
  }

  if (!order) {
    return (
      <div className="px-4 py-8 space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">{t('notFound')}</p>
        <Link href="/orders" className="text-teal-600 font-semibold text-sm hover:underline">
          {tc('ordersTitle')}
        </Link>
      </div>
    );
  }

  const shortRef = order.id.replace(/-/g, '').slice(-8).toUpperCase();

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title', { ref: shortRef })}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1 capitalize">{order.status ?? '—'}</p>
      </div>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-secondary)]">{tc('orderTotal')}</span>
          <span className="tabular-nums font-semibold">
            {order.total_amount != null ? formatCurrency(Number(order.total_amount), locale) : '—'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-secondary)]">{tc('cards')}</span>
          <span>{Math.round(Number(order.quantity ?? 0))}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-secondary)]">{tc('paymentTitle')}</span>
          <span className="capitalize">{order.payment_status ?? '—'}</span>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
        <p className="font-semibold text-[var(--color-text-primary)]">{tc('deliveryAddress')}</p>
        <p>{order.delivery_governorate ?? '—'}</p>
        <p>{order.delivery_address?.trim() || '—'}</p>
        <p>{order.delivery_phone ?? '—'}</p>
      </section>

      <button
        type="button"
        className="text-teal-600 font-semibold text-sm hover:underline"
        onClick={() => {
          void (async () => {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) return;
            const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/receipt`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `card-order-${shortRef}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
          })();
        }}
      >
        {t('downloadReceipt')}
      </button>

      <Link href="/orders" className="block text-sm text-[var(--color-text-secondary)] hover:text-teal-600">
        ← {tc('ordersTitle')}
      </Link>
    </div>
  );
}
