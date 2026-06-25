-- Custom internal team roles with configurable section-level permissions
-- Run this in Supabase SQL Editor before testing

-- Add columns if not exist
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS custom_permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Ensure role column exists (it should from migration 040)
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

-- Migrate existing role values to new schema
UPDATE public.admin_users SET role = 'admin' WHERE role = 'internal_admin';
UPDATE public.admin_users SET role = 'support_agent' WHERE role = 'internal_viewer';
UPDATE public.admin_users SET role = 'support_agent' WHERE role = 'support';

-- Drop old constraint and add new one
ALTER TABLE public.admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE public.admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('super_admin', 'admin', 'sales_rep', 'support_agent', 'accountant', 'custom'));
