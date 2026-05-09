-- Normalise Starter tier monthly_price drift 4500 → 4499 (F-B804 / pricing spec).

UPDATE public.centers
SET monthly_price = 4499
WHERE plan_key = 'starter'
  AND monthly_price = 4500
  AND is_test = false;
