-- Late fee invoices, dormancy, active_months_count, platform_config tuning keys

ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS dormancy_date DATE,
  ADD COLUMN IF NOT EXISTS active_months_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dormancy_purged_at TIMESTAMPTZ;

ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_status_check;
ALTER TABLE centers ADD CONSTRAINT centers_status_check
  CHECK (status IN (
    'pending',
    'pending_verification',
    'pending_payment',
    'paid_pending_activation',
    'active',
    'suspended',
    'dormant',
    'rejected',
    'deleted',
    'cancelled',
    'pending_cancellation'
  ));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN (
    'base_subscription',
    'subscription',
    'whatsapp_addon',
    'setup_fee',
    'payment_proof',
    'announcement_settlement',
    'announcement_cap',
    'plan_upgrade_difference',
    'pack_billing',
    'signup_first_payment',
    'late_fee'
  ));

-- Cron/system rows may omit user_id
ALTER TABLE audit_log ALTER COLUMN user_id DROP NOT NULL;

INSERT INTO platform_config (key, value) VALUES
  ('late_fee_grace_days', '3'::jsonb),
  ('late_fee_tier1_trigger_day', '4'::jsonb),
  ('late_fee_tier2_trigger_day', '9'::jsonb),
  ('dormancy_trigger_day', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;
