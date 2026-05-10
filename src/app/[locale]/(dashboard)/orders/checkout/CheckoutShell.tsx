'use client';

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from '@/i18n/routing';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useUser } from '@/contexts/UserContext';
import { formatCurrency } from '@/lib/formatNumber';
import { getShippingFee, getShippingZone, formatShippingZoneForLocale } from '@/lib/bostaShipping';
import { cn } from '@/lib/utils';

function stripLocale(path: string): string {
  return path.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

const PAY_SESSION_KEY = 'chq_card_checkout_payment';

export function readCheckoutPaymentSession(): { orderId: string; paymentUrl: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PAY_SESSION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { orderId?: string; paymentUrl?: string };
    if (!j.orderId || !j.paymentUrl) return null;
    return { orderId: j.orderId, paymentUrl: j.paymentUrl };
  } catch {
    return null;
  }
}

export function writeCheckoutPaymentSession(orderId: string, paymentUrl: string) {
  sessionStorage.setItem(PAY_SESSION_KEY, JSON.stringify({ orderId, paymentUrl }));
}

export function clearCheckoutPaymentSession() {
  sessionStorage.removeItem(PAY_SESSION_KEY);
}

const CheckoutRatesContext = createContext<Record<string, number> | null>(null);

export function useCheckoutRates(): Record<string, number> | null {
  return useContext(CheckoutRatesContext);
}

