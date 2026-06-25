-- Manual signup: owner name, city, notes for admin workflow
ALTER TABLE centers ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS signup_notes TEXT;

COMMENT ON COLUMN centers.owner_name IS 'Owner name from signup form (before activation)';
COMMENT ON COLUMN centers.city IS 'City from signup form';
COMMENT ON COLUMN centers.signup_notes IS 'Notes from signup form';
