-- ============================================================================
-- test-shim.sql — minimal Supabase-managed surface for REBUILD/TEST ONLY
-- ----------------------------------------------------------------------------
-- A plain Postgres (local verification + CI drift gate) lacks the objects that
-- Supabase provisions out of band: the anon/authenticated/service_role roles,
-- the `extensions` schema, and the auth.* / storage.* helper objects that RLS
-- policies and column defaults reference at CREATE time.
--
-- This shim creates JUST ENOUGH of that surface so the AS-IS baseline applies
-- on a vanilla Postgres and the public schema rebuilds identically. It is NEVER
-- applied to production — prod already has the real Supabase objects.
--
-- Apply order:  test-shim.sql  ->  00000000000000_baseline.sql  ->  (future migrations)
-- ============================================================================

-- ---------- roles referenced by GRANTs and policy TO-clauses ----------
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'anon','authenticated','service_role','authenticator',
    'supabase_admin','supabase_auth_admin','supabase_storage_admin',
    'dashboard_user','pgbouncer'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

-- ---------- schemas ----------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- Make function/default resolution match production (which searches extensions).
ALTER DATABASE :"DBNAME" SET search_path = public, extensions;

-- ---------- auth.users (FK target for 19 public FKs; minimal stand-in) ----------
-- Production's auth.users is provisioned by Supabase Auth. Rebuilds only need
-- the id primary key so the foreign keys resolve.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()
);

-- ---------- auth.* helpers used inside RLS policy expressions ----------
-- Signatures must match production; bodies are irrelevant (policies are only
-- parsed, never executed, during a schema rebuild).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.email', true), '') $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

-- ---------- storage.objects + helpers (for the storage.objects RLS policies) ----------
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[],
  version text,
  owner_id text,
  user_metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(storage.filename(name), '.', 2) $$;
