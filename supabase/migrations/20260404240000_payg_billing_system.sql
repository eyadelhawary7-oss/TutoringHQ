-- PAYG: per-student rates on pricing_plans, center switch scheduling, invoice metadata
ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS payg_rate_per_student NUMERIC;

UPDATE pricing_plans SET payg_rate_per_student = 27.50 WHERE plan_key = 'nano';
UPDATE pricing_plans SET payg_rate_per_student = 22.88 WHERE plan_key = 'starter';
UPDATE pricing_plans SET payg_rate_per_student = 20.24 WHERE plan_key = 'pro';
UPDATE pricing_plans SET payg_rate_per_student = 16.50 WHERE plan_key = 'business';
UPDATE pricing_plans SET payg_rate_per_student = 11.72 WHERE plan_key = 'enterprise';

ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS payg_pending_switch TEXT
    CHECK (payg_pending_switch IS NULL OR payg_pending_switch IN ('to_payg', 'from_payg')),
  ADD COLUMN IF NOT EXISTS payg_switch_effective_date DATE,
  ADD COLUMN IF NOT EXISTS payg_pending_target_period TEXT
    CHECK (
      payg_pending_target_period IS NULL
      OR payg_pending_target_period IN ('monthly', 'quarterly', 'annual')
    );

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS metadata JSONB;
