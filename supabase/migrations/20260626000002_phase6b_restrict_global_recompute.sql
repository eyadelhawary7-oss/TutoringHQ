-- ============================================================================
-- Phase 6 / Fix B — restrict the platform-wide recompute RPCs
-- ----------------------------------------------------------------------------
-- These SECURITY DEFINER functions recompute state for EVERY center on the
-- platform in a single call. While still GRANT EXECUTE ... TO authenticated, any
-- signed-in user could POST /rest/v1/rpc/<fn> and trigger a full-platform
-- recompute on demand — an availability / DoS lever (heavy table scans, lock
-- pressure) and a cross-tenant side-effect, with zero legitimate client use.
--
--   recalc_all_lifecycle_status()      — relabels lifecycle for all students
--   recompute_all_health_scores()      — recomputes every center's health score
--   compute_benchmark_snapshots(date)  — district/tier benchmark aggregation
--
-- Step-0 classification: class (a). No app code calls these as the signed-in
-- user. compute_benchmark_snapshots is invoked only by the compute-benchmarks
-- Vercel cron and the compute-benchmarks edge function, BOTH using the
-- service-role key. The other two have no app caller at all (the
-- recompute-health-scores cron computes in JS). service_role bypasses GRANTs,
-- so restricting to service_role/cron only breaks nothing.
--
-- Reversible. ROLLBACK: re-grant authenticated on each signature, e.g.
--   GRANT EXECUTE ON FUNCTION public.recalc_all_lifecycle_status() TO authenticated;
-- No function bodies change.
-- ============================================================================

DO $$
DECLARE
  r record;
  names text[] := ARRAY[
    'recalc_all_lifecycle_status','recompute_all_health_scores','compute_benchmark_snapshots'
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
