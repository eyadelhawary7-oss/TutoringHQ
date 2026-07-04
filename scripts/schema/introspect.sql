-- ============================================================================
-- introspect.sql — Canonical, version-stable schema snapshot generator
-- ----------------------------------------------------------------------------
-- Emits ONE normalized text line per schema object so the output is fully
-- deterministic and identical whether run:
--   * against LIVE prod via the Supabase MCP (execute_sql), or
--   * against a fresh rebuild via `psql -tAqX -f introspect.sql`.
--
-- The output is the drift reference (committed as db/schema.snapshot). The CI
-- drift gate rebuilds a DB from the migrations, runs this file, and diffs the
-- result against the committed snapshot. Any difference fails the build.
--
-- Design rules that keep it stable across Postgres 16 (local/CI) and 17 (prod):
--   * Scope: the `public` schema only, EXCLUDING extension-owned objects
--     (pg_depend deptype 'e'). Extensions themselves are listed by name+schema.
--   * Function bodies are compared by md5(prosrc) (the stored source is
--     identical across PG majors) rather than pg_get_functiondef (deparse can
--     differ across majors).
--   * One text column named "line". Ordering is forced by an explicit sort key
--     prefix so MCP-JSON and psql output collapse to byte-identical files.
--   * Covers every dimension the ghosts hid in: tables, columns, defaults,
--     nullability, PK/UNIQUE/CHECK/FK constraints, indexes, RLS enable flag,
--     RLS policies, triggers, functions, views, table grants, routine grants,
--     installed extensions, and storage.objects policies. Grants are frozen
--     for the app roles (anon/authenticated/service_role/PUBLIC) only.
--   * pg_cron jobs are NOT included here (bare-postgres rebuilds in CI cannot
--     reproduce them); they are captured separately by the live-drift check
--     via scripts/schema/introspect-cron.sql.
-- ============================================================================
WITH
pub AS (SELECT oid FROM pg_namespace WHERE nspname = 'public'),
-- relations in public that are NOT owned by an extension
pubrel AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  WHERE c.relnamespace = (SELECT oid FROM pub)
    AND c.relkind IN ('r','v','m','p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
),
-- functions/procedures in public that are NOT owned by an extension
pubproc AS (
  SELECT p.oid, p.proname
  FROM pg_proc p
  WHERE p.pronamespace = (SELECT oid FROM pub)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
),
lines AS (
  -- 00 EXTENSIONS (name + install schema; version intentionally excluded — it
  --    is environment-dependent and not an app-schema property)
  SELECT '00_ext::' || e.extname AS sk,
         'EXTENSION ' || e.extname || ' schema=' || n.nspname AS line
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  -- Supabase-managed extensions are provisioned out of band and are absent on a
  -- plain-Postgres rebuild (CI/local); exclude them so they don't false-trip the
  -- gate. They are watched by the live-drift check instead.
  WHERE e.extname NOT IN ('pg_cron','pg_net','supabase_vault','pg_graphql','pgsodium','pgjwt')

  -- 10 TABLES (relkind r/p)
  UNION ALL
  SELECT '10_tbl::' || r.relname,
         'TABLE ' || r.relname
           || ' rls=' || r.relrowsecurity
           || ' force_rls=' || r.relforcerowsecurity
  FROM pubrel r WHERE r.relkind IN ('r','p')

  -- 20 COLUMNS (ordinal, type, nullability, default)
  UNION ALL
  SELECT '20_col::' || r.relname || '::' || lpad(a.attnum::text, 4, '0'),
         'COLUMN ' || r.relname || '.' || a.attname
           -- dense relative position, not raw attnum: historically dropped
           -- columns leave attnum gaps in prod that a fresh rebuild repacks; the
           -- relative column ORDER is what matters and is preserved either way.
           || ' ord=' || row_number() OVER (PARTITION BY a.attrelid ORDER BY a.attnum)
           || ' type=' || format_type(a.atttypid, a.atttypmod)
           || ' notnull=' || a.attnotnull
           || ' default=' || COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '∅')
  FROM pubrel r
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE r.relkind IN ('r','p')

  -- 30 CONSTRAINTS (PK/UNIQUE/CHECK/FK) — full normalized definition
  UNION ALL
  SELECT '30_con::' || r.relname || '::' || c.conname,
         'CONSTRAINT ' || r.relname || '.' || c.conname
           || ' type=' || c.contype::text
           || ' def=' || regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g')
  FROM pg_constraint c JOIN pubrel r ON r.oid = c.conrelid

  -- 40 INDEXES (exclude indexes that back a constraint — those are emitted by 30)
  UNION ALL
  SELECT '40_idx::' || r.relname || '::' || ic.relname,
         'INDEX ' || ic.relname || ' ON ' || r.relname
           || ' def=' || regexp_replace(pg_get_indexdef(i.indexrelid), '\s+', ' ', 'g')
  FROM pg_index i
  JOIN pubrel r ON r.oid = i.indrelid
  JOIN pg_class ic ON ic.oid = i.indexrelid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conindid = i.indexrelid AND c.contype IN ('p','u','x')
  )

  -- 50 RLS POLICIES
  UNION ALL
  SELECT '50_pol::' || pol.tablename || '::' || pol.policyname,
         'POLICY ' || pol.tablename || '.' || pol.policyname
           || ' cmd=' || pol.cmd
           || ' permissive=' || pol.permissive
           || ' roles=' || array_to_string(pol.roles, ',')
           || ' using=' || COALESCE(regexp_replace(pol.qual, '\s+', ' ', 'g'), '∅')
           || ' check=' || COALESCE(regexp_replace(pol.with_check, '\s+', ' ', 'g'), '∅')
  FROM pg_policies pol
  WHERE pol.schemaname = 'public'
    AND pol.tablename IN (SELECT relname FROM pubrel)

  -- 60 TRIGGERS (exclude internal/constraint triggers)
  UNION ALL
  SELECT '60_trg::' || r.relname || '::' || tg.tgname,
         'TRIGGER ' || tg.tgname || ' ON ' || r.relname
           || ' def=' || regexp_replace(pg_get_triggerdef(tg.oid), '\s+', ' ', 'g')
  FROM pg_trigger tg JOIN pubrel r ON r.oid = tg.tgrelid
  WHERE NOT tg.tgisinternal

  -- 70 FUNCTIONS (signature + attributes + body hash; body hash is version-stable)
  UNION ALL
  SELECT '70_fun::' || p.proname || '::' || md5(pg_get_function_identity_arguments(pp.oid)),
         'FUNCTION ' || p.proname
           || '(' || pg_get_function_identity_arguments(pp.oid) || ')'
           || ' returns=' || pg_get_function_result(pp.oid)
           || ' lang=' || l.lanname
           || ' kind=' || pp.prokind::text
           || ' volatility=' || pp.provolatile::text
           || ' strict=' || pp.proisstrict
           || ' secdef=' || pp.prosecdef
           || ' cfg=' || COALESCE(array_to_string(pp.proconfig, ','), '∅')
           -- normalize CRLF->LF: some prod bodies were authored with CRLF; the
           -- line ending is behaviorally irrelevant and must not trip the gate.
           || ' bodymd5=' || md5(replace(COALESCE(pp.prosrc, ''), E'\r', ''))
  FROM pubproc p
  JOIN pg_proc pp ON pp.oid = p.oid
  JOIN pg_language l ON l.oid = pp.prolang

  -- 80 VIEWS (definition normalized)
  UNION ALL
  SELECT '80_view::' || r.relname,
         'VIEW ' || r.relname
           || ' def=' || regexp_replace(pg_get_viewdef(r.oid), '\s+', ' ', 'g')
  FROM pubrel r WHERE r.relkind IN ('v','m')

  -- 90 TABLE GRANTS — read from the catalog ACL (pg_class.relacl), NOT
  --    information_schema.role_table_grants. The information_schema privilege
  --    views only expose grants the CURRENT role is allowed to see, so the
  --    read-only live-drift role (which is not a member of anon/authenticated/
  --    service_role) sees NONE of them and every grant line false-trips as
  --    drift. pg_class.relacl is a plain catalog column any role can read, so
  --    the output is byte-identical whether run as the superuser CI rebuild or
  --    the read-only prod role. Two details keep it identical to the old
  --    information_schema output:
  --      * privilege_type is constrained to the SQL-standard table privileges
  --        that information_schema exposes; this drops PG17's non-standard
  --        MAINTAIN (granted in the baseline but absent from information_schema
  --        and therefore from the snapshot) so it does not leak in.
  --      * COALESCE(relacl, acldefault(...)) reconstructs Postgres' default
  --        privileges for a NULL acl exactly as information_schema reports them.
  UNION ALL
  SELECT '90_tgrant::' || r.relname || '::' || grantee_name || '::' || acl.privilege_type,
         'TABLE_GRANT ' || r.relname
           || ' grantee=' || grantee_name
           || ' priv=' || acl.privilege_type
           || ' grantable=' || CASE WHEN acl.is_grantable THEN 'YES' ELSE 'NO' END
  FROM pubrel r
  JOIN pg_class pc ON pc.oid = r.oid
  CROSS JOIN LATERAL aclexplode(COALESCE(pc.relacl, acldefault('r', pc.relowner))) acl
  CROSS JOIN LATERAL (
    SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                ELSE (SELECT rolname FROM pg_roles WHERE oid = acl.grantee) END
  ) gn(grantee_name)
  WHERE acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
    AND grantee_name IN ('anon','authenticated','service_role','PUBLIC')  -- security surface; owner grants are env noise

  -- 95 ROUTINE GRANTS (EXECUTE on functions — the over-granted RPC surface) —
  --    read from pg_proc.proacl for the same reason as 90: the routine-grant
  --    information_schema view is filtered to the current role's visibility and
  --    returns nothing for the read-only live-drift role. proacl is catalog-
  --    visible to every role. A NULL proacl means the function carries the
  --    default privilege (EXECUTE to PUBLIC), which acldefault('f', ...)
  --    reconstructs so those lines match the snapshot exactly.
  UNION ALL
  SELECT '95_rgrant::' || p.proname || '::' || grantee_name || '::' || acl.privilege_type,
         'ROUTINE_GRANT ' || p.proname
           || ' grantee=' || grantee_name
           || ' priv=' || acl.privilege_type
           || ' grantable=' || CASE WHEN acl.is_grantable THEN 'YES' ELSE 'NO' END
  FROM pubproc p
  JOIN pg_proc pp ON pp.oid = p.oid
  CROSS JOIN LATERAL aclexplode(COALESCE(pp.proacl, acldefault('f', pp.proowner))) acl
  CROSS JOIN LATERAL (
    SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                ELSE (SELECT rolname FROM pg_roles WHERE oid = acl.grantee) END
  ) gn(grantee_name)
  WHERE acl.privilege_type = 'EXECUTE'
    AND grantee_name IN ('anon','authenticated','service_role','PUBLIC')  -- security surface; owner grants are env noise

  -- A0 STORAGE.OBJECTS POLICIES (app-owned security surface in the storage schema)
  UNION ALL
  SELECT 'a0_storagepol::' || pol.tablename || '::' || pol.policyname,
         'STORAGE_POLICY ' || pol.tablename || '.' || pol.policyname
           || ' cmd=' || pol.cmd
           || ' roles=' || array_to_string(pol.roles, ',')
           || ' using=' || COALESCE(regexp_replace(pol.qual, '\s+', ' ', 'g'), '∅')
           || ' check=' || COALESCE(regexp_replace(pol.with_check, '\s+', ' ', 'g'), '∅')
  FROM pg_policies pol
  WHERE pol.schemaname = 'storage'
)
SELECT line FROM lines ORDER BY sk, line;
