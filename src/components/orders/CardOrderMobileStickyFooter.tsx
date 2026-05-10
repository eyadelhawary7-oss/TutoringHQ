'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { formatCurrency } from '@/lib/formatNumber';

/** Fixed checkout bar on small screens — totals mirror cart header. */
export function CardOrderMobileStickyFooter() {
  const t = useTranslations('cart');
  const tm = useTranslations('mobile.cart');
  const locale = useLocale();
  const { cart, activeItemCount, minimumQuantity, totals, loading } = useCardOrderCart();

  if (loading || !cart || activeItemCount === 0) return null;

  return (
    <div
      className="md:hidden fixed start-0 end-0 bottom-0 z-[70] border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/98 backdrop-blur-md px-4 pt-3 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
      style={{ paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))` }}
      data-testid="card-order-mobile-sticky-footer"
    >
      <p className="sr-only" aria-live="polite" aria-atomic>
        {tm('liveCartSummary', {
          count: activeItemCount,
          total: formatCurrency(totals.productInclusive, locale),
        })}
      </p>
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--color-text-secondary)]">{t('title')}</p>
          <p className="text-sm font-bold tabular-nums text-[var(--color-text-primary)] truncate">
            {t('itemCount', { count: activeItemCount })} · {formatCurrency(totals.productInclusive, locale)}
          </p>
        </div>
        {activeItemCount >= minimumQuantity ? (
          <Link
            href="/orders/checkout"
            className="shrink-0 min-h-[44px] min-w-[44px] px-5 inline-flex items-center justify-center rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold"
          >
            {t('checkout')}
          </Link>
        ) : (
          <span className="text-xs text-amber-700 dark:text-amber-200 shrink-0 max-w-[140px]">
            {t('minimumNotMet', { need: Math.max(0, minimumQuantity - activeItemCount) })}
          </span>
        )}
      </div>
    </div>
  );
}
