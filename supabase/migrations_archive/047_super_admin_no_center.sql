-- Allow super admin users to exist without being tied to a center
-- Admins are identified by admin_users table; they manage the platform globally

-- 1. Allow center_id to be NULL
ALTER TABLE users
ALTER COLUMN center_id DROP NOT NULL;

-- 2. Add check constraint: regular users must have center_id, super_admins must not
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_center_check;
ALTER TABLE users
ADD CONSTRAINT users_center_check
CHECK (
  (role IN ('owner', 'admin', 'assistant', 'teacher') AND center_id IS NOT NULL)
  OR
  (role = 'super_admin' AND center_id IS NULL)
);

COMMENT ON CONSTRAINT users_center_check ON users IS
'Regular users must have a center; super admins must not have a center';

-- 3. Extend users.role to include super_admin (if constrained)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'admin', 'assistant', 'teacher', 'super_admin'));

-- 4. Ensure admin_users members have center_id=NULL and role=super_admin in users
UPDATE users
SET center_id = NULL, role = 'super_admin'
WHERE id IN (SELECT id FROM admin_users);
