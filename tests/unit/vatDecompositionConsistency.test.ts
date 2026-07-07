import { describe, expect, it } from 'vitest';
import {
  explodeInclusive,
  baseFromInclusive,
  inclusiveFromBase,
  CARD_UNIT_BASE_EGP,
  cardOrderProductInclusiveFromQty,
} from '@/lib/pricing/taxMath';
import { vatInsideInclusive } from '@/lib/processingFee';

// B-H1 regression: taxMath and processingFee used to decompose VAT with two
// different, contradictory formulas — taxMath stripped P × 0.14 (base = P × 0.86)
// while processingFee used the correct VAT-inclusive split P × 0.14 / 1.14. On a
// legal فاتورة ضريبية that made the "VAT (14%)" line 16.28% of the printed
// subtotal. Both modules must now use the SAME ÷1.14 split so every invoice
// path agrees and the VAT line is exactly 14% of the base.
describe('VAT decomposition consistency (B-H1)', () => {
  const AMOUNTS = [60, 999, 1019, 4999, 3000, 21299, 20];

  it('taxMath.explodeInclusive VAT === processingFee.vatInsideInclusive for every amount', () => {
    for (const p of AMOUNTS) {
      expect(explodeInclusive(p).vat, `mismatch at ${p}`).toBeCloseTo(vatInsideInclusive(p), 2);
    }
  });

  it('the VAT slice is exactly 14% of the base (legal invoice invariant)', () => {
    for (const p of AMOUNTS) {
      const { base, vat } = explodeInclusive(p);
      expect(vat, `VAT != 14% of base at ${p}`).toBeCloseTo(base * 0.14, 1);
      expect(base + vat, `base+vat != total at ${p}`).toBeCloseTo(p, 2);
    }
  });

  it('base = inclusive / 1.14 (not inclusive × 0.86)', () => {
    expect(baseFromInclusive(4999)).toBeCloseTo(4385.09, 2);
    expect(baseFromInclusive(999)).toBeCloseTo(876.32, 2);
    // The retired ×0.86 model would give 4299.14 / 859.14 — assert we are NOT that.
    expect(baseFromInclusive(4999)).not.toBeCloseTo(4299.14, 1);
  });

  it('the redesigned-invoice worked example holds (999 + 20 fee → VAT inside 1019)', () => {
    // total = 1019 (999 subscription + 20 processing fee); the exact VAT-inclusive
    // slice is 1019 × 0.14 / 1.14 = 125.14. (PRICING_SPEC.md rounds this to 125.16
    // in prose — a documentation rounding artifact; the code figure is authoritative.)
    expect(vatInsideInclusive(1019)).toBeCloseTo(125.14, 2);
    expect(explodeInclusive(1019).vat).toBeCloseTo(125.14, 2);
  });

  it('card economics are preserved under the new split (flat 60 EGP/card, no drift)', () => {
    // The charged amount for card orders must NOT move — only the base/VAT
    // breakdown changes. CARD_UNIT_BASE is now 60/1.14 (unrounded) so multiples
    // gross back exactly.
    expect(inclusiveFromBase(CARD_UNIT_BASE_EGP)).toBe(60);
    expect(cardOrderProductInclusiveFromQty(1)).toBe(60);
    expect(cardOrderProductInclusiveFromQty(2)).toBe(120);
    expect(cardOrderProductInclusiveFromQty(5)).toBe(300);
    expect(cardOrderProductInclusiveFromQty(50)).toBe(3000);
  });
});
