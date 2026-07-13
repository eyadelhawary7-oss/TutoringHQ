-- Phase 4c (internal-portal rebuild): Manager-requested promo codes with CEO approval.
--
-- WHY: a Sales Manager (admin_users.role = 'sales_manager') can now REQUEST a promo
-- code (proposed code, discount %, max uses, expiry, and whether it targets centers or
-- teachers). The request lands as 'pending'. The CEO (super_admin) approves it — which
-- creates the real public.promo_codes row (active) — or rejects it WITH A REASON on the
-- Promo Codes screen. Reps get nothing (403). A per-request cap (max discount %, max
-- uses) prevents anyone requesting a 100%-off / unlimited code.
--
-- This migration is a REPO FILE ONLY — it is never applied from the coding session. It
-- is idempotent (IF NOT EXISTS / DROP ... IF EXISTS). It does NOT change existing
-- promo-code create/redeem logic; approval just inserts a normal promo_codes row.
-- New-data flagged: table public.promo_code_requests.

CREATE TABLE IF NOT EXISTS public.promo_code_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The manager's login identity (admin_users.id == auth.users.id). Nullable + SET NULL
  -- so a deleted internal login does not orphan/block the request history. A phone-based
  -- super_admin (no admin_users row) creating directly stores NULL here.
  requested_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  -- The manager's sales-org (staff) row, resolved from staff.user_id at request time.
  requested_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,

  code text,                                            -- proposed code (may be blank; CEO can fill on approve)
  discount_pct int NOT NULL CHECK (discount_pct >= 1 AND discount_pct <= 100),
  max_uses_total int CHECK (max_uses_total IS NULL OR max_uses_total >= 1),  -- NULL = unlimited (subject to cap)
  expires_at timestamptz,
  target_type text NOT NULL DEFAULT 'all'
    CHECK (target_type = ANY (ARRAY['center'::text, 'teacher'::text, 'all'::text])),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  rejection_reason text,
  reviewed_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_promo_code_id uuid REFERENCES public.promo_codes(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_code_requests_status
  ON public.promo_code_requests (status);
CREATE INDEX IF NOT EXISTS idx_promo_code_requests_requested_by
  ON public.promo_code_requests (requested_by) WHERE (requested_by IS NOT NULL);

-- Service-role only, exactly like trial_claims / teacher_assignments: only the internal
-- admin routes (service-role client) read/write this table. No RLS policies are added,
-- and anon/authenticated get no table privileges.
ALTER TABLE public.promo_code_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promo_code_requests FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
