-- ============================================================================
-- H8 (minimum) — privacy_requests reach an admin + raise an alert
-- ----------------------------------------------------------------------------
-- Data-subject rights requests are platform-level, not center-scoped, so a
-- privacy alert has no center. Relax admin_alerts.center_id to nullable and
-- extend the type CHECK with 'privacy_request' so the intake route can raise an
-- unmissable alert row alongside the in-app notifications to platform admins.
--
-- The 30-day PDPL due date is derived in the UI/API as created_at + 30 days;
-- no due_at column is added.
-- ============================================================================

ALTER TABLE public.admin_alerts ALTER COLUMN center_id DROP NOT NULL;

ALTER TABLE public.admin_alerts DROP CONSTRAINT admin_alerts_type_check;
ALTER TABLE public.admin_alerts ADD CONSTRAINT admin_alerts_type_check
  CHECK (type = ANY (ARRAY[
    'critical_inactivity'::text,
    'payment_overdue'::text,
    'support_escalation'::text,
    'privacy_request'::text
  ]));

NOTIFY pgrst, 'reload schema';
