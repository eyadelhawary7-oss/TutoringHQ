-- ============================================================================
-- H4 — Freeze commission_audit_log (append-only, like audit_log)
-- ----------------------------------------------------------------------------
-- Before: commission_audit_log had NO block-mutations trigger and a single
--         RLS policy `commission_audit_log_super_admin_all` (cmd=ALL) that let
--         a super_admin UPDATE/DELETE rows of a financial audit trail.
-- After:  UPDATE/DELETE are rejected at the trigger level for every role
--         (service_role included), and the super_admin policy is SELECT-only.
--         All writers of this table use the service-role client (INSERT only),
--         so no INSERT policy is needed.
-- ============================================================================

-- Generic append-only guard (audit_log has its own audit_log_block_mutations;
-- this one is table-agnostic so future frozen tables can share it).
CREATE OR REPLACE FUNCTION public.append_only_block_mutations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception '% is append-only: % is not permitted', tg_table_name, tg_op;
end;
$function$
;

REVOKE EXECUTE ON FUNCTION public.append_only_block_mutations() FROM PUBLIC;

CREATE TRIGGER commission_audit_log_no_update_delete
  BEFORE DELETE OR UPDATE ON public.commission_audit_log
  FOR EACH ROW EXECUTE FUNCTION append_only_block_mutations();

-- Downgrade the super_admin ALL policy to SELECT.
DROP POLICY IF EXISTS commission_audit_log_super_admin_all ON public.commission_audit_log;

CREATE POLICY commission_audit_log_super_admin_select
  ON public.commission_audit_log
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.id = auth.uid() AND admin_users.role = 'super_admin'::text
  ));

NOTIFY pgrst, 'reload schema';
