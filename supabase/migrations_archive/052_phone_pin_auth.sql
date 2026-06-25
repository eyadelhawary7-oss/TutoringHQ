-- Migration: Phone + PIN auth system
-- Remove username requirement, add phone index for login lookups

-- Drop the constraint that requires username when phone_verified = true
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_check;

-- Add index for efficient phone lookups during login
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
