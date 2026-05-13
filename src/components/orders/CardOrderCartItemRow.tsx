'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import type { HydratedCartItem } from '@/lib/card-order-cart/server';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

const SWIPE_OPEN = -88;

export function CardOrderCartItemRow({
  item,
  busyId,
  onRemove,
  onSaveForLater,
  onMoveToCart,
  initials,
}: {
  item: HydratedCartItem;
  busyId: string | null;
  onRemove: () => Promise<void>;
  onSaveForLater: () => Promise<void>;
  onMoveToCart: () => Promise<void>;
  initials: (name: string | null | undefined) => string;
}) {
  const t = useTranslations('cart');
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const lastX = useRef(0);
  const [offset, setOffset] = useState(0);

  const revealActions = offset < SWIPE_OPEN / 2;

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    lastX.current = offset;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current == null) return;
    const dx = e.touches[0].clientX - startX.current;
    let next = lastX.current + dx;
    if (item.saved_for_later) {
      next = Math.min(0, Math.max(SWIPE_OPEN, next));
    } else {
      next = Math.min(0, Math.max(SWIPE_OPEN, next));
    }
    setOffset(next);
  };

  const onTouchEnd = () => {
    startX.current = null;
    setOffset((o) => (o < SWIPE_OPEN / 2 ? SWIPE_OPEN : 0));
  };

  const closeSwipe = useCallback(() => setOffset(0), []);

  const label =
    `${item.student?.name ?? ','}, ${item.stale ? t('studentRow.removedFromCenter') : item.saved_for_later ? t('savedSection') : t('activeSection')}`;

  return (
    <li className="relative overflow-hidden border-b border-[var(--color-border-subtle)] last:border-0 md:overflow-visible">
      <div
        className="absolute inset-y-0 end-0 flex md:hidden"
        aria-hidden={!revealActions}
      >
        {!item.stale && !item.saved_for_later ? (
          <button
            type="button"
            className="min-w-[88px] min-h-[44px] px-2 bg-stone-600 text-white text-xs font-semibold"
            onClick={() => {
              closeSwipe();
              void onSaveForLater();
            }}
          >
            {t('studentRow.saveForLater')}
          </button>
        ) : null}
        {!item.stale && item.saved_for_later ? (
          <button
            type="button"
            className="min-w-[88px] min-h-[44px] px-2 bg-teal-700 text-white text-xs font-semibold"
            onClick={() => {
              closeSwipe();
              void onMoveToCart();
            }}
          >
            {t('studentRow.moveToCart')}
          </button>
        ) : null}
        <button
          type="button"
          className="min-w-[72px] min-h-[44px] px-2 bg-red-600 text-white text-xs font-semibold"
          onClick={() => {
            closeSwipe();
            void onRemove();
          }}
        >
          {t('studentRow.remove')}
        </button>
      </div>

      {/* Swipe offset uses physical translateX(px) from touch delta; reset on md+, RTL-EXEMPT */}
      <div
        ref={trackRef}
        role="group"
        aria-label={label}
        tabIndex={0}
        className={`relative flex items-start gap-3 py-3 bg-[var(--color-surface-1)] transition-transform md:translate-x-0 ${
          item.stale ? 'opacity-80' : ''
        }`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            void onRemove();
          }
        }}
      >
        <div className="w-9 h-9 rounded-full bg-teal-600/20 text-teal-700 dark:text-teal-300 flex items-center justify-center text-sm font-bold shrink-0">
          {initials(item.student?.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium text-[var(--color-text-primary)] ${item.stale ? 'line-through' : ''}`}>
            {item.student?.name ?? ','}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] font-mono" dir="ltr">
            <bdi>#{formatStudentNumberForDisplay(item.student?.student_number ?? '')}</bdi>
          </p>
          {item.stale ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-300 mt-1">{t('studentRow.removedFromCenter')}</p>
          ) : null}
          <div className="hidden md:flex flex-wrap gap-2 mt-2">
            {!item.stale && item.saved_for_later === false ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-teal-600 dark:text-teal-400 underline min-h-[44px]"
                disabled={!!busyId}
                onClick={() => void onSaveForLater()}
              >
                {t('studentRow.saveForLater')}
              </button>
            ) : null}
            {!item.stale && item.saved_for_later ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-teal-600 dark:text-teal-400 underline min-h-[44px]"
                disabled={!!busyId}
                onClick={() => void onMoveToCart()}
              >
                {t('studentRow.moveToCart')}
              </button>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="hidden md:flex p-3 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] shrink-0 min-h-[44px] min-w-[44px] items-center justify-center"
          aria-label={t('studentRow.removeFromCart')}
          disabled={!!busyId}
          onClick={() => void onRemove()}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}
