'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { ShoppingCart } from 'lucide-react';
import { useCardOrderCartOptional } from '@/hooks/useCardOrderCart';
import { formatCurrency } from '@/lib/formatNumber';
import { cn } from '@/lib/utils';

export function OrdersNavWithCartPreview({ navLinkClass }: { navLinkClass: (active: boolean) => string }) {
  const t = useTranslations('nav');
  const tc = useTranslations('cart');
  const locale = useLocale();
  const pathname = usePathname();
  const cart = useCardOrderCartOptional();
  const [previewOpen, setPreviewOpen] = useState(false);

  const count = cart?.activeItemCount ?? 0;
  const total = cart?.totals?.productInclusive ?? 0;

  const clean = pathname.replace(/^\/(ar|en)(\/|$)/, '/') || '/';
  const isOrders = clean === '/orders' || clean.startsWith('/orders/');

  return (
    <div
      className="relative"
      onMouseEnter={() => setPreviewOpen(true)}
      onMouseLeave={() => setPreviewOpen(false)}
      onTouchStart={() => setPreviewOpen((v) => !v)}
    >
      <Link href="/orders" className={cn(navLinkClass(isOrders), 'relative')} onClick={() => setPreviewOpen(false)}>
        <ShoppingCart size={18} className="shrink-0" />
        <span className="truncate">{t('orders')}</span>
        {count > 0 ? (
          <span className="ms-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-teal-600 text-white text-[10px] font-bold leading-none tabular-nums shrink-0">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
      {previewOpen && count > 0 ? (
        <div
          className="hidden lg:block absolute start-0 top-full mt-1 z-[120] min-w-[220px] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-3 shadow-lg"
          role="tooltip"
        >
          <p className="text-xs text-[var(--color-text-secondary)]">{tc('nav.miniPreview')}</p>
          <p className="text-sm font-semibold text-[var(--color-text-primary)] mt-1 tabular-nums">
            {tc('itemCount', { count })} · {formatCurrency(total, locale)}
          </p>
          <Link
            href="/orders"
            className="mt-2 block text-center text-xs font-semibold rounded-lg bg-teal-600 text-white py-2 hover:bg-teal-700"
          >
            {tc('nav.viewCart')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
