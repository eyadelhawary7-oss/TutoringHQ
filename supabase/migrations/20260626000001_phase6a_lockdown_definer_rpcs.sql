-- ============================================================================
-- Phase 6 / Fix A — lock down the broader class of unguarded SECURITY DEFINER RPCs
-- ----------------------------------------------------------------------------
-- The 2026-06-26 re-audit found a second tier of SECURITY DEFINER functions
-- still GRANT EXECUTE ... TO authenticated. Unlike the Phase-1 money RPCs these
-- are per-center / per-student business operations, but the exposure is the same
-- class of hole: any signed-in user could POST /rest/v1/rpc/<fn> directly,
-- bypassing the server-side wrapper, and (because several take a center/student
-- id as a plain argument) act on another center's data.
--
-- Step-0 classification (verified live + every caller read in the codebase):
-- ALL of these are class (a) — the ONLY callers are the service-role client
-- (supabaseAdmin) on the server / in crons, or a DB trigger. service_role
-- bypasses GRANTs, so revoking authenticated/anon/PUBLIC does not break any real
-- call path. None is invoked from the browser as the signed-in user, so no
-- function needs to stay client-callable and no in-body ownership guard is
-- required to keep a legitimate path working.
--
--   append_commission_pause(uuid)              -> src/lib/commissions.ts (admin)
--   close_commission_pause(uuid)               -> src/lib/commissions.ts (admin)
--   approve_student_rpc(uuid,uuid,uuid[],uuid) -> /api/students/pending/[id]/approve (admin)
--   complete_onboarding_step_rpc(uuid,integer) -> /api/onboarding/* (admin)
--   upsert_scan_metric(uuid,timestamptz,date)  -> metricsAggregator / simulate-scan (admin)
--   get_center_benchmarks(uuid)                -> /api/benchmarks (admin)
--   recalc_student_lifecycle(uuid)             -> DB trigger trigger_recalc_lifecycle_on_scan only
--   compute_center_health_score(uuid)          -> DB-internal (recompute loop) only; no app caller
--
-- (recalc_all_lifecycle_status / recompute_all_health_scores /
--  compute_benchmark_snapshots — the platform-wide recompute funcs — are handled
--  separately in 20260626000002_phase6b_restrict_global_recompute.sql.)
--
-- Reversible. ROLLBACK: re-grant authenticated on each signature below, e.g.
--   GRANT EXECUTE ON FUNCTION public.append_commission_pause(uuid) TO authenticated;
-- (the baseline grants are the pre-Phase-6 state). No function bodies change.
-- ============================================================================

DO $$
DECLARE
  r record;
  names text[] := ARRAY[
    'append_commission_pause','close_commission_pause','approve_student_rpc',
    'complete_onboarding_step_rpc','upsert_scan_metric','get_center_benchmarks',
    'recalc_student_lifecycle','compute_center_health_score'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proname = ANY(names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
