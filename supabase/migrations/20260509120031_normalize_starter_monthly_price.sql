-- F-B804 (Starter tier monthly price drift 4500 → 4499) closed without action.
-- Audit query on 2026-05-09 returned zero non-test Starter rows at 4500.
-- Original migration referenced columns that don't exist on public.centers.
-- Real schema uses `plan` and `all_in_price`.
-- See docs/PRICING_SPEC.md for canonical column references.

SELECT 1;  -- no-op
