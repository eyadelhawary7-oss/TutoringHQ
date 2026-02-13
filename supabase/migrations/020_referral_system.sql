-- Referral system: centers get unique code, 20% reward when referred center subscribes
ALTER TABLE centers ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES centers(id);
ALTER TABLE centers ADD COLUMN IF NOT EXISTS referral_code_used_at TIMESTAMPTZ;

-- Generate unique referral codes for existing centers
UPDATE centers SET referral_code = UPPER(SUBSTRING(MD5(id::text || COALESCE(created_at::text, NOW()::text)) FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- Referral rewards tracking
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referring_center_id UUID REFERENCES centers(id) NOT NULL,
  referred_center_id UUID REFERENCES centers(id) NOT NULL,
  referred_center_plan TEXT NOT NULL,
  first_month_fee NUMERIC NOT NULL,
  reward_amount NUMERIC NOT NULL,
  reward_status TEXT DEFAULT 'pending' CHECK (reward_status IN ('pending', 'paid', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  UNIQUE (referring_center_id, referred_center_id)
);

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Centers view own referral rewards" ON referral_rewards;
CREATE POLICY "Centers view own referral rewards" ON referral_rewards FOR SELECT
  USING (referring_center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- Trigger: auto-generate referral code on center creation
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTRING(MD5(NEW.id::text || NOW()::text) FROM 1 FOR 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_referral_code ON centers;
CREATE TRIGGER set_referral_code
  BEFORE INSERT ON centers
  FOR EACH ROW
  WHEN (NEW.referral_code IS NULL)
  EXECUTE FUNCTION generate_referral_code();

-- Trigger: create reward when referred center is created/activated (INSERT or UPDATE)
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

-- For INSERT: fire when center is created with referred_by
DROP TRIGGER IF EXISTS on_center_insert_referral ON centers;
CREATE TRIGGER on_center_insert_referral
  AFTER INSERT ON centers
  FOR EACH ROW
  WHEN (NEW.referred_by IS NOT NULL)
  EXECUTE FUNCTION create_referral_reward();

-- For UPDATE: fire when subscription_status becomes active
DROP TRIGGER IF EXISTS on_center_subscribe_referral ON centers;
CREATE TRIGGER on_center_subscribe_referral
  AFTER UPDATE ON centers
  FOR EACH ROW
  WHEN (NEW.referred_by IS NOT NULL
    AND NEW.subscription_status = 'active'
    AND (OLD.subscription_status IS NULL OR OLD.subscription_status != 'active'))
  EXECUTE FUNCTION create_referral_reward();
