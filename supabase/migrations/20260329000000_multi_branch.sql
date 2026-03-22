-- Multi-branch architecture: organizations, backward-compatible migration
-- Every existing center becomes org with 1 branch. No data deleted.

-- 1. organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  plan TEXT NOT NULL DEFAULT 'single' CHECK (plan IN ('single', 'multi'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own org" ON organizations;
CREATE POLICY "Users can view own org" ON organizations FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR id IN (SELECT organization_id FROM users WHERE id = auth.uid() AND organization_id IS NOT NULL)
  );

-- 2. Add organization_id to centers
ALTER TABLE centers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_centers_organization ON centers(organization_id);

-- 3. Migrate: each center → org with same name + owner, set centers.organization_id
DO $$
DECLARE
  c RECORD;
  owner_id UUID;
  new_org_id UUID;
BEGIN
  FOR c IN SELECT id, name FROM centers WHERE organization_id IS NULL
  LOOP
    -- Find owner: user with role='owner' and center_id = this center
    SELECT id INTO owner_id FROM users WHERE center_id = c.id AND role = 'owner' LIMIT 1;
    IF owner_id IS NULL THEN
      -- Fallback: first user with this center
      SELECT id INTO owner_id FROM users WHERE center_id = c.id LIMIT 1;
    END IF;

    INSERT INTO organizations (name, owner_user_id, plan)
    VALUES (c.name, owner_id, 'single')
    RETURNING id INTO new_org_id;

    UPDATE centers SET organization_id = new_org_id WHERE id = c.id;
  END LOOP;
END $$;

-- 4. Add organization_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);

-- 5. Migrate users: set organization_id from their center's organization_id
UPDATE users u
SET organization_id = c.organization_id
FROM centers c
WHERE u.center_id = c.id AND u.organization_id IS NULL AND c.organization_id IS NOT NULL;

-- 6. branch_user_assignments: limits user to specific branches if rows exist
CREATE TABLE IF NOT EXISTS branch_user_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, center_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_assignments_user ON branch_user_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_branch_assignments_org ON branch_user_assignments(organization_id);

ALTER TABLE branch_user_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own assignments" ON branch_user_assignments;
CREATE POLICY "Users can view own assignments" ON branch_user_assignments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 7. Update centers RLS: allow users to see all centers within their organization
DROP POLICY IF EXISTS "Users can view own center" ON centers;

-- Users see center if: (a) it's their center_id, or (b) center is in their org and they have no branch assignments (see all), or (c) they have assignment to this center
CREATE POLICY "Users can view own center" ON centers
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT center_id FROM users WHERE id = auth.uid() AND center_id IS NOT NULL)
    OR (
      organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid() AND organization_id IS NOT NULL)
      AND (
        NOT EXISTS (SELECT 1 FROM branch_user_assignments b WHERE b.user_id = auth.uid() AND b.organization_id = centers.organization_id)
        OR id IN (SELECT center_id FROM branch_user_assignments WHERE user_id = auth.uid())
      )
    )
  );

COMMENT ON TABLE organizations IS 'Multi-branch: org groups centers. single=1 branch, multi=2+';
COMMENT ON TABLE branch_user_assignments IS 'If rows exist for user+org, user sees only those centers. Else sees all org centers.';
