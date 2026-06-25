-- Session D: pack_billing invoice type, parent pack opt-out, suspension, pricing column

ALTER TABLE parent_pack_monthly_counts
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_pack_request_status_check;
  ALTER TABLE centers ADD CONSTRAINT centers_pack_request_status_check
    CHECK (pack_request_status IN ('none', 'pending', 'approved', 'rejected', 'suspended'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS pack_disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pack_price_per_parent NUMERIC NOT NULL DEFAULT 12;

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
        'plan_upgrade_difference',
        'pack_billing'
      ));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
