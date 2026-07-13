-- Internal-portal rebuild: staff INVITE-LINK → self-service INTAKE → CEO-APPROVAL flow.
--
-- WHY: replaces the old "add a team member directly" entry point. The CEO no longer
-- provisions a login by typing someone's name/phone. Instead:
--   1. CEO picks a role (+ optional custom permissions) and mints a SINGLE-USE, expiring
--      invite LINK (public.staff_invites). The link itself grants NOTHING — it only
--      permits submitting one intake for its pre-chosen role.
--   2. The invited person opens the link and enters ONLY name / phone / email. They never
--      choose or see a role picker; the role is frozen by the invite.
--   3. Submitting creates a PENDING request (public.staff_requests). It is INERT: no auth
--      identity, no admin_users row, no credential — nothing until a CEO approves.
--   4. A super_admin (CEO) approves or declines from the Internal Team queue. Only approval
--      provisions the login (via the existing provisionStaffLogin primitive), using the
--      role + permissions FROZEN on the request (copied from the invite at submit time).
--
-- SECURITY INVARIANTS enforced at the DB level here (code enforces the rest):
--   * super_admin (and legacy 'admin') can NEVER be the invited/requested role — excluded
--     by the CHECK constraints below, independent of any code path.
--   * Both tables are SERVICE-ROLE ONLY (RLS enabled, no policies, privileges revoked from
--     anon/authenticated) — exactly like trial_claims / promo_code_requests. Only the
--     internal routes' service-role client ever touch them.
--   * token_hash stores ONLY the SHA-256 of the plaintext invite token; the plaintext is
--     shown to the CEO once and never persisted (mirrors pin_setup_tokens).
--   * One request per invite (partial unique index) — a single-use link cannot spawn a
--     second intake.
--
-- This migration is a REPO FILE ONLY — never applied from the coding session. Idempotent
-- (IF NOT EXISTS / DROP ... IF EXISTS). New data flagged: public.staff_invites,
-- public.staff_requests.

-- The assignable internal-role set. super_admin and 'admin' are intentionally ABSENT so
-- this flow can never confer them. Keep in sync with ASSIGNABLE_INTERNAL_ROLES (TS).
-- (Repeated inline in both CHECKs below — Postgres CHECKs cannot reference a shared const.)

CREATE TABLE IF NOT EXISTS public.staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHA-256(plaintext link token). The plaintext leaves the DB exactly once (returned to
  -- the CEO to copy/share) and is never stored. Unique so a hash collision / replay is a
  -- hard error, not a silent second grant.
  token_hash text NOT NULL UNIQUE,

  -- The role this invite may create. super_admin / admin EXCLUDED at the DB level.
  role text NOT NULL CHECK (role = ANY (ARRAY[
    'internal_viewer'::text, 'internal_admin'::text, 'sales_manager'::text,
    'sales_rep'::text, 'support_agent'::text, 'accountant'::text, 'custom'::text
  ])),
  -- Permission overrides (used when role = 'custom'). Frozen onto the request at submit.
  custom_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Who minted the link (admin_users.id). NULL for a phone-based super_admin with no
  -- admin_users row, and SET NULL if that login is later deleted — never orphans history.
  created_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,

  expires_at timestamptz NOT NULL,             -- single-use AND time-bounded
  used_at timestamptz,                         -- set when an intake is submitted against it
  revoked_at timestamptz,                      -- CEO may cancel an outstanding link

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_invites_token_hash
  ON public.staff_invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_staff_invites_open
  ON public.staff_invites (created_at DESC)
  WHERE (used_at IS NULL AND revoked_at IS NULL);

CREATE TABLE IF NOT EXISTS public.staff_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The invite this intake was submitted against. RESTRICT: never delete an invite that
  -- has a request pointing at it (preserve the provenance of an approval).
  invite_id uuid NOT NULL REFERENCES public.staff_invites(id) ON DELETE RESTRICT,

  -- Self-declared identity from the intake form. Nothing here grants access.
  name text NOT NULL,
  phone text NOT NULL,
  email text,

  -- FROZEN copy of the invite's role + permissions, taken at submit time. The submitter
  -- never supplies these; the route copies them from the invite. super_admin / admin
  -- excluded here too (defense in depth — the value can only come from an invite, which is
  -- already constrained, but the DB refuses a bad value regardless).
  role text NOT NULL CHECK (role = ANY (ARRAY[
    'internal_viewer'::text, 'internal_admin'::text, 'sales_manager'::text,
    'sales_rep'::text, 'support_agent'::text, 'accountant'::text, 'custom'::text
  ])),
  custom_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])),
  decline_reason text,

  reviewed_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  -- The auth identity created on approval (auth.users.id == admin_users.id). Audit link;
  -- SET NULL if that identity is later removed.
  provisioned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- A single-use invite yields at most ONE intake. The submit route also marks the invite
-- used_at, but this index is the hard guarantee against a double-submit race.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_requests_one_per_invite
  ON public.staff_requests (invite_id);
CREATE INDEX IF NOT EXISTS idx_staff_requests_status
  ON public.staff_requests (status);

-- Service-role only, exactly like trial_claims / promo_code_requests: only the internal
-- routes (service-role client) read/write these tables. No RLS policies are added, and
-- anon/authenticated get no table privileges — so a leaked anon key cannot read pending
-- intakes or forge an invite.
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_invites FROM anon, authenticated;

ALTER TABLE public.staff_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_requests FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
