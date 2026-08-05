'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { formatCurrency } from '@/lib/formatNumber';
import { supabase } from '@/lib/supabase';
import { clearCheckoutPaymentSession, readCheckoutPaymentSession } from '../CheckoutShell';

const POLL_MS = 3000;
const TIMEOUT_SEC = 300;

function PaymentInner() {
  const t = useTranslations('checkout.payment');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderIdFromUrl = searchParams?.get('orderId')?.trim() ?? '';

  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string>(orderIdFromUrl);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(TIMEOUT_SEC);
  /**
   * §03 step 4 shows the amount about to be charged. This is the order's own
   * stored `total_amount`, echoed verbatim — nothing is recomputed here, so the
   * figure on screen is the figure Paymob is being asked for. Null until the
   * first poll returns; rendered as "not available" rather than as a zero.
   */
  const [totalAmount, setTotalAmount] = useState<number | null>(null);

  const shortRef = useMemo(() => (orderId ? orderId.replace(/-/g, '').slice(-8).toUpperCase() : ''), [orderId]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = readCheckoutPaymentSession();
      if (session && (!orderIdFromUrl || session.orderId === orderIdFromUrl)) {
        if (!cancelled) {
          setOrderId(session.orderId);
          setPaymentUrl(session.paymentUrl);
        }
        return;
      }
      if (!orderIdFromUrl) {
        if (!cancelled) setRecoverError(t('missingSession'));
        return;
      }

      const {
        data: { session: auth },
      } = await supabase.auth.getSession();
      const token = auth?.access_token;
      if (!token) {
        if (!cancelled) setRecoverError(t('notAuthenticated'));
        return;
      }

      const ordRes = await fetch(`/api/orders/${encodeURIComponent(orderIdFromUrl)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!ordRes.ok) {
        if (!cancelled) setRecoverError(t('orderNotFound'));
        return;
      }
      const ord = (await ordRes.json()) as { payment_status?: string; total_amount?: number };
      if (ord.total_amount != null && Number.isFinite(Number(ord.total_amount)) && !cancelled) {
        setTotalAmount(Number(ord.total_amount));
      }
      if (ord.payment_status === 'paid') {
        clearCheckoutPaymentSession();
        router.replace(`/orders/checkout/success/${encodeURIComponent(orderIdFromUrl)}`);
        return;
      }

      const amount = Number(ord.total_amount);
      const payRes = await fetch('/api/paymob/create-payment-key', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount, cardOrderId: orderIdFromUrl }),
      });
      const payBody = (await payRes.json().catch(() => ({}))) as { iframeUrl?: string; error?: string };
      if (!payRes.ok || !payBody.iframeUrl) {
        if (!cancelled) setRecoverError(payBody.error ?? t('recoverFailed'));
        return;
      }
      if (!cancelled) {
        setOrderId(orderIdFromUrl);
        setPaymentUrl(payBody.iframeUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderIdFromUrl, router, t]);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    const poll = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const row = (await res.json()) as { payment_status?: string; total_amount?: number };
      if (row.total_amount != null && Number.isFinite(Number(row.total_amount)) && !cancelled) {
        setTotalAmount(Number(row.total_amount));
      }
      if (row.payment_status === 'paid' && !cancelled) {
        clearCheckoutPaymentSession();
        router.replace(`/orders/checkout/success/${encodeURIComponent(orderId)}`);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [orderId, router]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="space-y-4 max-w-4xl mx-auto" data-testid="checkout-payment">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-[var(--color-text-primary)]">
          {t('orderRef', { ref: shortRef || tCommon('notAvailable') })}
        </h1>
        <p className="text-sm tabular-nums text-amber-700 font-semibold">
          {t('timeout', { mm, ss })}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3">
        <span className="text-sm text-[var(--color-text-secondary)]">{t('total')}</span>
        <span className="text-lg font-bold tabular-nums text-teal-700">
          {totalAmount != null ? formatCurrency(totalAmount, locale) : tCommon('notAvailable')}
        </span>
      </div>
      <p className="text-sm font-medium text-amber-800 bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-2">
        {t('iframeWarning')}
      </p>
      {recoverError ? <p className="text-sm text-red-600">{recoverError}</p> : null}
      {paymentUrl ? (
        <iframe
          title={t('iframeTitle')}
          src={paymentUrl}
          className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-white"
          style={{ height: '80vh' }}
        />
      ) : !recoverError ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('loadingIframe')}</p>
      ) : null}
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {t('securedBy')}
      </p>
    </div>
  );
}

export default function CheckoutPaymentPage() {
  const t = useTranslations('checkout.payment');
  return (
    <Suspense fallback={<p className="text-sm text-[var(--color-text-secondary)]">{t('loadingIframe')}</p>}>
      <PaymentInner />
    </Suspense>
  );
}
