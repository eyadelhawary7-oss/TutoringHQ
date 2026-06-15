-- Per-group attendance input mode: 'scan' (QR scanner -- default/legacy) or
-- 'checklist' (tap-a-name roster). Freely switchable by the center, no size lock.
-- This is a new INPUT METHOD into the existing attendance pipeline, not a new
-- system: a checklist row writes through the same queueScan/sync path as a scan.
--
-- Catalog reality (introspected against prod BEFORE writing -- Rule 146):
--   * public.student_groups has NO attendance_mode-like column today.
--   * The table carries BOTH `fee` and `fee_per_class` -- BOTH LEFT UNTOUCHED.
--   * kind defaults to 'center'. Center groups are owner/admin-updatable via the
--     existing row-level RLS policy student_groups_update
--     (center_id = get_auth_center_id() AND has_center_role(['owner','admin'])).
--     That policy is NOT column-scoped, so it already governs this new column --
--     no RLS change is required. The teacher UPDATE policy is gated to
--     kind='private', so a teacher CANNOT flip mode on a center group. Assistant
--     writes flow through the service-role /api/db proxy and are gated in the TS
--     route layer (db-proxy bypasses RLS by design).
--   * attendance_scans has NO admission_kind/scan_kind columns -- those are
--     queueScan-local (IndexedDB) fields translated into real columns by
--     src/lib/sync.ts. Untouched here.

ALTER TABLE public.student_groups
  ADD COLUMN IF NOT EXISTS attendance_mode text NOT NULL DEFAULT 'scan';

ALTER TABLE public.student_groups
  DROP CONSTRAINT IF EXISTS student_groups_attendance_mode_check;

ALTER TABLE public.student_groups
  ADD CONSTRAINT student_groups_attendance_mode_check
  CHECK (attendance_mode IN ('scan', 'checklist'));

NOTIFY pgrst, 'reload schema';
