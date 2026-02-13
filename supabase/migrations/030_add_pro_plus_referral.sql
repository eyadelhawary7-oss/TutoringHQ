-- Add pro_plus to referral reward trigger fee calculation
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
      WHEN 'starter' THEN 4000
      WHEN 'pro' THEN 7200
      WHEN 'pro_plus' THEN 8000
      WHEN 'enterprise' THEN 9000
      ELSE 4000
    END;
  END IF;
  INSERT INTO referral_rewards (referring_center_id, referred_center_id, referred_center_plan, first_month_fee, reward_amount, reward_status)
  VALUES (NEW.referred_by, NEW.id, COALESCE(NEW.plan, 'starter'), fee, fee * 0.20, 'approved')
  ON CONFLICT (referring_center_id, referred_center_id) DO UPDATE SET reward_status = 'approved', reward_amount = EXCLUDED.reward_amount;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
