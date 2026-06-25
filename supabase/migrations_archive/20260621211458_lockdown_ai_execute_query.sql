-- Security hardening (Step B): lock down ai_execute_query.
--
-- ai_execute_query(text, uuid) is SECURITY DEFINER and runs arbitrary caller-supplied SQL
-- (only p_center_id is bound as $1). It was EXECUTE-able by PUBLIC, anon and authenticated,
-- which means PostgREST exposed it as POST /rest/v1/rpc/ai_execute_query to logged-out and
-- signed-in clients alike -- a full RLS-bypass query primitive.
--
-- The only legitimate caller is src/app/api/ai/query/route.ts via the service-role client,
-- which bypasses GRANTs, so removing these grants does not affect it. Function body unchanged.

REVOKE EXECUTE ON FUNCTION public.ai_execute_query(text, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
