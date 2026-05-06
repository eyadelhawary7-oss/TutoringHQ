-- Private bucket for generated invoice PDFs (path: invoices/{center_id}/{invoice_id}.pdf)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-pdfs',
  'invoice-pdfs',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- Service role: full access for server-side upload/backup
DROP POLICY IF EXISTS "invoice_pdfs_service_role_all" ON storage.objects;
CREATE POLICY "invoice_pdfs_service_role_all"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'invoice-pdfs')
  WITH CHECK (bucket_id = 'invoice-pdfs');

-- Authenticated: read only files under invoices/{center_id}/ where center_id matches the user's center
-- Path layout invoices/{center_id}/{file}.pdf → center_id is (storage.foldername(name))[2]; [1] is "invoices".
DROP POLICY IF EXISTS "invoice_pdfs_authenticated_select_own_center" ON storage.objects;
CREATE POLICY "invoice_pdfs_authenticated_select_own_center"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoice-pdfs'
    AND (storage.foldername(name))[1] = 'invoices'
    AND (storage.foldername(name))[2]::text IN (
      SELECT u.center_id::text
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.center_id IS NOT NULL
    )
  );
