-- F-B804 (Starter tier monthly price drift 4500 → 4499) closed without action.
-- Audit query on 2026-05-09 returned zero non-test rows matching the criteria.
-- Original migration referenced columns that don't exist on public.centers
-- (plan_key, monthly_price). Real schema uses `plan` and `subscription_monthly_fee`.
-- See PRICING_SPEC.md for canonical column references.

SELECT 1;  -- no-op