-- Advanced student intelligence: lifecycle, families, notes, waitlist
-- Idempotent migration

-- 1. Add lifecycle and waitlist columns to students
ALTER TABLE students ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'enrolled'
  CHECK (lifecycle_status IN ('enrolled', 'active', 'at_risk', 'inactive', 'churned'));
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_status_change TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS at_risk_since TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS waitlist_position INTEGER;

CREATE INDEX IF NOT EXISTS idx_students_lifecycle ON students(center_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_students_at_risk ON students(center_id, at_risk_since) WHERE lifecycle_status = 'at_risk';

-- 2. Create families table (before students.sibling_family_id FK)
CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  family_name TEXT,
  parent_phone TEXT,
  parent_name TEXT,
  parent_consent_given BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_families_center ON families(center_id);

ALTER TABLE families ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "families_center_access" ON families;
CREATE POLICY "families_center_access" ON families FOR ALL
  TO authenticated
  USING (
    center_id IN (
      SELECT center_id FROM users WHERE id = auth.uid() AND center_id IS NOT NULL
    )
    OR center_id IN (
      SELECT c.id FROM centers c
      JOIN users u ON u.organization_id = c.organization_id
      WHERE u.id = auth.uid() AND c.organization_id IS NOT NULL
    )
  );

-- 3. Add sibling_family_id to students (after families exists)
ALTER TABLE students ADD COLUMN IF NOT EXISTS sibling_family_id UUID REFERENCES families(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_students_sibling_family ON students(sibling_family_id) WHERE sibling_family_id IS NOT NULL;

-- 4. Add max_capacity to student_groups for waitlist
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS max_capacity INTEGER;

-- 5. Add waitlist_group_id to students (FK to student_groups)
ALTER TABLE students ADD COLUMN IF NOT EXISTS waitlist_group_id UUID REFERENCES student_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_students_waitlist_group ON students(waitlist_group_id) WHERE waitlist_group_id IS NOT NULL;

-- 6. Create student_notes table
CREATE TABLE IF NOT EXISTS student_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  is_private BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id);
CREATE INDEX IF NOT EXISTS idx_student_notes_center ON student_notes(center_id);

ALTER TABLE student_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "student_notes_center_access" ON student_notes;
CREATE POLICY "student_notes_center_access" ON student_notes FOR ALL
  TO authenticated
  USING (
    center_id IN (
      SELECT center_id FROM users WHERE id = auth.uid() AND center_id IS NOT NULL
    )
    OR center_id IN (
      SELECT c.id FROM centers c
      JOIN users u ON u.organization_id = c.organization_id
      WHERE u.id = auth.uid() AND c.organization_id IS NOT NULL
    )
  );

-- 7. Create waitlist_notifications table
CREATE TABLE IF NOT EXISTS waitlist_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  response TEXT CHECK (response IN ('yes', 'no', 'pending'))
);

CREATE INDEX IF NOT EXISTS idx_waitlist_notifications_group ON waitlist_notifications(group_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_notifications_student ON waitlist_notifications(student_id);

ALTER TABLE waitlist_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waitlist_notifications_center_access" ON waitlist_notifications;
CREATE POLICY "waitlist_notifications_center_access" ON waitlist_notifications FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM student_groups sg
      JOIN users u ON u.center_id = sg.center_id
      WHERE sg.id = waitlist_notifications.group_id AND u.id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM student_groups sg
      JOIN centers c ON c.id = sg.center_id
      JOIN users u ON u.organization_id = c.organization_id
      WHERE sg.id = waitlist_notifications.group_id AND u.id = auth.uid()
    )
  );

