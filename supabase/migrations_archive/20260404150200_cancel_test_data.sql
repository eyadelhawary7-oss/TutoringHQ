-- Allow cancelling test card orders (status not in legacy check)
ALTER TABLE card_orders DROP CONSTRAINT IF EXISTS card_orders_status_check;
ALTER TABLE card_orders ADD CONSTRAINT card_orders_status_check CHECK (
  status IN (
    'pending_payment',
    'pending',
    'paid',
    'confirmed',
    'printing',
    'ready_for_pickup',
    'shipped',
    'delivered',
    'cancelled'
  )
);

UPDATE card_orders
SET status = 'cancelled'
WHERE status = 'pending'
  AND center_id IN (
    SELECT id FROM centers
    WHERE name IN ('1234center', 'Playwright Test Center', 'Test Owner Center')
  );

UPDATE invoices
SET status = 'cancelled'
WHERE invoice_type = 'payment_proof'
  AND status = 'pending'
  AND billing_period_start < '2026-03-01';
