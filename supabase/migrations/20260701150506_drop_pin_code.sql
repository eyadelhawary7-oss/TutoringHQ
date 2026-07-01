-- ============================================================================
-- Drop the dead public.users.pin_code column.
-- ----------------------------------------------------------------------------
-- pin_code was a best-effort mirror of the PIN that never populated reliably and
-- is no longer read or written by any code: the authoritative "PIN has been set"
-- signal is now public.users.pin_set_at (added in 20260701150505), and the real
-- credential is the Supabase Auth password.
--
-- DEPLOY ORDERING (important): this DROP must run only AFTER the code on this
-- branch is live. The previously-deployed code still INSERTs pin_code
-- (signup/complete, admin/centers, accept-invite, signupPaymobAutoApprove), so
-- dropping the column before those endpoints stop writing it would break live
-- signup/invite. It is therefore applied at deploy time, not ahead of it.
-- ============================================================================

ALTER TABLE public.users DROP COLUMN IF EXISTS pin_code;

notify pgrst, 'reload schema';
