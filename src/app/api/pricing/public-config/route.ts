// /api/pricing/public-config
// Public, read-only marketing-pricing view: banner + promo + interval labels +
// summer offer. No auth. No secrets. Used by the landing page banner/popup and
// the signup plan selector's promo display. Cached for 60 seconds.

import { NextResponse } from 'next/server';
import {
  getAddonPrices,
  getBannerConfig,
  getIntervalConfig,
  getPromoConfig,
  getPopupConfig,
} from '@/lib/pricingConfig';
import { getSummerConfig } from '@/lib/summer/config';

export const revalidate = 60;

export async function GET() {
  const [banner, promo, interval, popup, summerCfg, addonPrices] = await Promise.all([
    getBannerConfig(),
    getPromoConfig(),
    getIntervalConfig(),
    getPopupConfig(),
    getSummerConfig(),
    getAddonPrices(),
  ]);

  // Only the public-facing summer fields — the HELD/RELEASED hold is operational
  // and never surfaced to visitors.
  const summer = {
    enabled: summerCfg.enabled,
    freeUntil: summerCfg.freeUntil,
    firstChargeFloor: summerCfg.firstChargeFloor,
    trialDays: summerCfg.trialDays,
    payWindowDays: summerCfg.payWindowDays,
  };

  // Only the add-on price that is public marketing surface: the parent
  // WhatsApp pack (`platform_config.pack_price_per_parent`), quoted on
  // `/pricing`. The other AddonPrices fields (card order, shipping) stay
  // out of this payload until a public page needs them.
  const addons = { whatsappParentPack: addonPrices.whatsappParentPack };

  return NextResponse.json(
    { banner, promo, interval, popup, summer, addons },
    {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
