-- Add subject to student_groups for filtering
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS subject TEXT;
