import { describe, expect, it } from 'vitest';
import {
  baseFromInclusive,
  inclusiveFromBase,
  explodeInclusive,
  buildLegalInvoiceLines,
  cardOrderProductInclusiveFromQty,
  CARD_UNIT_BASE_EGP,
} from '@/lib/pricing/taxMath';

describe('taxMath (VAT-only; no service fee / stamp duty)', () => {
  it('baseFromInclusive strips only 14% VAT', () => {
    expect(baseFromInclusive(4999)).toBeCloseTo(4299.14, 2);
    expect(baseFromInclusive(4499)).toBeCloseTo(3869.14, 2);
    expect(baseFromInclusive(999)).toBeCloseTo(859.14, 2);
  });

  it('card base 51.6 grosses up to a flat 60 EGP/card', () => {
    expect(CARD_UNIT_BASE_EGP).toBe(51.6);
    expect(inclusiveFromBase(CARD_UNIT_BASE_EGP)).toBe(60);
    expect(cardOrderProductInclusiveFromQty(1)).toBe(60);
    expect(cardOrderProductInclusiveFromQty(5)).toBe(300);
    expect(cardOrderProductInclusiveFromQty(50)).toBe(3000);
  });

  it('explodeInclusive splits into base + VAT only, summing exactly', () => {
    const b = explodeInclusive(60);
    expect(b.base).toBeCloseTo(51.6, 2);
    expect(b.vat).toBeCloseTo(8.4, 2);
    expect(b.base + b.vat).toBeCloseTo(60, 4);
  });

  it('buildLegalInvoiceLines: subtotal, VAT, then total — no service/stamp lines', () => {
    const lines = buildLegalInvoiceLines(60, 'en');
    expect(lines).toHaveLength(3);
    expect(lines[1]?.label.toLowerCase()).toContain('vat');
    expect(lines[2]?.isTotal).toBe(true);
    expect(lines[1]?.amount).toBeCloseTo(explodeInclusive(60).vat, 4);
  });
});
