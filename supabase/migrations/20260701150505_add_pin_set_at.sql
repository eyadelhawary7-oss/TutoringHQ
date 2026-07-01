-- ============================================================================
-- Add an authoritative "PIN has been set" signal to public.users.
-- ----------------------------------------------------------------------------
-- Background: the real login credential is the Supabase Auth password. The old
-- public.users.pin_code was meant to flag "owner has set a PIN" but was a
-- best-effort mirror that never populated (NULL for every real user), so it
-- could not be relied on. The Auth password itself cannot be the signal either:
-- signupPaymobAutoApprove creates the auth user with a random PLACEHOLDER
-- password before any PIN is chosen, so encrypted_password is non-NULL even when
-- no PIN has been set.
--
-- pin_set_at is the dedicated, drift-free signal: NULL = no PIN set yet,
-- non-NULL = PIN set (timestamp of when it was set). Written by every real
-- PIN-set path; left NULL by the placeholder-creation path.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pin_set_at timestamptz;

-- Backfill authoritatively (NOT from the stale pin_code, which is NULL for all):
-- a user that has ever signed in must possess a real credential, because the
-- placeholder password is 256 random bits never disclosed to anyone and thus can
-- never produce a successful sign-in. last_sign_in_at IS NOT NULL therefore
-- implies a real PIN was set.
UPDATE public.users u
SET pin_set_at = COALESCE(a.last_sign_in_at, u.created_at)
FROM auth.users a
WHERE a.id = u.id
  AND a.last_sign_in_at IS NOT NULL
  AND u.pin_set_at IS NULL;

notify pgrst, 'reload schema';
