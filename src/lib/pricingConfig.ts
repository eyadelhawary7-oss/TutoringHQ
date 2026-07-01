// src/lib/pricingConfig.ts
// Server-side reader for pricing-related platform_config keys, plus dynamic plan
// prices sourced from the pricing_plans table (single source of truth).
//
// Hardcoded fallbacks mirror the defaults in:
//   - supabase/migrations/20260514130000_pricing_config_defaults.sql
//   - src/lib/pricing/plans.ts (SUBSCRIPTION_PLAN_DEFINITIONS)
// so callers always get a sane value even before the migration runs.

import { createClient } from '@supabase/supabase-js';
import {
  getAnnualChargeRounded,
  getAnnualMonthlyFromBase,
  ORDERED_SUBSCRIPTION_PLAN_KEYS,
  PLANS,
  type PlanKey,
  type SubscriptionPlanKey,
} from '@/lib/pricing';
import {
  PROCESSING_FEE_AMOUNT_KEY,
  PROCESSING_FEE_DEFAULT_AMOUNT,
  PROCESSING_FEE_DEFAULT_ENABLED,
  PROCESSING_FEE_ENABLED_KEY,
  type ProcessingFeeConfig,
} from '@/lib/processingFee';
import { getSummerConfig, type SummerConfig } from '@/lib/summer/config';

/** Read-only service-role client. */
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const PRICING_PROMO_DEFAULT_INTERVALS = ['annual'] as const;

export type BannerStyle = 'promo' | 'info' | 'warning' | 'success';
export const BANNER_STYLES: readonly BannerStyle[] = ['promo', 'info', 'warning', 'success'];

export interface IntervalConfig {
  monthlyMultiplier: number;
  annualMultiplier: number;
  annualLabelEn: string;
  annualLabelAr: string;
}

export interface AddonPrices {
  whatsappParentPack: number;
  cardOrderBase: number;
  shippingCost: number;
}

export interface PromoConfig {
  enabled: boolean;
  discountPct: number;
  applicableIntervals: string[];
  endDate: string | null;
  spotsTotal: number | null;
  spotsUsed: number;
}

export interface BannerConfig {
  enabled: boolean;
  textEn: string;
  textAr: string;
  subtextEn: string;
  subtextAr: string;
  style: BannerStyle;
  ctaTextEn: string;
  ctaTextAr: string;
  ctaUrl: string;
}

export interface PopupConfig {
  enabled: boolean;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  promoCode: string;
  ctaTextEn: string;
  ctaTextAr: string;
  ctaUrl: string;
  delaySeconds: number;
}

/** Combined snapshot for the admin page. */
export interface PricingConfigSnapshot {
  interval: IntervalConfig;
  addons: AddonPrices;
  promo: PromoConfig;
  banner: BannerConfig;
  popup: PopupConfig;
  summer: SummerConfig;
}

const INTERVAL_DEFAULTS: IntervalConfig = {
  monthlyMultiplier: 1.15,
  // Annual = "true 2 months free": annual total = monthly all-in × annualMultiplier.
  // 10 means pay for 10 months, get 12. Per-month figure = annual total ÷ 12.
  annualMultiplier: 10,
  annualLabelEn: '2 months free',
  annualLabelAr: 'شهران مجانًا',
};

const ADDON_DEFAULTS: AddonPrices = {
  whatsappParentPack: 12,
  cardOrderBase: 62,
  shippingCost: 115,
};

const PROMO_DEFAULTS: PromoConfig = {
  enabled: false,
  discountPct: 40,
  applicableIntervals: [...PRICING_PROMO_DEFAULT_INTERVALS],
  endDate: null,
  spotsTotal: null,
  spotsUsed: 0,
};

const BANNER_DEFAULTS: BannerConfig = {
  enabled: false,
  textEn: '',
  textAr: '',
  subtextEn: '',
  subtextAr: '',
  style: 'promo',
  ctaTextEn: '',
  ctaTextAr: '',
  ctaUrl: '',
};

