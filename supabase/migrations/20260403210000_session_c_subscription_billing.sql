-- Session C: subscription billing loop — constraints, blacklist, plan upgrade, chargeback

-- Centers: billing_status may include suspended; blacklist columns; optional center_code
ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_billing_status_check;
ALTER TABLE centers ADD CONSTRAINT centers_billing_status_check
  CHECK (billing_status IN ('active', 'paid', 'overdue', 'due_soon', 'suspended'));

ALTER TABLE centers ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMPTZ;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS center_code TEXT;

-- pricing_plans: quarterly all-in (plan_key = id in this schema)
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS all_in_price NUMERIC;

UPDATE pricing_plans SET all_in_price = 1500 WHERE id = 'nano' AND all_in_price IS NULL;
UPDATE pricing_plans SET all_in_price = 3000 WHERE id = 'starter' AND all_in_price IS NULL;
UPDATE pricing_plans SET all_in_price = 5500 WHERE id = 'pro' AND all_in_price IS NULL;
UPDATE pricing_plans SET all_in_price = 9000 WHERE id = 'business' AND all_in_price IS NULL;
UPDATE pricing_plans SET all_in_price = 12500 WHERE id = 'enterprise' AND all_in_price IS NULL;
-- top_centers / payg: leave all_in_price NULL → custom pricing path in app

-- plan_requests: pending_downgrade, pending_payment
ALTER TABLE plan_requests DROP CONSTRAINT IF EXISTS plan_requests_status_check;
ALTER TABLE plan_requests ADD CONSTRAINT plan_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'pending_downgrade', 'pending_payment'));

-- invoices: plan_upgrade_difference, chargeback status
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'invoice_type'
  ) THEN
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
        'plan_upgrade_difference'
      ));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_check;
  ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN (
      'pending', 'paid', 'overdue', 'cancelled', 'approved', 'rejected', 'failed', 'chargeback'
    ));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
