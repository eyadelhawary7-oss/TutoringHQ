-- Add index for payment confirmation tracking queries
CREATE INDEX IF NOT EXISTS idx_payments_confirmed_by
ON payments(confirmed_by)
WHERE confirmed_by IS NOT NULL;

-- Add comments for audit trail
COMMENT ON COLUMN payments.confirmed_by IS 'User ID who confirmed this payment (for online payments)';
COMMENT ON COLUMN payments.confirmed_at IS 'Timestamp when payment was confirmed';
