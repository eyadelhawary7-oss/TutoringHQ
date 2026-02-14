-- Invoices RLS: Allow centers to update their own invoices (payment proof submission)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Centers view own invoices" ON invoices;
DROP POLICY IF EXISTS "invoices_select" ON invoices;

CREATE POLICY "Centers view own invoices" ON invoices FOR SELECT
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Centers update own invoices" ON invoices FOR UPDATE
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()))
  WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- Storage: Allow authenticated users to upload to payment-proofs (path format: centerId/timestamp_filename)
CREATE POLICY "Users upload payment proofs" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs');
