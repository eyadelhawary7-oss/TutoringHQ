-- Fix generate_invoice_number: invoices no longer expose NEW.period_start (column was
-- renamed/superseded). Prefix month is derived from invoice creation time (Africa/Cairo).
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  month_prefix TEXT;
  next_num INT;
  ref_ts TIMESTAMPTZ;
BEGIN
  ref_ts := COALESCE(NEW.created_at, NOW());
  month_prefix := 'INV-' || TO_CHAR(timezone('Africa/Cairo', ref_ts), 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM LENGTH(month_prefix) + 2) AS INT)), 0) + 1
  INTO next_num
  FROM invoices
  WHERE invoice_number LIKE month_prefix || '-%';
  NEW.invoice_number := month_prefix || '-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

COMMENT ON FUNCTION generate_invoice_number() IS
  'Assigns INV-YYYY-MM-### using NEW.created_at (Cairo calendar month).';
