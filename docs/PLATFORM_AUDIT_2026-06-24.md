# CenterHQ / TutoringHQ — Whole-Platform Audit

**Date:** 2026-06-24
**Type:** Static code + **live database catalog** audit (read-only). No changes were made.
**Auditor scope:** DB drift, multi-tenant isolation/RLS, auth & access control, money integrity, webhooks & async jobs, secrets/config, child-safety/PDPL, frontend correctness, dead code, test coverage.
**Live DB introspected:** Supabase project `lczmjpnbuhnsislcvzar` (Postgres 17), 139 tables.

> **Limits of this audit.** This is a code + database-catalog review. It does **not** replace a live penetration test, a real payment-gateway sandbox run, or load testing. "CONFIRMED" means verified against the live catalog or by reading the exact code path; "SUSPECTED" means strong evidence but a dynamic test is needed to be sure. Findings about exploitability of RPCs/RLS were verified against live ACLs and policy definitions but were **not** executed against the live system.

---

## Executive summary

The platform is, on the whole, **more hardened than typical pre-launch SaaS**: RLS is enabled on all 139 tables, webhook HMAC verification is solid, all 41 cron routes fail closed on a missing `CRON_SECRET`, the PIN auth flow has lockout + weak-PIN rejection + single-use tokens, and the invoice tamper trigger + service-role-only write policies make invoices genuinely hard to forge. The team has clearly been through one security pass already.

**But the database is drifting badly from the code, and three issues can lose money or leak tenant data today.**

### Findings by severity
- **CRITICAL: 4** — (1) entire live schema is unreproducible from migrations + ghost security triggers; (2) `earn_credits_atomic` / `process_payment_rpc` and other money RPCs are directly callable by any authenticated user with attacker-chosen `center_id`/amount; (3) the AI-query route runs LLM-authored SQL as service-role; (4) combined-payment finalize can consume a customer's credit and then permanently dead-lock the session.
- **HIGH: 5**
- **MEDIUM: 9**
- **LOW: 6**

### Top 5 that genuinely matter
1. **The migrations cannot rebuild the database.** 47 of 139 live tables — including `users`, `centers`, `students`, `payments`, `subscriptions`, `commissions` — have **no `CREATE TABLE` in any committed migration**, and ~23 functions + 7 triggers (including the `users`/`centers` privilege-escalation guards and `audit_log` immutability) exist live with **zero presence in git history**. This is the exact "ghost object" class that burned you before, at scale. (DRIFT-1, DRIFT-2)
2. **Free money via unguarded definer RPCs.** `earn_credits_atomic(center_id, amount,…)` is granted to `authenticated` and never checks the caller owns `center_id` — a logged-in owner can mint themselves account credit; `process_payment_rpc` can mark a subscription invoice paid for 0.01 EGP. (AUTH-DB-1)
3. **LLM-authored SQL executed as service-role** in `/api/ai/query` → cross-tenant read exfiltration. (AUTH-1)
4. **Credit-loss + permanent session lock** in `combinedPaymentFinalize.ts` when a finalize step fails after the lock is taken. (MONEY-1)
5. **Silent payment/notification drop**: outbox jobs stuck in `processing` are never retried and dead-letter rows are never surfaced to anyone. (ASYNC-1)

---

# CRITICAL

## DRIFT-1 — The live schema cannot be rebuilt from the committed migrations · CONFIRMED
**Where:** `supabase/migrations/` vs live catalog.
**Evidence:**
- 47 of 139 live tables have **no `CREATE TABLE` statement in any migration file**, including core tables: `users`, `centers`, `students`, `payments`, `subscriptions`, `transactions`, `commissions`, `enrollments`, `groups`, `sessions`, `staff`, `webhook_inbox`, `webhook_outbox`, `chargebacks`, `assessments`, `content_items`, `phone_verifications`, `parent_pack_billing`, …
- Migration `001_whatsapp_tables.sql` already does `REFERENCES centers(id)` / `REFERENCES students(id)` — i.e. the base tables existed **before** the first committed migration. There is no baseline/`schema.sql` dump in the repo.

**Why it matters (plain terms):** You cannot stand up a fresh staging or disaster-recovery database from this repo. Anyone running the migrations on an empty DB gets failures (missing base tables) and a schema that does **not** match production. CI/tests run against a hand-built or shared DB, so schema regressions are invisible — which is precisely how a "ghost" object lived in prod undetected. This is the root cause of the whole drift class.

