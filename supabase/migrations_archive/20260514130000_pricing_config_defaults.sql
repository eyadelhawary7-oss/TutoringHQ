-- Pricing Control: platform_config seed keys for billing intervals, launch promo,
-- landing-page banner, and a single-number shipping override.
-- Plan base prices (Solo..Enterprise) live in the `pricing_plans` table and are
-- edited via /api/admin/pricing/plans (existing). WhatsApp pack price uses the
-- existing `pack_price_per_parent` key. Card base price uses existing `qr_card_price`.
-- Per-governorate shipping uses existing `bosta_shipping_rates`.
--
-- All inserts use ON CONFLICT (key) DO NOTHING so existing values are preserved.

-- Billing interval multipliers and Annual tab labels
INSERT INTO public.platform_config (key, value) VALUES
  ('pricing.interval.monthly_multiplier', '1.15'::jsonb),
  ('pricing.interval.annual_multiplier', '0.85'::jsonb),
  ('pricing.interval.annual_label_en', '"2 months free"'::jsonb),
  ('pricing.interval.annual_label_ar', '"شهران مجانًا"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Shipping override (single number). Per-governorate rates remain in `bosta_shipping_rates`.
INSERT INTO public.platform_config (key, value) VALUES
  ('pricing.shipping.default_cost', '115'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Launch promo
INSERT INTO public.platform_config (key, value) VALUES
  ('pricing.promo.enabled', 'false'::jsonb),
  ('pricing.promo.discount_pct', '40'::jsonb),
  ('pricing.promo.applicable_intervals', '["quarterly"]'::jsonb),
  ('pricing.promo.end_date', 'null'::jsonb),
  ('pricing.promo.spots_total', 'null'::jsonb),
  ('pricing.promo.spots_used', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Landing-page banner
INSERT INTO public.platform_config (key, value) VALUES
  ('pricing.banner.enabled', 'false'::jsonb),
  ('pricing.banner.text_en', '""'::jsonb),
  ('pricing.banner.text_ar', '""'::jsonb),
  ('pricing.banner.subtext_en', '""'::jsonb),
  ('pricing.banner.subtext_ar', '""'::jsonb),
  ('pricing.banner.style', '"promo"'::jsonb),
  ('pricing.banner.cta_text_en', '""'::jsonb),
  ('pricing.banner.cta_text_ar', '""'::jsonb),
  ('pricing.banner.cta_url', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;
