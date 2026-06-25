-- Add phone column to centers for center contact info
ALTER TABLE centers ADD COLUMN IF NOT EXISTS phone TEXT;
