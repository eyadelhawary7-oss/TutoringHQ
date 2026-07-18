# Cleanup Batch 5 - findings and decisions

> Point-in-time snapshot (Cleanup Batch 5). Reviewed against the live database and code on 2026-07-18 — findings preserved as recorded; only demonstrably-false current-state counts are annotated inline (verified live 2026-07-18). The pin_code-dropped and CSRF-fails-closed findings below match the live state today.

Held branch `claude/cleanup-batch-job-5-c4lo8q`. Do not merge without review. No
migration in this batch was applied to production. Every database claim below was
checked against the live catalog (information_schema, pg_catalog, pg_policy,
pg_proc) on the TutoringHQ project, not against schema_migrations or any prior
summary.

The branch carries two commits, kept separate on purpose:

- Commit 1 (Part 1): safe code cleanup. No DDL, no schema, no data.
- Commit 2 (Part 2 + Part 3): this findings document. The database investigation
  concluded that no migration is safe or needed in this batch, so the "database"
  commit is documentation only. Details below.

---

## Part 1 - safe cleanup (Commit 1)

### 1. Stale CSRF comment - FIXED

`src/lib/csrf.ts`, `isCSRFEnabled`. The old comment read: "When CSRF is disabled
(no secret), validation passes." That is the opposite of the code. When the
secret is missing or malformed, `validateCSRFRequest` returns false at its first
line (`if (!isCSRFEnabled()) return false;`), so every state-changing caller
returns 403. The function fails CLOSED, in every environment. Comment rewritten to
match the code and to reference PR #161 where the fail-closed behaviour was
proven. Behaviour unchanged; comment only.

### 2. Orphaned soft-delete route - REMOVED (DELETE handler only)

`DELETE /api/students/[id]` (a soft delete that set `is_active = false`) had zero
callers. Evidence:

- Whole-repo grep for `method: 'DELETE'` fetches: 6 hits, none targeting
  `/api/students/`. They target `teacher/center-requests`, `admin/promo-codes`,
  `card-order-cart`, `admin/centers`, `admin/centers/[id]/notes`, `admin/team`.
- Enumeration of every `/api/students/` reference in src + tests: only `at-risk`,
  `lifecycle`, `pending`, `pending/[id]/approve`, `pending/[id]/reject` are
  called. The `[id]` route appears only in its own `console.error` strings.
- The students roster UI (`src/app/[locale]/students/`) has no swipe-to-delete,
  no `can_delete_students` reference, and no client-side `is_active: false`
  update path.

Removed the DELETE handler and its now-unused `requirePermission` import.

Reported, left in place: PATCH and GET on the same `[id]` route are also
currently uncalled. The task scoped this item to the DELETE route, so PATCH/GET
were left alone. Removing the whole file is a reasonable follow-up if Eyad wants
it, but that is a wider decision than a DELETE-route cleanup.

### 3. Dependency warnings - NOTHING CLEARED, all reported (see below)

### 4. Gates - all green

`npm run typecheck` exit 0, `npm run lint` 0 errors (159 pre-existing warnings,
none in the two touched files), `npm run test:unit` 1367 tests passing.

### Dependency audit detail (Part 1.3)

`npm audit` reports 25 vulnerabilities (2 low, 23 moderate, 0 high, 0 critical),
all in transitive dependencies. Nothing was changed, because every available fix
is either a forbidden major bump or unacceptable churn for a cleanup batch:

Require `npm audit fix --force`, i.e. a MAJOR breaking downgrade - SKIPPED:

- `@opentelemetry/*` (unbounded memory alloc) reached through `@sentry/node` and
  `posthog-js`. The clean fix downgrades `@sentry/nextjs` to 6.3.5 (from ^10.50).
- `postcss <8.5.10` (XSS in stringify), reached through Next's bundled postcss.
  The clean fix downgrades `next` to 9.3.3.
- `uuid <11.1.1` (missing buffer bounds check), reached through `exceljs`. The
  clean fix downgrades `exceljs` to 3.4.0.

Fixable only via a broad non-force `npm audit fix` - NOT DONE in this batch:
`dompurify` (via jspdf + posthog), `brace-expansion`, `js-yaml`, `qs`, `esbuild`,
`@babel/core`. Running `npm audit fix` here does not surgically patch these; it
also bumps runtime-critical `@sentry/*` 10.53 -> 10.66, PostHog internals,
several `@opentelemetry/*` packages, and `next` 16.2.6 -> 16.2.10, and floods the
lockfile with ~100 cross-platform optional binaries. That is a dependency-upgrade
PR, not a cleanup no-op, and it churns the exact instrumentation (Sentry, Next)
that this batch should not destabilise.

