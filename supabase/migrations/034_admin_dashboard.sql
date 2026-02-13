-- Admin Dashboard: admin_payments, plan_requests, center billing columns
-- Run: supabase db push (or execute in Supabase SQL Editor)

-- 1. admin_payments table for recording manual payments by admin
CREATE TABLE IF NOT EXISTS admin_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id UUID REFERENCES centers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  billing_period TEXT DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'quarterly', 'semi_annual', 'annual')),
  period_start DATE,
  period_end DATE,
  paid_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT,
  recorded_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_payments_center ON admin_payments(center_id);
CREATE INDEX IF NOT EXISTS idx_admin_payments_paid_at ON admin_payments(paid_at DESC);

ALTER TABLE admin_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin only" ON admin_payments;
-- Service role bypasses RLS for admin API routes; no direct policy needed for admin table

-- 2. plan_requests table for center plan change requests
CREATE TABLE IF NOT EXISTS plan_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id UUID REFERENCES centers(id) ON DELETE CASCADE,
  current_plan TEXT,
  requested_plan TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_plan_requests_center ON plan_requests(center_id);
CREATE INDEX IF NOT EXISTS idx_plan_requests_status ON plan_requests(status);

-- 3. Add/ensure center columns for admin billing management
-- billing_period: 013 adds monthly/quarterly/half_yearly/yearly; we map semi_annual = half_yearly
ALTER TABLE centers ADD COLUMN IF NOT EXISTS next_payment_due DATE;
-- Use next_billing_date as source if next_payment_due is null (synced by trigger or app)
UPDATE centers SET next_payment_due = next_billing_date WHERE next_payment_due IS NULL AND next_billing_date IS NOT NULL;

ALTER TABLE centers ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT 'active' CHECK (billing_status IN ('active', 'paid', 'overdue', 'due_soon'));

-- 4. Add deleted_at for soft delete; allow status='deleted'
ALTER TABLE centers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- Extend status to include 'deleted' (drop existing check first)
ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_status_check;
ALTER TABLE centers ADD CONSTRAINT centers_status_check CHECK (status IN ('pending', 'active', 'suspended', 'rejected', 'deleted'));
