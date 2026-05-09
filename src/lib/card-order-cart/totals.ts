import { buildInternalBreakdown, cardOrderProductInclusiveFromQty } from '@/lib/pricing/taxMath';

export type CartItemLike = {
  kind: 'student' | 'blank';
  quantity: number;
  saved_for_later: boolean;
};

/** Active card count for pricing (excludes saved-for-later). */
export function activeCardCountFromItems(items: CartItemLike[]): number {
  let n = 0;
  for (const i of items) {
    if (i.saved_for_later) continue;
    if (i.kind === 'blank') n += Math.max(0, Math.round(Number(i.quantity)) || 0);
    else n += 1;
  }
  return n;
}

export function computeCardCartTotals(items: CartItemLike[], locale: 'en' | 'ar') {
  const qty = activeCardCountFromItems(items);
  const productInclusive = cardOrderProductInclusiveFromQty(qty);
  const breakdown = buildInternalBreakdown(productInclusive, locale);
  return {
    activeCardCount: qty,
    productInclusive,
    breakdown,
  };
}
