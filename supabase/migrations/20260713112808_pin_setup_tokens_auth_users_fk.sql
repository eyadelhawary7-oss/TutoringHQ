-- Add-staff fix: let the PIN-setup rail serve internal team members (managers/reps),
-- who have an admin_users row + auth identity but NO public.users row.
--
-- `pin_setup_tokens.user_id` FK'd to public.users(id), which coupled the entire
-- set-PIN mechanism to the CUSTOMER table — so a center-less employee could never be
-- issued a set-PIN link. Repoint the FK to auth.users(id): user_id is already an auth
-- user id (public.users.id == auth.users.id for owners, so no existing row is
-- orphaned), and the PIN rail becomes usable by any auth identity — center owner OR
-- internal admin. Idempotent.

ALTER TABLE public.pin_setup_tokens DROP CONSTRAINT IF EXISTS pin_setup_tokens_user_id_fkey;
ALTER TABLE public.pin_setup_tokens
  ADD CONSTRAINT pin_setup_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