**Suggested fix:** Generate a baseline migration from the live DB (`supabase db dump` / `pg_dump --schema-only`), commit it as `0000_baseline.sql`, and reconcile the migration ledger so a clean replay reproduces production. Then make CI run the full migration set against an empty DB and diff against prod.

## DRIFT-2 — Ghost functions & triggers: live security/billing logic absent from all git history · CONFIRMED
**Where:** live `pg_proc` / `pg_trigger` vs `git log --all -S`.
**Evidence — these objects appear in ZERO commits and ZERO migration files, yet are live and active:**

Trigger functions (security-critical):
- `chq_prevent_center_escalation` + trigger `trg_chq_prevent_center_escalation` on `centers` — blocks tenants from editing `plan`, `billing_amount`, `credit_balance`, `is_blacklisted`, `subscription_status`, etc.
- `chq_prevent_user_escalation` + trigger on `users` — blocks role/center self-escalation.
- `chq_prevent_card_order_tampering`, `chq_prevent_blast_tampering`, `chq_block_pack_billing_write` — money/order tamper guards.
- `audit_log_block_mutations` + trigger `audit_log_no_update_delete` — makes `audit_log` append-only.
- `validate_reports_to` + trigger `check_reports_to` on `staff`.

Other untracked (git=0) functions: `process_due_subscriptions`, `record_subscription_payment`, `apply_center_subscription_transition`, `apply_chargeback_transition`, `enforce_payout_status_transition`, `compute_lesson_money`, `accept_teacher_center_invite`, `invite_teacher_to_center`, `remove_teacher_from_center`, `assign_teacher_to_group`, `resolve_or_create_student`, `log_card_order_status_transition`, `set_teacher_commission_override`, `get_auth_center_group_ids`, `get_auth_teacher_group_ids`, and several `set_*_updated_at`.

**Especially dangerous:** `get_auth_teacher_group_ids()` and `get_auth_center_group_ids()` are **referenced inside the live `enrollments` and `students` RLS policies** (tenant isolation) but their definitions are ghosts. The `chq_prevent_invoice_tampering` guard **is** committed (in `20260626000000_billing_reliability_hardening.sql`) but its sibling escalation guards are not — they were created out-of-band (dashboard/MCP) and never back-filled.

**Why it matters:** These are the controls that stop a tenant from setting their own `plan`/`credit_balance` or `role`. Because they live only in the production DB, (a) a rebuild silently drops them, (b) no test can catch their removal, (c) nobody reviewing the repo knows they exist. This is the ghost-trigger problem you were burned by — there are dozens more.

**Suggested fix:** After the DRIFT-1 baseline, ensure every live function/trigger/policy is represented in a committed migration. Add a CI drift check (`supabase db diff` or a catalog snapshot test) that fails when live ≠ migrations.

## AUTH-DB-1 — `authenticated`-executable SECURITY DEFINER money RPCs with no caller-ownership check · CONFIRMED
**Where (live `pg_proc.proacl` + definitions):**
- `earn_credits_atomic(p_center_id, p_amount, p_reference_id, p_reference_type)` — `GRANT EXECUTE ... authenticated`. Body: inserts an `'earned'` `credit_ledger` row and raises `centers.credit_balance` (capped at 3× `all_in_price`). **No `auth.uid()` / center-ownership check.**
- `process_payment_rpc(p_center_id, p_invoice_id, p_amount, …)` — `authenticated`. Marks the invoice `paid`, inserts a `payments` row for **`p_amount` (no check that `p_amount >= total`)**, and advances `centers.next_payment_due` a full cycle.
- `deduct_blast_balance_rpc(p_center_id, …)` — `authenticated`. Inserts an `announcement_blasts` billing row for any center.
- `spend_credits_atomic`, `reserve_credits_atomic` — `authenticated`. Mutate credit balance/reservation for any `p_center_id`.

**Confirmed exposure:** these are reachable directly at `POST /rest/v1/rpc/<fn>` by anyone with a valid (non-anon) JWT. The Supabase security advisor flags 39 `authenticated_security_definer_function_executable` warnings; the June migration `20260621215634_revoke_anon_execute_business_rpcs` revoked **anon** but left **authenticated**. App code only ever calls these via the **service-role** client (`billingEngine.ts`, `supabaseAdmin`), so the `authenticated` grant is an unnecessary over-grant — `process_payment_rpc` and `deduct_blast_balance_rpc` have no app caller at all.

