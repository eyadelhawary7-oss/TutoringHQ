-- RLS policies for payments table
-- Ensures users can only access payments for their center with appropriate permissions

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (for idempotency)
DROP POLICY IF EXISTS "Payments select by center and permission" ON payments;
DROP POLICY IF EXISTS "Payments insert by center" ON payments;
DROP POLICY IF EXISTS "Payments update by center and permission" ON payments;

-- SELECT: Owners and admins see all payments for their center.
-- Assistants/teachers need can_view_payments = true.
CREATE POLICY "Payments select by center and permission" ON payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.center_id = payments.center_id
        AND (
          u.role IN ('owner', 'admin')
          OR (u.can_view_payments = true AND COALESCE(u.is_active, true) = true)
        )
    )
  );

-- INSERT: Owners, admins, or users with can_record_payments can insert payments for their center.
CREATE POLICY "Payments insert by center" ON payments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.center_id = payments.center_id
        AND (
          u.role IN ('owner', 'admin')
          OR (u.can_record_payments = true AND COALESCE(u.is_active, true) = true)
        )
    )
  );

-- UPDATE: Owners, admins, or users with can_record_payments can update (e.g. confirm) payments.
CREATE POLICY "Payments update by center and permission" ON payments
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.center_id = payments.center_id
        AND (
          u.role IN ('owner', 'admin')
          OR (u.can_record_payments = true AND COALESCE(u.is_active, true) = true)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.center_id = payments.center_id
        AND (
          u.role IN ('owner', 'admin')
          OR (u.can_record_payments = true AND COALESCE(u.is_active, true) = true)
        )
    )
  );
