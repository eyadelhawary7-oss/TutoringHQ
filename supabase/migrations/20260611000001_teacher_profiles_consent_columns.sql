-- Consent timestamps for teacher signups (PDPL Law 151/2020 compliance)
-- Mirrors centers.policy_accepted_at / terms_accepted_at pattern.
ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS policy_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_accepted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS policy_version     text;

NOTIFY pgrst, 'reload schema';