**Exploit (plain terms):** A logged-in center owner opens the network tab, grabs their bearer token, and calls `earn_credits_atomic` with their own `center_id` and `p_amount = 3 × all_in_price` → free account credit they can spend against their subscription. Or calls `process_payment_rpc(my_center, my_unpaid_invoice, 0.01)` → subscription marked paid and billing advanced a month for one piaster. With a discovered/guessed other-center UUID, `deduct_blast_balance_rpc` can also create charges on another tenant.

**Why it matters:** Direct, self-service revenue loss and credit creation; cross-tenant griefing. CRITICAL.

**Suggested fix:** `REVOKE EXECUTE ... FROM authenticated, anon` on every business/money RPC (they're only needed by `service_role`). Additionally, harden the functions to assert `p_center_id = get_auth_center_id()` (or require an explicit privileged actor) and validate `p_amount` against the invoice total. Add the revoke to a committed migration.

## AUTH-1 — `/api/ai/query` executes LLM-authored SQL as service-role → cross-tenant exfiltration · CONFIRMED
**Where:** `src/app/api/ai/query/route.ts:122-125` → RPC `ai_execute_query(p_sql, p_center_id)` (`supabase/migrations/20260320000001_ai_query_rpc.sql`).
**What's wrong:** The route sends a user `question` to Claude Haiku, takes the model's `sql` output, and passes it into `ai_execute_query`, which runs `EXECUTE format('SELECT … FROM (%s) sub', p_sql)` — raw interpolation of model output — as `SECURITY DEFINER` (RLS-bypassing). `p_center_id` is bound as `$1` **only if the generated SQL references it**; nothing forces a `WHERE center_id = $1`. The only guard is a regex blocking `DELETE|UPDATE|INSERT|DROP|ALTER|TRUNCATE` — pure `SELECT`/`UNION` exfiltration passes.
**Mitigation already present:** the June lockdown migration revoked the **PostgREST** grant, so `ai_execute_query` is no longer callable directly by `authenticated`/`anon` (confirmed live: ACL is `postgres | service_role` only). The exposure is now solely through this one route, which calls it via service-role.
**Why it matters:** A prompt-injection in `question` can make the model emit `SELECT … FROM payments` / `users` / `admin_users` / other centers' rows (or `UNION SELECT pin_code FROM users`) with no tenant filter — full cross-tenant read.
**Suggested fix:** Don't execute model-authored SQL. Use parameterized server-built queries over an allow-list, or at minimum: parse + reject anything that isn't a single `SELECT` over whitelisted tables, wrap in a server-injected `WHERE center_id = $1` the model can't remove, run under a low-priv role with RLS, and add a statement timeout + row cap.

## MONEY-1 — Combined-payment finalize can consume credit then permanently dead-lock the session · CONFIRMED
**Where:** `src/lib/combinedPaymentFinalize.ts:150-215`; `try_finalize_payment_session` (`supabase/migrations/...add_payment_finalization_guard.sql`); `markSessionFailed`.
**What's wrong:** Order is (1) `try_finalize_payment_session` sets `finalized_at = NOW()` and returns true; (2) `spend_credits_atomic` debits credit; (3) center/invoice/log updates. These are separate calls with **no shared transaction**. Any failure after step 1 calls `markSessionFailed`, which sets `status='failed'` but **leaves `finalized_at` set** — and the guard refuses any future finalize when `finalized_at IS NOT NULL`. `check-stuck-payments` filters `.is('finalized_at', null)`, so it never picks the session up.
**Scenario:** Reactivation session with `credit_amount = 500`: lock taken → 500 EGP credit spent → a later update throws transiently → session is permanently dead, credit gone, center not reactivated, no retry path.
**Suggested fix:** Make finalize a single DB transaction/RPC; or have `markSessionFailed` clear `finalized_at` and compensate the spent credit; or spend credit **last**, after all other side-effects succeed.

---

# HIGH

## ASYNC-1 — Outbox jobs stuck in `processing` are silently dropped; dead-letter queue is never surfaced · CONFIRMED
**Where:** `src/app/api/cron/process-outbox/route.ts:41-47,67-71,126-144`; `src/app/api/cron/watchdog/route.ts`.
**What's wrong:** The fetch selects only `status IN ('pending','failed')`; each job is flipped to `'processing'` **before** the handler runs. If the function times out (maxDuration 60s) or the final update never lands, the row stays `'processing'` forever — never re-selected, never retried, never dead-lettered. No reaper resets stale `processing` rows. Separately, jobs that exhaust `max_attempts` are inserted into `dead_letter_queue` correctly, but **nothing reads it** — the watchdog only checks `cron_health_log` freshness. A permanently-failed payment-confirmation or billing nudge lands in DLQ and **no human is ever notified**.
**Suggested fix:** Re-select `processing` rows older than N minutes (add a `locked_at`), or add a reaper cron; wire `watchdog`/`payment-alert` to alert on `dead_letter_queue` depth.

## MONEY-2 — Poll route reports `paid` even when finalize failed · CONFIRMED
**Where:** `src/app/api/paymob/invoice-status/route.ts:148-160`.
**What's wrong:** In the combined-session branch, when Paymob says `paid`, the route calls `tryFinalizeCombinedPaymentSession(...)` but **ignores its return** and unconditionally responds `{ paid: true }`. (The invoice branch at `:81-83` correctly checks `finalized.settled`.) Paymob captured the money but if finalize threw (the MONEY-1 case), the customer is told "paid" while the backend never delivered the upgrade/reactivation/credit-spend.
**Suggested fix:** Mirror the invoice branch — only return `paid` when the finalize result says the session reached `paid`; else `pending`.

## MONEY-3 — Invoice flip + side-effects are not transactional; the tamper guard then blocks retry · CONFIRMED
**Where:** `src/lib/invoicePaymobPayment.ts:231,289-421`.
**What's wrong:** After an invoice is flipped to `paid`, the type-specific handlers (`handleSubscriptionInvoicePaid`, `handlePlanUpgradeInvoicePaid`, legacy center extension, `advanceTeacherSubscriptionPaid`) run as separate, un-transacted calls whose errors are only `console.error`-logged. If a center/subscription update fails after the invoice is `paid`, the invoice is now immutable (tamper trigger) and a re-run short-circuits at `:231` (`status==='paid' → settled`), so the side-effect is **never retried**. Reconciliation Scan B only heals `unpaid → paid`, not `paid-but-unadvanced`.
**Scenario:** Invoice paid, but `next_payment_due`/plan/teacher-subscription never advanced → customer re-charged/suspended next cycle, or never billed again.
**Suggested fix:** Wrap invoice-flip + side-effects in one RPC/transaction, or make side-effects independently idempotent and reconcile paid-but-unadvanced invoices.

## FRONT-1 — "Collect payment" insert is not server-permission-gated (relies on client button hiding) · CONFIRMED
**Where:** `src/app/[locale]/payments/page.tsx:378-409` → `/api/db` insert of `payments`; `src/lib/dbProxyScope.ts:30`; `src/app/api/db/route.ts`.
**What's wrong:** Payment creation writes through the legacy `/api/db` proxy, which enforces CSRF + tenant scoping but **does not check `can_record_payments`**. The only gate on *who* may record a payment is the client-side `canCollectPayment` flag that hides the button. The confirm path (`/api/payments/confirm/route.ts:17-22`) *does* re-check server-side — this insert path is the asymmetry.
**Why it matters:** A center staffer without `can_record_payments` (or anyone crafting a POST with a valid session+CSRF for their own center) can insert `payments` rows, including `status:'confirmed'` for cash. Tenant-isolated, but the role gate is cosmetic.
**Suggested fix:** Move to a dedicated `/api/payments/collect` REST route using `requireCenterAuth` + `can_record_payments` re-check; short-term, add a permission check for `table==='payments'` inserts in `/api/db`.

## ASYNC-2 — Bosta webhook HMAC fails OPEN on non-production (incl. Vercel preview) · SUSPECTED
**Where:** `src/app/api/bosta/webhook/route.ts:521-541`.
**What's wrong:** `requireSecret = VERCEL_ENV==='production' || NODE_ENV==='production'`. On `preview`/dev with `BOSTA_WEBHOOK_SECRET` unset, the route logs a warning and **skips HMAC**, then processes events (creates/replaces card orders, sends WhatsApp) against the shared service-role DB. Paymob and WhatsApp routes never have this escape hatch.
**Why it matters:** A preview deploy (where `VERCEL_ENV='preview'`) with the secret unset accepts unsigned Bosta payloads that mutate production data.
**Suggested fix:** Require the secret unconditionally, or treat `preview` as production.

---

# MEDIUM

## CFG-1 — CSRF validation fails OPEN when `CSRF_SECRET` is unset · CONFIRMED
`src/lib/csrf.ts:52-53` — `if (!isCSRFEnabled()) return true;`. A deploy missing `CSRF_SECRET` silently disables CSRF on all `/api/db` mutations. `getKey()` throws in prod, but lazily — a path that doesn't trigger the throw at boot stays fail-open. **Fix:** make `validateCSRFRequest` deny in production regardless.

## CFG-2 — Rate limiting fails OPEN when Upstash env is unset · CONFIRMED
`src/lib/rateLimitCore.ts:33-37` returns `{ success: true }` and the named limiters become `null` when `UPSTASH_REDIS_REST_*` are absent. The highest-impact instance is the **PIN-reset** limiters (brute-force protection on auth). **Fix:** fail closed (deny) for the auth-reset limiters specifically when Redis is unavailable.

## AUTH-2 — `referrals/calculate-rewards` authenticates by comparing bearer to the service-role key · CONFIRMED
`src/app/api/referrals/calculate-rewards/route.ts:14-19,28` writes reward/commission money and gates on `Authorization === "Bearer <SUPABASE_SERVICE_ROLE_KEY>"` — using a DB master credential as an HTTP token, no timing-safe compare, inconsistent with the hardened `requireCronSecret`. **Fix:** gate on `requireCronSecret`.

## AUTH-3 — `referrals/process-commission` inlines a super-admin check against `public.users.phone` · CONFIRMED
`src/app/api/referrals/process-commission/route.ts:48-52` mutates money but checks `public.users.phone` against `SUPER_ADMIN_PHONES` instead of `requireSuperAdminApi` (which uses `auth.users`). Mitigated today because `users.phone` is a proxy-protected column, but it diverges from the authoritative pattern. Same shape in `admin/centers/route.ts:26-29`. **Fix:** normalize onto `requireSuperAdminApi`.

## MONEY-4 — Reconciliation Scan B windows on `billing_period_start`, missing fee/ad-hoc invoices · CONFIRMED
`src/lib/billing/reconciliation.ts:189-196` filters unpaid invoices by `.gte('billing_period_start', cutoffDate)`. Invoice types created without that column (`reactivation_fee`, `late_payment_fee`, ad-hoc) are excluded from the only self-healing scan, so a webhook-lost payment on them is never recovered or flagged. **Fix:** window on `created_at`.

## MONEY-5 — `app.allow_invoice_correction` bypass exists in the trigger but the audited tooling that uses it does not, and the bypass is unlogged · CONFIRMED
`chq_prevent_invoice_tampering` honors `current_setting('app.allow_invoice_correction')='on'` to allow rewriting paid invoices, but **no TypeScript code sets this GUC** (grepped) — `docs/BILLING_RELIABILITY.md` describes correction tooling that isn't in the repo. The bypass branch just `RETURN NEW`s with **no audit row**. **Fix:** have the bypass branch write to `audit_log`; build/commit the correction tool that sets the GUC, scoped and audited.

## MONEY-6 — `spend_credits_atomic` has no per-reference idempotency · CONFIRMED (latent)
`spend_credits_atomic` inserts `'spent'` rows and decrements balance every call with no dedupe on `(reference_id, reference_type)`. Today only the finalize lock prevents a double-spend; any second caller/replay double-debits. **Fix:** make the ledger itself idempotent on the reference.

## ASYNC-3 — `renewal-reminders` cron route exists but is not registered in `vercel.json` · CONFIRMED
`src/app/api/cron/renewal-reminders/route.ts` exists and gates on `CRON_SECRET`, but `vercel.json` has no entry — it never fires. Either dead code or a missing schedule. **Fix:** register it or delete it.

## FRONT-2 — Student/payment PII cached in browser `sessionStorage` · CONFIRMED
`payments/page.tsx:109,114,258` (`chq_payments_cache`: student name/number, amount, method, payer) and `students/page.tsx:65-75,338` (`chq_students_cache`: names, numbers, balances). Unencrypted, readable by any origin script, persists across reloads in a tab — risky on the shared/kiosk devices these centers use, and an XSS amplifier. **Fix:** drop the persistent PII cache (use in-memory SWR), and clear on signout/blur.

## FRONT-3 — Build gate `check-bidi.ts` does not actually enforce logical-CSS · CONFIRMED
`scripts/check-bidi.ts` only flags mixed-script identifiers missing `<bdi>`; it does **zero** physical-CSS-class detection, despite CLAUDE.md/`docs/RTL.md` describing it as the logical-property gate. RTL is clean today by convention only; a future `mr-4`/`text-right` passes CI. **Fix:** extend the gate to scan `className` for physical classes (excluding `// RTL-EXEMPT`/pdf/print/email), or correct the docs.

---

# LOW

- **AUTH-4 · `/api/login` is a phone-registration oracle** (`src/app/api/login/route.ts:113-124`) — returns `404 "not registered"` vs a payload, enabling enumeration of owner/admin phones. Rate-limited (5/15m). `login-verify`/`reset-pin` are correctly non-distinguishing. CONFIRMED. **Fix:** uniform response.
- **WEBHOOK-1 · `/api/whatsapp/webhook` lacks message-id dedupe** (`:434`) — fires `processWebhookPayload` async with no `webhook_inbox` check; Meta re-deliveries can re-run auto-replies (consent grant is idempotent-ish). The sibling `/inbound` route dedupes correctly. SUSPECTED, LOW.
- **WEBHOOK-2 · Bosta dedupe is read-then-count (racy)** (`bosta/webhook/route.ts:189-210`) — two concurrent same-`eventId` deliveries can both process; null-`eventId` events skip dedupe entirely. **Fix:** unique constraint on `(card_order_id, bosta_event_id)`. CONFIRMED, LOW.
- **DB-1 · `pin_code` column on `users` is plaintext-named and readable by all same-center members** — `users_select_own_center` RLS allows any center member to `SELECT *` of every user in the center (RLS is row-level). Live data shows all 6 rows have `pin_code = NULL` (PIN auth uses bcrypt OTP/tokens elsewhere), so this is currently a **latent/dead** column, not an active leak — but if ever populated with a real PIN it becomes a credential leak. **Fix:** drop the column, or exclude sensitive columns via a view/column privileges. CONFIRMED (latent).
- **FRONT-4 · `Intl.DateTimeFormat`/`RelativeTimeFormat` bypass `formatDate`** in `admin/finance`, `admin/health`, `students/pending`, `billing` clients — not caught by `check-no-tolocalestring` (date-only, no money impact). CONFIRMED, LOW.
- **CFG-3 · `pg_net`/`pg_trgm` extensions installed in `public` schema** (Supabase advisor) and `auth_leaked_password_protection` disabled. Hardening niceties. CONFIRMED, LOW.

---

# Looks healthy (checked, no action)

- **RLS coverage:** enabled on all 139 tables. Sensitive tables (`saved_cards`, `*_otps`, `pending_signups`, `chargebacks`, `recurring_charge_declines`, `parent_portal_tokens`) are RLS-on with **zero policies** (service-role-only) or an explicit `qual=false` — the secure default. 18 "RLS enabled, no policy" advisor notices are intentional.
- **Invoice isolation:** `invoices` has only SELECT policies for authenticated (own center / own teacher); all writes are service-role + the committed tamper trigger. `invoices` is empty live, and teacher-owned invoices don't populate `center_id`, so no cross-owner read path exists. The tamper guard correctly covers both owner types and immutably protects `owner_type`/`center_id`/`teacher_id` and paid-invoice fields (chargeback the only allowed paid exit).
- **`users` self-escalation:** UPDATE policy is own-row-only with `with_check (id=auth.uid() AND center_id=get_auth_center_id())`, plus the (ghost) escalation trigger; no INSERT/other-user-UPDATE policy. `users.phone`/`role` are in `dbProxyProtectedColumns`. Self-elevation is blocked.
- **Cron auth:** all 41 cron routes use `requireCronSecret` (timing-safe, 401 on missing/empty `CRON_SECRET` — fail closed).
- **Webhook HMAC:** Paymob (raw-body SHA-512, timing-safe, fail-closed) and WhatsApp (SHA-256, fail-closed, fast-200 on handler error) are correct; idempotency via `webhook_inbox`.
- **PIN auth flow:** per-phone lockout (fails closed if Upstash down), server-side weak-PIN rejection, single-use HMAC-bound setup tokens, bcrypt-compared reset OTPs, anti-enumeration on reset, payment-state re-verification. No arbitrary-phone reset.
- **Secrets:** no hardcoded secrets found; `.env.example` is placeholders only; Paymob creds read via accessors and are not `NEXT_PUBLIC_`; every `NEXT_PUBLIC_*` var is intentionally public.
- **Pricing math:** cascading VAT/stamp/service is correct and matches `PRICING_SPEC.md`; `top_centers` throws + Sentry-warns on NULL `all_in_price`; commission split uses remainder-absorption (no drift); underpayment core dedupes on `applied_txns` with a half-piaster settle epsilon. (One tax-line rounding nuance noted as MONEY-7 candidate — VAT line absorbs cent drift; money-neutral, flagged for tax-display correctness only.)
- **Frontend:** RTL physical-CSS clean (by convention); no currency `toLocaleString` bypass; no secrets in client bundles; money pages have error/empty/retry states.

---

# Recommended test coverage (the ghost class)

The "behavior enforced only live in the DB" risk needs DB-behavior tests so a regression (or a rebuild that drops a ghost) is caught:
- A pgTAP/integration test asserting each tamper/escalation guard **rejects** the forbidden update (center plan/credit, user role, paid-invoice fields, audit_log mutation).
- A test asserting `earn_credits_atomic`/`process_payment_rpc`/`deduct_blast_balance_rpc` are **not** EXECUTE-able by `authenticated`/`anon` (after the revoke).
- A CI "schema drift" job: replay all migrations on an empty DB and diff catalog vs production snapshot — fails on any ghost object.

> **The ghost problem, demonstrated live.** A repo-only review of this codebase concluded that `audit_log` is *not* append-only and that there is *no* user role-escalation guard. The **live database has both** — `audit_log_no_update_delete` (→ `audit_log_block_mutations`) and `chq_prevent_user_escalation` — as **ghost triggers** (DRIFT-2). The protections are real and active in production, but invisible to anyone reading the repo or the tests. That gap between "what the code says" and "what the DB does" is the single most dangerous property of this system right now.

---

# Child safety & PDPL (Egypt Law 151/2020)

> Students are minors; this domain is weighted accordingly. Note: the base `students` table is one of the un-versioned tables from DRIFT-1 — the schema of record for minors' data is not in git.

## CHILD-1 — PDPL right-to-erasure has no execution path · CONFIRMED · HIGH
**Where:** `src/app/api/privacy-request/route.ts:62-69` inserts `status:'pending'` and stops — **nothing reads `privacy_requests`**; no account-deletion route exists. The only hard-delete (`src/lib/dormantCenterPurge.ts:139-176`) is triggered by 12-month center inactivity, **excludes** `audit_log`, `invoices`, and all WhatsApp logs, and **exports every student/parent row to a Google Drive CSV first** (`:73-128`) with no documented expiry.
**Why it matters:** A parent asking to delete their child's data cannot be served; the data persists indefinitely in WhatsApp logs, `audit_log`, and external Drive copies.
**Fix:** Build an erasure processor that hard-deletes (or legally-justified-pseudonymizes) the subject across `students`, `families`/`paid_parents`, `attendance_scans`, `payments`, `parent_portal_tokens`, and WhatsApp logs; add a retention/purge policy for `wa_message_queue` and the Drive CSVs.

## CHILD-2 — Consent not captured before processing; two alert crons bypass the consent flag · CONFIRMED · HIGH
**Where:** student rows are created with `parent_consent_given:false` (`join/.../route.ts:150-164`, `verify-otp/route.ts:172-186`); consent is enforced in `whatsapp/flows/parentNotifications.ts:82` but **not** in `cron/parent-absence-alerts/route.ts:91` or `parent-balance-alerts/route.ts:60` (which check only `parent_pack_opted_in`). The bootstrap consent request is itself a WhatsApp message sent before consent.
**Why it matters:** Parents of minors receive automated attendance/balance WhatsApp messages without the verified consent gate PDPL requires for processing a minor's data.
**Fix:** Make `parent_consent_given = true` a hard precondition in both alert crons; capture consent at enrollment; give the bootstrap message a documented lawful basis or a non-WhatsApp channel.

## CHILD-3 — Consent webhook matches parent phone across ALL centers · CONFIRMED · MEDIUM
**Where:** `src/app/api/whatsapp/webhook/route.ts:351` — `.eq('parent_phone', normalized)` with no center scope; one "وافق" reply mints 1-year `parent_portal_tokens` for the child at *every* center where that phone is registered.
**Why it matters:** Crosses the tenant boundary that is the core child-safety guarantee.
**Fix:** Scope the match to the inbound message's center; mint per-center with per-center consent.

## CHILD-4 — Parent portal token: 1-year, unrevokable, bearer-in-URL on a public endpoint · CONFIRMED · MEDIUM
**Where:** `src/app/api/parent/portal/route.ts` (public GET) + 365-day token minted at `webhook/route.ts:357`. Per-student scoping is correct, but a forwarded/leaked URL exposes a child's attendance + balance for up to a year with no rotation/revocation.
**Fix:** TTL in days, add revocation, re-mint on demand.

## CHILD-5 — Parent phone logged in plaintext · CONFIRMED · MEDIUM
**Where:** `src/lib/whatsapp.ts:11` (`console.warn(... toPhone)`) and `:35` (`console.error(... JSON.stringify(data))` dumps Meta's full response). Parent numbers land unmasked in Vercel/stdout logs. (Sentry `setUser`/`setContext` is clean — no student PII.)
**Fix:** Mask to last 3 digits; don't dump raw Meta responses.

## CHILD-6 — `card-order-pdfs` bucket privacy not pinned in code · SUSPECTED · MEDIUM
**Where:** `src/lib/pdfStorage.ts:13,26` — no migration sets the bucket private (contrast `invoice-pdfs` = `public=false` in `20260506000000_invoice_pdfs_bucket.sql`). PDFs carry student name + number.
**Fix:** Add a migration creating `card-order-pdfs` with `public=false`; verify the live bucket state.

**Healthy here:** core scan/weekly/announcement WhatsApp flows are correctly center-scoped (`parentNotifications.ts:78` → `wrong_center`); `enrollment_otps` are hashed/10-min/5-attempt/fail-closed; join links are center-scoped. Leakage risk is concentrated in CHILD-3/CHILD-4, not the main notification path.

---

# Test coverage gaps (money & auth)

Existing: ~70 unit specs (strong billing/lifecycle/reconciliation/MRR suite, `invoiceTamperGuard`, `centerAuth`, `admin-access`, weak-PIN, PIN tokens) + ~28 e2e specs. Gaps:

- **TEST-1 (HIGH):** No unit test for the billing core — `billingEngine.ts`, `combinedPaymentFinalize.ts`, `invoicePaymobPayment.ts`, `commissions.ts`, `paygBilling.ts`, `packBilling.ts`, and the **Cairo-time window helpers** (`cairoBillingCalendar.ts`, `billingGrace.ts`, `billingSchedule.ts`) — the last is explicitly flagged bug-prone in CLAUDE.md and has zero coverage.
- **TEST-2 (HIGH/MED):** No unit test for `verifyHmac.ts` (pure; guards all 5 public webhooks — a regression = forged-webhook acceptance) or `csrf.ts` (pure `validateCSRFRequest`). Also untested: `requireOwnerAdminCenter.ts`, `enrollmentOtp.ts`, `teacherSignupOtp.ts`.
- **TEST-3 (HIGH) — the ghost-object regression class:** The repo's `invoiceTamperGuard.test.ts` greps migration SQL so the DB contract can't silently regress — but only 2 migrations are guarded this way. **No such test exists** for: the lifecycle-transition guards (`trg_guard_transactions/sessions/enrollments/teacher_subscriptions_lifecycle`), the `audit_log` append-only trigger, or the role/center escalation guards — **and several of those are ghosts (DRIFT-2), so a silent drop would be caught by nothing.** Add source-grep + (ideally) live integration tests asserting each guard rejects the forbidden update, plus an ACL test that the money RPCs (AUTH-DB-1) are not `authenticated`-executable.

---

## Consolidated priority list
1. **DRIFT-1 / DRIFT-2** — baseline the schema, commit every ghost object, add a CI drift gate. (Everything else is undetectable until this is done.)
2. **AUTH-DB-1** — revoke `authenticated`/`anon` EXECUTE on the money RPCs; add ownership/amount checks.
3. **AUTH-1** — stop executing LLM-authored SQL.
4. **MONEY-1 / MONEY-2 / ASYNC-1** — fix credit-loss dead-lock, false "paid", and silent outbox/DLQ drop.
5. **CHILD-1 / CHILD-2** — build the erasure path; enforce consent in the alert crons.
6. **CFG-1 / CFG-2** — make CSRF and the auth rate-limiters fail closed in production.
7. **TEST-3** — lock the DB guards behind regression tests so the ghost class can't recur silently.

*Hold for review — no fixes applied.*
