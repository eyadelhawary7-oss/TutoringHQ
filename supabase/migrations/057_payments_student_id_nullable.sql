-- Allow Paymob subscription payments (center billing) to be inserted without student_id.
-- Student attendance payments: still have student_id (unchanged).
-- Paymob center billing: student_id = NULL (no student involved).

ALTER TABLE payments
  ALTER COLUMN student_id DROP NOT NULL;
