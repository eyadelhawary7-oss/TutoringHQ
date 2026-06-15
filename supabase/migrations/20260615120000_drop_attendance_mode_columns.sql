-- Reverse the per-group attendance "mode" concept entirely.
--
-- Earlier on 2026-06-15 we shipped two mode columns (see migrations
-- 20260615000000 and 20260615055317): centers.default_attendance_mode and
-- student_groups.attendance_mode. The product decision changed: QR scan and
-- the tap-a-name checklist are now BOTH always available for EVERY group,
-- mixable within one session, surfaced as two tabs on a single Attendance page.
-- There is no per-group "mode" to choose, so both columns are obsolete.
--
-- Catalog reality (introspected against prod BEFORE writing -- Rule 146):
--   * Both columns exist as: text NOT NULL DEFAULT 'scan', each with a CHECK
--     constraint ('scan' | 'checklist').
--   * NOTHING depends on them outside the obsolete mode UI/logic: zero views,
--     materialized views, policies, triggers, or functions reference either
--     column; no billing / analytics / enrollment reader. All TS readers
--     (groups page, settings page, checklist page) are removed in the same
--     change set. Safe to drop.

ALTER TABLE public.student_groups
  DROP CONSTRAINT IF EXISTS student_groups_attendance_mode_check;

ALTER TABLE public.student_groups
  DROP COLUMN IF EXISTS attendance_mode;

ALTER TABLE public.centers
  DROP CONSTRAINT IF EXISTS centers_default_attendance_mode_check;

ALTER TABLE public.centers
  DROP COLUMN IF EXISTS default_attendance_mode;

-- Refresh PostgREST schema cache so the dropped columns stop being queryable.
NOTIFY pgrst, 'reload schema';
