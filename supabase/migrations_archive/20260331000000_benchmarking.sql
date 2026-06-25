-- Center benchmarking: anonymized aggregates by district + tier
-- PRIVACY: never expose center_id, minimum 10 centers per district/tier

-- 1. Add district, governorate, student_count_tier to centers
ALTER TABLE centers ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS governorate TEXT DEFAULT 'cairo';

-- student_count_tier: computed from active student count (small <150, medium 150-500, large 500+)
-- Use trigger to keep it updated (generated columns can't reference other tables)
CREATE OR REPLACE FUNCTION compute_student_count_tier()
RETURNS TRIGGER AS $$
DECLARE
  cid UUID;
  cnt INTEGER;
  tier TEXT;
BEGIN
  cid := COALESCE(NEW.center_id, OLD.center_id);
  IF cid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COUNT(*)::INTEGER INTO cnt
  FROM students
  WHERE center_id = cid
    AND (is_active IS NULL OR is_active = true);
  IF cnt < 150 THEN tier := 'small';
  ELSIF cnt <= 500 THEN tier := 'medium';
  ELSE tier := 'large';
  END IF;
  UPDATE centers SET student_count_tier = tier WHERE id = cid;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Add column if not exists
ALTER TABLE centers ADD COLUMN IF NOT EXISTS student_count_tier TEXT;

-- Trigger on students changes (insert/update/delete) - recalc tier for affected center
DROP TRIGGER IF EXISTS trg_compute_student_count_tier ON students;
CREATE TRIGGER trg_compute_student_count_tier
  AFTER INSERT OR UPDATE OR DELETE ON students
  FOR EACH ROW
  EXECUTE FUNCTION compute_student_count_tier();

-- Backfill tiers for existing centers
UPDATE centers c
SET student_count_tier = CASE
  WHEN (SELECT COUNT(*) FROM students s WHERE s.center_id = c.id AND (s.is_active IS NULL OR s.is_active = true)) < 150 THEN 'small'
  WHEN (SELECT COUNT(*) FROM students s WHERE s.center_id = c.id AND (s.is_active IS NULL OR s.is_active = true)) <= 500 THEN 'medium'
  ELSE 'large'
END
WHERE c.student_count_tier IS NULL;

COMMENT ON COLUMN centers.district IS 'District for benchmarking: nasr_city, maadi, dokki, heliopolis, new_cairo, etc.';
COMMENT ON COLUMN centers.governorate IS 'Governorate, default cairo';
COMMENT ON COLUMN centers.student_count_tier IS 'Computed: small <150, medium 150-500, large 500+';

-- 2. Create benchmark_snapshots (aggregates only, never raw center data)
CREATE TABLE IF NOT EXISTS benchmark_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  district TEXT NOT NULL,
  student_count_tier TEXT NOT NULL,
  center_count INTEGER NOT NULL,
  avg_attendance_rate NUMERIC,
  p25_attendance_rate NUMERIC,
  p50_attendance_rate NUMERIC,
  p75_attendance_rate NUMERIC,
  avg_revenue_per_student NUMERIC,
  p25_revenue_per_student NUMERIC,
  p50_revenue_per_student NUMERIC,
  p75_revenue_per_student NUMERIC,
  avg_retention_rate_30d NUMERIC,
  p25_retention_rate_30d NUMERIC,
  p50_retention_rate_30d NUMERIC,
  p75_retention_rate_30d NUMERIC,
  avg_group_utilization NUMERIC,
  p25_group_utilization NUMERIC,
  p50_group_utilization NUMERIC,
  p75_group_utilization NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(snapshot_date, district, student_count_tier)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_lookup ON benchmark_snapshots(snapshot_date DESC, district, student_count_tier);

-- Add percentile columns if table existed from earlier migration
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p25_revenue_per_student NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p50_revenue_per_student NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p75_revenue_per_student NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p25_retention_rate_30d NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p50_retention_rate_30d NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p75_retention_rate_30d NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p25_group_utilization NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p50_group_utilization NUMERIC;
ALTER TABLE benchmark_snapshots ADD COLUMN IF NOT EXISTS p75_group_utilization NUMERIC;

COMMENT ON TABLE benchmark_snapshots IS 'Anonymized benchmark aggregates by district+tier. Never stores center_id.';

-- 3. Function: compute and upsert benchmark snapshots (called by Edge Function)
CREATE OR REPLACE FUNCTION compute_benchmark_snapshots(p_snapshot_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows_affected INTEGER := 0;
BEGIN
  -- Per-center metrics for active centers with district and tier
  WITH center_metrics AS (
    SELECT
      c.id,
      c.district,
      COALESCE(c.student_count_tier, 'medium') AS tier,
      -- attendance_rate: unique students scanned last 30d / total active students
      CASE
        WHEN sc.total_students > 0 THEN
          LEAST(1.0, (sc.unique_scanned_30d::NUMERIC / sc.total_students))
        ELSE NULL
      END AS attendance_rate,
      -- revenue_per_student: confirmed payments last 30d / total students
      CASE
        WHEN sc.total_students > 0 AND rev.revenue_30d IS NOT NULL THEN
          rev.revenue_30d / sc.total_students
        ELSE NULL
      END AS revenue_per_student,
      -- retention_rate_30d: students active 30d ago still active / students active 30d ago
      ret.retention_rate AS retention_rate_30d,
      -- group_utilization: students in groups / total students (or 0 if no groups)
      CASE
        WHEN sc.total_students > 0 AND grp.students_in_groups IS NOT NULL THEN
          LEAST(1.0, grp.students_in_groups::NUMERIC / sc.total_students)
        WHEN sc.total_students = 0 THEN 0
        ELSE NULL
      END AS group_utilization
    FROM centers c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT s.id)::INTEGER AS total_students,
        (SELECT COUNT(DISTINCT a.student_id) FROM attendance_scans a
         WHERE a.center_id = c.id AND a.scanned_at >= (p_snapshot_date - interval '30 days'))::INTEGER AS unique_scanned_30d
      FROM students s
      WHERE s.center_id = c.id AND (s.is_active IS NULL OR s.is_active = true)
    ) sc ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(p.amount), 0) AS revenue_30d
      FROM payments p
      WHERE p.center_id = c.id
        AND p.paid_at >= (p_snapshot_date - interval '30 days')
        AND (p.status IN ('confirmed', 'paid') OR p.confirmed = true)
    ) rev ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN active_30d_ago > 0 THEN still_active::NUMERIC / active_30d_ago
          ELSE NULL
        END AS retention_rate
      FROM (
        SELECT
          (SELECT COUNT(DISTINCT student_id) FROM attendance_scans
           WHERE center_id = c.id AND scanned_at >= (p_snapshot_date - interval '37 days')
             AND scanned_at < (p_snapshot_date - interval '30 days'))::INTEGER AS active_30d_ago,
          (SELECT COUNT(DISTINCT a.student_id) FROM attendance_scans a
           WHERE a.center_id = c.id
             AND a.scanned_at >= (p_snapshot_date - interval '7 days')
             AND EXISTS (
               SELECT 1 FROM attendance_scans a2
               WHERE a2.center_id = c.id AND a2.student_id = a.student_id
                 AND a2.scanned_at >= (p_snapshot_date - interval '37 days')
                 AND a2.scanned_at < (p_snapshot_date - interval '30 days')
             ))::INTEGER AS still_active
      ) sub
    ) ret ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT sgm.student_id)::INTEGER AS students_in_groups
      FROM student_group_members sgm
      JOIN student_groups sg ON sg.id = sgm.group_id AND sg.center_id = c.id
    ) grp ON true
    WHERE c.status = 'active'
      AND c.district IS NOT NULL
      AND c.district != ''
  ),
  grouped AS (
    SELECT
      district,
      tier,
      COUNT(*)::INTEGER AS center_count,
      AVG(attendance_rate) AS avg_attendance_rate,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY attendance_rate) AS p25_attendance_rate,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY attendance_rate) AS p50_attendance_rate,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY attendance_rate) AS p75_attendance_rate,
      AVG(revenue_per_student) AS avg_revenue_per_student,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY revenue_per_student) AS p25_revenue,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY revenue_per_student) AS p50_revenue,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY revenue_per_student) AS p75_revenue,
      AVG(retention_rate_30d) AS avg_retention_rate_30d,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY retention_rate_30d) AS p25_retention,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY retention_rate_30d) AS p50_retention,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY retention_rate_30d) AS p75_retention,
      AVG(group_utilization) AS avg_group_utilization,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY group_utilization) AS p25_util,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY group_utilization) AS p50_util,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY group_utilization) AS p75_util
    FROM center_metrics
    WHERE district IS NOT NULL
    GROUP BY district, tier
  )
  INSERT INTO benchmark_snapshots (
    snapshot_date, district, student_count_tier, center_count,
    avg_attendance_rate, p25_attendance_rate, p50_attendance_rate, p75_attendance_rate,
    avg_revenue_per_student, p25_revenue_per_student, p50_revenue_per_student, p75_revenue_per_student,
    avg_retention_rate_30d, p25_retention_rate_30d, p50_retention_rate_30d, p75_retention_rate_30d,
    avg_group_utilization, p25_group_utilization, p50_group_utilization, p75_group_utilization
  )
  SELECT
    p_snapshot_date, district, tier, center_count,
    ROUND(avg_attendance_rate::NUMERIC, 4),
    ROUND(p25_attendance_rate::NUMERIC, 4),
    ROUND(p50_attendance_rate::NUMERIC, 4),
    ROUND(p75_attendance_rate::NUMERIC, 4),
    ROUND(avg_revenue_per_student::NUMERIC, 2),
    ROUND(p25_revenue::NUMERIC, 2),
    ROUND(p50_revenue::NUMERIC, 2),
    ROUND(p75_revenue::NUMERIC, 2),
    ROUND(avg_retention_rate_30d::NUMERIC, 4),
    ROUND(p25_retention::NUMERIC, 4),
    ROUND(p50_retention::NUMERIC, 4),
    ROUND(p75_retention::NUMERIC, 4),
    ROUND(avg_group_utilization::NUMERIC, 4),
    ROUND(p25_util::NUMERIC, 4),
    ROUND(p50_util::NUMERIC, 4),
    ROUND(p75_util::NUMERIC, 4)
  FROM grouped
  ON CONFLICT (snapshot_date, district, student_count_tier)
  DO UPDATE SET
    center_count = EXCLUDED.center_count,
    avg_attendance_rate = EXCLUDED.avg_attendance_rate,
    p25_attendance_rate = EXCLUDED.p25_attendance_rate,
    p50_attendance_rate = EXCLUDED.p50_attendance_rate,
    p75_attendance_rate = EXCLUDED.p75_attendance_rate,
    avg_revenue_per_student = EXCLUDED.avg_revenue_per_student,
    p25_revenue_per_student = EXCLUDED.p25_revenue_per_student,
    p50_revenue_per_student = EXCLUDED.p50_revenue_per_student,
    p75_revenue_per_student = EXCLUDED.p75_revenue_per_student,
    avg_retention_rate_30d = EXCLUDED.avg_retention_rate_30d,
    p25_retention_rate_30d = EXCLUDED.p25_retention_rate_30d,
    p50_retention_rate_30d = EXCLUDED.p50_retention_rate_30d,
    p75_retention_rate_30d = EXCLUDED.p75_retention_rate_30d,
    avg_group_utilization = EXCLUDED.avg_group_utilization,
    p25_group_utilization = EXCLUDED.p25_group_utilization,
    p50_group_utilization = EXCLUDED.p50_group_utilization,
    p75_group_utilization = EXCLUDED.p75_group_utilization;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected;
