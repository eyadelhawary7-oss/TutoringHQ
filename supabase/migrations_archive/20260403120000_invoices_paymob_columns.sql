-- invoices_paymob_columns: Paymob checkout fields on invoices

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS paymob_order_id TEXT,
  ADD COLUMN IF NOT EXISTS paymob_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS paymob_iframe_url TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_paymob_order
  ON invoices (paymob_order_id)
  WHERE paymob_order_id IS NOT NULL;

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
        'announcement_cap'
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
      'pending', 'paid', 'overdue', 'cancelled', 'approved', 'rejected', 'failed'
    ));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
