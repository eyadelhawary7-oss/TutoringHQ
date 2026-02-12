-- Ensure student_groups has description and created_by (for DBs with partial schema / stale PostgREST cache)
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
