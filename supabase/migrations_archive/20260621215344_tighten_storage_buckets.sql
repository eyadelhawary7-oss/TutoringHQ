-- Security hardening (Step D1): make the payment-proofs bucket private and remove the
-- broad anonymous-listing SELECT policies on both storage buckets.
--
-- payment-proofs held financial documents that were publicly fetchable and enumerable.
-- 0 invoices reference any bucket object; admins read proofs via service-role signed URLs
-- (see src/app/api/upload/payment-proof/route.ts), so privacy does not break any live read.
-- center-logos stays public (logos render via getPublicUrl); only its anonymous-listing
-- policy is dropped.

UPDATE storage.buckets SET public = false WHERE id = 'payment-proofs';

DROP POLICY IF EXISTS "Anyone can view payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read logos" ON storage.objects;

NOTIFY pgrst, 'reload schema';
