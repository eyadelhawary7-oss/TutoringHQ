-- Adds referral_payout to invoice_type CHECK. Keeps reactivation_fee for existing rows.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;

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
    'referral_payout',
    'reactivation_fee'
  ));
