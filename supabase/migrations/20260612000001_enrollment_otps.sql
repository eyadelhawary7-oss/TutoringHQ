-- OTP store for public student self-enrollment (the /join/g/[groupId] flow).
-- All access is via service_role API routes; no user-facing RLS policies.
CREATE TABLE public.enrollment_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.student_groups(id)
    ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.enrollment_otps (group_id, phone, expires_at);

ALTER TABLE public.enrollment_otps ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; all access via service_role API routes.

NOTIFY pgrst, 'reload schema';
