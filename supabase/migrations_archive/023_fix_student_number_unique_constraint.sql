-- Fix: student_number should be unique per center, not globally
-- Migration 021_student_number added UNIQUE on the column (global)
-- Migration 021_student_number_and_group_subject uses per-center numbering
-- Drop the column-level UNIQUE so we can have STU-00001 per center

DO $$
BEGIN
  -- Drop the unique constraint if it exists (from 021_student_number)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_student_number_key'
    AND conrelid = 'students'::regclass
  ) THEN
    ALTER TABLE students DROP CONSTRAINT students_student_number_key;
  END IF;
END $$;
