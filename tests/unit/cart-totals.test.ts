import { describe, expect, it } from 'vitest';
import { cardOrderProductInclusiveFromQty } from '@/lib/pricing/taxMath';
import { activeCardCountFromItems, computeCardCartTotals } from '@/lib/card-order-cart/totals';

describe('card cart totals', () => {
  it('counts 5 student lines as 5 active cards and matches inclusive product total', () => {
    const items = Array.from({ length: 5 }, () => ({
      kind: 'student' as const,
      quantity: 1,
      saved_for_later: false,
    }));
    expect(activeCardCountFromItems(items)).toBe(5);
    const totals = computeCardCartTotals(items, 'en');
    expect(totals.activeCardCount).toBe(5);
    expect(totals.productInclusive).toBe(cardOrderProductInclusiveFromQty(5));
    // 5 cards × 60 EGP/card (VAT-inclusive, no service fee / stamp duty)
    expect(totals.productInclusive).toBe(300);
  });

  it('counts 3 students + blank quantity 2 as 5 active cards', () => {
    const items = [
      ...Array.from({ length: 3 }, () => ({
        kind: 'student' as const,
        quantity: 1,
        saved_for_later: false,
      })),
      { kind: 'blank' as const, quantity: 2, saved_for_later: false },
    ];
    expect(activeCardCountFromItems(items)).toBe(5);
    const totals = computeCardCartTotals(items, 'en');
    expect(totals.productInclusive).toBe(cardOrderProductInclusiveFromQty(5));
  });

  it('excludes saved-for-later items from active count and totals', () => {
    const items = [
      { kind: 'student' as const, quantity: 1, saved_for_later: false },
      { kind: 'student' as const, quantity: 1, saved_for_later: true },
      { kind: 'blank' as const, quantity: 4, saved_for_later: true },
    ];
    expect(activeCardCountFromItems(items)).toBe(1);
    const totals = computeCardCartTotals(items, 'en');
    expect(totals.productInclusive).toBe(cardOrderProductInclusiveFromQty(1));
  });
});
