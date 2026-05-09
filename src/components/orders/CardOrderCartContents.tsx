'use client';

import { useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import type { HydratedCartItem } from '@/lib/card-order-cart/server';
import { formatCurrency } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { StudentPickerDrawer, type StudentPickerRow } from '@/components/orders/StudentPickerDrawer';
import { CartRecommendations } from '@/components/orders/CartRecommendations';
import { CardOrderCartItemRow } from '@/components/orders/CardOrderCartItemRow';

export function CardOrderCartContents({
  studentsForPicker,
  centerId = null,
}: {
  studentsForPicker: StudentPickerRow[];
  centerId?: string | null;
}) {
  const t = useTranslations('cart');
  const tCommon = useTranslations('common');
  const tMobile = useTranslations('mobile.cart');
  const locale = useLocale();
  const {
    cart,
    items,
    activeItems,
    savedForLater,
    totals,
    loading,
    removeItem,
    toggleSaveForLater,
    updateItem,
    abandonCart,
    addItem,
    createCart,
    refresh,
    activeItemCount,
  } = useCardOrderCart();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [blankQty, setBlankQty] = useState(1);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const blankLine = useMemo(() => activeItems.find((i) => i.kind === 'blank'), [activeItems]);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      await refresh();
    }
  };

  const initials = (name: string | null | undefined) =>
    (name?.trim()?.charAt(0) || '?').toUpperCase();

  const rowStudent = (item: HydratedCartItem) => (
    <CardOrderCartItemRow
      key={item.id}
      item={item}
      busyId={busyId}
      initials={initials}
      onRemove={() =>
        run(async () => {
          setBusyId(item.id);
          await removeItem(item.id);
          setBusyId(null);
        })
      }
      onSaveForLater={() =>
        run(async () => {
          setBusyId(item.id);
          await toggleSaveForLater(item.id, true);
          setBusyId(null);
        })
      }
      onMoveToCart={() =>
        run(async () => {
          setBusyId(item.id);
          await toggleSaveForLater(item.id, false);
          setBusyId(null);
        })
      }
    />
  );

  const rowBlank = (item: HydratedCartItem) => (
    <li key={item.id} className="flex items-center gap-3 py-3 border-b border-[var(--color-border-subtle)] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('blanks.label')}</p>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[var(--color-border-subtle)] disabled:opacity-50"
            disabled={item.quantity <= 1 || !!busyId}
            onClick={() =>
              run(async () => {
                setBusyId(item.id);
                await updateItem(item.id, { quantity: Math.max(1, item.quantity - 1) });
                setBusyId(null);
              })
            }
          >
            <Minus size={14} />
          </button>
          <span className="tabular-nums text-sm font-semibold w-8 text-center">{item.quantity}</span>
          <button
            type="button"
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[var(--color-border-subtle)] disabled:opacity-50"
            disabled={!!busyId}
            onClick={() =>
              run(async () => {
                setBusyId(item.id);
                await updateItem(item.id, { quantity: item.quantity + 1 });
                setBusyId(null);
              })
            }
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] shrink-0"
        aria-label={t('studentRow.removeFromCart')}
        disabled={!!busyId}
        onClick={() =>
          run(async () => {
            setBusyId(item.id);
            await removeItem(item.id);
            setBusyId(null);
          })
        }
      >
        <Trash2 size={16} />
      </button>
    </li>
  );

  const hasCart = !!cart;
  const showEmpty = !loading && (!hasCart || items.length === 0);

  const activeStudentRows = activeItems.filter((i) => i.kind === 'student');
  return (
    <div className="space-y-6 mb-8" data-testid="card-order-cart-contents">
      {showEmpty ? (
        <>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 text-center space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]">{t('empty.title')}</p>
            <button
              type="button"
              data-testid="card-cart-add-students"
              className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold"
              onClick={() => setPickerOpen(true)}
            >
              {t('empty.cta')}
            </button>
            <Link href="/students" className="block text-xs text-teal-600 dark:text-teal-400 underline">
              {t('empty.studentsWithoutCards')}
            </Link>
            {!hasCart ? (
              <button
                type="button"
                className="block mx-auto text-xs font-semibold text-[var(--color-text-secondary)] underline"
                onClick={() => run(async () => await createCart())}
              >
                {t('startNewOrder')}
              </button>
            ) : null}
          </div>
          <CartRecommendations centerId={centerId} show={showEmpty} />
        </>
      ) : (
        <>
          <p className="sr-only" aria-live="polite" aria-atomic>
            {tMobile('liveCartSummary', {
              count: activeItemCount,
              total: formatCurrency(totals.productInclusive, locale),
            })}
          </p>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
              {t('activeSection')}
            </p>
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {activeStudentRows.length === 0 && !blankLine ? (
                <li className="py-3 text-sm text-[var(--color-text-secondary)]">{t('empty.title')}</li>
              ) : null}
              {activeStudentRows.map(rowStudent)}
              {blankLine ? rowBlank(blankLine) : null}
            </ul>
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                className="text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]"
                onClick={() => setPickerOpen(true)}
              >
                + {t('empty.cta')}
              </button>
              <button
                type="button"
                className="text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]"
                onClick={() => {
                  setBlankQty(1);
                  setBlankOpen(true);
                }}
              >
                + {t('blanks.add')}
              </button>
            </div>
          </div>

          {savedForLater.length > 0 ? (
            <details className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 group">
              <summary className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide cursor-pointer list-none flex justify-between items-center">
                {t('savedSection')}
                <span className="text-[var(--color-text-tertiary)]">{savedForLater.length}</span>
              </summary>
              <ul className="mt-3">{savedForLater.filter((i) => i.kind === 'student').map(rowStudent)}</ul>
            </details>
          ) : null}

          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 space-y-2">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{t('totals.subtotal')}</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(totals.productInclusive, locale)}</p>
            <ul className="text-[11px] text-[var(--color-text-tertiary)] space-y-0.5">
              {totals.breakdown.map((line) => (
                <li key={line.label} className="flex justify-between gap-2">
                  <span>{line.label}</span>
                  <span className="font-mono">{formatCurrency(line.amount, locale)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-[var(--color-text-secondary)] pt-2 border-t border-[var(--color-border-subtle)]">
              {t('totals.shippingHint')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs font-semibold text-red-600 dark:text-red-400 underline"
              onClick={() => setAbandonOpen(true)}
            >
              {t('abandon')}
            </button>
          </div>
        </>
      )}

      <StudentPickerDrawer open={pickerOpen} onClose={() => setPickerOpen(false)} students={studentsForPicker} />

      {blankOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal
          onClick={() => setBlankOpen(false)}
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] p-6 max-w-sm w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{t('blanks.add')}</h3>
              <button type="button" className="p-2 rounded-lg hover:bg-[var(--color-surface-2)]" onClick={() => setBlankOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">{t('blanks.quantity')}</label>
            <input
              type="number"
              min={1}
              className="w-full rounded-lg border border-input bg-[var(--color-surface-0)] px-3 py-2 text-sm mb-4"
              value={blankQty}
              onChange={(e) => setBlankQty(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
            <button
              type="button"
              className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700"
              onClick={() =>
                run(async () => {
                  await addItem({ kind: 'blank', quantity: blankQty });
                  setBlankOpen(false);
                })
              }
            >
              {t('blanks.add')}
            </button>
          </div>
        </div>
      ) : null}

      {abandonOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal>
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] p-6 max-w-sm w-full shadow-xl space-y-4">
            <p className="text-sm text-[var(--color-text-primary)]">{t('abandonConfirm')}</p>
            <div className="flex gap-2">
              <button type="button" className="flex-1 py-2 rounded-lg border border-[var(--color-border-subtle)] text-sm" onClick={() => setAbandonOpen(false)}>
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold"
                onClick={() =>
                  run(async () => {
                    await abandonCart();
                    setAbandonOpen(false);
                  })
                }
              >
                {t('abandon')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
