-- Signup Paymob: center status + invoice type for first payment checkout
ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_status_check;
ALTER TABLE centers ADD CONSTRAINT centers_status_check
  CHECK (status IN (
    'pending',
    'pending_verification',
    'pending_payment',
    'paid_pending_activation',
    'active',
    'suspended',
    'rejected',
    'deleted',
    'cancelled',
    'pending_cancellation'
  ));

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
    'signup_first_payment'
  ));
