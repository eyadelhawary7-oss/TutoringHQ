# Database history rebuild + `pin_code` drop — technical note

Project: Supabase `lczmjpnbuhnsislcvzar` (PostgreSQL 17.6, eu-west-2).
Branch: `claude/db-history-rebuild-pin-code-hnbhpv`. **No PR opened — held for review.**

Ground truth throughout is the **live catalog** (`information_schema`, `pg_proc`,
`pg_get_functiondef`, `pg_constraint`, `pg_policies`, `pg_indexes`, and
`supabase_migrations.schema_migrations`), read via the Supabase MCP. The only
production mutation performed by this job is the single `pin_code` column drop
(plus two bookkeeping rows in the migration ledger — no schema, no data).

---

## WORKSTREAM 1 — Ground truth: the three inventory lists

Live migration ledger: **235 rows** at start (min version `00000000000000`, the
Phase-0 baseline repair). Repo `supabase/migrations/`: **26 files**. The earliest
real repo migration is `20260625000001`; the last archived migration
(`supabase/migrations_archive/`, 217 files) is `20260624203826` — so the baseline
boundary is clean and contiguous.

### (a) Ledger entries with no repo file — the missing history
**212 ledger rows** with `version < 20260625000001`: the `00000000000000`
baseline row + 211 pre-existing historical rows. Their SQL lives in
`supabase/migrations_archive/` (217 files; the ledger had 211 rows for them — a
pre-existing incoherence). All of this pre-baseline history is **squashed into
`00000000000000_baseline.sql`** (an AS-IS photograph of the live `public`
schema, produced in Phase 0). Nothing here needs a new repo file.

### (b) Repo files whose version/timestamp did not match the ledger — the drift
The recent repo files carried **synthetic sequential timestamps**; the live
ledger carried the **real applied timestamps**. 17 applied migrations were
misnamed. Reconciled by renaming the repo file to the ledger version (content
identical; the example from the brief is the first phase6a row):

| repo (old, synthetic)                               | ledger / repo (new, real)       |
|-----------------------------------------------------|---------------------------------|
| 20260625000005_invoice_correction_audit             | 20260625203915                  |
| 20260626000001_phase6a_lockdown_definer_rpcs        | 20260626134248                  |
| 20260626000002_phase6b_restrict_global_recompute    | 20260626134256                  |
| 20260626000003_phase6f_tighten_anon_definer_funcs   | 20260626134308                  |
| 20260628000001_summer_2026_promo_billing            | 20260628110833                  |
| 20260628000002_teacher_free_baseline_gate           | 20260628135521                  |
| 20260630000001_teacher_annual_billing_interval      | 20260630090857                  |
| 20260630000002_teacher_scale_overage                | 20260630113619                  |
| 20260630000003_scheduled_downgrade_fields           | 20260630154550                  |
| 20260630000004_teacher_plan_change_keep_renewal     | 20260630154913                  |
| 20260702000001_content_access_log_tenant_scope      | 20260702080943                  |
| 20260702100001_freeze_commission_audit_log          | 20260702100711                  |
| 20260702100002_money_columns_nonneg_and_scale       | 20260702103347                  |
| 20260702100003_money_audit_fk_delete_rules          | 20260702103413                  |
| 20260702100004_missing_fks_unique_and_last4_guards  | 20260702103429                  |
| 20260702100005_parent_portal_token_hardening        | 20260702105138                  |
| 20260702100006_privacy_request_admin_flow           | 20260702105640                  |

The rename preserves the exact relative order (synthetic order ↔ real order are
monotonic), so the from-zero rebuild is unaffected. Files already matching the
ledger were left alone: `20260625000001..000004` (phase1a–phase3),
`20260701100354` (referral_commissions_align), `20260701150505` (add_pin_set_at).

### (c) Repo files not in the ledger
Two, at job start:
1. **`drop_pin_code`** — genuinely unapplied; `users.pin_code` still existed on
   prod. This is the one permitted production change (WS4).
2. **`hotpath_indexes_and_dedupe`** — a **ghost application**: the migration's
   schema effects were already on live (verified: all 9 new FK indexes present,
   all 7 duplicate indexes gone) but the migration was never recorded in the
   ledger. Reconciled with a ledger **repair row** (version `20260702105641`,
   empty `statements` — a no-op marker, same mechanism Phase 0 used for the
   baseline). No schema change: the indexes already exist.

### (d) Additional finding — function-body drift (discovered, not in the brief)
Per-category catalog diff (live vs committed snapshot) showed **two** drifted
areas: `20_col` (the expected `pin_code`) **and `70_fun`**. Two functions had a
different `bodymd5` on live than in the committed snapshot:

- `is_teacher_private_locked()`
- `process_due_subscriptions(p_as_of timestamptz)`  ← teacher-billing RPC

The delta is **comments only**. The live stored `prosrc` is byte-identical to the
repo migration body with the inline `--` comment lines removed — the SQL logic is
identical. Root cause: the version applied to prod (`teacher_free_baseline_gate`,
ledger `20260628135521`) was comment-free, while the repo file carried
explanatory `--` comments inside the function bodies; the snapshot had been
regenerated from a rebuild of the commented file, so it matched the repo, not
prod. **No behavioural / billing-logic drift.** Every other category
(constraints, indexes, policies, triggers, views, table/routine grants, tables,
extensions, storage policies) is byte-identical live-vs-repo.

Resolution (repo-only, no prod change): the `--` comments were **relocated
outside** the two function bodies (comments outside `$function$…$function$` don't
affect the stored `prosrc`), so the from-zero rebuild now reproduces the live
bodies exactly. Verified byte-exact:

