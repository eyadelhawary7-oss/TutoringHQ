-- Drop the last two pay-as-you-go leftovers now that PAYG is fully removed:
--   1. the payg_rates table (legacy PAYG tier rate card), and
--   2. the pricing_plans.payg_rate_per_student column.
--
-- Verified against live prod before authoring:
--   - payg_rates holds 4 dead rows, has no foreign keys (in or out), no triggers,
--     and nothing (app code, functions, views) references it.
--   - pricing_plans.payg_rate_per_student has 0 non-null rows and no live reader.
--   - No src/ or supabase/functions/ code references either object.
--
-- pricing_plans_money_nonneg still references payg_rate_per_student, so a plain
-- DROP COLUMN would cascade-drop that guard. Drop it explicitly and re-add it
-- minus the payg_rate_per_student term (keeping all_in_price, cost_per_student,
-- setup_fee) -- same pattern used for the monthly_fee drop in 20260708120200.

-- 1. Drop the payg_rates table (its PK, CHECK, RLS policy, and grants go with it).
drop table if exists public.payg_rates;

-- 2. Drop the pricing_plans.payg_rate_per_student column, preserving the money guard.
alter table public.pricing_plans drop constraint if exists pricing_plans_money_nonneg;

alter table public.pricing_plans drop column if exists payg_rate_per_student;

alter table public.pricing_plans add constraint pricing_plans_money_nonneg check (
  ((all_in_price is null) or (all_in_price >= (0)::numeric))
  and (cost_per_student >= (0)::numeric)
  and (setup_fee >= (0)::numeric)
);

notify pgrst, 'reload schema';
