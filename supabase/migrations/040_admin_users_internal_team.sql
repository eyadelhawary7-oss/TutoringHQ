-- Add phone column and expand role check for internal team management
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Drop existing role constraint and add expanded one
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('admin', 'support', 'super_admin', 'internal_admin', 'internal_viewer'));

-- Make email nullable for internal invites (phone is primary identifier)
ALTER TABLE admin_users ALTER COLUMN email DROP NOT NULL;

-- Drop UNIQUE on email to allow placeholder emails for multiple invites
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_email_key;