const POPUP_DEFAULTS: PopupConfig = {
  enabled: false,
  titleEn: '',
  titleAr: '',
  bodyEn: '',
  bodyAr: '',
  promoCode: '',
  ctaTextEn: '',
  ctaTextAr: '',
  ctaUrl: '/pricing',
  delaySeconds: 3,
};

function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function maybeNum(value: unknown, fallback: number | null): number | null {
  if (value == null) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value.trim() === '') return fallback;
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

function str(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  return fallback;
}

function maybeStr(value: unknown, fallback: string | null): string | null {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim() === '' ? fallback : value;
  return fallback;
}

function asBannerStyle(value: unknown): BannerStyle {
  if (typeof value === 'string' && (BANNER_STYLES as readonly string[]).includes(value)) {
    return value as BannerStyle;
  }
  return 'promo';
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return fallback;
}

/** Pricing-related platform_config keys (only ones this module owns). */
export const PRICING_CONFIG_KEYS = [
  'pricing.interval.monthly_multiplier',
  'pricing.interval.annual_multiplier',
  'pricing.interval.annual_label_en',
  'pricing.interval.annual_label_ar',
  'pricing.shipping.default_cost',
  'pricing.promo.enabled',
  'pricing.promo.discount_pct',
  'pricing.promo.applicable_intervals',
  'pricing.promo.end_date',
  'pricing.promo.spots_total',
  'pricing.promo.spots_used',
  'pricing.banner.enabled',
  'pricing.banner.text_en',
  'pricing.banner.text_ar',
  'pricing.banner.subtext_en',
  'pricing.banner.subtext_ar',
  'pricing.banner.style',
  'pricing.banner.cta_text_en',
  'pricing.banner.cta_text_ar',
  'pricing.banner.cta_url',
  'landing.popup.enabled',
  'landing.popup.title_en',
  'landing.popup.title_ar',
  'landing.popup.body_en',
  'landing.popup.body_ar',
  'landing.popup.promo_code',
  'landing.popup.cta_text_en',
  'landing.popup.cta_text_ar',
  'landing.popup.cta_url',
  'landing.popup.delay_seconds',
] as const;

export type PricingConfigKey = (typeof PRICING_CONFIG_KEYS)[number];

/** Map of key → raw JSON value, with extra add-on keys reused from existing config. */
async function readKeys(keys: readonly string[]): Promise<Record<string, unknown>> {
  const client = svc();
  const out: Record<string, unknown> = {};
  if (!client) return out;
  // A failed/unavailable config read must never bubble up to callers (signup,
  // pricing display). Fall back to the hardcoded defaults instead of throwing.
  try {
    const { data } = await client
      .from('platform_config')
      .select('key, value')
      .in('key', keys as unknown as string[]);
    for (const row of data ?? []) {
      out[row.key as string] = (row as { value: unknown }).value;
    }
  } catch {
    /* swallow: callers apply their own defaults */
  }
  return out;
}

export async function getIntervalConfig(): Promise<IntervalConfig> {
  const rows = await readKeys([
    'pricing.interval.monthly_multiplier',
    'pricing.interval.annual_multiplier',
    'pricing.interval.annual_label_en',
    'pricing.interval.annual_label_ar',
  ]);
  return {
    monthlyMultiplier: num(rows['pricing.interval.monthly_multiplier'], INTERVAL_DEFAULTS.monthlyMultiplier),
    annualMultiplier: num(rows['pricing.interval.annual_multiplier'], INTERVAL_DEFAULTS.annualMultiplier),
    annualLabelEn: str(rows['pricing.interval.annual_label_en'], INTERVAL_DEFAULTS.annualLabelEn),
    annualLabelAr: str(rows['pricing.interval.annual_label_ar'], INTERVAL_DEFAULTS.annualLabelAr),
  };
}

