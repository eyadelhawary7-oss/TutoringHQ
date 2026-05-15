// /api/pricing/public-config
// Public, read-only marketing-pricing view: banner + promo + interval labels.
// No auth. No secrets. Used by the landing page banner and the signup plan
// selector's promo display. Cached for 60 seconds.

import { NextResponse } from 'next/server';
import { getBannerConfig, getIntervalConfig, getPromoConfig, getPopupConfig } from '@/lib/pricingConfig';

export const revalidate = 60;

export async function GET() {
  const [banner, promo, interval, popup] = await Promise.all([
    getBannerConfig(),
    getPromoConfig(),
    getIntervalConfig(),
    getPopupConfig(),
  ]);

  return NextResponse.json(
    { banner, promo, interval, popup },
    {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