export function CheckoutShell({
  shippingRates,
  children,
}: {
  shippingRates: Record<string, number> | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const t = useTranslations('checkout');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const basePath = stripLocale(pathname);
  const isSuccess = basePath.includes('/checkout/success');
  const isPayment = basePath.endsWith('/checkout/payment');

  const { cart, activeItemCount, minimumQuantity, totals, loading, refresh } = useCardOrderCart();
  const [gateReady, setGateReady] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading) return;
    if (!user?.center_id) {
      router.replace('/orders?checkout_error=no_center');
      return;
    }
    if (isSuccess || isPayment) {
      setGateReady(true);
      return;
    }
    if (!cart || cart.status !== 'open') {
      router.replace('/orders?checkout_error=no_cart');
      return;
    }
    if (activeItemCount < minimumQuantity) {
      router.replace('/orders?checkout_error=below_minimum');
      return;
    }
    setGateReady(true);
  }, [loading, user?.center_id, cart, activeItemCount, minimumQuantity, router, isSuccess, isPayment]);

  const stepIndex = useMemo(() => {
    if (basePath.endsWith('/checkout/payment')) return 3;
    if (basePath.includes('/checkout/review')) return 2;
    if (basePath.includes('/checkout/customize')) return 1;
    return 0;
  }, [basePath]);

  const tm = useTranslations('mobile.checkout');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const gov = cart?.delivery_governorate?.trim() || '';
  const shipFee = getShippingFee(gov || undefined, shippingRates);
  const zoneLabel = formatShippingZoneForLocale(getShippingZone(gov || undefined, shippingRates), locale);
  const grandTotal = totals.productInclusive + shipFee;

  const summaryCard =
    !isSuccess && !isPayment ? (
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 lg:sticky lg:top-24 space-y-2 text-sm">
        <p className="font-semibold text-[var(--color-text-primary)]">{t('summary.title')}</p>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-secondary)]">{t('summary.cards')}</span>
          <span className="tabular-nums font-medium">{activeItemCount}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-secondary)]">{t('summary.subtotal')}</span>
          <span className="tabular-nums">{formatCurrency(totals.productInclusive, locale)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-secondary)]">{t('summary.shipping')}</span>
          <span className="tabular-nums">{gov ? formatCurrency(shipFee, locale) : '—'}</span>
        </div>
        {gov ? <p className="text-[11px] text-[var(--color-text-tertiary)]">{zoneLabel}</p> : null}
        <div className="flex justify-between gap-2 pt-2 border-t border-[var(--color-border-subtle)] font-bold">
          <span>{t('summary.total')}</span>
          <span className="tabular-nums text-teal-700 dark:text-teal-300">{formatCurrency(grandTotal, locale)}</span>
        </div>
      </div>
    ) : null;

  if (!gateReady) {
    return (
      <CheckoutRatesContext.Provider value={shippingRates}>
        <div className="min-h-[40vh] flex items-center justify-center text-sm text-[var(--color-text-secondary)] px-4">
          {t('loading')}
        </div>
      </CheckoutRatesContext.Provider>
    );
  }

  return (
    <CheckoutRatesContext.Provider value={shippingRates}>
      <div className="max-w-6xl mx-auto px-4 py-6 pb-[calc(96px+env(safe-area-inset-bottom,0px))] lg:pb-8">
      {!isSuccess ? (
        <nav
          aria-label={t('stepsAria')}
          className="sticky top-0 z-30 -mx-4 px-4 py-3 mb-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/95 backdrop-blur-md lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none lg:px-0 lg:py-0 lg:mb-6"
        >
          <ol
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={stepIndex}
            aria-label={t('stepsAria')}
            className="flex flex-wrap items-center justify-center gap-2 md:gap-4"
          >
            {[
              { href: '/orders/checkout', label: t('stepDelivery') },
              { href: '/orders/checkout/customize', label: t('stepCustomize') },
              { href: '/orders/checkout/review', label: t('stepReview') },
              { href: '/orders/checkout/payment', label: t('stepPay') },
            ].map((s, i) => (
              <li key={s.href} className="flex items-center gap-2">
                {i > 0 ? <span className="text-[var(--color-text-muted)] hidden sm:inline">→</span> : null}
                <Link
                  href={s.href}
                  className={cn(
                    'flex min-h-[44px] items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold border transition-colors',
                    i === stepIndex
                      ? 'border-teal-500 bg-teal-500/15 text-teal-800 dark:text-teal-200'
                      : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-[11px]',
                      i <= stepIndex ? 'bg-teal-600 text-white' : 'bg-[var(--color-surface-2)]',
                    )}
                  >
                    {i + 1}
                  </span>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="hidden lg:block lg:w-80 shrink-0 order-first lg:order-last">{summaryCard}</aside>
        <div className="flex-1 min-w-0 order-last lg:order-first">{children}</div>
      </div>

      {!isSuccess && !isPayment && summaryCard ? (
        <>
          <div
            className="lg:hidden fixed start-0 end-0 bottom-0 z-50 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/98 backdrop-blur-md px-4 pt-2 shadow-[0_-4px_24px_rgba(0,0,0,0.06)]"
            style={{ paddingBottom: `calc(8px + env(safe-area-inset-bottom, 0px))` }}
          >
            <button
              type="button"
              className="flex w-full min-h-[44px] items-center justify-between gap-3 text-start"
              aria-expanded={mobileSheetOpen}
              onClick={() => setMobileSheetOpen(true)}
            >
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">{tm('summaryToggle')}</span>
              <span className="text-sm font-bold tabular-nums text-teal-700 dark:text-teal-300">
                {activeItemCount} · {formatCurrency(grandTotal, locale)}
              </span>
            </button>
          </div>

          {mobileSheetOpen ? (
            <div
              className="lg:hidden fixed inset-0 z-[60] flex flex-col justify-end bg-black/45"
              role="dialog"
              aria-modal="true"
              aria-labelledby="checkout-summary-sheet-title"
            >
              <button
                type="button"
                className="min-h-[48px] flex-1 w-full"
                aria-label={tCommon('cancel')}
                onClick={() => setMobileSheetOpen(false)}
              />
              <div className="max-h-[78vh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-3 shadow-xl">
                <div
                  className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-[var(--color-border-subtle)]"
                  aria-hidden
                />
                <p id="checkout-summary-sheet-title" className="sr-only">
                  {tm('summaryExpand')}
                </p>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4 space-y-2 text-sm">
                  <p className="font-semibold text-[var(--color-text-primary)]">{t('summary.title')}</p>
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-secondary)]">{t('summary.cards')}</span>
                    <span className="tabular-nums font-medium">{activeItemCount}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-secondary)]">{t('summary.subtotal')}</span>
                    <span className="tabular-nums">{formatCurrency(totals.productInclusive, locale)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-secondary)]">{t('summary.shipping')}</span>
                    <span className="tabular-nums">{gov ? formatCurrency(shipFee, locale) : '—'}</span>
                  </div>
                  {gov ? <p className="text-[11px] text-[var(--color-text-tertiary)]">{zoneLabel}</p> : null}
                  <div className="flex justify-between gap-2 pt-2 border-t border-[var(--color-border-subtle)] font-bold">
                    <span>{t('summary.total')}</span>
                    <span className="tabular-nums text-teal-700 dark:text-teal-300">
                      {formatCurrency(grandTotal, locale)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-4 w-full min-h-[44px] rounded-xl border border-[var(--color-border-subtle)] text-sm font-semibold"
                  onClick={() => setMobileSheetOpen(false)}
                >
                  {tm('summaryCollapse')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      </div>
    </CheckoutRatesContext.Provider>
  );
}
