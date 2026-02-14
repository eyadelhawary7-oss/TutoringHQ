-- Add group_id to payments and attendance_scans for multi-group student tracking
ALTER TABLE payments ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES student_groups(id) ON DELETE SET NULL;
ALTER TABLE attendance_scans ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES student_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_group ON payments(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_scans_group ON attendance_scans(group_id) WHERE group_id IS NOT NULL;
