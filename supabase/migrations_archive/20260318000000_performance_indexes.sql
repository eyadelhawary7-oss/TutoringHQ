-- Performance indexes for students, payments, attendance_scans
-- For zero-downtime: run scripts/run-performance-indexes-concurrent.sql manually

ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_students_center_created ON students(center_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_students_center_active ON students(center_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_payments_center_paid ON payments(center_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_student_scanned ON attendance_scans(student_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_center_date ON attendance_scans(center_id, scanned_at DESC);

ANALYZE students;
ANALYZE payments;
ANALYZE attendance_scans;
