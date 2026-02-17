-- CenterHQ 5-tier pricing: starter, pro, business, enterprise, top_centers
-- Remove pro_plus, add business, update limits and fees

-- 1. Add team_members_limit to pricing_plans if not exists
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS team_members_limit INTEGER;

-- 2. Migrate pro_plus centers to business (similar capacity: 1000 students)
UPDATE centers SET plan = 'business' WHERE plan = 'pro_plus';

-- 3. Remove pro_plus from pricing_plans, add business, update all plans
DELETE FROM pricing_plans WHERE id = 'pro_plus';

-- Use COALESCE for monthly_fee column (may be renamed from monthly_fee_egp per migration 026)
INSERT INTO pricing_plans (id, name_en, name_ar, students_per_week_limit, monthly_fee, per_student_at_capacity_egp, setup_fee_egp, is_custom, sort_order, team_members_limit)
VALUES
  ('starter', 'Starter', 'أساسي', 150, 2000, 13.33, 1000, false, 1, 2),
  ('pro', 'Pro', 'محترف', 500, 4500, 9, 2000, false, 2, 5),
  ('business', 'Business', 'أعمال', 1000, 6500, 6.5, 3000, false, 3, 10),
  ('enterprise', 'Enterprise', 'مؤسسات', 2000, 9000, 4.5, 5000, false, 4, 20),
  ('top_centers', 'Top Centers', 'كبار السناتر', 999999, 0, 0, 0, true, 5, 999)
ON CONFLICT (id) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_ar = EXCLUDED.name_ar,
  students_per_week_limit = EXCLUDED.students_per_week_limit,
  monthly_fee = EXCLUDED.monthly_fee,
  per_student_at_capacity_egp = EXCLUDED.per_student_at_capacity_egp,
  setup_fee_egp = EXCLUDED.setup_fee_egp,
  is_custom = EXCLUDED.is_custom,
  sort_order = EXCLUDED.sort_order,
  team_members_limit = EXCLUDED.team_members_limit;

-- 4. Update PAYG rates: 0-150=4, 151-500=3, 501-1000=2.50, 1001-2000=2, 2001+=1.75
DELETE FROM payg_rates;
INSERT INTO payg_rates (min_students_per_week, max_students_per_week, rate_per_student_egp, sort_order)
VALUES
  (0, 150, 4, 1),
  (151, 500, 3, 2),
  (501, 1000, 2.50, 3),
  (1001, 2000, 2, 4),
  (2001, 10000, 1.75, 5);

-- 5. Update center limits trigger: max_teachers (team members) and max_students (weekly)
CREATE OR REPLACE FUNCTION update_center_limits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    NEW.max_teachers := CASE
      WHEN NEW.plan = 'starter' THEN 2
      WHEN NEW.plan = 'pro' THEN 5
      WHEN NEW.plan = 'business' THEN 10
      WHEN NEW.plan = 'enterprise' THEN 20
      WHEN NEW.plan = 'top_centers' THEN 999
      ELSE 2
    END;
    NEW.max_students := CASE
      WHEN NEW.plan = 'starter' THEN 150
      WHEN NEW.plan = 'pro' THEN 500
      WHEN NEW.plan = 'business' THEN 1000
      WHEN NEW.plan = 'enterprise' THEN 2000
      WHEN NEW.plan = 'top_centers' THEN 999999
      ELSE 150
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Sync existing centers' limits
UPDATE centers SET
  max_teachers = CASE
    WHEN plan = 'starter' THEN 2
    WHEN plan = 'pro' THEN 5
    WHEN plan = 'business' THEN 10
    WHEN plan = 'enterprise' THEN 20
    WHEN plan = 'top_centers' THEN 999
    ELSE 2
  END,
  max_students = CASE
    WHEN plan = 'starter' THEN 150
    WHEN plan = 'pro' THEN 500
    WHEN plan = 'business' THEN 1000
    WHEN plan = 'enterprise' THEN 2000
    WHEN plan = 'top_centers' THEN 999999
    ELSE 150
  END
WHERE plan IN ('starter','pro','business','enterprise','top_centers');

-- 7. Update referral reward trigger with new plan fees
CREATE OR REPLACE FUNCTION create_referral_reward()
RETURNS TRIGGER AS $$
DECLARE
  fee NUMERIC;
BEGIN
  IF NEW.referred_by IS NULL OR COALESCE(NEW.subscription_status, 'active') != 'active' THEN
    RETURN NEW;
  END IF;
  SELECT monthly_fee INTO fee FROM pricing_plans WHERE id = COALESCE(NEW.plan, 'starter');
  IF fee IS NULL OR fee <= 0 THEN
    fee := CASE COALESCE(NEW.plan, 'starter')
      WHEN 'starter' THEN 2000
      WHEN 'pro' THEN 4500
      WHEN 'business' THEN 6500
      WHEN 'enterprise' THEN 9000
      ELSE 2000
    END;
  END IF;
  INSERT INTO referral_rewards (referring_center_id, referred_center_id, referred_center_plan, first_month_fee, reward_amount, reward_status)
  VALUES (NEW.referred_by, NEW.id, COALESCE(NEW.plan, 'starter'), fee, fee * 0.40, 'approved')
  ON CONFLICT (referring_center_id, referred_center_id) DO UPDATE SET reward_status = 'approved', reward_amount = EXCLUDED.reward_amount;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
