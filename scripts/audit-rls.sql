-- RLS Policy Audit for public schema
-- Run against your Supabase project to list all RLS policies
-- Usage: psql $DATABASE_URL -f scripts/audit-rls.sql

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expr,
  with_check AS check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
