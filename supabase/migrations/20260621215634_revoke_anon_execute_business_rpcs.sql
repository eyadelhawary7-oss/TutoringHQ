-- Security hardening (Step E): remove anon's PostgREST /rpc reach to the SECURITY DEFINER
-- business RPCs that are only ever invoked server-side via the service-role client.
--
-- For each function: revoke EXECUTE from PUBLIC + anon, then re-grant authenticated +
-- service_role. This removes the logged-out POST /rest/v1/rpc/<fn> surface while preserving
-- signed-in and server access (all of these already had an authenticated grant).
--
-- The auth-helper family (get_auth_*, has_center_role, is_super_admin,
-- is_auth_teacher_suspended, can_manage_students_fn, can_record_payments_fn,
-- get_my_center_id, teacher_private_access) is intentionally left granted to anon, because
-- {public} RLS policies on public-facing pages (e.g. the join-link flow) evaluate them as
-- the anon role -- revoking would make those queries fail with "permission denied for
-- function". Trigger and non-SECURITY-DEFINER helper functions are also left untouched.
-- No function body is modified.

DO $$
DECLARE
  r record;
  names text[] := ARRAY[
    'append_commission_pause','close_commission_pause','approve_student_rpc',
    'cancel_reservation_atomic','complete_onboarding_step_rpc','compute_active_days',
    'compute_benchmark_snapshots','compute_center_health_score','deduct_blast_balance_rpc',
    'earn_credits_atomic','spend_credits_atomic','reserve_credits_atomic',
    'get_center_benchmarks','increment_promo_uses','process_payment_rpc',
    'recalc_all_lifecycle_status','recalc_student_lifecycle','recompute_all_health_scores',
    'redeem_promo_code','try_finalize_payment_session','upsert_scan_metric'
  ];
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
