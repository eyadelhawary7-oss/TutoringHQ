/**
 * Invoice / order tax display helpers - VAT-inclusive decomposition via pricing/taxMath.
 * Only VAT is broken out; the former service fee and stamp duty are gone.
 */

import { explodeInclusive } from '@/lib/pricing/taxMath';

export interface ExclusivePricing {
  base: number;
  vat: number;
  total: number;
}

export function calcExclusive(inclusiveTotal: number): ExclusivePricing {
  const b = explodeInclusive(inclusiveTotal);
  return {
    base: b.base,
    vat: b.vat,
    total: b.inclusive,
  };
}

/** Product portion is taxed (VAT); shipping is added on top and not taxed. */
export function calcExclusiveProduct(
  inclusiveTotal: number,
  shippingFee: number,
): ExclusivePricing & { shipping: number } {
  const ship = Math.round(Number(shippingFee) * 100) / 100;
  const productIncl = Math.max(
    0,
    Math.round((Number(inclusiveTotal) - ship) * 100) / 100,
  );
  const p = calcExclusive(productIncl);
  return { ...p, shipping: ship, total: Math.round(Number(inclusiveTotal) * 100) / 100 };
}
