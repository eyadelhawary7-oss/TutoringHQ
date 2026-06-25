# Schema baseline & drift detection

## The one rule

**The production database is the source of truth. Code catches up to the
database — never the other way around.** Phase 0 made the repo a faithful mirror
of live and added automation so it can never silently drift again.

From now on, **every schema change goes through a tracked migration** in
`supabase/migrations/`. Never change the schema via the Supabase dashboard, the
MCP server, or ad-hoc `psql`. Anything applied directly to prod is a "ghost" —
it breaks rebuilds and trips the live-drift check.

## How we got here

A point-in-time audit found that ~47 of 139 tables, 41 functions and 15 triggers
existed in production but in **no** migration and **no** git commit — including
core tables (`users`, `students`, `centers`, `payments`, `subscriptions`) and
live security guards (the `chq_prevent_*_escalation` triggers, the append-only
`audit_log` guard). There was no baseline migration; a from-scratch rebuild would
not have reproduced production. Full list: [SCHEMA_GHOST_INVENTORY.md](./SCHEMA_GHOST_INVENTORY.md).

## The model

```
supabase/migrations/
  00000000000000_baseline.sql   ← AS-IS photograph of the live public schema
  <future timestamped migrations…>   ← every change from here on
supabase/migrations_archive/
  001_… … 20260624203826_…       ← the 217 superseded migrations (history kept)
db/
  schema.snapshot                ← canonical normalized snapshot (drift reference)
  cron.snapshot                  ← pg_cron jobs (operational; live-drift only)
scripts/schema/
  introspect.sql                 ← emits the normalized snapshot (version-stable)
  generate-baseline.sql          ← regenerates baseline.sql from a live DB
  test-shim.sql                  ← Supabase-managed surface for test rebuilds only
  rebuild.sh / check-drift.sh    ← rebuild a fresh DB and diff vs the snapshot
```

### Baseline (`00000000000000_baseline.sql`)
A complete, AS-IS schema-only capture of the live `public` schema: extensions,
every table (columns/types/defaults/nullability), all PK/UNIQUE/CHECK/FK
constraints, all indexes, all functions (verbatim), all triggers, RLS enable +
every policy, the current grants (frozen), the 2 views, and the
`storage.objects` policies. It is **generated**, not hand-written — regenerate
with `scripts/schema/generate-baseline.sql`, never hand-edit.

Supabase-managed extensions (`pg_net`, `pg_cron`, `supabase_vault`,
`pg_graphql`) are wrapped in availability guards so the baseline also applies on
a plain Postgres (CI/local); on Supabase they install normally. The four managed
extensions and the `auth.*` / `storage.*` helpers a rebuild needs are supplied
for **test environments only** by `test-shim.sql` — never applied to prod.

### Snapshot (`db/schema.snapshot`)
A normalized, ordered, one-line-per-object text rendering of the schema produced
by `introspect.sql`. It is **catalog-based and Postgres-version-stable**:
function bodies are compared by `md5(prosrc)` (not version-sensitive deparse),
grants are frozen for the app roles (`anon`/`authenticated`/`service_role`/
`PUBLIC`), and the output is identical whether produced on the live PG17 prod DB
or a rebuilt PG17 database. It is the reference both drift checks diff against.

## The two drift checks

### 1. CI drift gate — `.github/workflows/schema-drift.yml`
On every PR/push touching migrations or the snapshot: spin up a fresh
`postgres:17`, apply `test-shim.sql` + all migrations, run `introspect.sql`, and
diff against `db/schema.snapshot`. **Any** difference fails the build — a
migration that changed the schema without updating the snapshot, or a snapshot
edited without a matching migration. Covers tables, columns, types, defaults,
constraints, indexes, RLS policies, triggers, functions and grants.

When you intentionally change the schema: write the migration, then regenerate
the snapshot and commit it alongside:
```bash
scripts/schema/rebuild.sh db/schema.snapshot   # against a throwaway PG17
```

### 2. Live drift check — `.github/workflows/schema-drift-live.yml`
Daily, read-only: introspect the **live prod** schema and diff vs
`db/schema.snapshot` (and `cron.snapshot` for pg_cron jobs). Catches a ghost
created directly on prod. It **never mutates** the database; on drift it fails
the job (notifying watchers) and prints a categorized diff. Requires a read-only
prod DSN in the `SCHEMA_DRIFT_DATABASE_URL` repo secret; absent that, it skips.

> **Why GitHub Actions and not a Vercel cron route?** A `src/app/api/cron/*`
> route cannot run the full catalog introspection without either a new
> server-side Postgres driver + direct connection, or a new
> `SECURITY DEFINER` introspection function in the database. The latter is
> **prod DDL, which Phase 0 forbids**. A scheduled GitHub Action reuses the exact
> same `introspect.sql` as the CI gate, stays strictly read-only, and adds no
> production surface. Once a tracked migration can add a read-only introspection
> RPC (a later phase), this can move into the Vercel cron family if desired.

## Rebuilding / squash & ledger

The 217 incremental migrations that produced the current state are archived under
`supabase/migrations_archive/` (git history preserved). A fresh database now
rebuilds from **baseline + future migrations only**, with no double-apply.

Production already matches the baseline, so the baseline is recorded in prod's
migration ledger as **already-applied** (a reversible one-row "repair", not a
run) — it must never execute against prod. See the Phase 0 report for the exact,
reversible ledger operation.

## Known faithful-capture caveats (intentional, AS-IS)
- Object **ownership** is not reproduced by the baseline: a rebuild owns objects
  as the applying role. Prod ownership is untouched (the baseline never runs
  against prod). The snapshot/diff compares behavior-relevant attributes
  (signature, body, volatility, security, grants), not owner.
- `pg_cron` jobs and `auth`/`storage`/`vault`/`net` internals are Supabase-managed
  and out of the public-schema baseline; cron jobs are tracked separately in
  `db/cron.snapshot` for the live-drift check.
