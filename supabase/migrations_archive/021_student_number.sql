-- Migration: Add student_number to students
-- Format: STU-00001 (auto-generated unique ID)

ALTER TABLE students ADD COLUMN IF NOT EXISTS student_number TEXT UNIQUE;

-- Function to generate unique student number
CREATE OR REPLACE FUNCTION generate_student_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(student_number FROM 5) AS INT)), 0) + 1
  INTO next_num
  FROM students
  WHERE student_number IS NOT NULL AND student_number ~ '^STU-[0-9]+$';
  NEW.student_number := 'STU-' || LPAD(next_num::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_student_number ON students;
CREATE TRIGGER set_student_number
  BEFORE INSERT ON students
  FOR EACH ROW
  WHEN (NEW.student_number IS NULL)
  EXECUTE FUNCTION generate_student_number();

-- Generate numbers for existing students
DO $$
DECLARE
  r RECORD;
  counter INT := 1;
BEGIN
  FOR r IN SELECT id FROM students WHERE student_number IS NULL ORDER BY created_at LOOP
    UPDATE students SET student_number = 'STU-' || LPAD(counter::TEXT, 5, '0') WHERE id = r.id;
    counter := counter + 1;
  END LOOP;
END $$;