export async function getAddonPrices(): Promise<AddonPrices> {
  const rows = await readKeys([
    'pack_price_per_parent',
    'qr_card_price',
    'pricing.shipping.default_cost',
  ]);
  return {
    whatsappParentPack: num(rows['pack_price_per_parent'], ADDON_DEFAULTS.whatsappParentPack),
    cardOrderBase: num(rows['qr_card_price'], ADDON_DEFAULTS.cardOrderBase),
    shippingCost: num(rows['pricing.shipping.default_cost'], ADDON_DEFAULTS.shippingCost),
  };
}

export async function getPromoConfig(): Promise<PromoConfig> {
  const rows = await readKeys([
    'pricing.promo.enabled',
    'pricing.promo.discount_pct',
    'pricing.promo.applicable_intervals',
    'pricing.promo.end_date',
    'pricing.promo.spots_total',
    'pricing.promo.spots_used',
  ]);
  // end_date: "" is the sentinel for "no deadline" (stored to satisfy NOT NULL).
  // maybeStr already converts "" → null via the trim() === '' branch.
  const endDate = maybeStr(rows['pricing.promo.end_date'], null);
  // spots_total: 0 is the sentinel for "unlimited" (stored to satisfy NOT NULL).
  const rawSpotsTotal = maybeNum(rows['pricing.promo.spots_total'], null);
  const spotsTotal = rawSpotsTotal === 0 ? null : rawSpotsTotal;
  return {
    enabled: bool(rows['pricing.promo.enabled'], PROMO_DEFAULTS.enabled),
    discountPct: num(rows['pricing.promo.discount_pct'], PROMO_DEFAULTS.discountPct),
    applicableIntervals: asStringArray(rows['pricing.promo.applicable_intervals'], PROMO_DEFAULTS.applicableIntervals),
    endDate,
    spotsTotal,
    spotsUsed: num(rows['pricing.promo.spots_used'], PROMO_DEFAULTS.spotsUsed),
  };
}

export async function getBannerConfig(): Promise<BannerConfig> {
  const rows = await readKeys([
    'pricing.banner.enabled',
    'pricing.banner.text_en',
    'pricing.banner.text_ar',
    'pricing.banner.subtext_en',
    'pricing.banner.subtext_ar',
    'pricing.banner.style',
    'pricing.banner.cta_text_en',
    'pricing.banner.cta_text_ar',
    'pricing.banner.cta_url',
  ]);
  return {
    enabled: bool(rows['pricing.banner.enabled'], BANNER_DEFAULTS.enabled),
    textEn: str(rows['pricing.banner.text_en'], ''),
    textAr: str(rows['pricing.banner.text_ar'], ''),
    subtextEn: str(rows['pricing.banner.subtext_en'], ''),
    subtextAr: str(rows['pricing.banner.subtext_ar'], ''),
    style: asBannerStyle(rows['pricing.banner.style']),
    ctaTextEn: str(rows['pricing.banner.cta_text_en'], ''),
    ctaTextAr: str(rows['pricing.banner.cta_text_ar'], ''),
    ctaUrl: str(rows['pricing.banner.cta_url'], ''),
  };
}

export async function getPopupConfig(): Promise<PopupConfig> {
  const rows = await readKeys([
    'landing.popup.enabled',
    'landing.popup.title_en',
    'landing.popup.title_ar',
    'landing.popup.body_en',
    'landing.popup.body_ar',
    'landing.popup.promo_code',
    'landing.popup.cta_text_en',
    'landing.popup.cta_text_ar',
    'landing.popup.cta_url',
    'landing.popup.delay_seconds',
  ]);
  return {
    enabled: bool(rows['landing.popup.enabled'], POPUP_DEFAULTS.enabled),
    titleEn: str(rows['landing.popup.title_en'], ''),
    titleAr: str(rows['landing.popup.title_ar'], ''),
    bodyEn: str(rows['landing.popup.body_en'], ''),
    bodyAr: str(rows['landing.popup.body_ar'], ''),
    promoCode: str(rows['landing.popup.promo_code'], ''),
    ctaTextEn: str(rows['landing.popup.cta_text_en'], ''),
    ctaTextAr: str(rows['landing.popup.cta_text_ar'], ''),
    ctaUrl: str(rows['landing.popup.cta_url'], POPUP_DEFAULTS.ctaUrl),
    delaySeconds: num(rows['landing.popup.delay_seconds'], POPUP_DEFAULTS.delaySeconds),
  };
}

