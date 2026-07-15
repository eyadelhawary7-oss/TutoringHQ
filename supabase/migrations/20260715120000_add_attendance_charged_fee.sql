-- STEP 1 of 2 — apply BEFORE the #158 deploy.
--
-- Add attendance_scans.charged_fee and snapshot the price onto existing rows.
--
-- WHY BEFORE THE DEPLOY: the new scanner/checklist (sync.ts) write `charged_fee`
-- on every attendance insert, so the column MUST exist first — otherwise those
-- inserts fail (PostgREST 400 on an unknown column) and no attendance is
-- recorded. Splitting this out (separate from the fee drop / center-priced
-- constraint, which must land AFTER the deploy) is what removes the broken
-- window.
--
-- SAFE AGAINST THE OLD CODE THAT IS LIVE WHEN THIS RUNS:
--   • ADD COLUMN is nullable with no default → instant, no table rewrite, brief
--     lock only. The old code neither writes nor reads charged_fee.
--   • The old balance path derives each charge from the LIVE group price, not
--     from charged_fee, so backfilling this column is invisible to it — no read
--     or write path changes behaviour.
--
-- HELD — REQUIRES SIGN-OFF, NOT applied to production from the coding session.
-- Idempotent.

ALTER TABLE public.attendance_scans
  ADD COLUMN IF NOT EXISTS charged_fee numeric;

-- Backfill existing chargeable CENTER attendance from the group's current
-- fee_per_class (the only available proxy for the historical price): a center
-- group (kind='center'), attended (status null/'present', not 'absent'), not a
-- fee-exempt admission ('admitted'), and not a teacher-private/waived row
-- (billable IS NULL — i.e. NOT true and NOT false). Teacher-private scans
-- (billable=true) and exempt rows are left NULL so the center balance never
-- charges them. Backfilling here (before the deploy) means historical balances
-- are correct the instant the new balance helper goes live.
--
-- NOTE on the rows live today: both are teacher-private (billable=true), so this
-- backfill skips them — their charged_fee stays NULL and they contribute 0 to
-- the center balance (the teacher-private engine bills them separately).
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
