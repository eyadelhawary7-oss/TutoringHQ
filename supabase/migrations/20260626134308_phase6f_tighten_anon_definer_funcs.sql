-- ============================================================================
-- Phase 6 / Fix F — least-privilege on the anon-executable SECURITY DEFINER funcs
-- ----------------------------------------------------------------------------
-- The re-audit flagged the broad anon EXECUTE surface on public SECURITY DEFINER
-- functions. Two distinct groups, handled differently (verified live against
-- pg_policy — which roles each helper's policies actually serve):
--
-- (1) TRIGGER functions. A trigger function fires as the table owner when the
--     triggering DML runs; PostgreSQL does NOT check EXECUTE on it against the
--     invoking role. So an EXECUTE grant to anon/authenticated is pure surface
--     with no purpose. Revoke EXECUTE from everyone (PUBLIC, anon, authenticated,
--     service_role) — the triggers keep firing.
--
-- (2) RLS-helper functions referenced in policies. These MUST stay executable by
--     the roles the policies serve, or RLS evaluation errors. Live check:
--       - referenced by PUBLIC policies (so anon can hit them) -> KEEP anon:
--         get_auth_center_id, get_auth_center_group_ids, get_auth_teacher_group_ids,
--         has_center_role, is_auth_teacher_suspended  ==> NOT TOUCHED HERE.
--       - referenced only by an `authenticated` policy, or by no policy / no
--         function body / no app caller at all (anon never needs them) -> revoke
--         anon AND PUBLIC (the Supabase default GRANT ... TO PUBLIC otherwise
--         re-admits anon transitively), keep authenticated + service_role:
--         can_manage_students_fn, can_record_payments_fn, is_super_admin,
--         get_my_center_id
--
-- Reversible. ROLLBACK:
--   (1) GRANT EXECUTE ON FUNCTION public.<trigger_fn>() TO anon, authenticated, service_role; (and PUBLIC if desired)
--   (2) GRANT EXECUTE ON FUNCTION public.<helper_fn>(...) TO anon; GRANT EXECUTE ON FUNCTION public.<helper_fn>(...) TO PUBLIC;
-- No function bodies change. RLS policies are unchanged.
-- ============================================================================

-- (1) Trigger functions — revoke EXECUTE from all roles (triggers don't need it).
DO $$
DECLARE
  r record;
  trig_names text[] := ARRAY[
    'assign_center_code','assign_student_number','chq_block_pack_billing_write',
    'chq_prevent_blast_tampering','chq_prevent_card_order_tampering',
    'chq_prevent_center_escalation','chq_prevent_invoice_tampering',
    'chq_prevent_user_escalation','resolve_inactivity_alerts_on_scan',
    'trigger_recalc_lifecycle_on_scan'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proname = ANY(trig_names)
      AND p.prorettype = 'pg_catalog.trigger'::regtype   -- guard: only trigger fns
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- (2) RLS helpers not served to anon — revoke anon AND PUBLIC; keep
-- authenticated/service_role (authenticated holds its own explicit grant, so the
-- one authenticated policy on can_manage_students_fn keeps evaluating).
DO $$
DECLARE
  r record;
  helper_names text[] := ARRAY[
    'can_manage_students_fn','can_record_payments_fn','is_super_admin','get_my_center_id'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proname = ANY(helper_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
