-- Academic year management: Egyptian centers run Sep-Jun cycles
-- academic_years, academic_periods, holidays, summer_mode

-- 1. academic_years
CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_center_current
  ON academic_years (center_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_academic_years_center ON academic_years(center_id);

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academic_years_select" ON academic_years;
CREATE POLICY "academic_years_select" ON academic_years FOR SELECT
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "academic_years_insert" ON academic_years;
CREATE POLICY "academic_years_insert" ON academic_years FOR INSERT
  WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "academic_years_update" ON academic_years;
CREATE POLICY "academic_years_update" ON academic_years FOR UPDATE
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "academic_years_delete" ON academic_years;
CREATE POLICY "academic_years_delete" ON academic_years FOR DELETE
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- 2. academic_periods
CREATE TABLE IF NOT EXISTS academic_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('exam', 'holiday', 'peak', 'normal')),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  attendance_context TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academic_periods_year ON academic_periods(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_academic_periods_center ON academic_periods(center_id);
CREATE INDEX IF NOT EXISTS idx_academic_periods_dates ON academic_periods(center_id, start_date, end_date);

ALTER TABLE academic_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academic_periods_select" ON academic_periods;
CREATE POLICY "academic_periods_select" ON academic_periods FOR SELECT
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "academic_periods_insert" ON academic_periods;
CREATE POLICY "academic_periods_insert" ON academic_periods FOR INSERT
  WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "academic_periods_update" ON academic_periods;
CREATE POLICY "academic_periods_update" ON academic_periods FOR UPDATE
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "academic_periods_delete" ON academic_periods;
CREATE POLICY "academic_periods_delete" ON academic_periods FOR DELETE
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- 3. holidays
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holidays_center ON holidays(center_id);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(center_id, date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "holidays_select" ON holidays;
CREATE POLICY "holidays_select" ON holidays FOR SELECT
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "holidays_insert" ON holidays;
CREATE POLICY "holidays_insert" ON holidays FOR INSERT
  WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "holidays_update" ON holidays;
CREATE POLICY "holidays_update" ON holidays FOR UPDATE
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "holidays_delete" ON holidays;
CREATE POLICY "holidays_delete" ON holidays FOR DELETE
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- 4. summer_mode on centers
ALTER TABLE centers ADD COLUMN IF NOT EXISTS summer_mode BOOLEAN DEFAULT false;

-- 5. Pre-populate Egyptian national holidays 2026-2027 for existing centers
INSERT INTO holidays (center_id, name, date, is_recurring)
SELECT c.id, h.nm, h.dt::date, h.is_rec
FROM centers c
CROSS JOIN (VALUES
  ('عيد الميلاد المجيد'::text, '2026-01-07'::text, false),
  ('ثورة 25 يناير'::text, '2026-01-25'::text, false),
  ('عيد الفطر (تقريبي)'::text, '2026-03-20'::text, false),
  ('عيد تحرير سيناء'::text, '2026-04-25'::text, false),
  ('عيد العمال'::text, '2026-05-01'::text, false),
  ('عيد الأضحى (تقريبي)'::text, '2026-05-26'::text, false),
  ('ثورة 30 يونيو'::text, '2026-06-30'::text, false),
  ('عيد الثورة'::text, '2026-07-23'::text, false),
  ('المولد النبوي (تقريبي)'::text, '2026-08-26'::text, false),
  ('عيد القوات المسلحة'::text, '2026-10-06'::text, false),
  ('عيد الميلاد المجيد'::text, '2027-01-07'::text, false),
  ('ثورة 25 يناير'::text, '2027-01-25'::text, false),
  ('عيد الفطر (تقريبي)'::text, '2027-03-09'::text, false),
  ('عيد تحرير سيناء'::text, '2027-04-25'::text, false),
  ('عيد العمال'::text, '2027-05-01'::text, false),
  ('عيد الأضحى (تقريبي)'::text, '2027-05-15'::text, false),
  ('ثورة 30 يونيو'::text, '2027-06-30'::text, false),
  ('عيد الثورة'::text, '2027-07-23'::text, false),
  ('المولد النبوي (تقريبي)'::text, '2027-08-15'::text, false),
  ('عيد القوات المسلحة'::text, '2027-10-06'::text, false)
) AS h(nm, dt, is_rec);

COMMENT ON TABLE academic_years IS 'Egyptian academic years: Sep-Jun cycles';
COMMENT ON TABLE academic_periods IS 'Exam, holiday, peak, normal periods within a year';
COMMENT ON TABLE holidays IS 'Center-specific holidays (national + custom)';
COMMENT ON COLUMN centers.summer_mode IS 'When true, renewal reminders include note about new academic year pricing';
