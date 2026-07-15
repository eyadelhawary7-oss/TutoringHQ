-- STEP 2 of 2 — apply AFTER the #158 deploy.
--
-- Two schema changes that BOTH require the new code to already be live:
--
--   1. Drop the dead student_groups.fee column. The OLD code mirrored fee from
--      fee_per_class on dashboard group-create (and could read it); the NEW code
--      reads fee_per_class everywhere and no longer writes the mirror. Dropping
--      fee BEFORE the deploy would break the old create path — so it lands AFTER.
--
--   2. Add student_groups_center_priced_chk (a CENTER group must carry
--      fee_per_class > 0). The OLD onboarding inserted a center group with NO
--      fee_per_class (NULL); the NEW onboarding requires a positive fee. Adding
--      the constraint BEFORE the deploy would break the old onboarding insert —
--      so it lands AFTER, once the app itself guarantees a positive fee.
--
-- SAFE AGAINST THE NEW CODE THAT IS LIVE WHEN THIS RUNS:
--   • The new code never reads or writes student_groups.fee, so dropping it is
--     invisible to every live path.
--   • Every new center-group write (onboarding + dashboard create) produces
--     fee_per_class > 0, and 0 live center groups violate the check today, so
--     ADD CONSTRAINT succeeds and no subsequent write trips it.
--
-- HELD — REQUIRES SIGN-OFF, NOT applied to production from the coding session.
-- Idempotent (DROP ... IF EXISTS; backfills touch only NULL/needy rows).

-- 0. Catch-up snapshot: price any chargeable center scan still missing a
--    charged_fee. Step 1 priced everything up to when it ran; this closes the
--    brief window BETWEEN step 1 and the deploy, during which the OLD code wrote
--    scans without charged_fee. Those rows still carry group_id, so the same
--    join prices them. Idempotent — touches only charged_fee IS NULL rows.
UPDATE public.attendance_scans a
   SET charged_fee = g.fee_per_class
  FROM public.student_groups g
 WHERE a.group_id = g.id
   AND g.kind = 'center'
   AND a.billable IS NULL
   AND (a.status IS NULL OR a.status <> 'absent')
   AND (a.payment_status_at_scan IS NULL OR a.payment_status_at_scan <> 'admitted')
   AND a.charged_fee IS NULL;

-- 1. Safety-net backfill: carry a REAL (non-zero) fee across to fee_per_class for
--    any group that somehow has fee_per_class NULL. Guarded with `fee > 0` so we
--    never overwrite a price with the dead 0. (0 rows on the live DB today.)
--    Must run before the column is dropped — it reads `fee`.
UPDATE public.student_groups
   SET fee_per_class = fee
 WHERE fee_per_class IS NULL
   AND fee > 0;

-- 2. Drop the CHECK that references only `fee`, then the column itself. The other
--    two CHECKs (center_cut_valid, kind_shape_chk) reference fee_per_class and are
--    untouched; no view depends on `fee`.
ALTER TABLE public.student_groups DROP CONSTRAINT IF EXISTS student_groups_fee_nonneg;
ALTER TABLE public.student_groups DROP COLUMN IF EXISTS fee;

-- 3. Once `fee` is gone, fee_per_class is the ONLY price. A CENTER group with no
--    price would make the scanner/checklist snapshot 0 silently. Require every
--    center group to carry a positive fee_per_class. (Private groups are already
--    gated NOT NULL by kind_shape_chk; the app requires a positive fee on create.)
--    Verified: 0 live center groups violate this today, so ADD CONSTRAINT succeeds.
ALTER TABLE public.student_groups DROP CONSTRAINT IF EXISTS student_groups_center_priced_chk;
ALTER TABLE public.student_groups
  ADD CONSTRAINT student_groups_center_priced_chk
  CHECK (kind <> 'center' OR (fee_per_class IS NOT NULL AND fee_per_class > 0));

NOTIFY pgrst, 'reload schema';
