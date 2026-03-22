-- Hybrid authentication: OTP for signup/verification, username+password for daily logins
-- Run in Supabase SQL Editor: supabase db push (or paste into SQL Editor)

-- Allow centers to have pending_verification status (before OTP+credentials complete)
ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_status_check;
ALTER TABLE centers ADD CONSTRAINT centers_status_check
  CHECK (status IN ('pending', 'pending_verification', 'active', 'suspended', 'rejected', 'deleted'));

-- Add username and phone_verified to public.users (app profile table)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS username TEXT,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;

-- Create unique index for fast username lookup (usernames must be globally unique for login)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- Username required when phone is verified (users who completed credential setup)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_check;
ALTER TABLE users
ADD CONSTRAINT users_username_check
CHECK (
  (phone_verified = false) OR
  (phone_verified = true AND username IS NOT NULL)
);

COMMENT ON COLUMN users.username IS 'Unique login identifier. Used with auth.users.email (username@centerhq.local) for signInWithPassword';
COMMENT ON COLUMN users.phone_verified IS 'True after OTP verification during signup/invite. Required before username can be used.';

-- Add invited_name to center_invites for OTP-based invite flow
ALTER TABLE center_invites ADD COLUMN IF NOT EXISTS invited_name TEXT;
