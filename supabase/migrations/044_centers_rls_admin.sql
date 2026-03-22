-- RLS policies for centers table
-- NOTE: Admin API routes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- These policies apply to direct Supabase client access (anon key) only.

ALTER TABLE centers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view all centers" ON centers;
DROP POLICY IF EXISTS "Users can view own center" ON centers;

-- Super admins and internal admins: view all centers (when using anon key)
CREATE POLICY "Admin can view all centers" ON centers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
      AND au.role IN ('super_admin', 'admin', 'internal_admin', 'internal_viewer')
    )
  );

-- Regular users: view only their own center
CREATE POLICY "Users can view own center" ON centers
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT center_id FROM users WHERE id = auth.uid() AND center_id IS NOT NULL
    )
  );
