-- Phone uniqueness for REAL centres only (F-B21).
-- Test rows (is_test = true) are excluded — they may share junk phones.
-- Original DEFERRABLE constraint replaced with a partial unique index because:
--   1. Postgres does not support deferrable partial unique indexes.
--   2. CenterHQ does not batch centre upserts within a single transaction.
--   3. A partial index expresses the actual business invariant.

CREATE UNIQUE INDEX IF NOT EXISTS centers_phone_unique_real
  ON public.centers (phone)
  WHERE is_test = false;

COMMENT ON INDEX public.centers_phone_unique_real IS
  'Enforces phone uniqueness on real (non-test) centres only. Test rows allowed to collide.';
