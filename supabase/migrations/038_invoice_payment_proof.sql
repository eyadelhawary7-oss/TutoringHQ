-- Allow payment_proof invoice type and ensure required columns exist
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_amount NUMERIC;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_start DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_end DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type TEXT;

-- Expand invoice_type check to include payment_proof (for schemas that have it)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='invoice_type') THEN
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
    ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_type_check
      CHECK (invoice_type IN ('base_subscription', 'whatsapp_addon', 'setup_fee', 'payment_proof'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Make invoice_number nullable for payment proof inserts (if it exists and is NOT NULL)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='invoice_number') THEN
    ALTER TABLE invoices ALTER COLUMN invoice_number DROP NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Expand status check to include approved/rejected for payment proof workflow
DO $$
BEGIN
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_check;
  ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled', 'approved', 'rejected'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add INSERT policy for invoices (centers can insert their own)
DROP POLICY IF EXISTS "Centers insert own invoices" ON invoices;
CREATE POLICY "Centers insert own invoices" ON invoices FOR INSERT
  WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
