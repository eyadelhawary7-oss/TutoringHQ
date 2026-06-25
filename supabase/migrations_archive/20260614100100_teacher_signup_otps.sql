-- ITEM 8: OTP store for teacher signup phone verification (WhatsApp live-number proof).
--
-- Mirrors public.enrollment_otps (the student self-enrollment OTP store) exactly,
-- minus group_id: a teacher signup is keyed by phone only. Same generation
-- (crypto 6-digit), hashing (SHA-256 hex, never stored in clear), 10-minute
-- expiry, and per-row attempts<5 brute-force cap as the enrollment flow.
--
-- All access is via service_role API routes (send-otp + the signup route's verify
-- step); no user-facing RLS policies. A new dedicated table (not an overload of
-- enrollment_otps) keeps the two flows independent.
CREATE TABLE public.teacher_signup_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.teacher_signup_otps (phone, expires_at);

ALTER TABLE public.teacher_signup_otps ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; all access via service_role API routes.

NOTIFY pgrst, 'reload schema';
