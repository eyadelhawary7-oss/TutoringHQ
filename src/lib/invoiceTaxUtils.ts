const TAX_MULTIPLIER = 1.204; // 1 + 0.06 service + 0.004 stamp + 0.14 VAT

export interface ExclusivePricing {
  base: number; // back-calculated pre-tax subtotal
  service: number; // 6% service fee
  stamp: number; // 0.4% stamp duty
  vat: number; // 14% VAT — absorbs rounding, always last
  total: number; // identical to original inclusive total
}

export function calcExclusive(inclusiveTotal: number): ExclusivePricing {
  const base = Math.round(inclusiveTotal / TAX_MULTIPLIER);
  const service = Math.round(base * 0.06);
  const stamp = Math.round(base * 0.004);
  const vat = inclusiveTotal - base - service - stamp; // exact residual
  return { base, service, stamp, vat, total: inclusiveTotal };
}

// setup_fee only: product is taxed, shipping is not
export function calcExclusiveProduct(
  inclusiveTotal: number,
  shippingFee: number,
): ExclusivePricing & { shipping: number } {
  const p = calcExclusive(inclusiveTotal - shippingFee);
  return { ...p, shipping: shippingFee, total: inclusiveTotal };
}
