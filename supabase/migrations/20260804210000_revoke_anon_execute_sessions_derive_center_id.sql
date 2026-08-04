-- ============================================================================
-- APPLIED TO PRODUCTION 4 August 2026, on Eyad's instruction, after this file
-- was first written as a proposal. The SQL below is EXACTLY what was executed.
--
-- Eyad: "Apply the REVOKE using the idiom already in the archive, not your
-- version — 20260621215634_revoke_anon_execute_business_rpcs.sql is the
-- established pattern in this repo."
--
-- THAT INSTRUCTION CHANGED THE OUTCOME, so read this before assuming the two
-- are interchangeable. The first draft of this file said:
--     REVOKE ALL ON FUNCTION public.sessions_derive_center_id()
--       FROM anon, authenticated;
-- which strips `authenticated` as well. The archive idiom does NOT: it revokes
-- from PUBLIC + anon and then RE-GRANTS authenticated + service_role. Running
-- the draft would have left production in a different state from the one it is
-- actually in. The draft is gone; what follows is what ran.
--
-- WHY THIS FILE EXISTS AT ALL. Migration 20260804120000 (recorded in the
-- history as 20260804094631) ended block 1b with
--     REVOKE ALL ON FUNCTION public.sessions_derive_center_id() FROM PUBLIC;
-- under a comment claiming it satisfied the standing "revoke anonymous EXECUTE
-- on SECURITY DEFINER helpers" rule. It did not. REVOKE ... FROM PUBLIC removes
-- only the implicit PUBLIC grant; Supabase's explicit default grants to `anon`
-- and `authenticated` are separate ACL entries and survived it. The statement
-- ran and the surface stayed open. The defect was never exploitability — it was
-- a committed comment asserting a property the catalog did not have, so an
-- auditor sweeping SECURITY DEFINER surfaces would tick this one off as closed.
--
-- That comment was written by Claude, not by Eyad. The correct idiom for this
-- exact job had existed in this repo since 21 June; the line deviated from a
-- known-good pattern rather than inventing a new problem.
--
-- BEFORE  {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- AFTER   {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- anon EXECUTE grants: 1 -> 0. Verified by re-querying pg_proc.proacl and
-- aclexplode() after the apply, not inferred from the statement succeeding.
--
-- SAFETY, verified after applying: the trigger is unaffected. Postgres checks
-- EXECUTE at CREATE TRIGGER time, not at fire time, so
-- trg_sessions_derive_center_id still exists and sessions still reads 4 rows
-- with 2 carrying center_id. The function returns `trigger`, so PostgREST never
-- exposed it and a direct call fails with 42809 regardless of grants.
--
-- WHY `authenticated` IS DELIBERATELY RETAINED: because the archive idiom
-- retains it, for every one of the 21 business RPCs it covers. Whether a
-- trigger function needs any grant at all is a separate question and a wider
-- change; this file matches the established pattern rather than quietly
-- introducing a stricter one.
--
-- NOTE FOR THE DRIFT GATE, corrected after CI caught me. An earlier draft of
-- this header claimed this migration "produces no ROUTINE_GRANT line in
-- db/schema.snapshot". That was true of the REVOKE-only draft and is FALSE of
-- the idiom actually used here, because it also issues an explicit GRANT.
-- Locally, Supabase's anon/authenticated default privileges do not exist, so
-- there is nothing for the REVOKE to remove — but the GRANT still CREATES two
-- entries. A clean Postgres 17 rebuild adds exactly:
--     ROUTINE_GRANT sessions_derive_center_id grantee=authenticated priv=EXECUTE grantable=NO
--     ROUTINE_GRANT sessions_derive_center_id grantee=service_role  priv=EXECUTE grantable=NO
-- and nothing else (6242 -> 6244 objects). db/schema.snapshot is regenerated in
-- this branch to match. The claim was carried over from the draft without being
-- re-verified against the new SQL; schema-drift failed and was right to.
--
-- The load-bearing half of the original note still stands, and matters more:
-- check-drift.sh compares a rebuild of the migrations against the committed
-- snapshot, and NEITHER SIDE IS PRODUCTION. The local rebuild has no anon grant
-- to revoke, so the gate can confirm the GRANT but can say nothing at all about
-- whether the REVOKE achieved anything on the live database. That is precisely
-- how the original defect passed review, and it is why the ACL above was
-- re-queried against production by hand after applying.
--
-- Idempotent: re-running produces the same ACL.
-- ============================================================================

DO $$
DECLARE
  r record;
  names text[] := ARRAY['sessions_derive_center_id'];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proname = ANY(names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY VERIFICATION (run against production; expect anon_grants = 0)
--
--   SELECT p.proname, p.proacl::text,
--          (SELECT count(*) FROM aclexplode(p.proacl) a
--            WHERE a.grantee = 'anon'::regrole) AS anon_grants
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'sessions_derive_center_id';
--
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_sessions_derive_center_id';  -- expect 1
