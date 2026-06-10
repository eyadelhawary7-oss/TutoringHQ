-- Drop the old 3-arg signature of apply_transaction_transition.
-- CREATE OR REPLACE FUNCTION with a NEW argument list does not replace the
-- function - it OVERLOADS it, leaving both signatures callable and making
-- 3-arg call sites bind to the old body (which cannot set method). Dropping
-- the old signature forces every caller onto the 4-arg version, whose
-- p_method defaults to NULL so existing 3-arg-style calls keep working.
-- Already applied to prod on 2026-06-10; this file keeps the repo in sync.

DROP FUNCTION IF EXISTS public.apply_transaction_transition(uuid, text, uuid);

DO $$
BEGIN
  RAISE NOTICE 'old apply_transaction_transition(uuid,text,uuid) signature dropped; 4-arg version is canonical';
END $$;
