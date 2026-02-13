-- Add day_of_week to schedule_slots if missing (stores 'sat','sun','mon','tue','wed','thu','fri')
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS day_of_week TEXT;

-- Add payment proof columns to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_amount NUMERIC;
