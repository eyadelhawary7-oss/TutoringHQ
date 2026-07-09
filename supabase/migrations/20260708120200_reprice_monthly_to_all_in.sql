-- Reprice monthly billing to the all-in price and remove the separate monthly
-- list price. Monthly now bills at the same per-month rate as quarterly
-- (all_in_price); the previously higher pricing_plans.monthly_fee is dropped.
--
-- The application charge and display paths are updated in the same change:
-- getChargeFromQuarterlyAllIn / getPlanPrice / getSignupDisplayMonthlyPrice all
-- return all_in_price for the monthly period, and every reader of
-- pricing_plans.monthly_fee (signup auto-approve, plan upgrade, admin pricing,
-- public plan prices, the detect-churn edge function) now uses all_in_price.
--
-- Also deletes the vestigial pricing.interval.monthly_multiplier config key: it
-- was read into the interval config and shown in the admin editor but never
-- applied to any computed price. Annual pricing is unaffected (annual total =
-- all_in_price x pricing.interval.annual_multiplier, still 10).

-- pricing_plans_money_nonneg references monthly_fee among several money columns,
-- so a plain DROP COLUMN monthly_fee would cascade-drop the whole guard. Drop it
-- explicitly and re-add it minus the monthly_fee term (the payg_rate_per_student
-- term stays; that column is only cleared, not dropped).
alter table public.pricing_plans drop constraint if exists pricing_plans_money_nonneg;

alter table public.pricing_plans drop column if exists monthly_fee;

alter table public.pricing_plans add constraint pricing_plans_money_nonneg check (
  ((all_in_price is null) or (all_in_price >= (0)::numeric))
  and (cost_per_student >= (0)::numeric)
  and ((payg_rate_per_student is null) or (payg_rate_per_student >= (0)::numeric))
  and (setup_fee >= (0)::numeric)
);

-- Delete the dead monthly multiplier config key (never applied to a price).
delete from public.platform_config where key = 'pricing.interval.monthly_multiplier';

notify pgrst, 'reload schema';
