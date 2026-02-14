-- Add 'late' status to payments for "Allow Late Entry" flow
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('paid', 'confirmed', 'pending', 'late'));
