-- Phase 4b (internal-portal rebuild): two-level center + teacher assignment.
--
-- WHY: the sales org is CEO -> Manager (sm) -> Rep (sr). The CEO batch-assigns a set
-- of centers and teachers to a Manager; the Manager then sub-assigns each account to
-- one of THEIR reps; the CEO sees and overrides everything. Two data changes make this
-- possible:
--   1. center_assignments gains manager_staff_id so a row can be "owned by a manager,
--      rep not yet chosen" (manager_staff_id set, staff_id NULL).
--   2. a new teacher_assignments table mirrors the same concept for teachers, which had
--      no staff ownership at all before.
--
-- This migration is a REPO FILE ONLY — it is never applied from the coding session.
-- It is idempotent (IF NOT EXISTS / DROP ... IF EXISTS) and does NOT touch commission
-- calculation. New-data flagged: column center_assignments.manager_staff_id and table
-- public.teacher_assignments.

-- ── 1. center_assignments: manager ownership ──────────────────────────────────
ALTER TABLE public.center_assignments
  ADD COLUMN IF NOT EXISTS manager_staff_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'center_assignments_manager_staff_id_fkey'
  ) THEN
    ALTER TABLE public.center_assignments
      ADD CONSTRAINT center_assignments_manager_staff_id_fkey
      FOREIGN KEY (manager_staff_id) REFERENCES public.staff(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_center_assignments_manager_staff_id
  ON public.center_assignments (manager_staff_id) WHERE (manager_staff_id IS NOT NULL);

-- Relax the eyad/staff guard so a non-eyad row may carry manager_staff_id with a NULL
-- staff_id (assigned to a manager, rep not yet chosen). Semantics:
--   sourced_by = 'eyad'  => staff_id IS NULL
--   sourced_by <> 'eyad' => staff_id IS NOT NULL OR manager_staff_id IS NOT NULL
ALTER TABLE public.center_assignments
  DROP CONSTRAINT IF EXISTS sourced_by_eyad_no_staff;
ALTER TABLE public.center_assignments
  ADD CONSTRAINT sourced_by_eyad_no_staff CHECK (
    ((sourced_by = 'eyad'::text) AND (staff_id IS NULL))
    OR (
      (sourced_by <> 'eyad'::text)
      AND ((staff_id IS NOT NULL) OR (manager_staff_id IS NOT NULL))
    )
  );

-- ── 2. teacher_assignments: mirror the center concept for teachers ─────────────
CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teacher_profiles(user_id) ON DELETE CASCADE,
  manager_staff_id uuid REFERENCES public.staff(id),
  staff_id uuid REFERENCES public.staff(id),
  assignment_status text NOT NULL DEFAULT 'approved'
    CHECK (assignment_status = ANY (ARRAY['pending_sm_approval'::text, 'approved'::text, 'disputed'::text])),
  is_primary boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.admin_users(id),
  sourced_by text CHECK (sourced_by = ANY (ARRAY['eyad'::text, 'sm'::text, 'sr'::text])),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One primary assignment per teacher (partial unique, mirrors one_primary_per_center).
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_per_teacher
  ON public.teacher_assignments (teacher_id) WHERE (is_primary = true);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_staff_id
  ON public.teacher_assignments (staff_id) WHERE (staff_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_manager_staff_id
  ON public.teacher_assignments (manager_staff_id) WHERE (manager_staff_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_status
  ON public.teacher_assignments (assignment_status);

-- Service-role only, exactly like trial_claims: only the internal admin routes (which
-- use the service-role client) read/write this table. No RLS policies are added, and
-- anon/authenticated get no table privileges.
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_assignments FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
