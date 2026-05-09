/**
 * Invoice / order tax display helpers — cascading inclusive math via pricing/taxMath.
 */

import { explodeInclusive } from '@/lib/pricing/taxMath';

export interface ExclusivePricing {
  base: number;
  service: number;
  stamp: number;
  vat: number;
  total: number;
}

export function calcExclusive(inclusiveTotal: number): ExclusivePricing {
  const b = explodeInclusive(inclusiveTotal);
  return {
    base: b.base,
    service: b.service,
    stamp: b.stamp,
    vat: b.vat,
    total: b.inclusive,
  };
}

/** Product portion is taxed (cascade); shipping is added on top and not cascaded. */
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
