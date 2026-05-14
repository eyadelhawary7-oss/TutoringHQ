// src/components/landing/PricingBanner.tsx
// Server component: reads banner config at request time and renders a
// full-width announcement strip. Returns null when banner is disabled or empty.

import { getBannerConfig, type BannerStyle } from '@/lib/pricingConfig';

const STYLE_BG: Record<BannerStyle, string> = {
  promo: 'bg-teal-600 text-white',
  info: 'bg-blue-600 text-white',
  warning: 'bg-amber-500 text-slate-900',
  success: 'bg-emerald-600 text-white',
};

const STYLE_CTA: Record<BannerStyle, string> = {
  promo: 'bg-white text-teal-700 hover:bg-teal-50',
  info: 'bg-white text-blue-700 hover:bg-blue-50',
  warning: 'bg-slate-900 text-amber-300 hover:bg-slate-800',
  success: 'bg-white text-emerald-700 hover:bg-emerald-50',
};

interface PricingBannerProps {
  locale: string;
  /** When true, renders a more compact strip suitable for stacking above a navbar. */
  variant?: 'strip' | 'section';
}

export async function PricingBanner({ locale, variant = 'strip' }: PricingBannerProps) {
  const cfg = await getBannerConfig();
  if (!cfg.enabled) return null;

  const isAr = locale === 'ar';
  const text = isAr ? cfg.textAr : cfg.textEn;
  const subtext = isAr ? cfg.subtextAr : cfg.subtextEn;
  const cta = isAr ? cfg.ctaTextAr : cfg.ctaTextEn;
  if (!text.trim()) return null;

  const bg = STYLE_BG[cfg.style];
  const ctaCls = STYLE_CTA[cfg.style];

  if (variant === 'strip') {
    return (
      <div
        className={`w-full ${bg} px-4 py-2 text-center text-sm`}
        dir={isAr ? 'rtl' : 'ltr'}
        role="status"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="font-semibold">{text}</span>
          {subtext ? <span className="opacity-90">{subtext}</span> : null}
          {cta && cfg.ctaUrl ? (
            <a
              href={cfg.ctaUrl}
              className={`ms-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${ctaCls}`}
            >
              {cta}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section
      className={`w-full rounded-2xl ${bg} px-5 py-4 my-6`}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-base font-bold">{text}</p>
          {subtext ? <p className="text-sm opacity-90">{subtext}</p> : null}
        </div>
        {cta && cfg.ctaUrl ? (
          <a
            href={cfg.ctaUrl}
            className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ${ctaCls}`}
          >
            {cta}
          </a>
        ) : null}
      </div>
    </section>
  );
}

export default PricingBanner;
