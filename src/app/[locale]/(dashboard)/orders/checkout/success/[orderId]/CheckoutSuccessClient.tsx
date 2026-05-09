'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatNumber';
import { useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';

type OrderRow = {
  id: string;
  quantity?: number | null;
  total_amount?: number | null;
  delivery_governorate?: string | null;
  delivery_address?: string | null;
  delivery_phone?: string | null;
};

export function CheckoutSuccessClient({ orderId }: { orderId: string }) {
  const t = useTranslations('checkout.success');
  const locale = useLocale();
  const [order, setOrder] = useState<OrderRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      setOrder((await res.json()) as OrderRow);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const shortRef = orderId.replace(/-/g, '').slice(-8).toUpperCase();

  async function downloadReceipt() {
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
  }

  return (
    <div className="max-w-lg mx-auto space-y-8 text-center py-4" data-testid="checkout-success">
      <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto" aria-hidden />
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-2">{t('orderNumber', { ref: shortRef })}</p>
      </div>

      <details className="text-start rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-[var(--color-text-primary)]">{t('summaryToggle')}</summary>
        <div className="mt-3 space-y-2 text-[var(--color-text-secondary)]">
          <p>
            {t('itemsCount', { count: Math.round(Number(order?.quantity ?? 0)) })}
          </p>
          <p>
            {t('total')}:{' '}
            <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
              {order?.total_amount != null ? formatCurrency(Number(order.total_amount), locale) : '—'}
            </span>
          </p>
          <p>
            {t('delivery')}: {order?.delivery_governorate ?? '—'} — {order?.delivery_address?.trim() || '—'}
          </p>
        </div>
      </details>

      <p className="text-sm text-[var(--color-text-secondary)]">{t('deliveryEta')}</p>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href={`/orders/${orderId}`}
          className="inline-flex justify-center px-5 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm"
        >
          {t('track')}
        </Link>
        <button
          type="button"
          onClick={() => void downloadReceipt()}
          className="inline-flex justify-center px-5 py-3 rounded-xl border border-[var(--color-border-subtle)] font-semibold text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
        >
          {t('receipt')}
        </button>
        <Link
          href="/orders"
          className="inline-flex justify-center px-5 py-3 rounded-xl border border-transparent font-semibold text-sm text-teal-700 dark:text-teal-300 underline-offset-2 hover:underline"
        >
          {t('orderMore')}
        </Link>
      </div>
    </div>
  );
}
