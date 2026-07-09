-- Remove pay-as-you-go (PAYG) billing at the database level. A center may only
-- ever be fixed billing now. The application code that offered or ran PAYG (the
-- payg-billing cron, the switch-payg / payg-calculate routes, the PAYG billing
-- engine, the settings and admin PAYG UI) is removed in the same change.
--
-- Safe by construction, verified against live prod immediately before authoring:
--   - both live centers are billing_type = fixed AND pricing_type = fixed
--   - zero rows have payg_rate, payg_pending_switch, payg_switch_effective_date,
--     or payg_pending_target_period set
--   - no index, view, trigger, or generated column depends on the dropped columns
-- so no existing row violates the tighter CHECKs and no drop cascades to data.
--
-- This also removes the last place 'quarterly' survived in the schema: the
-- centers_payg_pending_target_period_check was the only remaining CHECK that
-- still accepted 'quarterly'.
--
-- Scope note: the payg_rates and payg_weekly_charges tables and the
-- pricing_plans.payg_rate_per_student column are intentionally NOT dropped here
-- (they are separate objects with their own RLS/grants). The unused
-- pricing_plans.payg_rate_per_student values are cleared to NULL instead; the
-- column itself can be dropped in a scoped follow-up if desired.

-- 1. Data: clear the now-unused per-plan PAYG rate (advertised pricing uses
--    all_in_price only).
update public.pricing_plans set payg_rate_per_student = null where payg_rate_per_student is not null;

-- 2. Tighten the billing discriminators to fixed-only.
alter table public.centers drop constraint if exists centers_billing_type_check;
alter table public.centers add constraint centers_billing_type_check
  check (billing_type = 'fixed');

alter table public.centers drop constraint if exists centers_pricing_type_check;
alter table public.centers add constraint centers_pricing_type_check
  check (pricing_type = 'fixed');

-- 3. Drop the PAYG pending-switch machinery: its CHECK constraints first, then
--    the columns (the last CHECK that still allowed 'quarterly' goes with it).
alter table public.centers drop constraint if exists centers_payg_pending_switch_check;
alter table public.centers drop constraint if exists centers_payg_pending_target_period_check;

-- centers_money_nonneg references payg_rate among many money columns, so a plain
-- DROP COLUMN payg_rate would cascade-drop the whole non-negativity guard. Drop
-- it explicitly and re-add it identically minus the payg_rate term so every other
-- money column stays protected.
alter table public.centers drop constraint if exists centers_money_nonneg;

alter table public.centers drop column if exists payg_rate;
alter table public.centers drop column if exists payg_pending_switch;
alter table public.centers drop column if exists payg_switch_effective_date;
alter table public.centers drop column if exists payg_pending_target_period;

alter table public.centers add constraint centers_money_nonneg check (
  ((all_in_price is null) or (all_in_price >= (0)::numeric))
  and ((announcement_balance is null) or (announcement_balance >= (0)::numeric))
  and ((announcement_cap is null) or (announcement_cap >= (0)::numeric))
  and ((announcement_price_per_blast is null) or (announcement_price_per_blast >= (0)::numeric))
  and (credit_balance >= (0)::numeric)
  and (credit_reserved >= (0)::numeric)
  and ((early_adopter_price is null) or (early_adopter_price >= (0)::numeric))
  and (pack_pending_balance >= (0)::numeric)
  and ((pack_price_per_parent is null) or (pack_price_per_parent >= (0)::numeric))
  and ((reactivation_fee_amount is null) or (reactivation_fee_amount >= (0)::numeric))
  and ((referral_reward_amount is null) or (referral_reward_amount >= (0)::numeric))
  and ((subscription_monthly_fee is null) or (subscription_monthly_fee >= (0)::numeric))
);

notify pgrst, 'reload schema';
