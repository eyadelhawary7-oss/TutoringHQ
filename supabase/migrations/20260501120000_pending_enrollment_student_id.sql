-- Link pending enrollment rows to a pre-created (inactive) student for approve_student_rpc.
ALTER TABLE pending_enrollments
ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pending_enrollments_student_id ON pending_enrollments(student_id);
