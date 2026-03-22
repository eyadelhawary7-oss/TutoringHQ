-- Demo requests from marketing website
CREATE TABLE IF NOT EXISTS demo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  center_name TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status);

-- Center invites: when super admin creates a center, they add owner phone
-- When that phone logs in, we link them to the center
CREATE TABLE IF NOT EXISTS center_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_center_invites_phone ON center_invites(phone);
