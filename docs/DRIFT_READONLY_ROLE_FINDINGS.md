# Read-only drift role — findings note

Created a dedicated read-only database role on the **live** CenterHQ Supabase
project (`lczmjpnbuhnsislcvzar`, region `eu-west-2`) so GitHub Actions can run
the scheduled **Live Schema Drift Check**
(`.github/workflows/schema-drift-live.yml`) against production without any write
ability.

This was done **directly on the live database** (via the Supabase MCP), **not**
through a tracked app migration — a login password must never live in a
migration or in the repo. This note records exactly what was created; the
password and connection string were handed to Eyad separately and are not
committed anywhere.

## Role

```
drift_readonly   LOGIN
                 NOSUPERUSER  NOCREATEDB  NOCREATEROLE  NOREPLICATION  NOBYPASSRLS
                 INHERIT
                 member of: (none)
```

- Strong random password (24 bytes, `openssl rand -hex`). Delivered to Eyad
  once, out of band. Not stored in this repo, any file, or any migration.
- **No membership in any role** — in particular not `postgres`, `service_role`,
  `authenticated`, or `anon`. Not even `pg_read_all_data`.

## Grants (exactly this, nothing more)

| Privilege | Object |
|-----------|--------|
| `CONNECT` | database `postgres` |
| `USAGE`   | schema `public` |
| `USAGE`   | schema `storage` |
| `USAGE`   | schema `cron` |
| `SELECT`  | table `cron.job` (for the pg_cron portion of the live check) |

`USAGE` + `SELECT` on `pg_catalog` and `information_schema` are the default
`PUBLIC` grants and are all the schema-introspection query (`introspect.sql`)
actually reads for tables/columns/constraints/indexes/policies/triggers/
functions/views. **No `SELECT` was granted on any application table**, so this
credential cannot read business data (students, payments, PII). It can see
schema *shape* only — which is the entire point of a drift check.

No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, or any DDL was granted.

## Proof it is read-only

Verified by `SET ROLE drift_readonly` and attempting writes:

| Attempt | Result |
|---------|--------|
| `CREATE TABLE public.drift_write_probe (id int)` | **refused** — `ERROR: 42501: permission denied for schema public` |
| `INSERT INTO public.academic_periods …` | **refused** — `ERROR: 42501: permission denied for table academic_periods` |
| `SELECT` from an application table | **refused** — `ERROR: 42501: permission denied for table academic_periods` |
| `SELECT` from `pg_catalog` / `information_schema` / `cron.job` | allowed |

**One-line confirmation:** a write attempt by `drift_readonly` (both DDL
`CREATE TABLE` and DML `INSERT`) was refused with `permission denied` — the role
can look but cannot touch.

## Connection string shape (value delivered to Eyad, not committed)

Built against the **Supabase pooler** (Supavisor), **session mode**, not the
direct `db.*.supabase.co` host — GitHub Actions is IPv4-only and the direct host
is IPv6-only, so a direct DSN would fail to connect from CI.

```
postgresql://drift_readonly.<project_ref>:<password>@<pooler-host>:5432/postgres?sslmode=require
```

- Pooler username format: `drift_readonly.<project_ref>` (role name, dot,
  project ref).
- Port `5432` = session mode. `sslmode=require`.
- Goes into the GitHub repo secret `SCHEMA_DRIFT_DATABASE_URL`.

## Known limitations of a *pure* read-only role vs. the current snapshot

These are pre-existing properties of the introspection scripts, surfaced here so
they are not mistaken for a misconfigured role. The role behaves **identically
to `postgres`** for every catalog-based section of `introspect.sql`; the gaps
below are purely about object *visibility* to an unprivileged role and about one
genuine, unrelated drift.

1. **Grant lines (3080) are invisible to a non-privileged role.**
   `introspect.sql` sections `90_tgrant` / `95_rgrant` read
   `information_schema.role_table_grants` / `role_routine_grants`, which only
   return rows whose grantor **or** grantee is a role the caller inherits
   (`information_schema.enabled_roles` → `pg_has_role(…, 'USAGE')`). All 3080
   app-role grants were made **by `postgres` to `anon`/`authenticated`/
   `service_role`**, none of which `drift_readonly` is (or should be) a member
   of. So `drift_readonly` sees 0 of them while the committed
   `db/schema.snapshot` (generated as `postgres`) has 3080 → the live job would
   report 3080 phantom grant diffs.
   *Making them visible would require inherited membership in `postgres` or in
   the writable app roles — which would defeat "read-only" — so it was **not**
   done.* The clean fix is a follow-up change to `introspect.sql` to source
   grants from `pg_catalog` (`pg_class.relacl`, `pg_proc.proacl`), which are
   world-readable and therefore visible to any read-only role. That is an app/CI
   change and was intentionally left out of scope for this credential task.

2. **pg_cron jobs (1) are invisible to a non-owner.** `pg_cron` restricts
   `cron.job` rows to the job's owner; the one job is owned by `postgres`, so
   `drift_readonly` sees 0 while `db/cron.snapshot` has 1. `SELECT` on
   `cron.job` was granted (so the query does not error), but the owner filter
   still hides the row. Same trade-off as above — not fixable without privilege
   escalation or a script change.

3. **Pre-existing real drift (not a role issue):** live prod currently has
   **1617** public columns vs **1620** in `db/schema.snapshot` (−3). `postgres`
   sees 1617 too, so this is genuine schema drift the committed snapshot has not
   captured — exactly what the live check exists to catch. Out of scope for this
   task; flagged for Eyad.

## Cleanup performed

A temporary `GRANT drift_readonly TO postgres WITH SET` was added only to allow
`SET ROLE` while proving the role is read-only, then **revoked**. Final state:
`drift_readonly` is a member of no roles and no role is a member of it beyond
Postgres defaults.