-- 8. Function: recalculate lifecycle_status for a student
CREATE OR REPLACE FUNCTION recalc_student_lifecycle(p_student_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_center_id UUID;
  v_last_scan TIMESTAMPTZ;
  v_scans_14d INT;
  v_expected_14d INT;
  v_rate NUMERIC;
  v_new_status TEXT;
  v_old_status TEXT;
  v_at_risk_since TIMESTAMPTZ;
BEGIN
  SELECT center_id, lifecycle_status, at_risk_since INTO v_center_id, v_old_status, v_at_risk_since
  FROM students WHERE id = p_student_id;
  IF v_center_id IS NULL THEN RETURN; END IF;

  -- Last scan
  SELECT MAX(scanned_at) INTO v_last_scan
  FROM attendance_scans WHERE student_id = p_student_id AND center_id = v_center_id;

  -- No scan in 30 days → inactive
  IF v_last_scan IS NULL OR v_last_scan < (now() - interval '30 days') THEN
    v_new_status := 'inactive';
    IF v_old_status IS DISTINCT FROM v_new_status THEN
      UPDATE students SET lifecycle_status = v_new_status, last_status_change = now(), at_risk_since = NULL
      WHERE id = p_student_id;
    END IF;
    RETURN;
  END IF;

  -- Scans in last 14 days vs expected (approx 2 sessions/week per group)
  SELECT COUNT(*) INTO v_scans_14d
  FROM attendance_scans
  WHERE student_id = p_student_id AND center_id = v_center_id
    AND scanned_at >= (now() - interval '14 days');

  SELECT COALESCE(SUM(2), 0) INTO v_expected_14d
  FROM student_group_members sgm
  JOIN student_groups sg ON sg.id = sgm.group_id AND sg.center_id = v_center_id
  WHERE sgm.student_id = p_student_id;

  v_expected_14d := GREATEST(v_expected_14d, 1);
  v_rate := (v_scans_14d::NUMERIC / v_expected_14d) * 100;

  -- Below 60% for 14 days → at_risk
  IF v_rate < 60 THEN
    v_new_status := 'at_risk';
    IF v_old_status IS DISTINCT FROM v_new_status THEN
      UPDATE students SET
        lifecycle_status = v_new_status,
        last_status_change = now(),
        at_risk_since = COALESCE(at_risk_since, now())
      WHERE id = p_student_id;
    ELSIF v_old_status = 'at_risk' AND v_at_risk_since IS NULL THEN
      UPDATE students SET at_risk_since = now() WHERE id = p_student_id;
    END IF;
    RETURN;
  END IF;

  -- Above 70% → active
  IF v_rate >= 70 THEN
    v_new_status := 'active';
    IF v_old_status IN ('at_risk', 'enrolled') AND v_old_status IS DISTINCT FROM v_new_status THEN
      UPDATE students SET lifecycle_status = v_new_status, last_status_change = now(), at_risk_since = NULL
      WHERE id = p_student_id;
    END IF;
    RETURN;
  END IF;

  -- Between 60-70%: keep current (at_risk stays, active stays)
  NULL;
END;
$$;

-- 9. Function: recalculate all students (for pg_cron)
CREATE OR REPLACE FUNCTION recalc_all_lifecycle_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM students LOOP
    PERFORM recalc_student_lifecycle(r.id);
  END LOOP;
END;
$$;

-- 10. pg_cron: 3am Cairo (1am UTC) daily
-- SELECT cron.schedule(
--   'recalc-lifecycle-daily',
--   '0 1 * * *',
--   $$ SELECT recalc_all_lifecycle_status() $$
-- );

-- 11. Trigger: on attendance_scans INSERT, recalc for that student
CREATE OR REPLACE FUNCTION trigger_recalc_lifecycle_on_scan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM recalc_student_lifecycle(NEW.student_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_lifecycle_on_scan ON attendance_scans;
CREATE TRIGGER trg_recalc_lifecycle_on_scan
  AFTER INSERT ON attendance_scans
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_lifecycle_on_scan();

-- 12. Backfill: set enrolled for students with no lifecycle_status
UPDATE students SET lifecycle_status = 'enrolled' WHERE lifecycle_status IS NULL;

COMMENT ON TABLE families IS 'Sibling families: parent contact shared across linked students';
COMMENT ON TABLE student_notes IS 'Internal notes on students, optionally private';
COMMENT ON TABLE waitlist_notifications IS 'WA notifications sent to waitlist parents when spot opens';

-- Register chq_reenrollment template for re-enrollment campaigns
INSERT INTO wa_meta_templates (template_name, category, variables_count, status)
VALUES ('chq_reenrollment', 'marketing', 2, 'APPROVED')
ON CONFLICT (template_name) DO UPDATE SET
  category = EXCLUDED.category,
  variables_count = EXCLUDED.variables_count,
  updated_at = now();
