-- Subscription renewal reminder system
-- Centers: subscription dates, billing period, monthly fee, status
-- renewal_history: payment records
-- renewal_reminders_sent: dedup per center/stage/month
-- pg_cron daily 7am UTC → process-renewals Edge Function

-- 1. Add subscription columns to centers
ALTER TABLE centers ADD COLUMN IF NOT EXISTS subscription_start_date DATE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS subscription_renewal_date DATE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS subscription_billing_period TEXT
  CHECK (subscription_billing_period IN ('monthly', 'quarterly', 'biannual', 'yearly')) DEFAULT 'quarterly';
ALTER TABLE centers ADD COLUMN IF NOT EXISTS subscription_monthly_fee NUMERIC DEFAULT 0;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS subscription_status TEXT
  CHECK (subscription_status IN ('active', 'overdue', 'suspended', 'cancelled')) DEFAULT 'active';

-- Backfill: use existing billing fields if subscription columns are null
UPDATE centers
SET
  subscription_start_date = COALESCE(subscription_start_date, billing_cycle_start, current_period_start, created_at::date),
  subscription_renewal_date = COALESCE(subscription_renewal_date, next_billing_date, next_payment_due, payment_due_date),
  subscription_monthly_fee = COALESCE(subscription_monthly_fee, early_adopter_price, billing_amount / 3, 0),
  subscription_billing_period = COALESCE(subscription_billing_period, billing_period, 'quarterly')
WHERE subscription_start_date IS NULL OR subscription_renewal_date IS NULL;

-- Map half_yearly/semi_annual to biannual for subscription_billing_period
UPDATE centers
SET subscription_billing_period = 'biannual'
WHERE subscription_billing_period IN ('half_yearly', 'semi_annual');

-- 2. renewal_history: payment records for subscription renewals
CREATE TABLE IF NOT EXISTS renewal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  renewal_date DATE NOT NULL,
  amount_paid NUMERIC NOT NULL,
  payment_method TEXT,
  recorded_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renewal_history_center ON renewal_history(center_id);
CREATE INDEX IF NOT EXISTS idx_renewal_history_renewal_date ON renewal_history(renewal_date DESC);

ALTER TABLE renewal_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "renewal_history_admin_only" ON renewal_history;
CREATE POLICY "renewal_history_admin_only" ON renewal_history FOR ALL USING (false);

-- 3. renewal_reminders_sent: dedup per center/stage/month (sent_month = date_trunc('month', sent_at))
CREATE TABLE IF NOT EXISTS renewal_reminders_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_month DATE NOT NULL DEFAULT (date_trunc('month', now())::date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_reminders_dedup
  ON renewal_reminders_sent (center_id, stage, sent_month);
CREATE INDEX IF NOT EXISTS idx_renewal_reminders_center ON renewal_reminders_sent(center_id);
CREATE INDEX IF NOT EXISTS idx_renewal_reminders_sent_at ON renewal_reminders_sent(sent_at DESC);

ALTER TABLE renewal_reminders_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "renewal_reminders_admin_only" ON renewal_reminders_sent;
CREATE POLICY "renewal_reminders_admin_only" ON renewal_reminders_sent FOR ALL USING (false);

-- 4. pg_cron: daily 7am UTC → process-renewals Edge Function
-- SELECT cron.schedule(
--   'process-renewals',
--   '0 7 * * *',
--   $$ SELECT net.http_post(
--        url := 'https://<project>.supabase.co/functions/v1/process-renewals',
--        headers := '{"Authorization": "Bearer <anon_key>"}'::jsonb,
--        body := '{}'::jsonb
--      ) $$
-- );

COMMENT ON TABLE renewal_history IS 'Subscription renewal payment records';
COMMENT ON TABLE renewal_reminders_sent IS 'Dedup: one reminder per center/stage per calendar month';