/**
 * Dynamic per-plan quarterly all-in price sourced from the `pricing_plans` DB table.
 * Falls back to the hardcoded `PLANS[plan].quarterlyAllIn` when the row is missing.
 * Top Centers is excluded (custom-priced).
 */
export async function getPlanPrices(): Promise<Record<SubscriptionPlanKey, number>> {
  const client = svc();
  const fallback = Object.fromEntries(
    ORDERED_SUBSCRIPTION_PLAN_KEYS.map((k) => [k, PLANS[k].quarterlyAllIn]),
  ) as Record<SubscriptionPlanKey, number>;
  if (!client) return fallback;
  const { data } = await client
    .from('pricing_plans')
    .select('plan_key, all_in_price')
    .in('plan_key', ORDERED_SUBSCRIPTION_PLAN_KEYS as unknown as string[]);
  const out: Record<SubscriptionPlanKey, number> = { ...fallback };
  for (const row of data ?? []) {
    const key = (row as { plan_key: string }).plan_key as SubscriptionPlanKey;
    const v = num((row as { all_in_price: unknown }).all_in_price, fallback[key]);
    if (v > 0) out[key] = v;
  }
  return out;
}

/**
 * Per-plan display prices for visitor / signup / billing UI surfaces.
 *
 * - `monthlyListPrice` - `pricing_plans.monthly_fee` (fallback `PLANS[k].monthlyListPrice`).
 * - `quarterlyAllIn` - `pricing_plans.all_in_price` (fallback `PLANS[k].quarterlyAllIn`).
 * - `annualTotal` - full-year charge = quarterlyAllIn × `pricing.interval.annual_multiplier`
 *   (=10 → "true 2 months free"). This is the number CHARGED at signup, so display and
 *   charge stay identical.
 * - `annualEffectiveMonthly` - per-month figure shown on the page = annualTotal ÷ 12.
 * - `weeklyStudentLimit` - `pricing_plans.weekly_student_limit` (fallback `PLANS[k].weeklyStudentLimit`).
 *
 * Top Centers is excluded (custom-priced).
 */
export interface PublicPlanPrice {
  monthlyListPrice: number;
  quarterlyAllIn: number;
  annualTotal: number;
  annualEffectiveMonthly: number;
  weeklyStudentLimit: number | null;
}

