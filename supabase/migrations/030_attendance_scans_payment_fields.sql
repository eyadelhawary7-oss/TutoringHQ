-- Add payment tracking to attendance_scans for scan+pay flow
ALTER TABLE attendance_scans ADD COLUMN IF NOT EXISTS payment_status_at_scan TEXT;
ALTER TABLE attendance_scans ADD COLUMN IF NOT EXISTS payment_method TEXT;
