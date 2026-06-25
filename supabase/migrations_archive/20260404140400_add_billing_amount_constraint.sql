ALTER TABLE centers ADD CONSTRAINT chk_billing_amount_positive
  CHECK (
    billing_type = 'payg'
    OR status IN ('pending', 'rejected', 'cancelled')
    OR billing_amount > 0
  );