export async function getPublicPlanPrices(): Promise<Record<SubscriptionPlanKey, PublicPlanPrice>> {
  const client = svc();
  const interval = await getIntervalConfig();

  const fallbackFor = (k: SubscriptionPlanKey): PublicPlanPrice => ({
    monthlyListPrice: PLANS[k].monthlyListPrice,
    quarterlyAllIn: PLANS[k].quarterlyAllIn,
    annualTotal: getAnnualChargeRounded(PLANS[k].quarterlyAllIn, interval.annualMultiplier),
    annualEffectiveMonthly: getAnnualMonthlyFromBase(
      PLANS[k].quarterlyAllIn,
      interval.annualMultiplier,
    ),
    weeklyStudentLimit: PLANS[k].weeklyStudentLimit,
  });
  const fallback = Object.fromEntries(
    ORDERED_SUBSCRIPTION_PLAN_KEYS.map((k) => [k, fallbackFor(k)]),
  ) as Record<SubscriptionPlanKey, PublicPlanPrice>;

  if (!client) return fallback;

  const { data } = await client
    .from('pricing_plans')
    .select('plan_key, monthly_fee, all_in_price, weekly_student_limit, is_active')
    .in('plan_key', ORDERED_SUBSCRIPTION_PLAN_KEYS as unknown as string[]);

  const out: Record<SubscriptionPlanKey, PublicPlanPrice> = { ...fallback };
  for (const row of data ?? []) {
    const key = (row as { plan_key: string }).plan_key as SubscriptionPlanKey;
    if (!(key in fallback)) continue;
    const fb = fallback[key];
    const quarterlyAllIn = num((row as { all_in_price: unknown }).all_in_price, fb.quarterlyAllIn);
    const monthlyListPrice = num((row as { monthly_fee: unknown }).monthly_fee, fb.monthlyListPrice);
    const limitRaw = (row as { weekly_student_limit: unknown }).weekly_student_limit;
    const weeklyStudentLimit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.round(limitRaw)
        : fb.weeklyStudentLimit;
    const baseForAnnual = quarterlyAllIn > 0 ? quarterlyAllIn : fb.quarterlyAllIn;
    const annualTotal = getAnnualChargeRounded(baseForAnnual, interval.annualMultiplier);
    const annualEffectiveMonthly = getAnnualMonthlyFromBase(
      baseForAnnual,
      interval.annualMultiplier,
    );
    out[key] = {
      monthlyListPrice: monthlyListPrice > 0 ? monthlyListPrice : fb.monthlyListPrice,
      quarterlyAllIn: quarterlyAllIn > 0 ? quarterlyAllIn : fb.quarterlyAllIn,
      annualTotal: annualTotal > 0 ? annualTotal : fb.annualTotal,
      annualEffectiveMonthly:
        annualEffectiveMonthly > 0 ? annualEffectiveMonthly : fb.annualEffectiveMonthly,
      weeklyStudentLimit,
    };
  }
  return out;
}

/**
 * Flat processing-fee config (Section 5). Read from platform_config:
 *   - processing_fee_enabled (bool, default true)
 *   - processing_fee_amount  (number EGP, default 20)
 * Falls back to the brief defaults (enabled @ 20) when missing / DB unreachable,
 * so the fee is ON by default even before the migration runs.
 */
export async function getProcessingFeeConfig(): Promise<ProcessingFeeConfig> {
  const rows = await readKeys([PROCESSING_FEE_ENABLED_KEY, PROCESSING_FEE_AMOUNT_KEY]);
  const enabled = bool(rows[PROCESSING_FEE_ENABLED_KEY], PROCESSING_FEE_DEFAULT_ENABLED);
  const amount = num(rows[PROCESSING_FEE_AMOUNT_KEY], PROCESSING_FEE_DEFAULT_AMOUNT);
  return {
    enabled,
    amount: Number.isFinite(amount) && amount >= 0 ? amount : PROCESSING_FEE_DEFAULT_AMOUNT,
  };
}

/** All pricing config in one shot - used by admin GET. */
export async function getPricingConfigSnapshot(): Promise<PricingConfigSnapshot> {
  const [interval, addons, promo, banner, popup, summer] = await Promise.all([
    getIntervalConfig(),
    getAddonPrices(),
    getPromoConfig(),
    getBannerConfig(),
    getPopupConfig(),
    getSummerConfig(),
  ]);
  return { interval, addons, promo, banner, popup, summer };
}

export type { PlanKey, SubscriptionPlanKey };

export const PRICING_CONFIG_DEFAULTS = {
  interval: INTERVAL_DEFAULTS,
  addons: ADDON_DEFAULTS,
  promo: PROMO_DEFAULTS,
  banner: BANNER_DEFAULTS,
  popup: POPUP_DEFAULTS,
} as const;
