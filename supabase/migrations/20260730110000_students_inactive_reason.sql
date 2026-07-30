-- ============================================================================
-- `students.inactive_reason` — why a student is inactive, not just that it is
--
-- Eyad's decision, 30 July 2026. D24 (design/BUILD-AFTER-REDESIGN.md) found
-- `is_active=false` already carries FOUR distinct live meanings before this
-- migration: pending signup, rejected signup, staff-paused, and privacy/GDPR
-- anonymization. `pending_enrollments` cannot reliably disambiguate them at
-- query time (verified: approval never clears the enrollment row, rejection
-- never touches the student row, and anonymized/staff-added students never
-- had a `pending_enrollments` row to begin with).
--
-- `'paused'` IS included in the CHECK below so the enum is complete and honest
-- about what the column can hold. NOTHING in this migration or the paired code
-- changes writes it. There is no live UI trigger for a staff-pause feature
-- today (the one endpoint that could set it has zero confirmed callers) and
-- none is being built here. If a pause feature is ever wanted, that is a
-- decision, not a schema afterthought — do not read this constraint value as
-- proof the feature exists.
--
-- SAFE TO ADD
-- -----------
--   * Nullable, no default write required for existing rows: all 4 live
--     students are `is_active=true`, so `inactive_reason` stays NULL for all
--     of them under the paired code changes (which only ever set it alongside
--     `is_active=false`).
--   * No existing reader of `students` selects `*` in a way this would break;
--     it is purely additive.
-- ============================================================================

BEGIN;

ALTER TABLE public.students
  ADD COLUMN inactive_reason text NULL DEFAULT NULL;

ALTER TABLE public.students
  ADD CONSTRAINT students_inactive_reason_check
  CHECK (inactive_reason IS NULL OR inactive_reason IN
    ('pending_signup', 'rejected', 'paused', 'anonymized'));

COMMENT ON COLUMN public.students.inactive_reason IS
  'Why is_active=false, when it is false. NULL whenever is_active=true. '
  '''paused'' is a valid value with NO live writer today — no staff-pause '
  'feature is wired to any route (see BUILD-AFTER-REDESIGN.md D24). Building '
  'one is a decision, not implied by this column existing.';

-- Approval must clear the reason directly on `students` so the discriminator
-- lives on one table and stops depending on `pending_enrollments` staying in
-- sync (it does not: approval never touches it, so a stale 'pending' row
-- there is not evidence of anything past the moment of signup).
-- Every other line of this function is byte-identical to the live definition,
-- confirmed via pg_get_functiondef before writing this migration.
CREATE OR REPLACE FUNCTION public.approve_student_rpc(
  p_student_id uuid,
  p_center_id uuid,
  p_group_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_approved_by uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_student           RECORD;
  v_center            RECORD;
  v_new_student_count INTEGER;
  v_month_key         TEXT;
  v_group_id          UUID;
BEGIN
  SELECT * INTO v_student
  FROM students
  WHERE id = p_student_id
    AND center_id = p_center_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_student.is_active = true THEN
    RAISE EXCEPTION 'student_already_active' USING ERRCODE = 'P0002';
  END IF;

  UPDATE students
  SET is_active = true,
      inactive_reason = NULL
  WHERE id = p_student_id;

  IF array_length(p_group_ids, 1) > 0 THEN
    FOREACH v_group_id IN ARRAY p_group_ids
    LOOP
      INSERT INTO student_group_members (student_id, group_id)
      SELECT p_student_id, v_group_id
      WHERE EXISTS (
        SELECT 1 FROM student_groups
        WHERE id = v_group_id AND center_id = p_center_id
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  v_month_key := to_char(NOW(), 'YYYY-MM');

  INSERT INTO parent_pack_monthly_counts (
    center_id, billing_period, student_id, parent_phone
  )
  SELECT
    p_center_id,
    v_month_key,
    s.id,
    s.parent_phone
  FROM students s
  WHERE s.center_id = p_center_id
    AND s.is_active = true
    AND s.parent_phone IS NOT NULL
    AND s.parent_phone != ''
  ON CONFLICT DO NOTHING;

  SELECT COUNT(*) INTO v_new_student_count
  FROM students
  WHERE center_id = p_center_id AND is_active = true;

  INSERT INTO center_metrics_daily (
    center_id, metric_date, students_active, last_upserted_at
  )
  VALUES (
    p_center_id, CURRENT_DATE, v_new_student_count, NOW()
  )
  ON CONFLICT (center_id, metric_date) DO UPDATE SET
    students_active  = EXCLUDED.students_active,
    last_upserted_at = NOW();

  RETURN jsonb_build_object(
    'success',            true,
    'student_id',         p_student_id,
    'new_student_count',  v_new_student_count
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$;

COMMIT;
