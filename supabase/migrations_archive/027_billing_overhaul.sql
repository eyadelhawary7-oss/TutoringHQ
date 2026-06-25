-- Billing overhaul: centers billing_type, pending changes, invoices
ALTER TABLE centers ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'fixed'
  CHECK (billing_type IN ('fixed', 'payg'));
ALTER TABLE centers ADD COLUMN IF NOT EXISTS pending_plan_change TEXT;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS pending_billing_type TEXT;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS current_period_start DATE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS current_period_end DATE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS last_payment_date DATE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS instapay_reference TEXT;

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID REFERENCES centers(id) NOT NULL,
  invoice_number TEXT UNIQUE,
  billing_type TEXT NOT NULL,
  plan TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_checkins INT DEFAULT 0,
  weekly_average NUMERIC DEFAULT 0,
  subtotal NUMERIC NOT NULL,
  referral_discount NUMERIC DEFAULT 0,
  total_amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  payment_method TEXT,
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  due_date DATE NOT NULL,
  CONSTRAINT valid_period CHECK (period_end > period_start)
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Centers view own invoices" ON invoices;
CREATE POLICY "Centers view own invoices" ON invoices FOR SELECT
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_invoices_center ON invoices(center_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  month_prefix TEXT;
  next_num INT;
BEGIN
  month_prefix := 'INV-' || TO_CHAR(NEW.period_start, 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM LENGTH(month_prefix) + 2) AS INT)), 0) + 1
  INTO next_num
  FROM invoices
  WHERE invoice_number LIKE month_prefix || '-%';
  NEW.invoice_number := month_prefix || '-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS set_invoice_number ON invoices;
CREATE TRIGGER set_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW
  WHEN (NEW.invoice_number IS NULL)
  EXECUTE FUNCTION generate_invoice_number();
