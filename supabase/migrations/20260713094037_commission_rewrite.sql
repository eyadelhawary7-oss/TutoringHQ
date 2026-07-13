-- Money-track commission rewrite (v2) — schema side.
-- REQUIRES SIGN-OFF. Repo-only until merge; NOT applied to the live DB here.
-- Safe on the live dataset: 0 commission / 0 payout / 0 staff / 0 assignment rows
-- (verified read-only), so there is no data to migrate — this is forward-shape only.
--
-- Changes:
--  1. Fix the `solo` CHECK bug: `plan_at_signing` omitted 'solo' (yet the engine
--     priced solo centers) so any solo commission INSERT threw. Broaden it, and add
--     the teacher plan keys now that teachers earn commissions.
--  2. Owner polymorphism: commissions were center-only (`center_id NOT NULL`). Add
--     `owner_type` + `teacher_id` (FK teacher_profiles.user_id), make `center_id`
--     nullable, and enforce exactly-one-owner consistent with owner_type.
--  3. Teacher uniqueness: mirror the center partial-unique indexes for teachers, and
--     tighten the center indexes to `center_id IS NOT NULL` so teacher rows (center_id
--     NULL) never fall under them. The engine also does explicit insert + 23505-catch
--     (no reliance on partial-index ON CONFLICT inference — the old double-insert bug).

BEGIN;

-- 1. plan_at_signing: add 'solo' + teacher plan keys ---------------------------------
ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_plan_at_signing_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_plan_at_signing_check
  CHECK (plan_at_signing = ANY (ARRAY[
    'solo','nano','starter','pro','business','enterprise','top_centers',
    'teacher_standard','teacher_pro','teacher_scale'
  ]));

-- 2. Owner polymorphism --------------------------------------------------------------
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'center',
  ADD COLUMN IF NOT EXISTS teacher_id uuid;

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_teacher_id_fkey;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES public.teacher_profiles(user_id) ON DELETE RESTRICT;

-- center_id was NOT NULL; teacher rows carry a NULL center_id.
ALTER TABLE public.commissions ALTER COLUMN center_id DROP NOT NULL;

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_owner_type_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_owner_type_check
  CHECK (owner_type = ANY (ARRAY['center','teacher']));

-- Exactly one owner, consistent with owner_type.
ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_owner_exactly_one;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_owner_exactly_one
  CHECK (
    (owner_type = 'center'  AND center_id IS NOT NULL AND teacher_id IS NULL) OR
    (owner_type = 'teacher' AND teacher_id IS NOT NULL AND center_id IS NULL)
  );

-- 3. Uniqueness ----------------------------------------------------------------------
-- Tighten the existing center indexes so they never cover teacher rows.
DROP INDEX IF EXISTS public.one_commission_per_center_staff_type;
CREATE UNIQUE INDEX one_commission_per_center_staff_type
  ON public.commissions (center_id, staff_id, commission_type)
  WHERE staff_id IS NOT NULL AND center_id IS NOT NULL;

DROP INDEX IF EXISTS public.one_eyad_commission_per_center;
CREATE UNIQUE INDEX one_eyad_commission_per_center
  ON public.commissions (center_id)
  WHERE staff_id IS NULL AND center_id IS NOT NULL;

-- Teacher mirrors.
CREATE UNIQUE INDEX IF NOT EXISTS one_commission_per_teacher_staff_type
  ON public.commissions (teacher_id, staff_id, commission_type)
  WHERE staff_id IS NOT NULL AND teacher_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_eyad_commission_per_teacher
  ON public.commissions (teacher_id)
  WHERE staff_id IS NULL AND teacher_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_teacher
  ON public.commissions (teacher_id) WHERE teacher_id IS NOT NULL;

-- 4. Reassignment terminal statuses --------------------------------------------------
-- A reassignment VOIDS the previous rep's still-unearned tiers (never a paid one).
-- Add 'reassigned' to each tier's status CHECK so voided rows are auditable and are
-- excluded from every "eligible"/"locked" payout query.
ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_t1_status_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_t1_status_check
  CHECK (t1_status = ANY (ARRAY['pending','eligible','paid','clawed_back','reassigned']));

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_t2_status_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_t2_status_check
  CHECK (t2_status = ANY (ARRAY['locked','eligible','paid','forfeited','reassigned']));

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_loyalty_bonus_status_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_loyalty_bonus_status_check
  CHECK (loyalty_bonus_status = ANY (ARRAY['locked','eligible','paid','forfeited','reassigned']));

COMMIT;
