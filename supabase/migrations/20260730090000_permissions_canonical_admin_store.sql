-- ============================================================================
-- `public.permissions` becomes the canonical store for admin-portal permissions
--
-- Eyad's decision, 29 July 2026. `admin_users.custom_permissions` is a jsonb
-- blob with no history; `permissions` carries `enabled` and `created_at`, so it
-- records who was granted what and when. One store, no dual-write.
--
-- WHY A MIGRATION IS NEEDED AT ALL
-- --------------------------------
-- `permissions.user_id` was declared REFERENCES users(id). `public.users` is
-- the CENTRE-tenant table; admins live in `public.admin_users` and, verified in
-- the live catalog on 29 July, NEITHER existing admin row has a matching
-- `users` row. Inserting an admin's permission would have raised a foreign-key
-- violation on the first save, for every admin including the owner.
--
-- SAFE TO REPOINT
-- ---------------
--   * `permissions` holds 0 rows, so there is nothing to migrate or orphan.
--   * No application code reads or writes it (grepped across src/ — zero hits).
--     It was declared in the baseline migration and never adopted.
--   * Both `users.id` and `admin_users.id` ARE the Supabase auth user id, so the
--     existing RLS policy `user_id = auth.uid()` keeps working unchanged.
--
-- `admin_users.custom_permissions` is left in place and is now DEAD. Dropping
-- it is Eyad's call and deliberately not done here.
-- ============================================================================

BEGIN;

-- 1. Repoint the foreign key: centre users -> admin users.
ALTER TABLE public.permissions
  DROP CONSTRAINT IF EXISTS permissions_user_id_fkey;

ALTER TABLE public.permissions
  ADD CONSTRAINT permissions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.admin_users(id) ON DELETE CASCADE;

-- 2. Index the lookup every gate now performs on every admin request.
--    (user_id, permission) is already UNIQUE, which serves equality on user_id,
--    but the gates filter on `enabled` too.
CREATE INDEX IF NOT EXISTS permissions_user_enabled_idx
  ON public.permissions (user_id, enabled);

COMMENT ON TABLE public.permissions IS
  'Canonical admin-portal permission grants. One row per (admin_users.id, permission key). '
  '`enabled` + `created_at` give the audit trail that admin_users.custom_permissions lacked. '
  'Canonical since 2026-07-30; admin_users.custom_permissions is dead and pending drop.';

COMMENT ON COLUMN public.permissions.user_id IS
  'References admin_users(id), NOT users(id). Both are the Supabase auth user id.';

COMMIT;