```
is_teacher_private_locked  stored-body md5 = 496e6020df1f7617fe2e36b0b0b4ac51 = LIVE
process_due_subscriptions  stored-body md5 = ff528d8763ed878854cd4179fba8e70e = LIVE
```

---

## WORKSTREAM 2 — Baseline for the missing history

Approach chosen: **baseline at the boundary before the earliest repo migration**
(brief's preferred option). `00000000000000_baseline.sql` (from Phase 0) captures
the full live `public` schema as-is; the 16+ recent migrations remain real,
auditable files; the 217 superseded files stay in `migrations_archive/`. The
baseline is already recorded in the prod ledger as applied (version
`00000000000000`, a one-row repair inserted in Phase 0), so it never executes
against prod. Confirmed: it did not run here; production was untouched by the
baseline.

Verification the boundary is exact: `min(version)=00000000000000`; last archived
= `20260624203826`; first repo migration = `20260625000001` — contiguous, no gap.

---

## WORKSTREAM 3 — Version-drift reconciliation

- Renamed the 17 drifted files to their ledger versions (table above) with
  `git mv` (+ the `hotpath` file to `20260702105641`).
- Updated two file-level comment self-references and two unit tests
  (`invoiceCorrectionAudit`, `phase6-security-migrations`) that read migrations
  by their old names.
- Ledger repairs (metadata only, reversible):
  - `20260701150506 drop_pin_code` — statements recorded (the actual drop).
  - `20260702105641 hotpath_indexes_and_dedupe` — empty statements (ghost repair).

### Dry-run push equivalent — proof of zero live changes
No Supabase CLI / prod DSN is available in this environment, so the equivalent
check is: **every repo migration file version must be present in the live
ledger** (a `db push` applies exactly the local versions absent from the remote
history). Result:

```
pending_count        = 0
would_apply_to_live  = (none)
repo_migration_count = 26
ledger_total         = 237
```

A push would apply **nothing** to production.

---

## WORKSTREAM 4 — Drop the old `pin_code` column

### Safety proof (before dropping)
- **Code:** full-repo grep for `pin_code`. The only `src/` hits are an unrelated
  WhatsApp template placeholder (`waTemplatePreviewSamples.ts`). The former
  readers/writers were already removed in PR #117; the authoritative gate is
  `users.pin_set_at`. One dead writer remained in the one-off script
  `fix-audit-passwords.mjs` (`pin_code: u.password`) — removed in this branch.
- **Database:** no function body, RLS policy, index, view, constraint, or column
  default on live references `users.pin_code` (catalog query returned empty).
- **Data:** `users` = 6 rows; `pin_code` non-null = **0** (dead for every user);
  `pin_set_at` non-null = **6** (populated for all real users).
- **Sign-in:** login authenticates against `auth.users.encrypted_password`
  (7 set), which is independent of `public.users.pin_code`; the login/PIN paths
  read `pin_set_at`. Dropping `pin_code` cannot affect sign-in. All 1081 unit
  tests (incl. the auth PIN suites) pass.

### Applied (the only production mutation)
```sql
ALTER TABLE public.users DROP COLUMN IF EXISTS pin_code;
notify pgrst, 'reload schema';
```
Verified afterwards: `information_schema` reports `pin_code` **gone** (0). Ledger
row recorded at the repo file's version `20260701150506`. The from-zero rebuild
ends without `pin_code` (the `drop_pin_code` migration is in the run path once).

---

## WORKSTREAM 5 — Rebuild-from-zero proof + gates

The snapshot was **regenerated to equal the live catalog introspection**
(`introspect.sql` run against live post-drop) — not hand-tuned — and the equality
is proven by md5. Both gates:

**Live-drift gate (snapshot == live):**
```
live introspection md5 (post-drop) = 7378a91e35871a5aaea73cc31ccadd5f
db/schema.snapshot md5             = 7378a91e35871a5aaea73cc31ccadd5f   ✓
```

**Rebuild gate (migrations-from-empty == snapshot):** a fresh database was built
from empty (test-shim + `00000000000000_baseline.sql` + all 25 following
migrations, in order) and introspected:
```
rebuild-from-zero snapshot md5     = 7378a91e35871a5aaea73cc31ccadd5f
diff vs db/schema.snapshot         = 0 lines   ✓
```
(Run locally on PostgreSQL 16 — the PG17-only `MAINTAIN` grant privilege, which
`information_schema` does not expose and which is therefore absent from the
snapshot, was stripped from the grant lists for the local run only; it has no
effect on the snapshot. The byte-identical match on PG16 confirms the
introspection is genuinely Postgres-version-stable. CI's `schema-drift.yml`
re-runs the same rebuild on `postgres:17`.)

Transitively: **rebuild-from-zero == snapshot == live**, with `pin_code` gone.

Snapshot: 6187 lines · 139 tables · 1617 columns · 660 constraints · 305 indexes
· 221 policies · 42 triggers · 111 functions · 2 views · 2850 table grants · 230
routine grants · 5 storage policies · 5 extensions.

**Tests / typecheck:** `npm run test:unit` → 128 files, 1081 tests pass.
`npm run typecheck` → clean.

---

## Reversal notes (if ever needed)
- `pin_code` drop: it was dead (all-NULL); if truly needed, re-add
  `ALTER TABLE public.users ADD COLUMN pin_code varchar(6)` and
  `DELETE FROM supabase_migrations.schema_migrations WHERE version='20260701150506'`.
- Ledger repairs: `DELETE FROM supabase_migrations.schema_migrations WHERE
  version IN ('20260701150506','20260702105641')`.
- Function comment relocation: cosmetic; git history holds the prior file.
