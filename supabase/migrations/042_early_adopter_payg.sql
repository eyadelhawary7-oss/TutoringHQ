-- Early Adopter program and PAYG weekly charges
-- Early adopter: first 10 centers get 40% discount, price lock-in
-- PAYG: weekly billing records

-- 1. Early adopter columns on centers
ALTER TABLE centers ADD COLUMN IF NOT EXISTS is_early_adopter BOOLEAN DEFAULT false;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS early_adopter_price NUMERIC;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS early_adopter_number INTEGER;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS early_adopter_date TIMESTAMPTZ;
COMMENT ON COLUMN centers.is_early_adopter IS 'First 10 centers - 40% discount locked in forever';
COMMENT ON COLUMN centers.early_adopter_price IS 'Locked-in monthly price for early adopters';
COMMENT ON COLUMN centers.early_adopter_number IS 'Position 1-10 in early adopter program';

-- 2. Ensure billing_type exists (may be pricing_type or billing_type)
ALTER TABLE centers ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'fixed';
UPDATE centers SET billing_type = COALESCE(pricing_type, 'fixed') WHERE billing_type IS NULL;

-- 3. payg_weekly_charges table
CREATE TABLE IF NOT EXISTS payg_weekly_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  student_count INTEGER NOT NULL DEFAULT 0,
  rate_per_student NUMERIC NOT NULL,
  total_charge NUMERIC NOT NULL,
  paid BOOLEAN DEFAULT false,
  invoice_id UUID REFERENCES invoices(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (center_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_payg_weekly_charges_center ON payg_weekly_charges(center_id);
CREATE INDEX IF NOT EXISTS idx_payg_weekly_charges_week ON payg_weekly_charges(week_start_date);

-- 4. Add referral_count to centers for early adopter 60% boost (first 10 referrals)
ALTER TABLE centers ADD COLUMN IF NOT EXISTS early_adopter_referral_count INTEGER DEFAULT 0;
