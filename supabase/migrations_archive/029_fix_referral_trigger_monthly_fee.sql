-- Fix create_referral_reward trigger to use monthly_fee (after 026 rename)
CREATE OR REPLACE FUNCTION create_referral_reward()
RETURNS TRIGGER AS $$
DECLARE
  fee NUMERIC;
BEGIN
  IF NEW.referred_by IS NOT NULL AND COALESCE(NEW.subscription_status, 'active') = 'active' THEN
    SELECT monthly_fee INTO fee FROM pricing_plans WHERE id = COALESCE(NEW.plan, 'starter');
    IF fee IS NULL OR fee <= 0 THEN
      fee := CASE COALESCE(NEW.plan, 'starter')
        WHEN 'starter' THEN 4000
        WHEN 'pro' THEN 7200
        WHEN 'enterprise' THEN 9000
        ELSE 4000
      END;
    END IF;
    INSERT INTO referral_rewards (referring_center_id, referred_center_id, referred_center_plan, first_month_fee, reward_amount)
    VALUES (NEW.referred_by, NEW.id, COALESCE(NEW.plan, 'starter'), fee, fee * 0.20)
    ON CONFLICT (referring_center_id, referred_center_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
