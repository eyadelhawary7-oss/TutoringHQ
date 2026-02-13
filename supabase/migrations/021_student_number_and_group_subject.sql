-- Migration: Add student_number to students (unique per center)
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_center_student_number ON students(center_id, student_number) WHERE student_number IS NOT NULL AND student_number != '';
CREATE INDEX IF NOT EXISTS idx_students_student_number ON students(student_number) WHERE student_number IS NOT NULL;

-- Function to generate unique student number
-- Format: STU-00001
CREATE OR REPLACE FUNCTION generate_student_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  IF NEW.student_number IS NOT NULL AND NEW.student_number != '' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(MAX(
    CASE
      WHEN student_number ~ '^STU-[0-9]+$'
      THEN CAST(SUBSTRING(student_number FROM 5) AS INT)
      ELSE 0
    END
  ), 0) + 1
  INTO next_num
  FROM students
  WHERE center_id = NEW.center_id;
  NEW.student_number := 'STU-' || LPAD(next_num::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_student_number ON students;
CREATE TRIGGER set_student_number
  BEFORE INSERT ON students
  FOR EACH ROW
  WHEN (NEW.student_number IS NULL OR NEW.student_number = '')
  EXECUTE FUNCTION generate_student_number();

-- Generate numbers for existing students (per center)
DO $$
DECLARE
  c RECORD;
  r RECORD;
  counter INT;
BEGIN
  FOR c IN SELECT id FROM centers LOOP
    counter := 1;
    FOR r IN SELECT id FROM students WHERE center_id = c.id AND (student_number IS NULL OR student_number = '') ORDER BY created_at LOOP
      UPDATE students SET student_number = 'STU-' || LPAD(counter::TEXT, 5, '0') WHERE id = r.id;
      counter := counter + 1;
    END LOOP;
  END LOOP;
END $$;

-- Add subject to student_groups for filtering
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS subject TEXT;
CREATE INDEX IF NOT EXISTS idx_student_groups_subject ON student_groups(center_id, subject) WHERE subject IS NOT NULL;