Recommendation for a separate, dedicated deps PR (Eyad to review): pin the
low-risk transitives via the existing `overrides` block in package.json (the same
mechanism already used for protobufjs/tmp/vite/ws), rather than a blanket
`npm audit fix`. None of these are high/critical and most are dev/build only.

---

## Part 2 - database changes (Commit 2). No migration written or applied.

### 1. Revoke anon EXECUTE on the flagged SECURITY DEFINER helpers - LEAVE ALL. Do not revoke.

The July 2026 scan (Supabase advisor lint `0028_anon_security_definer_function_executable`)
flags exactly 6 SECURITY DEFINER functions as anon-executable. Confirmed live via
`pg_proc` + `aclexplode` (prosecdef = true, anon has EXECUTE):

1. `get_auth_center_id()`
2. `get_auth_center_group_ids()`
3. `get_auth_teacher_group_ids()`
4. `has_center_role(text[])`
5. `is_auth_teacher_suspended()`
6. `is_teacher_private_locked()`

All 6 are RLS-internal helpers. They are referenced by RLS policies that apply to
PUBLIC (pg_policy.polroles = {0}), which means PostgreSQL evaluates them as the
`anon` role whenever anon touches the protected table. Live `pg_policy` evidence
(applies_to_public = true), per function:

- `get_auth_center_id`: content_access_insert, content_items_*, teacher_center_select, transactions_select
- `get_auth_center_group_ids`: assessments_*, enrollments_*, group_join_links_*, sessions_*, transactions_select
- `get_auth_teacher_group_ids`: assessment_scores_*, assessments_*, attendance_scans_*, enrollments_*, group_join_links_*, sessions_*, students_teacher_select, student_groups_teacher_select
- `has_center_role`: assessment_scores_*, assessments_*, content_access_insert, content_items_*, group_join_links_*, sessions_*, teacher_center_select, transactions_select
- `is_auth_teacher_suspended`: assessment_scores_*, assessments_*, attendance_scans_*, enrollments_insert, group_join_links_*, sessions_*, student_groups_teacher_*
- `is_teacher_private_locked`: content_access_insert, content_items_*, student_credits_select, student_group_notes_teacher_*, student_groups_teacher_*

And `anon` holds table-level grants (SELECT/INSERT/UPDATE/DELETE) on every one of
those tables (confirmed via `information_schema.role_table_grants`:
group_join_links, student_groups, sessions, enrollments, assessments,
assessment_scores, attendance_scans, content_items, content_access,
student_credits, student_group_notes, students, teacher_center, transactions).

Therefore revoking anon EXECUTE on any of these 6 would make anon-role queries on
those tables fail with "permission denied for function ..." - breaking the
public, logged-out paths that legitimately hit them (the group join-link /
self-enroll flow being the documented example).

This is not a new judgement. It is the same decision already made, applied, and
tested in the repo:

- `supabase/migrations/20260626134308_phase6f_tighten_anon_definer_funcs.sql`
  header explicitly lists get_auth_center_id, get_auth_center_group_ids,
  get_auth_teacher_group_ids, has_center_role, is_auth_teacher_suspended as
  "KEEP anon ... NOT TOUCHED HERE" for this exact reason.
- `supabase/migrations_archive/20260621215634_revoke_anon_execute_business_rpcs.sql`
  says the same: revoking these "would make those queries fail with 'permission
  denied for function'".
- `tests/unit/sql/phase6-security-migrations.test.ts` has a test asserting these
  helpers must NOT appear in any revoke list.

`is_teacher_private_locked` is the one not named in the phase6f keep-list (it was
likely added to policies after that migration), but the live evidence puts it in
exactly the same category, so it gets the same treatment: keep.

Grep also confirms no app code calls these as PostgREST RPCs (`.rpc('get_auth_*')`
etc.); the only in-repo references are the SQL migrations that define/keep them
and the phase6 tests. The advisor warning is a known, accepted false positive. A
broken public path is worse than silencing a warning. No revoke migration written.

### 2. Dead `pin_code` column - ALREADY DROPPED. Nothing to write.

`users.pin_code` no longer exists in production. Confirmed live twice:
`information_schema.columns` for `public.users` returns no `pin_code` row, and the
full column list ends at `pin_attempts, pin_locked_until, pin_set_at` with no
`pin_code`. The drop migration already exists in the repo at
`supabase/migrations/20260701150506_drop_pin_code.sql` (idempotent
`DROP COLUMN IF EXISTS`) and has already reached production.

Grep confirms no code reads or writes the column: the only `pin_code` hits in
`src/` are in `src/lib/waTemplatePreviewSamples.ts`, where `pin_code` is a
WhatsApp template variable name (the `{{pin_code}}` placeholder in the
`chq_pin_delivery` sample), unrelated to the dropped DB column. All other hits are
docs and migration files.

