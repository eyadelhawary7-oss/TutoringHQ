-- Rename pricing_plans.monthly_fee_egp to monthly_fee for consistency
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_plans' AND column_name = 'monthly_fee_egp'
  ) THEN
    ALTER TABLE pricing_plans RENAME COLUMN monthly_fee_egp TO monthly_fee;
  END IF;
END $$;
