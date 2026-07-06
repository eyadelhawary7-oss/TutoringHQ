'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { formatCurrency } from '@/lib/formatNumber';
import { formatRelativeMinutesAgo } from '@/lib/formatNumber';

export function CardOrderCartHeader() {
  const t = useTranslations('cart');
  const locale = useLocale();
  const {
    cart,
    activeItemCount,
    minimumQuantity,
    totals,
    concurrencyConflict,
    acknowledgeConcurrency,
  } = useCardOrderCart();

  const need = Math.max(0, minimumQuantity - activeItemCount);
  const progressPct =
    minimumQuantity <= 0 ? 100 : Math.min(100, Math.round((activeItemCount / minimumQuantity) * 100));

  const modName = cart?.last_modified_by_name?.trim() || '';
  const modTime =
    cart?.updated_at && modName ? formatRelativeMinutesAgo(cart.updated_at, locale) : '';

  return (
    <div
      className="sticky top-0 z-20 -mx-4 px-4 py-3 mb-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/95 backdrop-blur-sm space-y-3"
      data-testid="card-order-cart-header"
    >
      {concurrencyConflict ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/25 px-3 py-2 text-sm text-amber-100">
          <p className="flex-1">
            {t('concurrency.conflict', {
              name: cart?.last_modified_by_name?.trim() || '…',
            })}
          </p>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-teal-300 underline"
            onClick={() => acknowledgeConcurrency()}
          >
            {t('concurrency.refreshCta')}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t('title')}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            {t('itemCount', { count: activeItemCount })} · {formatCurrency(totals.productInclusive, locale)}
          </p>
          {modName && modTime ? (
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
              {t('lastModifiedBy', { name: modName, timeAgo: modTime })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-stretch gap-2 min-w-[140px]">
          {activeItemCount >= minimumQuantity ? (
            <Link
              href="/orders/checkout"
              className="text-center px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors"
            >
              {t('checkout')}
            </Link>
          ) : (
            <div className="text-xs font-medium text-amber-700 bg-amber-500/15 rounded-lg px-3 py-2 border border-amber-500/25">
              {t('minimumNotMet', { need })}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-[var(--color-text-secondary)] mb-1">
          <span>{t('minimumProgress', { current: activeItemCount, minimum: minimumQuantity })}</span>
          <span>{activeItemCount >= minimumQuantity ? t('minimumMet') : null}</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden border border-[var(--color-border-subtle)]">
          <div
            className={`h-full rounded-full transition-all ${activeItemCount >= minimumQuantity ? 'bg-teal-500' : 'bg-amber-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
