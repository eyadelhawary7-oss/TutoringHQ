-- whatsapp_pack_request_and_billing_v2
-- Immutable billing log: append-only, one row per student per billing period

CREATE TABLE IF NOT EXISTS parent_pack_monthly_counts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id       UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  billing_period  TEXT NOT NULL,
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_phone    TEXT NOT NULL,
  opted_in_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (center_id, billing_period, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_pack_monthly_counts_center_period
  ON parent_pack_monthly_counts (center_id, billing_period);

ALTER TABLE parent_pack_monthly_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parent_pack_monthly_counts_select ON parent_pack_monthly_counts;
CREATE POLICY parent_pack_monthly_counts_select ON parent_pack_monthly_counts
  FOR SELECT USING (
    center_id IN (SELECT center_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS parent_pack_monthly_counts_insert ON parent_pack_monthly_counts;
CREATE POLICY parent_pack_monthly_counts_insert ON parent_pack_monthly_counts
  FOR INSERT WITH CHECK (
    center_id IN (SELECT center_id FROM users WHERE id = auth.uid())
  );

ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS pack_request_status         TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS pack_requested_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pack_approved_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pack_rejection_reason       TEXT,
  ADD COLUMN IF NOT EXISTS pack_pending_balance        NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pack_months_without_invoice INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pack_custom_invoice_minimum NUMERIC;

DO $$
BEGIN
  ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_pack_request_status_check;
  ALTER TABLE centers ADD CONSTRAINT centers_pack_request_status_check
    CHECK (pack_request_status IN ('none', 'pending', 'approved', 'rejected'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
