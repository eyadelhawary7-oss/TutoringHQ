-- Turn off the 30% launch promo (pricing.promo.*). This is the general pricing
-- promo shown on /pricing and the signup selector, NOT the summer offer.
--
-- IMPORTANT: this is fully separate from summer.promo.* (the SUMMER26 offer,
-- summer.promo.enabled). This migration touches ONLY pricing.promo.enabled and
-- leaves every summer.* key untouched.
--
-- Live state verified before authoring: pricing.promo.enabled = true,
-- applicable_intervals = ["quarterly"], discount_pct = 30, spots 0/100,
-- end_date 2026-08-14. Flipping enabled to false makes the promo inert; the
-- other pricing.promo.* tunables are left in place so the promo can be
-- re-enabled later with the same settings (they have no effect while disabled).

update public.platform_config
set value = 'false'::jsonb
where key = 'pricing.promo.enabled';

notify pgrst, 'reload schema';
