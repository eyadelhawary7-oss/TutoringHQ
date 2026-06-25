-- Security hardening (Step A): pin a stable search_path on every own (non-extension)
-- function that lacks one, closing the mutable-search_path advisor finding.
--
-- Catalog-driven so it targets exactly the unpinned set; no function body is rewritten.
-- The value `public, pg_temp` is safe here: functions referencing the auth schema already
-- qualify it (auth.uid()), none of the targeted functions call uuid-ossp/pgcrypto
-- (which live in the `extensions` schema) unqualified, and pg_trgm/pg_net are installed in
-- `public`. pg_trgm extension-owned functions are intentionally left untouched.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
