-- Rename late_fee → late_payment_fee; add reactivation_fee; centers.reactivation_date

ALTER TABLE centers ADD COLUMN IF NOT EXISTS reactivation_date DATE;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;

UPDATE invoices SET invoice_type = 'late_payment_fee' WHERE invoice_type = 'late_fee';

ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN (
    'base_subscription',
    'subscription',
    'whatsapp_addon',
    'setup_fee',
    'payment_proof',
    'announcement_settlement',
    'announcement_cap',
    'plan_upgrade_difference',
    'pack_billing',
    'signup_first_payment',
    'late_payment_fee',
    'reactivation_fee'
  ));
