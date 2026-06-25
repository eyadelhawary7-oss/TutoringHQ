-- ============================================================================
-- Phase 1 / Fix B — remove the AI natural-language query primitive
-- ----------------------------------------------------------------------------
-- /api/ai/query asked an LLM to author SQL and then ran it via
-- ai_execute_query(text, uuid) on the SERVICE-ROLE client. Only p_center_id was
-- bound as $1; the lone guard was a write-blocking regex, so a read query could
-- be crafted to read across tenants (cross-tenant exfiltration). The product
-- decision (Eyad) was to REMOVE the feature rather than keep+harden it.
--
-- This migration drops the function. The route (src/app/api/ai/query/route.ts)
-- and its UI (AnalyticsAiChatWidget, NaturalQueryBox) are removed in the same
-- change so prod is never left expecting a function that is gone.
--
-- Reversible. ROLLBACK: recreate from
--   supabase/migrations_archive/20260320000001_ai_query_rpc.sql
-- and re-apply the lockdown revoke from
--   supabase/migrations_archive/20260621211458_lockdown_ai_execute_query.sql
-- (and restore the route + UI from git history).
-- ============================================================================

DROP FUNCTION IF EXISTS public.ai_execute_query(text, uuid);

NOTIFY pgrst, 'reload schema';
