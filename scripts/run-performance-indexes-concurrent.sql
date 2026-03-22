-- Run manually for zero-downtime index creation (outside transaction):
-- psql $DATABASE_URL -f scripts/run-performance-indexes-concurrent.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_center_created ON students(center_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_center_active ON students(center_id, is_active) WHERE is_active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_center_paid ON payments(center_id, paid_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_student_scanned ON attendance_scans(student_id, scanned_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_center_date ON attendance_scans(center_id, scanned_at DESC);

ANALYZE students;
ANALYZE payments;
ANALYZE attendance_scans;
