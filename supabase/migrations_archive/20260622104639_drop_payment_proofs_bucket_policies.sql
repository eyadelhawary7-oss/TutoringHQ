-- Final cleanup of the dead payment-proofs storage bucket. The bucket, its 16
-- stale objects, and these upload policies were removed via the Storage API
-- (the protect_objects_delete trigger blocks direct SQL deletes of objects, so
-- the bucket itself was emptied + deleted through the Supabase Storage Dashboard).
-- This migration drops the now-orphaned upload policies idempotently so a fresh
-- rebuild from migrations does not recreate them on a non-existent bucket.
DROP POLICY IF EXISTS "Users upload payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload payment proofs" ON storage.objects;

NOTIFY pgrst, 'reload schema';
