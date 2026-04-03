-- Billing system schema: grace period, credits, combined payments, withdrawals, upgrade log, reactivation.
-- Applied to production via Supabase MCP (project lczmjpnbuhnsislcvzar); keep in sync for local/CI.

-- update_grace_period_to_6_days
ALTER TABLE centers
  ALTER COLUMN auto_suspend_at
  SET DEFAULT (CURRENT_DATE + INTERVAL '6 days')::date;

UPDATE centers
SET auto_suspend_at = (next_payment_due + 6)::date
WHERE status IN ('active', 'pending')
  AND billing_status NOT IN ('suspended')
  AND next_payment_due IS NOT NULL;

-- add_instapay_number_to_centers
ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS instapay_number TEXT;

-- create_credit_ledger
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earned','spent','expired','withdrawn','fee')),
  reference_id UUID,
  reference_type TEXT CHECK (reference_type IN (
    'downgrade','invoice','subscription','withdrawal','expiry'
  )),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_center_id ON credit_ledger(center_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_expires_at ON credit_ledger(expires_at);

ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS credit_balance NUMERIC NOT NULL DEFAULT 0;

-- create_combined_payment_sessions
CREATE TABLE IF NOT EXISTS combined_payment_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  paymob_order_id TEXT UNIQUE,
  invoice_ids UUID[] NOT NULL DEFAULT '{}',
  credit_amount NUMERIC NOT NULL DEFAULT 0,
  paymob_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','expired')),
  session_type TEXT NOT NULL
    CHECK (session_type IN (
      'reactivation_tier1','reactivation_tier2',
      'signup','upgrade','pack','cards'
    )),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 hours')
);

CREATE INDEX IF NOT EXISTS idx_combined_payment_sessions_center
  ON combined_payment_sessions(center_id);
CREATE INDEX IF NOT EXISTS idx_combined_payment_sessions_order
  ON combined_payment_sessions(paymob_order_id);

-- create_withdrawal_requests
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  credits_deducted NUMERIC NOT NULL,
  cash_amount NUMERIC NOT NULL,
  fee_amount NUMERIC NOT NULL,
  instapay_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','rejected')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES admin_users(id),
  notes TEXT
);

-- create_upgrade_log
CREATE TABLE IF NOT EXISTS upgrade_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  previous_plan TEXT NOT NULL,
  new_plan TEXT NOT NULL,
  previous_period TEXT NOT NULL,
  new_period TEXT NOT NULL,
  days_remaining INTEGER NOT NULL,
  daily_rate_difference NUMERIC NOT NULL,
  amount_charged NUMERIC NOT NULL,
  paymob_order_id TEXT,
  billing_anchor_unchanged DATE NOT NULL,
  upgrade_count_this_cycle INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS upgrade_count_this_period INTEGER NOT NULL DEFAULT 0;

-- add_reactivation_tracking
ALTER TABLE centers ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS reactivation_tier TEXT
  CHECK (reactivation_tier IN ('tier1','tier2','tier3'));
ALTER TABLE centers ADD COLUMN IF NOT EXISTS reactivation_fee_amount NUMERIC DEFAULT 0;

UPDATE centers
SET suspended_at = blacklisted_at
WHERE status = 'suspended'
  AND blacklisted_at IS NOT NULL
  AND suspended_at IS NULL;
