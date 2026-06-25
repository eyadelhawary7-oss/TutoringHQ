-- Allow 'pending' payment status for students and payments
-- Run this in Supabase SQL Editor if migrations aren't applied

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_payment_status_check;
ALTER TABLE students ADD CONSTRAINT students_payment_status_check 
  CHECK (payment_status IN ('paid', 'unpaid', 'pending'));

-- Add status to payments table if not exists (default 'paid' for backward compat)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'paid';
UPDATE payments SET status = 'paid' WHERE status IS NULL;