So there is nothing to drop and no migration to write. Writing another drop would
be redundant.

---

## Part 3 - report only. Nothing changed.

### 1. Zero-policy RLS tables - now 21, not 18. Deny-by-default confirmed. Add no policies.

RLS is enabled with zero policies (deny-by-default; only service_role, which has
BYPASSRLS, can touch them) on 21 tables, not the 18 previously believed. Confirmed
two ways: a `pg_class`/`pg_policy` catalog query and the Supabase advisor
(`0008_rls_enabled_no_policy`), which agree exactly. The count has drifted up by
three since the "18" figure was recorded.

*(Update, verified live 2026-07-18: the deny-all count is now **22**, not 21 — `billing_lockout_events` (added with the built-but-inert billing-lockout ledger) joined the set. Do not treat any figure here as permanent; recount live. The 22 tables at 2026-07-18: the 21 below plus `billing_lockout_events`.)*

The 21 tables (as of this batch):

attendance_overrides, billing_nudges, billing_reconciliation_reports,
card_charge_intents, card_order_status_transitions, card_order_status_wa_dedupe,
chargebacks, enrollment_otps, group_slot_proposals, pending_enrollments,
pending_signups, phone_verifications, pin_setup_tokens, promo_code_requests,
recurring_charge_declines, saved_card_consents, saved_card_events, saved_cards,
teacher_assignments, teacher_signup_otps, trial_claims.

Every one is a sensitive, server-managed table: payment card tokens and consents,
OTP / verification / pin-setup tokens, signup and pending-enrollment PII, and
billing internals (nudges, reconciliation, chargebacks, declines, charge intents).
Deny-by-default is the correct posture; they are meant to be reached only by
server code through the service-role client. Confirmed the RLS-on/zero-policy
state is intact. Do NOT add permissive policies. This is a report only.

### 2. Hand-rolled auth routes - report only, change nothing.

Scope of the scan: every API route that authenticates the caller itself was
identified by grepping `src/app/api` for inline `supabase.auth.getUser(` /
`.auth.getSession(` and for inline `isSuperAdminPhone` / `SUPER_ADMIN_PHONES`
usage (the two signals of a route doing its own auth). That produced 24 candidate
routes, each read and then adversarially re-checked. The other ~230 API routes
import a standard gate (`requireCenterAuth` / `requireOwnerAdminCenter` /
`requirePermission` / `admin-access`) and are not hand-rolled.

Important context confirmed from `src/proxy.ts`: `AUTHENTICATED_ROUTE_PREFIXES`
holds only page prefixes (`/students`, `/analytics`, `/admin`, ...); none match
`/api/*`. The middleware does not force login on API routes, so each API route is
its own auth boundary. A hand-rolled route that calls `auth.getUser()` is still
authenticated, but it skips the suspension / blacklist / billing-status checks
that `requireCenterAuth` bakes in, and it re-implements auth (a maintenance and
consistency risk).

Nothing below was changed. Rewriting an auth path is not a cleanup task; some of
these are deliberate.

#### Hand-rolled inline auth (12 center/org routes)

Each defines a private helper (`getUserContext` / `getContext` /
`getAnalyticsAuth` / `getOrgContext` / `getAuthContext`) that reads the
`Authorization: Bearer` token, validates it with an anon-key client
`auth.getUser()`, then uses a service-role client to resolve center / org / role,
instead of `requireCenterAuth`. All 12 therefore skip the suspension / blacklist
gate.

- `analytics/consolidated` (GET): org-level analytics (MRR, students, outstanding, per-branch) across all centers in the org.
- `analytics/revenue` (GET): one center's finance dashboard. Also hand-rolls super-admin detection (admin_users + `isSuperAdminPhone`) and honours `?center_id=` for super-admins. Note: it correctly refuses to trust `users.role` (comment cites a prior privilege-escalation P0), so this one is security-aware even though it bypasses the gate.
- `benchmarks` (GET): center benchmark metrics via the `get_center_benchmarks` RPC on a service-role client (RLS bypassed; tenant isolation rests on the inline center_id / org / branch_user_assignments checks).
- `billing/initiate-payment` (POST): initiates a Paymob subscription payment. Hand-rolled auth AND no `validateCSRFRequest` on a state-changing, money-touching POST. Worth a closer look by Eyad, but not a cleanup edit.
- `branches` (GET/POST): list / add branches (centers) in the caller's org.
- `db` (POST): the legacy `/api/db` typed proxy. Deliberate and documented (`docs/DB_PROXY_SECURITY.md`); it does its own scoping (`dbProxyScope`) and its own comment states it runs no suspension gate. Intentional, not an oversight. Do not "fix".
- `onboarding/first-student` (POST): creates a center's first student. Does enforce `can_manage_students` and a guardian-consent gate, but skips suspension. Docs already note this is a legacy route not wired into the current UI.
- `realtime/subscribe` (POST): Realtime channel handshake; Bearer first, cookie-session fallback; authorises by matching the channel UUID to the caller's center / staff.
- `students/at-risk` (GET): at-risk students with PII (name, student_number, parent_phone, balance). Called by the dashboard and AtRiskPanel.
- `user/locale` (POST): updates the caller's own `preferred_locale`. Lowest risk of the set (only touches the caller's own row).
- `whatsapp/send-balance-reminder` (POST): sends outbound WhatsApp balance reminders to parents in the caller's center.
- `whatsapp/send-welcome-test` (POST): sends the onboarding welcome WhatsApp template to the center owner's phone.

