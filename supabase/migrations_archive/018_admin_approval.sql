-- ============================================
-- Admin Approval System Migration
-- Run this in Supabase SQL Editor (or: supabase db push)
-- ============================================

-- Add status tracking to centers
ALTER TABLE centers 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' 
  CHECK(status IN ('pending', 'active', 'suspended', 'rejected'));

ALTER TABLE centers 
ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE centers 
ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE centers 
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE centers 
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);

-- Set existing centers to active
UPDATE centers SET status = 'active' WHERE status IS NULL;

-- Create admin users table (for Eyad and support team)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'support')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on admin_users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists (for idempotency)
DROP POLICY IF EXISTS "Admins can view admin users" ON admin_users;

-- Only admins can see admin table (self only for simplicity)
CREATE POLICY "Admins can view admin users"
  ON admin_users
  FOR SELECT
  USING (id = auth.uid());

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_centers_status ON centers(status);
CREATE INDEX IF NOT EXISTS idx_centers_requested_at ON centers(requested_at DESC);

-- Add comment
COMMENT ON COLUMN centers.status IS 'Center approval status: pending, active, suspended, rejected';

-- To add yourself as admin, first sign up/login, then run:
-- INSERT INTO admin_users (id, name, email, role) 
-- SELECT id, COALESCE(raw_user_meta_data->>'name', 'Admin'), COALESCE(email, phone || '@placeholder.local'), 'admin' 
-- FROM auth.users WHERE phone = '+20XXXXXXXXX' LIMIT 1;
