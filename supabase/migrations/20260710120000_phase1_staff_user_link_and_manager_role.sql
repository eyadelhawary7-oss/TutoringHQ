-- Phase 1 (internal-portal rebuild): link a login identity to its sales-org (staff)
-- row, and add a 'sales_manager' internal login role.
--
-- WHY: Internal login/access lives in public.admin_users. The manager->rep hierarchy
-- lives in public.staff (roles 'sm'/'sr', staff.reports_to). The two tables had NO
-- link, so a logged-in person could not be mapped to their sales-org position for
-- access scoping. staff.user_id is that single link (auth.users.id == admin_users.id).
-- No new tables are introduced. This migration is idempotent.

-- 1. Link a staff row to a login identity. Nullable + UNIQUE (Postgres allows many
--    NULLs), FK to auth.users so a deleted login clears the link rather than orphaning
--    the sales/commission history.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_user_id_fkey') THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_user_id_key') THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_user_id_key UNIQUE (user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_user_id ON public.staff (user_id);

-- 2. Allow a 'sales_manager' internal login role (Manager). 'sales_rep' (Rep) and the
--    others already exist in the constraint; CEO stays 'super_admin'.
ALTER TABLE public.admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_role_check
  CHECK (role = ANY (ARRAY[
    'super_admin'::text,
    'admin'::text,
    'internal_admin'::text,
    'internal_viewer'::text,
    'sales_manager'::text,
    'sales_rep'::text,
    'support_agent'::text,
    'accountant'::text,
    'custom'::text
  ]));
