-- Retire the dead `student_groups.fee` column.
--
-- WHY: `fee_per_class` is the authoritative single per-group price — what the
-- scanner, checklist, students list, and the balance helper charge. The legacy
-- `student_groups.fee` column was only mirrored from `fee_per_class` on the
-- dashboard group-create path (src/lib/validations.ts); groups created any other
-- way kept `fee = 0`, so any code reading `fee` undercharged to 0 (live proof:
-- two of three groups had fee 0 while fee_per_class was 300 / 700). Every read
-- has been switched to `fee_per_class` and the mirror removed; this drops the
-- leftover column.
--
-- HELD — REQUIRES SIGN-OFF, NOT applied to production from the coding session.
-- Idempotent (DROP ... IF EXISTS).

-- 1. Safety-net backfill: carry a REAL (non-zero) fee across to fee_per_class for
--    any group that somehow has fee_per_class NULL. Guarded with `fee > 0` so we
--    never overwrite a price with the dead 0. (0 rows on the live DB today:
--    every group already has fee_per_class populated.)
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
--    price would make the scanner/checklist charge 0 silently. Require every
--    center group to carry a positive fee_per_class. (Private groups are already
--    gated NOT NULL by kind_shape_chk; the app requires a positive fee on create.)
--    Verified: 0 live center groups violate this today. The onboarding
--    create-group path now requires a positive fee (see src/app/api/onboarding).
ALTER TABLE public.student_groups DROP CONSTRAINT IF EXISTS student_groups_center_priced_chk;
ALTER TABLE public.student_groups
  ADD CONSTRAINT student_groups_center_priced_chk
  CHECK (kind <> 'center' OR (fee_per_class IS NOT NULL AND fee_per_class > 0));

NOTIFY pgrst, 'reload schema';