The first three (`send-balance-reminder`, `at-risk`, `analytics/revenue`) are the
same three `docs/ENTERPRISE_ARCHITECTURE_AUDIT_2026-07-07.md` already flagged as
"ad-hoc inline auth copies ... skip the suspension gate baked into
requireCenterAuth - unify them". This scan confirms that finding and extends it to
the fuller list above.

#### Mixed (3 internal-admin routes)

These are internal-admin / super-admin routes gated against `admin_users` +
`SUPER_ADMIN_PHONES`, so `requireCenterAuth`'s tenant suspension gate does not
apply to them. The issue is two parallel auth paths that must be kept in sync by
hand, not a tenant bypass.

- `admin/overview` (GET): a cookie `getSession()` + inline `admin_users` /
  `SUPER_ADMIN_PHONES` path, plus a `getAdminContext` bearer fallback; the finance
  role gate is hand-rolled inline rather than via `requirePermission`.
- `admin/pending-signups` (GET/POST/DELETE): GET reimplements the admin check
  inline, while POST/DELETE use the standard `getAdminContext`. The two paths can
  drift; `getAdminContext` carries hardening the inline GET path does not.
- `admin/centers` (GET/POST/PUT/DELETE): admin center management with a similar
  split between inline and helper-based auth.

#### Properly gated (for completeness, not findings)

- Standard gate: `admin/centers/[id]`, `admin/pricing/plans/[plan_key]`
  (`requireSuperAdminApi` + `requireSuperAdminRow`), `admin/team`
  (`getAdminContext`), `invoices/[id]/pdf`.
- Auth primitives (doing their own `getUser` is inherent to the endpoint):
  `me`, `csrf-token`, `auth/check-invite`, `accept-invite/complete`,
  `signup/complete`.

Recommendation (for a separate change Eyad approves, not this batch): migrate the
12 center/org hand-rolled routes onto `requireCenterAuth` so they inherit the
suspension / blacklist / billing gate, and collapse the 3 mixed admin routes onto
a single `getAdminContext` path. `billing/initiate-payment`'s missing CSRF check
deserves its own look. `/api/db` stays as-is by design.

### 3. "Duplicate test student #007-0001" - not a duplicate, not test data. Do not delete.

The claim does not survive the live data. Querying `students` for
`student_number ILIKE '%007-0001%'` returns exactly ONE row:

- student_number `#007-0001`, name "Eyad Elhawary", `is_guest = false`,
  `is_active = true`, center `fcd5c5ef-...`, created 2026-07-08.

Findings:

- Not a duplicate at the row level: only one row carries `#007-0001`. The only
  `student_number` value that appears more than once in the whole table is NULL
  (2 rows).
- Not test data by any of the stated criteria: there is no `is_test` column on
  `students` (test rows elsewhere use `is_guest`, which is false here), there is
  no `notes` column so no `e2e_seed:v1` marker can live on the row, and `#007-0001`
  is not a `TEST-xxxxx` number.
- It looks like real / production data: the name is the owner's own
  ("Eyad Elhawary"), active, non-guest, in a real center.

There is a plausible SEMANTIC duplicate, worth flagging to Eyad: the same center
also has `#007-0000`, same name "Eyad Elhawary", created 2026-07-07 (one day
earlier), also active and non-guest. This looks like the owner's own throwaway
self-entries made during setup, but neither meets the test-data bar, so both are
treated as production rows.

Per the task and the repo rules: do not delete production rows in a cleanup batch,
even if they look like throwaways. Reported for Eyad to decide.

---

## Deliberately excluded (not done, by instruction)

`pg_trgm` and `pg_net` are flagged by the Supabase linter as "extension in public
schema" (advisor `0014_extension_in_public`, WARN). They were left in place.
`idx_students_phone_trgm` is a live GIN index on `students` using trgm operator
classes; moving the extension risks breaking unqualified trgm operators in student
phone search unless the new schema is on every relevant role's search_path. The
benefit is silencing a warning; the cost is the students page, which already went
down once this month. Not touched, as instructed.
