-- Snapshot the per-session fee onto attendance_scans.
--
-- WHY: the student balance was re-deriving each past session's charge from the
-- LIVE student_groups.fee_per_class (via attendance_scans.group_id). That made
-- history mutable: editing a group's price re-priced every past session, and
-- deleting a group (attendance_scans.group_id_fkey is ON DELETE SET NULL)
-- zeroed the debt for all its past scans. The payment side is already
-- snapshotted (payments.amount records what was collected); this makes the
-- charge side symmetric. From now on the scanner/checklist write the price that
-- applied at scan time into `charged_fee`, and the balance helper SUMS
-- `charged_fee` instead of joining to the live group price — so price edits and
-- group deletion are non-destructive to recorded history.
--
-- HELD — REQUIRES SIGN-OFF, NOT applied to production from the coding session.
-- Idempotent.

ALTER TABLE public.attendance_scans
  ADD COLUMN IF NOT EXISTS charged_fee numeric;

-- Backfill existing rows. There is no historical price to recover, so the best
-- available proxy is the group's CURRENT fee_per_class — but only for rows that
-- ARE chargeable center attendance: a center group (kind='center'), attended
-- (status is null/'present', not 'absent'), not a fee-exempt admission
-- ('admitted'), and not a teacher-private/waived row (billable is null, i.e. NOT
-- true and NOT false). Teacher-private scans (billable=true) and exempt rows are
-- left NULL so the center balance does not charge them.
--
-- NOTE on the 2 rows live today: both are teacher-private (billable=true), so
-- this backfill skips them — their charged_fee stays NULL and they contribute 0
-- to the center balance (the teacher-private engine bills them separately).
UPDATE public.attendance_scans a
   SET charged_fee = g.fee_per_class
  FROM public.student_groups g
 WHERE a.group_id = g.id
   AND g.kind = 'center'
   AND a.billable IS NULL
   AND (a.status IS NULL OR a.status <> 'absent')
   AND (a.payment_status_at_scan IS NULL OR a.payment_status_at_scan <> 'admitted')
   AND a.charged_fee IS NULL;

NOTIFY pgrst, 'reload schema';
