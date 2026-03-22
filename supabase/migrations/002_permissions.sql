-- Granular permissions for assistants (owner/admin have full access by role)
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, center_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_permissions_user_center ON permissions(user_id, center_id);
