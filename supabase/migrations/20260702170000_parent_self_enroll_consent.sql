-- ============================================================================
-- Parent consent captured on the public self-enrollment (join-by-link) flow.
-- ----------------------------------------------------------------------------
-- When a PARENT self-enrolls a student through a shared join link, they must
-- attest, on the public form, that they are the student's parent / legal
-- guardian AND that they consent to their child's personal data being
-- processed. This column is the PROOF of that parent-side attestation and its
-- timestamp.
--
--   parent_self_enroll_consent_at - timestamp of the parent's attestation
--                                   (now() at the moment the join submission is
--                                   accepted). NULL = no such attestation was
--                                   captured for this row.
--
-- Deliberately distinct from the other consent columns so the three can never
-- be conflated:
--   * parent_consent_given / parent_consent_at  -> WhatsApp parent-pack COMMS
--                                                  opt-in (a different purpose).
--   * guardian_consent_confirmed_at / _by       -> the CENTER attesting it holds
--                                                  the guardian's consent
--                                                  (center-side create/approve).
--   * parent_self_enroll_consent_at (this one)  -> the PARENT attesting directly,
--                                                  on the public join form.
--
-- No accompanying "_by" uuid: the self-enrolling parent is unauthenticated
-- (there is no public.users row for them); the submitted parent_phone already
-- lives on the same students row. The column is nullable so existing rows and
-- non-join creation paths are unaffected. The API layer is the gate: the public
-- join routes reject a submission that does not carry the parent's consent and
-- stamp this column on success (the server is the gate, not just the checkbox).
-- ============================================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS parent_self_enroll_consent_at timestamptz;

COMMENT ON COLUMN public.students.parent_self_enroll_consent_at IS
  'When the self-enrolling parent attested (on the public join-by-link form) that they are the student''s parent/legal guardian and consented to processing the student''s personal data. NULL when not captured via self-enrollment. Distinct from parent_consent_* (WhatsApp comms opt-in) and guardian_consent_confirmed_* (center-side attestation).';

notify pgrst, 'reload schema';
