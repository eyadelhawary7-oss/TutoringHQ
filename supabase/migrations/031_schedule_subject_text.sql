-- Add subject (TEXT) to schedule_slots - table uses subject name, not subject_id
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS subject TEXT;
-- Make subject_id nullable for backward compat (we use subject going forward)
ALTER TABLE schedule_slots ALTER COLUMN subject_id DROP NOT NULL;
