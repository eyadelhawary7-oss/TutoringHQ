-- Add confirmed tracking to payments for pending → confirmed flow
ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT true;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Backfill: status='paid' means confirmed
UPDATE payments SET confirmed = true, confirmed_at = NOW() WHERE status = 'paid' AND (confirmed IS NULL OR confirmed = true);
UPDATE payments SET confirmed = false WHERE status = 'pending';
