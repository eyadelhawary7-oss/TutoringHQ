-- Granular per-user permission flags for center-side authorization.
-- Extends the two existing flags (can_record_payments, can_view_payments) with
-- six new flags covering the OWNER-ONLY routes identified in the May 12 role-gating
-- audit (commit 44bb9ba, doc at docs/AUDIT_center_role_gating.md).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_manage_billing           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_edit_center_profile      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_delete_students          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_academic_calendar BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_place_card_orders        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_request_referral_payouts BOOLEAN NOT NULL DEFAULT FALSE;

-- Owners and super_admins get all permissions; assistants stay at default false.
-- This preserves existing role-based behavior while making flags individually toggleable.
UPDATE users SET
  can_manage_billing           = TRUE,
  can_edit_center_profile      = TRUE,
  can_delete_students          = TRUE,
  can_manage_academic_calendar = TRUE,
  can_place_card_orders        = TRUE,
  can_request_referral_payouts = TRUE
WHERE role IN ('owner', 'super_admin');
