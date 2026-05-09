CREATE TABLE public.pending_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  center_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  city TEXT,
  plan_key TEXT,
  billing_period TEXT,
  referral_code TEXT,
  terms_accepted_at TIMESTAMPTZ,
  last_step_completed SMALLINT DEFAULT 1,
  payment_attempt_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  completed_at TIMESTAMPTZ
);

CREATE INDEX pending_signups_phone_idx ON public.pending_signups (phone);
CREATE INDEX pending_signups_expires_idx ON public.pending_signups (expires_at) WHERE completed_at IS NULL;

ALTER TABLE public.pending_signups ENABLE ROW LEVEL SECURITY;
