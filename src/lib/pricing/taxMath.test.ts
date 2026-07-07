import { describe, expect, it } from 'vitest';
import {
  baseFromInclusive,
  inclusiveFromBase,
  explodeInclusive,
  buildLegalInvoiceLines,
  cardOrderProductInclusiveFromQty,
  CARD_UNIT_BASE_EGP,
} from '@/lib/pricing/taxMath';

describe('taxMath (VAT-only, VAT-inclusive ÷1.14 split; no service fee / stamp duty)', () => {
  it('baseFromInclusive strips only 14% VAT (base = inclusive / 1.14)', () => {
    // VAT-inclusive split: the printed VAT is exactly 14% of the printed base.
    expect(baseFromInclusive(4999)).toBeCloseTo(4385.09, 2);
    expect(baseFromInclusive(4499)).toBeCloseTo(3946.49, 2);
    expect(baseFromInclusive(999)).toBeCloseTo(876.32, 2);
    // Sanity: VAT line = 14% of the stripped base, not 16.28%.
    expect(4999 - baseFromInclusive(4999)).toBeCloseTo(baseFromInclusive(4999) * 0.14, 1);
  });

  it('card base (60 / 1.14) grosses up to a flat 60 EGP/card with no drift', () => {
    expect(CARD_UNIT_BASE_EGP).toBeCloseTo(52.63, 2);
    expect(inclusiveFromBase(CARD_UNIT_BASE_EGP)).toBe(60);
    expect(cardOrderProductInclusiveFromQty(1)).toBe(60);
    expect(cardOrderProductInclusiveFromQty(5)).toBe(300);
    expect(cardOrderProductInclusiveFromQty(50)).toBe(3000);
  });

  it('explodeInclusive splits into base + VAT only, summing exactly', () => {
    const b = explodeInclusive(60);
    expect(b.base).toBeCloseTo(52.63, 2);
    expect(b.vat).toBeCloseTo(7.37, 2);
    expect(b.base + b.vat).toBeCloseTo(60, 4);
    // The VAT slice equals 14% of the base (the compliance invariant).
    expect(b.vat).toBeCloseTo(b.base * 0.14, 1);
  });

  it('buildLegalInvoiceLines: subtotal, VAT, then total — no service/stamp lines', () => {
    const lines = buildLegalInvoiceLines(60, 'en');
    expect(lines).toHaveLength(3);
    expect(lines[1]?.label.toLowerCase()).toContain('vat');
    expect(lines[2]?.isTotal).toBe(true);
    expect(lines[1]?.amount).toBeCloseTo(explodeInclusive(60).vat, 4);
  });
});
