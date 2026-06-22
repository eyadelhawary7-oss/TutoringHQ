-- Remove the dead manual payment-proof upload column. The manual-proof flow is
-- fully superseded by Paymob and had no live callers; invoices.payment_proof_url
-- was populated in 0 rows. The accompanying payment-proofs storage bucket and its
-- objects are removed in a follow-up storage cleanup.
ALTER TABLE invoices DROP COLUMN IF EXISTS payment_proof_url;

NOTIFY pgrst, 'reload schema';
