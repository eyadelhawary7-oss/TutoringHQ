-- demo_requests: marketing-website lead intake, surfaced in /admin/demo-requests
--
-- Schema derived from the two routes that read/write this table:
--   src/app/api/demo-request/route.ts        — public POST insert (no auth)
--     fields: name, phone, email, center_name, status='pending'
--   src/app/api/admin/demo-requests/route.ts — admin GET/PATCH/DELETE
--     GET:    select('*').order('created_at', desc)
--     PATCH:  updates one of {status, notes, assigned_to, handled_at, handled_by}, .eq('id', id)
--     DELETE: .eq('id', id)
--
-- An earlier migration (003_super_admin_tables.sql) attempted to create this
-- table but is missing the handler columns (assigned_to, handled_at, handled_by)
-- and was never applied to production (PostgREST reported "Could not find the
-- table 'public.demo_requests' in the schema cache"). This migration is
-- idempotent: it creates the table if absent and adds any missing columns
-- otherwise, so it converges both states onto the full schema.

CREATE TABLE IF NOT EXISTS demo_requests (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT         NOT NULL,
  phone        TEXT         NOT NULL,
  email        TEXT,
  center_name  TEXT,
  status       TEXT         NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'contacted', 'approved', 'rejected')),
  notes        TEXT,
  assigned_to  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at   TIMESTAMPTZ,
  handled_by   UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Idempotent: add handler columns if 003 created a partial table without them.
ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS handled_at  TIMESTAMPTZ;
ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS handled_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS notes       TEXT;

CREATE INDEX IF NOT EXISTS idx_demo_requests_status     ON demo_requests(status);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at ON demo_requests(created_at DESC);

-- updated_at auto-bump on every UPDATE.
CREATE OR REPLACE FUNCTION set_demo_requests_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_demo_requests_updated_at ON demo_requests;
CREATE TRIGGER trg_demo_requests_updated_at
  BEFORE UPDATE ON demo_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_demo_requests_updated_at();

-- RLS. All write paths in code go through SUPABASE_SERVICE_ROLE_KEY (which
-- bypasses RLS), so these policies only constrain the anon/authenticated
-- keys. Pattern mirrors supabase/migrations/044_centers_rls_admin.sql.
ALTER TABLE demo_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view demo requests" ON demo_requests;
DROP POLICY IF EXISTS "Admin can update demo requests" ON demo_requests;
DROP POLICY IF EXISTS "Admin can delete demo requests" ON demo_requests;
DROP POLICY IF EXISTS "Service role inserts demo requests" ON demo_requests;

-- Internal admins read demo requests via anon-key clients (none in production
-- today; admin routes use service role). Kept for parity with centers RLS.
CREATE POLICY "Admin can view demo requests" ON demo_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND au.role IN ('super_admin', 'admin', 'internal_admin', 'internal_viewer')
    )
  );

CREATE POLICY "Admin can update demo requests" ON demo_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND au.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND au.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Admin can delete demo requests" ON demo_requests
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND au.role IN ('super_admin', 'admin')
    )
  );

-- The public POST /api/demo-request handler uses the service role key, so it
-- bypasses RLS. We intentionally do NOT add an anon/authenticated INSERT
-- policy here — leads must funnel through that server route (which validates
-- payload size and shape) and never come straight from a browser.
