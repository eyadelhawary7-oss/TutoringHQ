-- DATE + INTERVAL must cast to DATE for stable DATE return type
CREATE OR REPLACE FUNCTION calculate_next_billing_date(cycle_start DATE, period TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE period
    WHEN 'monthly'      THEN (cycle_start + INTERVAL '1 month')::date
    WHEN 'quarterly'     THEN (cycle_start + INTERVAL '3 months')::date
    WHEN 'half_yearly'   THEN (cycle_start + INTERVAL '6 months')::date
    WHEN 'yearly'        THEN (cycle_start + INTERVAL '12 months')::date
    ELSE (cycle_start + INTERVAL '3 months')::date
  END CASE;
END;
$$;
