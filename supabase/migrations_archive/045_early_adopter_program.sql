-- Add Early Adopter Program columns to centers table
-- (Uses IF NOT EXISTS for idempotency - columns may already exist from 042_early_adopter_payg)
ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS is_early_adopter BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS early_adopter_price DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS early_adopter_number INTEGER;

-- Add comment explaining the columns
COMMENT ON COLUMN centers.is_early_adopter IS 'Whether this center is in the Early Adopter Program (first 10 centers get 40% off forever)';
COMMENT ON COLUMN centers.early_adopter_price IS 'Locked-in monthly price for early adopters (e.g., 1200 for STARTER at 40% off)';
COMMENT ON COLUMN centers.early_adopter_number IS 'Early adopter sequence number (1-10 for first wave)';

-- Create index for querying early adopters
CREATE INDEX IF NOT EXISTS idx_centers_early_adopter ON centers (is_early_adopter) WHERE is_early_adopter = TRUE;