END;
$$;

-- 4. get_center_benchmarks(p_center_id) RETURNS jsonb
CREATE OR REPLACE FUNCTION get_center_benchmarks(p_center_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district TEXT;
  v_tier TEXT;
  v_center_count INT;
  v_snapshot RECORD;
  v_attendance_rate NUMERIC;
  v_revenue_per_student NUMERIC;
  v_retention_rate NUMERIC;
  v_group_utilization NUMERIC;
  v_attendance_pct NUMERIC;
  v_revenue_pct NUMERIC;
  v_retention_pct NUMERIC;
  v_util_pct NUMERIC;
  v_total_students INT;
  v_revenue_30d NUMERIC;
  v_active_30d_ago INT;
  v_still_active INT;
  v_students_in_groups INT;
BEGIN
  -- Get center's district and tier
  SELECT district, COALESCE(student_count_tier, 'medium')
  INTO v_district, v_tier
  FROM centers
  WHERE id = p_center_id AND status = 'active';

  IF v_district IS NULL OR v_district = '' THEN
    RETURN jsonb_build_object('insufficient_data', true, 'centers_needed', 10, 'reason', 'no_district');
  END IF;

  -- Latest snapshot for this district+tier
  SELECT bs.* INTO v_snapshot
  FROM benchmark_snapshots bs
  WHERE bs.district = v_district AND bs.student_count_tier = v_tier
  ORDER BY bs.snapshot_date DESC
  LIMIT 1;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('insufficient_data', true, 'centers_needed', 10);
  END IF;

  v_center_count := v_snapshot.center_count;
  IF v_center_count < 10 THEN
    RETURN jsonb_build_object('insufficient_data', true, 'centers_needed', 10 - v_center_count);
  END IF;

  -- Compute this center's metrics (same logic as compute_benchmark_snapshots)
  SELECT COUNT(*)::INT INTO v_total_students
  FROM students WHERE center_id = p_center_id AND (is_active IS NULL OR is_active = true);

  SELECT COALESCE(SUM(amount), 0) INTO v_revenue_30d
  FROM payments
  WHERE center_id = p_center_id
    AND paid_at >= (CURRENT_DATE - interval '30 days')
    AND (status IN ('confirmed', 'paid') OR confirmed = true);

  SELECT COUNT(DISTINCT student_id) INTO v_active_30d_ago
  FROM attendance_scans
  WHERE center_id = p_center_id
    AND scanned_at >= (CURRENT_DATE - interval '37 days')
    AND scanned_at < (CURRENT_DATE - interval '30 days');

  SELECT COUNT(DISTINCT a.student_id) INTO v_still_active
  FROM attendance_scans a
  WHERE a.center_id = p_center_id AND a.scanned_at >= (CURRENT_DATE - interval '7 days')
    AND EXISTS (
      SELECT 1 FROM attendance_scans a2
      WHERE a2.center_id = p_center_id AND a2.student_id = a.student_id
        AND a2.scanned_at >= (CURRENT_DATE - interval '37 days')
        AND a2.scanned_at < (CURRENT_DATE - interval '30 days')
    );

  SELECT COUNT(DISTINCT sgm.student_id) INTO v_students_in_groups
  FROM student_group_members sgm
  JOIN student_groups sg ON sg.id = sgm.group_id AND sg.center_id = p_center_id;

  v_attendance_rate := CASE WHEN v_total_students > 0 THEN
    LEAST(1.0, (SELECT COUNT(DISTINCT student_id) FROM attendance_scans
      WHERE center_id = p_center_id AND scanned_at >= (CURRENT_DATE - interval '30 days'))::NUMERIC / v_total_students)
  ELSE NULL END;

  v_revenue_per_student := CASE WHEN v_total_students > 0 THEN v_revenue_30d / v_total_students ELSE NULL END;
  v_retention_rate := CASE WHEN v_active_30d_ago > 0 THEN v_still_active::NUMERIC / v_active_30d_ago ELSE NULL END;
  v_group_utilization := CASE WHEN v_total_students > 0 AND v_students_in_groups IS NOT NULL THEN
    LEAST(1.0, v_students_in_groups::NUMERIC / v_total_students) ELSE NULL END;

  -- Percentile rank: linear interpolation between p25/p50/p75
  v_attendance_pct := CASE
    WHEN v_attendance_rate IS NULL THEN 50
    WHEN v_snapshot.p25_attendance_rate IS NULL THEN 50
    WHEN v_attendance_rate <= v_snapshot.p25_attendance_rate THEN LEAST(100, GREATEST(0, 25 * v_attendance_rate / NULLIF(v_snapshot.p25_attendance_rate, 0)))
    WHEN v_attendance_rate <= v_snapshot.p50_attendance_rate THEN 25 + 25 * (v_attendance_rate - v_snapshot.p25_attendance_rate) / NULLIF(v_snapshot.p50_attendance_rate - v_snapshot.p25_attendance_rate, 0)
    WHEN v_attendance_rate <= v_snapshot.p75_attendance_rate THEN 50 + 25 * (v_attendance_rate - v_snapshot.p50_attendance_rate) / NULLIF(v_snapshot.p75_attendance_rate - v_snapshot.p50_attendance_rate, 0)
    ELSE 75 + 25 * (v_attendance_rate - v_snapshot.p75_attendance_rate) / NULLIF(GREATEST(1 - v_snapshot.p75_attendance_rate, 0.01), 0)
  END;
  v_attendance_pct := LEAST(100, GREATEST(0, v_attendance_pct));

  v_revenue_pct := CASE
    WHEN v_revenue_per_student IS NULL OR v_snapshot.p25_revenue_per_student IS NULL THEN 50
    WHEN v_revenue_per_student <= v_snapshot.p25_revenue_per_student THEN LEAST(100, GREATEST(0, 25 * v_revenue_per_student / NULLIF(v_snapshot.p25_revenue_per_student, 0)))
    WHEN v_revenue_per_student <= v_snapshot.p50_revenue_per_student THEN 25 + 25 * (v_revenue_per_student - v_snapshot.p25_revenue_per_student) / NULLIF(v_snapshot.p50_revenue_per_student - v_snapshot.p25_revenue_per_student, 0)
    WHEN v_revenue_per_student <= v_snapshot.p75_revenue_per_student THEN 50 + 25 * (v_revenue_per_student - v_snapshot.p50_revenue_per_student) / NULLIF(v_snapshot.p75_revenue_per_student - v_snapshot.p50_revenue_per_student, 0)
    ELSE 75 + 25 * LEAST(1.0, (v_revenue_per_student - v_snapshot.p75_revenue_per_student) / NULLIF(v_snapshot.p75_revenue_per_student - v_snapshot.p50_revenue_per_student, 0))
  END;
  v_revenue_pct := LEAST(100, GREATEST(0, COALESCE(v_revenue_pct, 50)));

  v_retention_pct := CASE
    WHEN v_retention_rate IS NULL OR v_snapshot.p25_retention_rate_30d IS NULL THEN 50
    WHEN v_retention_rate <= v_snapshot.p25_retention_rate_30d THEN LEAST(100, GREATEST(0, 25 * v_retention_rate / NULLIF(v_snapshot.p25_retention_rate_30d, 0)))
    WHEN v_retention_rate <= v_snapshot.p50_retention_rate_30d THEN 25 + 25 * (v_retention_rate - v_snapshot.p25_retention_rate_30d) / NULLIF(v_snapshot.p50_retention_rate_30d - v_snapshot.p25_retention_rate_30d, 0)
    WHEN v_retention_rate <= v_snapshot.p75_retention_rate_30d THEN 50 + 25 * (v_retention_rate - v_snapshot.p50_retention_rate_30d) / NULLIF(v_snapshot.p75_retention_rate_30d - v_snapshot.p50_retention_rate_30d, 0)
    ELSE 75 + 25 * (v_retention_rate - v_snapshot.p75_retention_rate_30d) / NULLIF(GREATEST(1 - v_snapshot.p75_retention_rate_30d, 0.01), 0)
  END;
  v_retention_pct := LEAST(100, GREATEST(0, COALESCE(v_retention_pct, 50)));

  v_util_pct := CASE
    WHEN v_group_utilization IS NULL OR v_snapshot.p25_group_utilization IS NULL THEN 50
    WHEN v_group_utilization <= v_snapshot.p25_group_utilization THEN LEAST(100, GREATEST(0, 25 * v_group_utilization / NULLIF(v_snapshot.p25_group_utilization, 0)))
    WHEN v_group_utilization <= v_snapshot.p50_group_utilization THEN 25 + 25 * (v_group_utilization - v_snapshot.p25_group_utilization) / NULLIF(v_snapshot.p50_group_utilization - v_snapshot.p25_group_utilization, 0)
    WHEN v_group_utilization <= v_snapshot.p75_group_utilization THEN 50 + 25 * (v_group_utilization - v_snapshot.p50_group_utilization) / NULLIF(v_snapshot.p75_group_utilization - v_snapshot.p50_group_utilization, 0)
    ELSE 75 + 25 * (v_group_utilization - v_snapshot.p75_group_utilization) / NULLIF(GREATEST(1 - v_snapshot.p75_group_utilization, 0.01), 0)
  END;
  v_util_pct := LEAST(100, GREATEST(0, COALESCE(v_util_pct, 50)));

  RETURN jsonb_build_object(
    'insufficient_data', false,
    'district', v_district,
    'tier', v_tier,
    'center_count', v_center_count,
    'snapshot_date', v_snapshot.snapshot_date,
    'attendance', jsonb_build_object(
      'your_value', ROUND(COALESCE(v_attendance_rate, 0)::NUMERIC, 4),
      'district_avg', v_snapshot.avg_attendance_rate,
      'percentile', ROUND(v_attendance_pct::NUMERIC, 1)
    ),
    'revenue_per_student', jsonb_build_object(
      'your_value', ROUND(COALESCE(v_revenue_per_student, 0)::NUMERIC, 2),
      'district_avg', v_snapshot.avg_revenue_per_student,
      'percentile', ROUND(v_revenue_pct::NUMERIC, 1)
    ),
    'retention_30d', jsonb_build_object(
      'your_value', ROUND(COALESCE(v_retention_rate, 0)::NUMERIC, 4),
      'district_avg', v_snapshot.avg_retention_rate_30d,
      'percentile', ROUND(v_retention_pct::NUMERIC, 1)
    ),
    'group_utilization', jsonb_build_object(
      'your_value', ROUND(COALESCE(v_group_utilization, 0)::NUMERIC, 4),
      'district_avg', v_snapshot.avg_group_utilization,
      'percentile', ROUND(v_util_pct::NUMERIC, 1)
    )
  );
END;
$$;

-- RLS: benchmark_snapshots is read-only for authenticated (via get_center_benchmarks)
ALTER TABLE benchmark_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "benchmark_snapshots_read_via_rpc" ON benchmark_snapshots;
CREATE POLICY "benchmark_snapshots_read_via_rpc" ON benchmark_snapshots FOR SELECT
  TO authenticated USING (true);

-- pg_cron: 1am UTC daily → compute-benchmarks Edge Function
-- Note: Replace <project_ref> and <anon_key> with actual values when deploying
-- SELECT cron.schedule(
--   'compute-benchmarks',
--   '0 1 * * *',
--   $$ SELECT net.http_post(
--        url := 'https://<project_ref>.supabase.co/functions/v1/compute-benchmarks',
--        headers := '{"Authorization": "Bearer <anon_key>", "Content-Type": "application/json"}'::jsonb,
--        body := '{}'::jsonb
--      ) $$
-- );
