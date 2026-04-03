-- Align pricing_plans with 2026 subscription list: all_in_price (EGP/mo on quarterly), monthly_fee (list monthly), student caps

UPDATE pricing_plans SET
  students_per_week_limit = CASE id
    WHEN 'nano' THEN 100
    WHEN 'starter' THEN 250
    WHEN 'pro' THEN 500
    WHEN 'business' THEN 1000
    WHEN 'enterprise' THEN 2000
    ELSE students_per_week_limit
  END,
  monthly_fee = CASE id
    WHEN 'nano' THEN 2500
    WHEN 'starter' THEN 5200
    WHEN 'pro' THEN 9200
    WHEN 'business' THEN 15000
    WHEN 'enterprise' THEN 21300
    ELSE monthly_fee
  END,
  all_in_price = CASE id
    WHEN 'nano' THEN 2000
    WHEN 'starter' THEN 4500
    WHEN 'pro' THEN 8000
    WHEN 'business' THEN 13000
    WHEN 'enterprise' THEN 18500
    ELSE all_in_price
  END
WHERE id IN ('nano', 'starter', 'pro', 'business', 'enterprise');
