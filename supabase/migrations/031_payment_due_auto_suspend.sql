-- Payment due date and auto-suspend tracking
ALTER TABLE centers ADD COLUMN IF NOT EXISTS payment_due_date DATE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS auto_suspend_at TIMESTAMPTZ;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS billing_start_date DATE;
