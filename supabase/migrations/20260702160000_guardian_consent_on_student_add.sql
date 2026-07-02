-- ============================================================================
-- Guardian-consent confirmation when a center adds a student.
-- ----------------------------------------------------------------------------
-- The center is the party responsible for holding the guardian's consent to
-- process a student's data (to be worded by Adsero in the center agreement and
-- the data processing agreement). These two columns are the PROOF behind that
-- contract clause: they record WHO at the center confirmed consent and WHEN,
-- captured at the moment the student is created or a pending enrollment is
-- approved center-side.
--
--   guardian_consent_confirmed_at  - timestamp of the confirmation (now() at
--                                    the moment of the create/approve).
--   guardian_consent_confirmed_by  - the confirming user (public.users.id).
--
-- Both are nullable ON PURPOSE:
--   * Existing students are NOT affected and are NOT retroactively blocked.
--   * Only NEW center-side adds and approvals require the confirmation going
--     forward; that gate is enforced in the API layer (the server is the gate,
--     not just the checkbox), which stamps these columns on success.
--
-- guardian_consent_confirmed_by is a plain uuid (no FK), mirroring the existing
-- parent_consent_* columns and the approve_student_rpc's p_approved_by: the
-- value is an immutable audit fact and must survive even if the user row is
-- later removed, so it is intentionally not tied to a delete rule.
-- ============================================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS guardian_consent_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS guardian_consent_confirmed_by uuid;

COMMENT ON COLUMN public.students.guardian_consent_confirmed_at IS
  'When the center confirmed it holds the guardian''s consent to process this student''s data (center-side create/approve). NULL for pre-existing students.';
COMMENT ON COLUMN public.students.guardian_consent_confirmed_by IS
  'The center user (public.users.id) who confirmed guardian consent at create/approve time. NULL for pre-existing students.';

notify pgrst, 'reload schema';
