-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_students_center_payment ON students(center_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_attendance_center_date ON attendance_scans(center_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_center_date ON payments(center_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_center ON schedule_slots(center_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_wa_messages_center_created ON whatsapp_messages(center_id, created_at DESC);
