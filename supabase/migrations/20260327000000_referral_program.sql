-- Referral program: reward rules (Month 1: 25% held; Months 2-12: 10%; Month 13+: 5%)
-- referral_reward_records: monthly reward tracking (separate from legacy referral_rewards)
-- payout_requests: withdrawal requests
-- pg_cron 1st of month → calculate-rewards Edge Function

-- 1. Ensure referral_code on centers (8-char uppercase alphanumeric)
ALTER TABLE centers ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

CREATE OR REPLACE FUNCTION generate_referral_code_8char()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INT;
BEGIN
  IF NEW.referral_code IS NULL OR LENGTH(TRIM(NEW.referral_code)) != 8 THEN
    FOR i IN 1..8 LOOP
      result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    NEW.referral_code := result;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_referral_code ON centers;
CREATE TRIGGER set_referral_code
  BEFORE INSERT ON centers
  FOR EACH ROW
  WHEN (NEW.referral_code IS NULL OR LENGTH(COALESCE(TRIM(NEW.referral_code), '')) != 8)
  EXECUTE FUNCTION generate_referral_code_8char();

-- 2. Update referrals: status (pending/converted/active/inactive)
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_status_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_status_check
  CHECK (status IN ('pending', 'converted', 'active', 'inactive'));

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_first_paid_at TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

-- 3. referral_reward_records: monthly rewards (Month 1: 25%, 2-12: 10%, 13+: 5%)
CREATE TABLE IF NOT EXISTS referral_reward_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  referrer_center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  referred_center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  month_number INT NOT NULL,
  reward_percentage NUMERIC NOT NULL,
  base_amount NUMERIC NOT NULL,
  reward_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'available', 'paid')),
  held_until TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  period_month TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_reward_records_unique
  ON referral_reward_records (referral_id, period_month);
CREATE INDEX IF NOT EXISTS idx_referral_reward_records_referrer ON referral_reward_records(referrer_center_id);
CREATE INDEX IF NOT EXISTS idx_referral_reward_records_status ON referral_reward_records(status);

ALTER TABLE referral_reward_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "referral_reward_records_select" ON referral_reward_records;
CREATE POLICY "referral_reward_records_select" ON referral_reward_records FOR SELECT
  USING (referrer_center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- 4. payout_requests
CREATE TABLE IF NOT EXISTS payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  amount_requested NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  payment_method TEXT,
  payment_details JSONB,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_center ON payout_requests(center_id);

ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payout_requests_select" ON payout_requests;
CREATE POLICY "payout_requests_select" ON payout_requests FOR SELECT
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- pg_cron: 1st of month → calculate-rewards Edge Function
-- SELECT cron.schedule(
--   'calculate-rewards',
--   '0 6 1 * *',
--   $$ SELECT net.http_post(...) $$
-- );

COMMENT ON TABLE referral_reward_records IS 'Monthly referral rewards: Month 1: 25% held; 2-12: 10%; 13+: 5%';
COMMENT ON TABLE payout_requests IS 'Referral payout withdrawal requests';
