-- New pricing model: pricing_plans (fixed plans) and payg_rates (pay-as-you-go tiers)
-- Add pricing_type and weekly_student_limit to centers

-- 1. Create pricing_plans table
CREATE TABLE IF NOT EXISTS pricing_plans (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  students_per_week_limit INTEGER NOT NULL,
  monthly_fee_egp NUMERIC NOT NULL,
  per_student_at_capacity_egp NUMERIC NOT NULL,
  setup_fee_egp NUMERIC NOT NULL,
  is_custom BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

-- 2. Seed fixed plans (starter, pro, enterprise, top_centers)
INSERT INTO pricing_plans (id, name_en, name_ar, students_per_week_limit, monthly_fee_egp, per_student_at_capacity_egp, setup_fee_egp, is_custom, sort_order)
VALUES
  ('starter', 'Starter', 'أساسي', 200, 4000, 5, 2500, false, 1),
  ('pro', 'Pro', 'محترف', 600, 7200, 3, 5000, false, 2),
  ('enterprise', 'Enterprise', 'مؤسسات', 1500, 9000, 1.5, 10000, false, 3),
  ('top_centers', 'Top Centers', 'كبار السناتر', 1500, 0, 0, 0, true, 4)
ON CONFLICT (id) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_ar = EXCLUDED.name_ar,
  students_per_week_limit = EXCLUDED.students_per_week_limit,
  monthly_fee_egp = EXCLUDED.monthly_fee_egp,
  per_student_at_capacity_egp = EXCLUDED.per_student_at_capacity_egp,
  setup_fee_egp = EXCLUDED.setup_fee_egp,
  is_custom = EXCLUDED.is_custom,
  sort_order = EXCLUDED.sort_order;

-- 3. Create payg_rates table
CREATE TABLE IF NOT EXISTS payg_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_students_per_week INTEGER NOT NULL,
  max_students_per_week INTEGER NOT NULL,
  rate_per_student_egp NUMERIC NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE (min_students_per_week, max_students_per_week)
);

-- 4. Seed PAYG tiers: 0-200=6, 201-600=3.75, 601-1500=2, 1501+=1.25
INSERT INTO payg_rates (min_students_per_week, max_students_per_week, rate_per_student_egp, sort_order)
VALUES
  (0, 200, 6, 1),
  (201, 600, 3.75, 2),
  (601, 1500, 2, 3),
  (1501, 10000, 1.25, 4)
ON CONFLICT (min_students_per_week, max_students_per_week) DO UPDATE SET
  rate_per_student_egp = EXCLUDED.rate_per_student_egp,
  sort_order = EXCLUDED.sort_order;

-- 5. Add pricing_type and weekly_student_limit to centers
ALTER TABLE centers ADD COLUMN IF NOT EXISTS pricing_type TEXT DEFAULT 'fixed' CHECK (pricing_type IN ('fixed', 'payg'));
ALTER TABLE centers ADD COLUMN IF NOT EXISTS weekly_student_limit INTEGER;

-- 6. Sync weekly_student_limit from max_students for existing centers (approximate: max_students was weekly capacity)
UPDATE centers SET weekly_student_limit = COALESCE(max_students, 200) WHERE weekly_student_limit IS NULL;
UPDATE centers SET pricing_type = 'fixed' WHERE pricing_type IS NULL;

-- 7. Update center limits trigger to support top_centers plan
CREATE OR REPLACE FUNCTION update_center_limits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    NEW.max_teachers := CASE
      WHEN NEW.plan = 'starter' THEN 8
      WHEN NEW.plan = 'pro' THEN 20
      WHEN NEW.plan = 'enterprise' THEN 50
      WHEN NEW.plan = 'top_centers' THEN 100
      ELSE 8
    END;
    NEW.max_students := CASE
      WHEN NEW.plan = 'starter' THEN 200
      WHEN NEW.plan = 'pro' THEN 600
      WHEN NEW.plan = 'enterprise' THEN 999999
      WHEN NEW.plan = 'top_centers' THEN 999999
      ELSE 200
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
