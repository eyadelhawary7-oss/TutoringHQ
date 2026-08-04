'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { formatCurrency } from '@/lib/formatNumber';
import { buildLegalInvoiceLines } from '@/lib/pricing/taxMath';
import { getShippingFee, formatShippingZoneForLocale, getShippingZone } from '@/lib/bostaShipping';
import { governorateLabel, EGYPT_GOVERNORATES } from '@/lib/egyptGovernorates';
import { supabase } from '@/lib/supabase';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import {
  useCheckoutRates,
  useCheckoutProcessingFee,
  writeCheckoutPaymentSession,
  clearCheckoutPaymentSession,
} from '../CheckoutShell';

export default function CheckoutReviewPage() {
  const t = useTranslations('checkout.review');
  const tCheckout = useTranslations('checkout');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const localeShort: 'en' | 'ar' = locale.startsWith('ar') ? 'ar' : 'en';
  const { cart, activeItems, totals, activeItemCount, loading } = useCardOrderCart();
  const rates = useCheckoutRates();
  const processingFee = useCheckoutProcessingFee();

  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const govLabel = useMemo(() => {
    const g = cart?.delivery_governorate?.trim();
    if (!g) return '';
    const opt = EGYPT_GOVERNORATES.find((x) => x.value === g);
    return opt ? governorateLabel(opt, localeShort) : g;
  }, [cart?.delivery_governorate, localeShort]);

  const shipFee = cart?.delivery_governorate?.trim()
    ? getShippingFee(cart.delivery_governorate.trim(), rates ?? undefined)
    : 0;
  const zoneLabel = formatShippingZoneForLocale(
    getShippingZone(cart?.delivery_governorate?.trim() || undefined, rates ?? undefined),
    locale,
  );

  const legalLines = useMemo(
    () => buildLegalInvoiceLines(totals.productInclusive, localeShort),
    [totals.productInclusive, localeShort],
  );
  const taxLines = legalLines.filter((l) => !l.isTotal);
  const productInclusive = legalLines.find((l) => l.isTotal)?.amount ?? totals.productInclusive;
  const grandTotal = productInclusive + processingFee + shipFee;
  const perCard = activeItemCount > 0 ? grandTotal / activeItemCount : 0;

  const blanks = activeItems.filter((i) => i.kind === 'blank');
  const blankCount = blanks.reduce((s, i) => s + Math.max(1, Math.round(Number(i.quantity)) || 0), 0);

  async function placeOrder() {
    setError(null);
    if (!terms) return;
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const res = await fetch('/api/card-order-cart/checkout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ terms_accepted: true }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        orderId?: string;
        paymentUrl?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? body.code ?? res.statusText);
      }
      if (!body.orderId || !body.paymentUrl) throw new Error('Invalid checkout response');

      clearCheckoutPaymentSession();
      writeCheckoutPaymentSession(body.orderId, body.paymentUrl);
      router.push(`/orders/checkout/payment?orderId=${encodeURIComponent(body.orderId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  const phoneDisp = cart?.delivery_phone?.trim() ?? '';

  return (
    <div className="space-y-8 max-w-2xl" data-testid="checkout-review">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('subtitle')}</p>
      </div>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
        <div className="flex justify-between items-start gap-2 mb-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('sections.items')}</h2>
          <Link href="/orders" className="text-xs font-semibold text-teal-600 hover:underline">
            {t('edit.items')}
          </Link>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--color-text-secondary)]">{t('itemsSummary', { count: activeItemCount })}</summary>
          <ul className="mt-2 space-y-1 text-[var(--color-text-primary)]">
            {activeItems.map((i) =>
              i.kind === 'student' ? (
                <li key={i.id}>
                  {i.student?.name?.trim() || tCommon('notAvailable')}{' '}
                  <span className="text-[var(--color-text-tertiary)]">
                    #<bdi>{i.student?.student_number?.trim() || tCommon('notAvailable')}</bdi>
                  </span>
                </li>
              ) : null,
            )}
            {blankCount > 0 ? (
              <li className="text-[var(--color-text-secondary)]">{t('blanksLine', { count: blankCount })}</li>
            ) : null}
          </ul>
        </details>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
        <div className="flex justify-between items-start gap-2">
          <h2 className="font-semibold text-[var(--color-text-primary)]">{t('sections.delivery')}</h2>
          <Link href="/orders/checkout" className="text-xs font-semibold text-teal-600 hover:underline shrink-0">
            {t('edit.delivery')}
          </Link>
        </div>
        <p>
          <span className="text-[var(--color-text-secondary)]">{t('govLabel')}:</span> {govLabel || tCommon('notAvailable')}
        </p>
        <p>
          <span className="text-[var(--color-text-secondary)]">{t('addressLabel')}:</span> {cart?.delivery_address?.trim() || tCommon('notAvailable')}
        </p>
        <p>
          <span className="text-[var(--color-text-secondary)]">{t('phoneLabel')}:</span> {phoneDisp || tCommon('notAvailable')}
        </p>
        <p>
          <span className="text-[var(--color-text-secondary)]">{t('deliveryNotesLabel')}:</span>{' '}
          {cart?.notes?.trim() ? cart.notes.trim() : tCommon('notAvailable')}
        </p>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2 text-sm">
        <div className="flex justify-between items-start gap-2">
          <h2 className="font-semibold text-[var(--color-text-primary)]">{t('sections.customize')}</h2>
          <Link href="/orders/checkout/customize" className="text-xs font-semibold text-teal-600 hover:underline shrink-0">
            {t('edit.customize')}
          </Link>
        </div>
        <p>
          <span className="text-[var(--color-text-secondary)]">{t('styleLabel')}:</span>{' '}
          {cart?.card_style === 'light' ? t('styleLight') : cart?.card_style === 'dark' ? t('styleDark') : tCommon('notAvailable')}
        </p>
        <p>
          <span className="text-[var(--color-text-secondary)]">{t('vendorNotesLabel')}:</span>{' '}
          {cart?.vendor_notes?.trim() ? cart.vendor_notes.trim() : tCommon('notAvailable')}
        </p>
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('sections.pricing')}</h2>
        <div className="space-y-1 text-sm">
          {taxLines.map((line) => (
            <div key={line.label} className="flex justify-between gap-2">
              <span className="text-[var(--color-text-secondary)]">{line.label}</span>
              <span className="tabular-nums">{formatCurrency(line.amount, locale)}</span>
            </div>
          ))}
          <div className="flex justify-between gap-2 pt-1 border-t border-[var(--color-border-subtle)]">
            <span className="text-[var(--color-text-secondary)]">{t('subtotalInclusive')}</span>
            <span className="tabular-nums font-medium">{formatCurrency(productInclusive, locale)}</span>
          </div>
          {processingFee > 0 ? (
            <div className="flex justify-between gap-2">
              <span className="text-[var(--color-text-secondary)]">{t('processingFee')}</span>
              <span className="tabular-nums">{formatCurrency(processingFee, locale)}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <span className="text-[var(--color-text-secondary)]">{t('shippingLine', { zone: zoneLabel || tCommon('notAvailable') })}</span>
            <span className="tabular-nums">{formatCurrency(shipFee, locale)}</span>
          </div>
          <div className="flex justify-between gap-2 pt-2 text-lg font-bold">
            <span>{t('grandTotal')}</span>
            <span className="tabular-nums text-teal-700">{formatCurrency(grandTotal, locale)}</span>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)] pt-1">{t('perCardAllIn', { amount: formatCurrency(perCard, locale) })}</p>
        </div>
      </section>

      <label className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
        <input
          type="checkbox"
          data-testid="checkout-terms"
          className="mt-1 rounded border-[var(--color-border-subtle)]"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
        />
        <span>{tCheckout('terms.noRefund')}</span>
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        data-testid="checkout-place-order"
        disabled={!terms || submitting || loading}
        onClick={() => void placeOrder()}
        className="w-full sm:w-auto px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-sm"
      >
        {submitting ? t('placing') : t('placeOrder')}
      </button>
    </div>
  );
}
