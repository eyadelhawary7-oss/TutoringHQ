'use client';

import { useEffect, useState } from 'react';

/**
 * The live parent-WhatsApp-pack price — `platform_config.pack_price_per_parent`,
 * the EGP/parent/month figure pack billing actually invoices (read server-side
 * by `getAddonPrices()` in `src/lib/pricingConfig.ts`; billed per parent by
 * `invoiceTemplates.ts`). Served through the public 60s-cached
 * `/api/pricing/public-config` endpoint so an admin price edit shows on
 * `/pricing` without a redeploy — the same pattern as
 * `usePublicAnnualMultiplier`.
 *
 * The fallback mirrors `ADDON_DEFAULTS.whatsappParentPack` in
 * `pricingConfig.ts` (verified equal to the live `platform_config` value on
 * 2026-08-03). It cannot be imported here: `pricingConfig.ts` is service-role
 * server code a client bundle must not pull in.
 */
const WHATSAPP_PACK_PRICE_FALLBACK = 12;

export function usePublicWhatsappPackPrice(): number {
  const [price, setPrice] = useState(WHATSAPP_PACK_PRICE_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pricing/public-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const p = data?.addons?.whatsappParentPack;
        if (typeof p === 'number' && Number.isFinite(p) && p > 0) setPrice(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}
