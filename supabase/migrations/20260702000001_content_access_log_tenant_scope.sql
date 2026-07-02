-- C2 (2 July audit): content_access_log was readable cross-tenant by anon.
--
-- The old policy granted SELECT to PUBLIC (which includes the anon role) with a
-- qual that was true for any row whose content item still exists — no tenant
-- predicate — so an unauthenticated caller could read the whole table across
-- every center. Rescope SELECT to authenticated callers and only the rows whose
-- content item is owned by the caller's own center, and drop the anon SELECT
-- grant. Writes are unaffected: this is the only policy on the table, so
-- INSERT/UPDATE/DELETE succeed only via the RLS-bypassing service role.

DROP POLICY IF EXISTS content_access_log_select ON public.content_access_log;

CREATE POLICY content_access_log_select
  ON public.content_access_log
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.content_items ci
      WHERE ci.id = content_access_log.content_item_id
        AND ci.owner_center_id = public.get_auth_center_id()
    )
  );

REVOKE SELECT ON public.content_access_log FROM anon;

NOTIFY pgrst, 'reload schema';
