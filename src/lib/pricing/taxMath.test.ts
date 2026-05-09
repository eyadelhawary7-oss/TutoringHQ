import { describe, expect, it } from 'vitest';
import {
  baseFromInclusive,
  inclusiveFromBase,
  explodeInclusive,
  buildLegalInvoiceLines,
} from '@/lib/pricing/taxMath';

describe('taxMath', () => {
  it('baseFromInclusive examples from PRICING_SPEC', () => {
    expect(baseFromInclusive(4999)).toBeCloseTo(4020.99, 1);
    expect(baseFromInclusive(4499)).toBeCloseTo(3618.27, 1);
    expect(baseFromInclusive(999)).toBeCloseTo(803.4, 1);
  });

  it('inclusiveFromBase(50) ≈ 62.17', () => {
    expect(inclusiveFromBase(50)).toBeCloseTo(62.17, 1);
  });

  it('explodeInclusive(62) approximates spec breakdown', () => {
    const b = explodeInclusive(62);
    expect(b.base).toBeCloseTo(49.87, 1);
    expect(b.vat).toBeCloseTo(8.68, 1);
    expect(b.stamp).toBeCloseTo(0.27, 1);
    expect(b.service).toBeCloseTo(3.18, 1);
    expect(b.base + b.service + b.stamp + b.vat).toBeCloseTo(62, 4);
  });

  it('buildLegalInvoiceLines: VAT last tax line; total last row', () => {
    const lines = buildLegalInvoiceLines(62, 'en');
    expect(lines[3]?.label.toLowerCase()).toContain('vat');
    expect(lines[4]?.isTotal).toBe(true);
    expect(lines[3]?.amount).toBeCloseTo(explodeInclusive(62).vat, 4);
  });
});
