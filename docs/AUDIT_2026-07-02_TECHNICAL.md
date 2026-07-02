# TutoringHQ — Technical Findings Note

**Date:** 2026-07-02 · **Project:** Supabase `lczmjpnbuhnsislcvzar` (PostgreSQL 17, eu-west-2) · **Repo:** `eyadelhawary7-oss/CenterHQ`
**Method:** READ-ONLY. Live catalog introspected via `information_schema` / `pg_catalog` / advisors; full codebase read/grepped. No code, config, migrations, or writes changed. Summer billing engine inspected only, never exercised.
**Severity:** CRITICAL / HIGH / MEDIUM / LOW / INFO · **Fix difficulty:** Easy / Med / Hard.

Ground-truth surface: 137 public tables (all with RLS enabled), 319 API routes, 42 cron routes (all `CRON_SECRET`-gated) + 1 pg_cron heartbeat, 123 pages. Rule 173 (SECURITY DEFINER lockdown) **held**; Rule 174 (no arbitrary SQL) **clean** (no `ai_execute_query` / dynamic-SQL-on-user-input function exists).

---

## CRITICAL

### C1 — `GET /api/center-users` cross-tenant IDOR (staff PII leak) · Easy
`src/app/api/center-users/route.ts:30-45`. Authenticates the JWT (any logged-in user) then reads `centerId` **from the query string** with no ownership check and queries `users` via the **service-role client** (RLS bypassed):
```
const centerId = searchParams.get('centerId');                 // L31 attacker-controlled
supabaseAdmin.from('users').select('id, phone, role').eq('center_id', centerId)  // L42-45
```
Any authenticated user passes any other tenant's `center_id` (UUIDs are non-secret — returned by `/api/me`, join links, realtime channels) and receives that center's full staff roster incl. **phone numbers** and roles.
**Fix:** derive `centerId` from the caller's `users` row / `requireCenterAuth`, or assert `caller.center_id === centerId` (membership check like `/api/benchmarks`).

### C2 — `content_access_log` anon-readable cross-tenant · Easy
Live policy `content_access_log_select`: role **`{public}`** (incl. `anon`), cmd SELECT, `qual = EXISTS (SELECT 1 FROM content_items ci WHERE ci.id = content_access_log.content_item_id)`. No center/owner scoping — the qual is true for every row whose content item exists, and `anon` holds the default table SELECT grant. **Any unauthenticated caller can read the entire `content_access_log`** (`student_id` + `content_item_id` + access timestamps) across all tenants.
**Fix:** rescope qual to the student's center via `get_auth_center_id()` (or content owner); drop the anon grant.

---

## HIGH

### H1 — `POST /api/billing/payg-calculate` authentication bypass · Easy
`src/app/api/billing/payg-calculate/route.ts:33-56`. Auth runs **only when the body has no `centerId`**:
```
let targetCenterId = centerId;                          // L39 from body
if (!targetCenterId && authHeader) { ...getUser... }    // L40 auth ONLY if body id absent
// L60: attendance_scans .eq('center_id', targetCenterId) via SERVICE ROLE
```
`{ "centerId": "<uuid>" }` skips auth entirely. Reachable unauthenticated server-to-server (middleware doesn't gate `/api/*`; the CORS check only fires when an `Origin` header is present — `proxy.ts:181`). Returns unique-student count + PAYG billing figures for any center (aggregate, no student PII, but a genuine unauthenticated data bypass — the only in-scope route that trusts a request-supplied center id).
**Fix:** always authenticate; ignore body `centerId` unless caller is super-admin.

### H2 — Money columns lack `CHECK >= 0` (integrity) · Med
~85 of ~98 money-ish numeric columns across ~45 tables have no non-negative constraint, incl. `payments.amount`, all `invoices.*_amount`, `commissions.*`, `commission_payouts.*`, `credit_ledger.amount`, `card_orders.total_amount`, `centers.credit_balance`. The `transactions.*` / `chargebacks.amount` / `student_credits.amount` / `card_charge_intents.amount` / `teacher_subscriptions.*` family is correctly guarded — replicate that pattern.
**Fix:** bulk `ADD CONSTRAINT … CHECK (col >= 0)`, first auditing for legitimately-negative adjustment columns (e.g. `commission_payouts.adjustment_amount`) to exclude.

### H3 — Dangerous `ON DELETE CASCADE` on money/audit FKs · Med
Inconsistent with the `RESTRICT` pattern used by `transactions`. These CASCADE, so a center/student hard-delete silently destroys financial + audit history: `audit_log.center_id`, `commission_audit_log.commission_id/payout_id`, `commissions.center_id`, `invoices.center_id/teacher_id`, `payments.center_id/student_id`, `credit_ledger.center_id`, plus `parent_pack_billing`, `renewal_history.center_id`, `upgrade_log.center_id`, `combined_payment_sessions.center_id`, `card_order_events.card_order_id`.
**Fix:** switch money/audit FKs to `RESTRICT`/`SET NULL` + soft-delete centers.

### H4 — `commission_audit_log` is not truly append-only · Med
Live: write policy = `ALL` for super_admin (`qual = admin_users.role='super_admin'`), and **no** `BEFORE UPDATE/DELETE` block trigger — unlike `audit_log`, which is correctly frozen by `audit_log_no_update_delete`. A financial audit trail is mutable/deletable.
**Fix:** add the same block-mutations trigger and/or downgrade the super_admin policy to SELECT.

### H5 — Migration drift; `pin_code` drop unapplied · Med-High
`list_migrations` returns ~230 ledger entries; repo `supabase/migrations/` holds only **18** files (all `20260625xxxx`+). Consequences:
1. Repo is **not** the schema source of truth — everything before 2026-06-25 exists only in the live ledger; the DB cannot be reproduced from repo.
2. Version/timestamp drift in the overlap window (e.g. repo `20260626000001_phase6a_lockdown_definer_rpcs` vs ledger `20260626134248 phase6a_lockdown_definer_rpcs`) → fragile `db push` reconciliation.
3. **Security-relevant:** `supabase/migrations/20260701150506_drop_pin_code.sql` exists in repo but is **not** in the ledger, and `users.pin_code` **still exists** in production (confirmed via `information_schema`). The credential-column drop never reached prod.
**NOTIFY pgrst reload** pattern present in 16/18 recent repo migrations (good).
**Fix:** backfill/ squash historical migrations into repo, reconcile versions, decide+apply the `pin_code` drop.

### H6 — `parent_portal_tokens`: 1-year TTL, plaintext, no revoke (minors' PII) · Med
Token is strong (128-bit `crypto.getRandomValues` hex, expiry enforced), but minted with a **1-year** TTL (`api/whatsapp/webhook/route.ts:357` `expiresAt.setFullYear(+1)`), stored **plaintext** (`.eq('token', token)`, no hash), and the table has **no revocation column** (`id, student_id, token, expires_at, created_at`; only removal is center/student cascade). A forwarded WhatsApp link exposes a minor's name, ~30-day attendance, balance, and schedule for up to a year, unrevokable.
**Fix:** short TTL (hours/days), add `revoked_at` checked on lookup, store a hash.

### H7 — Customer-facing legal pages are placeholders (PDPL exposure) · Hard (legal)
`src/app/[locale]/legal/LegalDoc.tsx:9-21,68` renders ~100 `SECTION_PLACEHOLDER` = "[pending legal review]" sections; `src/app/[locale]/privacy/page.tsx:26` and `terms/page.tsx:35` render `t('placeholderBody')`. For a platform handling minors' data under Egyptian PDPL, shipped privacy/terms are stubs.
**Fix:** legal review + real content (not an engineering fix).

### H8 — `privacy_requests`: intake only, no admin flow, no 30-day SLA · Med
Intake is solid: `src/app/[locale]/legal/privacy-request/page.tsx` → `POST /api/privacy-request` inserts `privacy_requests` (status `pending`, rate-limited 5/hr/IP). But `grep privacy_requests` across `src` returns **only** the intake route — **no admin screen reads the table**, no nav entry, and **no** `due_at`/SLA/30-day logic anywhere. Data-subject rights requests land where no one can action them. (DB: table has `status/handled_by/handled_at/response_notes` but **no** SLA/due field.)
**Fix:** admin review screen + SLA deadline field + reminder cron.

---

## MEDIUM

### M1 — Admin money/lifecycle mutations gated too weakly (internal privilege gap) · Easy
Not external IDOR (requires a valid internal admin session), but several money/lifecycle mutations gate only on "any `admin_users` row," admitting `internal_viewer`-tier staff (`sales_rep`, `support_agent`, `accountant`, `custom`). Their matching GET endpoints ARE finance-gated (oversight):

| Route | Method | Gate | Issue |
|---|---|---|---|
| `admin/billing` | POST L307 / PUT L386 | `getAdminContext`+CSRF, no role | records `admin_payments`, flips center paid/active, edits invoices |
| `admin/renewals` | POST L135 | `getAdminContext`+CSRF, no role | inserts `renewal_history`, reactivates center |
| `admin/referrals` | POST L90 → `ensureAdmin` | admin_users-exists / phone, **NO CSRF** | marks `referral_commissions` paid; weakest of set |
| `admin/centers` | PUT L717 / DELETE L455 | inline `isAdminUser`+CSRF | plan-change/reactivate/approve + hard cascade-delete; suspend/delete require password re-verify, plan/billing/approve do not |
| `ceo/mrr`, `ceo/dashboard` | GET | `getAdminContext` only | MRR/revenue/health exposed to `internal_viewer` (inconsistent with accountant-gated `ceo/financials`) |

Correct pattern (contrast): `admin/centers/[id]` PATCH gates each money action to `flags.isSuperAdmin` per-action (L222-233).
**Fix:** add `requireAdminRole(ctx, ['super_admin','accountant'])` to each mutation; add `validateCSRFRequest` to `admin/referrals` POST.

### M2 — Non-atomic JS upgrade path between claim & finalize RPC · Moderate
`src/lib/combinedPaymentFinalize.ts` upgrade branch (~L214-321): between the claim RPC `try_finalize_payment_session` and the atomic `finalize_combined_session_paid`, four un-transacted Supabase writes run (`centers` plan/price, `invoices` loop, `upgrade_log` insert). A failure before the `upgrade_log` insert leaves the center on the new plan while the session is `failed` — real partial-write window. Money is not lost (finalize is `FOR UPDATE`-guarded + idempotent; stuck-payment cron recovers), but audit is delayed.
**Fix:** fold the center/invoice/upgrade_log writes into one SECURITY DEFINER RPC alongside finalize (as done for subscription/teacher paths).

### M3 — Concurrent finalize can double-write `upgrade_log` · Moderate
`try_finalize_payment_session` uses `pg_try_advisory_xact_lock`, but that lock releases when the tiny claim RPC commits — it does **not** span the JS upgrade writes. Two concurrent callers (webhook + status-poll/cron) can both pass the claim (status still `pending`, `finalized_at` NULL) and both run the upgrade branch; `upgradeAlreadyApplied` is a read-then-write TOCTOU. `upgrade_log` has **only PK(id)** → duplicate audit rows. Money is safe (`finalize_combined_session_paid` lets only one spend credit / mark paid; `upgrade_count_this_period` set absolute).
**Fix:** `UNIQUE(center_id, paymob_order_id)` on `upgrade_log`, or move writes inside the locked finalize RPC.

### M4 — Cron visibility list drifted from actual schedule · Easy
`src/lib/vercelCronDefinitions.ts` (feeds `/api/admin/health` cron status) lists a phantom `renewal-reminders` (route exists but is NOT in `vercel.json`; reminders are actually sent by `process-renewals`) and **omits 7 crons that DO run**, incl. money-critical `subscription-autocharge`, `billing-reconciliation`, `summer-billing`, `billing-nudges`, `fee-reminders`, `expire-group-proposals`, `reset-teacher-blast-credits`. Those run unmonitored for staleness.
**Fix:** regenerate the list from `vercel.json` (or import it).

### M5 — Student erasure is soft-delete only (no self-serve erasure) · Med
Customer-facing delete exists (students list swipe → `DELETE /api/students/[id]`, gated by `can_delete_students`), but `src/app/api/students/[id]/route.ts:91-95` only sets `is_active=false` — name/phone/parent_phone/attendance/payment PII is never erased. True erasure only via the manual PDPL `deletion` request (which has no admin flow — see H8).
**Fix:** wire a real erasure path for the `deletion` request type.

### M6 — Money columns not `numeric(_,2)` · Med
96/98 money-ish columns are bare `numeric` (arbitrary scale); only `centers.early_adopter_price` and `card_charge_intents.amount` are `numeric(_,2)`. Storage-layer sub-cent drift is possible; relies entirely on `formatNumber.ts`.
**Fix:** `ALTER … TYPE numeric(12,2)` after a value audit.

### M7 — Missing FKs on invoice/payout links · Easy-Med
No FK on: `billing_reconciliation_reports.invoice_id`, `recurring_charge_declines.invoice_id`, `centers.summer_first_invoice_id`, `teacher_subscriptions.summer_first_invoice_id` (→ invoices); `commissions.loyalty_payout_id/t1_payout_id/t2_payout_id` (→ commission_payouts); `student_group_notes.teacher_id`. (Polymorphic `owner_type+owner_id` columns are correctly FK-less by design.)

### M8 — Unindexed hot-path FKs · Easy
69 unindexed FKs; the ones that matter: **`users.center_id`** (hottest tenancy join — every `get_auth_center_id()`), **`transactions.center_id/group_id/enrollment_id/created_by/marked_paid_by`** (core money ledger), `pending_enrollments.center_id/group_id/student_id`, plus many `*_center_id`. `attendance_scans`/`payments.student_id`/`invoices.center_id` are well-indexed already.
**Fix:** `CREATE INDEX CONCURRENTLY`.

### M9 — Orphan pages / unreachable admin screens · Easy
`/financial-intelligence` (full feature, **zero** references anywhere), `/admin/demo-requests` (no nav — submitted demo leads have no reachable screen), `/invoices`, `/parent-whatsapp`, `/whatsapp` (removed from sidebar, renders "coming soon"). Also dead nav components `Navbar.tsx`/`TopNavbar.tsx`/`BottomNav.tsx` (not rendered anywhere, carry stale `/scan` link vs live `/attendance`).

### M10 — Group-join-by-link OTP is "coming soon" · Med
`src/app/[locale]/join/g/[groupId]/page.tsx:132` coming-soon banner; `src/app/api/join/g/[groupId]/send-otp/route.ts:31,124` `TODO(whatsapp): OTP delivery needs a Meta-approved Utility template`. The link-based group-join OTP isn't wired. (Center-code join `/join/[center_code]/[group_id]` is live — so the center loop is not broken.)

---

## LOW / INFO

- **L1** Sentry webhook fail-open: `api/webhooks/sentry/route.ts:27-34` checks signature only `if (sentrySecret)` present; unset secret → any POST processed. Impact limited to a spoofed admin alert WhatsApp (no DB write). · Easy
- **L2** `POST /api/accept-invite/check` — public, no rate limit → phone enumeration of pending invites (no minor PII). `referral/validate` similarly no RL (public, masked). · Easy
- **L3** `recurring_charge_declines.card_last4` has no 4-digit CHECK (`saved_cards.card_last4` does). · Easy
- **L4** Duplicate indexes — 22 groups; hot ones: `attendance_scans` (3 on student), `payments` (3 on center,paid_at), `students`. Write amplification/planner noise only. · Easy
- **L5** `process-outbox` claim not atomic: `route.ts:69-73` `UPDATE … SET status='processing' WHERE id=?` with no `status` predicate → overlapping crons could double-claim (bounded; handlers dedupe). · Easy
- **L6** `wa_message_queue` is a send-LOG not a retried queue — failed direct-client sends are terminal (no worker reads it). The real retried queue is `webhook_outbox` + `dead_letter_queue` (well-built: backoff, max-attempts, DLQ with atomic-claim retry). Naming footgun. · Moderate
- **L7** Crons return HTTP 200 on internal failure (`billing-reconciliation`, `subscription-autocharge`, `check-stuck-payments`, `process-renewals`) — HTTP monitors blind; `cron_log`/Sentry still capture it. Intentional (avoid Vercel retry storms). · Easy
- **L8** `payment-retry` sends WA before persisting retry state (`route.ts:185-229`) → possible re-send if UPDATE fails (bounded daily, no double-charge — sends a link not a charge). · Easy
- **L9** UTC `new Date().toISOString().slice(0,10)` in billing-window fallbacks: `subscriptionAnchor.ts:55`, `billingSchedule.ts:24`, `invoicePaymobPayment.ts:520-527`, `payment-retry/route.ts:77` — off-by-one near Cairo midnight; main paths use Cairo helpers. Violates the Cairo-time rule. · Easy
- **L10** Recharts empty-state: most components guarded; confirm `PaymentDonut`/`PaymentBar`/sparklines render an empty state, not an empty SVG. · Easy
- **L11** WS3 residuals (no exploit): 5% referral withdrawal-fee deduction site not located (validation of balance/ownership is sound); two coexisting referral stores (`referral_commissions` cron-written vs `referral_reward_records` payout-read) — if unreconciled would under-pay, never over-pay; teacher Pro→Standard downgrade gate hard-codes `STUDENT_LIMIT=60`/`GROUP_LIMIT=8` vs real cap 20, but plan doesn't change until renewal and the live over-cap lock (cap=20) self-corrects → no free usage.
- **L12** Seed-only: `supabase/migrations_archive/20260507120000_seed_audit_accounts.sql:54` raw `auth.users` insert omits `confirmation_token`/etc. (relies on defaults) — dev/audit seed, not production; Rule 11 hygiene.
- **INFO** Advisors (security): `extension_in_public` for `pg_net`, `pg_trgm` (WARN — move out of public); leaked-password protection disabled (auth is phone+PIN, so low relevance). The anon/authenticated SECURITY DEFINER warnings are the expected RLS-helper family — safe.
- **INFO** Advisors (performance, 383): 135 unused_index, 134 `auth_rls_initplan` (RLS re-evaluates `auth.<fn>()` per row — wrap in `(select …)` for scale), 69 unindexed_foreign_keys (see M8), 37 multiple_permissive_policies, 7 duplicate_index, 1 auth_db_connections (Auth max 10 connections). Raw file archived at `tool-results/mcp-Supabase-get_advisors-1782976152768.txt`.

---

## Verified clean (PASS) — no finding

- **Money loopholes (WS3): none open.** Nine switching guardrails hold; wallet-credit-on-downgrade leak **dead** (`earnCredits` at `billingEngine.ts:233` has **zero callers**; `billing/downgrade/route.ts:149` returns `creditEarned:0`; `credit_balance` writers are only the expire-credits recompute (clamped ≥0)). Prorated round-trips extract nothing (`upgrade_count_this_period` caps repeats; annual→annual re-upgrade rejected). Scale overage math exact: 130 students → overage invoice **620** (600+20) + base **2519** (2499+20), two separate invoices, overage on own monthly cadence even on annual base (`midnightBillingAdapter.ts:274-339`, `teacherBilling.ts`), cap enforced at check-in (`requireTeacherUnderCap`) and billing. Referrals: annual no longer overpays (per-month base = all_in×10/12); self-referral blocked, once-per-referee race-safe marker. Promo codes single-use/expiry/cap atomic (`redeem_promo_code`). Detach requires `teacher_id === actor` (center can't seize a group). Credit/withdrawals validate balance+ownership, can't go negative. Summer first-charge gate **HELD** (`platform_config summer.first_charge_release=HELD`), engine inert.
- **Atomicity (WS4):** `approve_student_rpc`, `process_payment_rpc`, `finalize_subscription_invoice_paid`, `finalize_teacher_invoice_paid`, `finalize_combined_session_paid` each single-txn, `FOR UPDATE`-locked, ROW_COUNT/status-idempotent.
- **Idempotency keys present:** `card_charge_intents_idempotency_key_key`, `combined_payment_sessions_paymob_order_id_key`, `attendance_scans_session_student_unique`, `card_order_status_wa_dedupe_pkey`, `idx_renewal_reminders_dedup`, `billing_nudges_owner_type_owner_id_cycle_key_step_key`, `webhook_inbox_idempotency_key_idx`.
- **Reconciliation:** only auto-mutates unpaid→paid via the idempotent finalizer; everything else flagged `open` for a human. Never reverses/refunds.
- **Webhooks:** Paymob / WhatsApp / Bosta all verify HMAC / verify-token **before** any DB write; idempotency via `webhook_inbox`. (Sentry webhook fail-open = L1.)
- **Secrets:** `supabase-admin.ts` is `import 'server-only'`; zero non-`NEXT_PUBLIC` env in `'use client'` files; no committed keys; `/api/db` enforces CSRF; every cron route gates on `CRON_SECRET` (timing-safe, fails closed).
- **Rate limiting:** all public form/OTP endpoints Upstash-limited (join/enrollment/minors, signup, all OTP, PIN reset, privacy-request, demo-request, login).
- **Card data:** `saved_cards` = token + last4/brand/exp only (no PAN); `card_last4` CHECK `^[0-9]{4}$`; `card_charge_intents` `UNIQUE(idempotency_key)`; `saved_card_consents` exists.
- **XSS:** `dangerouslySetInnerHTML` only in static theme script + JSON-LD (no user content). **Injection:** all DB access parameterized (supabase-js / RPC named params).
- **DB integrity:** no Postgres enums in public (text+CHECK only); all timestamps `timestamptz`; every table has a PK; 18 zero-policy tables genuinely deny-all (server-only, correct); `audit_log` truly append-only; `pending_enrollments` (minors) deny-all + server-only; `benchmark_snapshots` has **no** center id (anonymized aggregate confirmed).
- **Frontend:** RTL clean (0 physical-direction utilities in app UI); no customer-facing "CenterHQ" (16 hits all comments/tokens/console); `toLocaleString` only inside `formatNumber.ts`; no `centers.owner_phone` misuse (resolves via `ownerPhone.ts`); `platform_config` used as key-value only; no secret in client bundle.
- **Consent gate (WS6.2/6.3):** `parentNotifications.ts:82` skips sends unless `parent_consent_given` (+ `notify_on_scan`); weekly summary filters on consent; opt-out columns are per-center on `students`. **DONE.**
- **Core loops:** center (signup → attach group → add students → offline QR scan+sync → record fee → parent WhatsApp/portal) and teacher (signup → trial → create group → attach → detach-without-approval) both complete end-to-end, no break. Center loop = **works today: YES**; teacher loop = **works today: YES**.

---

## Fix-priority summary

| # | Finding | Severity | Fix |
|---|---|---|---|
| C1 | `/api/center-users` cross-tenant IDOR (staff phones) | CRITICAL | Easy |
| C2 | `content_access_log` anon cross-tenant read | CRITICAL | Easy |
| H1 | `/api/billing/payg-calculate` auth bypass | HIGH | Easy |
| H2 | Money columns lack CHECK≥0 | HIGH | Med |
| H3 | CASCADE delete on money/audit FKs | HIGH | Med |
| H4 | `commission_audit_log` mutable audit trail | HIGH | Med |
| H5 | Migration drift + unapplied `pin_code` drop | HIGH | Med-High |
| H6 | `parent_portal_tokens` 1yr/plaintext/no-revoke | HIGH | Med |
| H7 | Legal privacy/terms are placeholders | HIGH | Legal |
| H8 | `privacy_requests` no admin flow / no SLA | HIGH | Med |
| M1 | Admin money mutations weak role + missing CSRF | MED | Easy |
| M2 | Non-atomic JS upgrade path | MED | Moderate |
| M3 | Concurrent finalize double-writes `upgrade_log` | MED | Moderate |
| M4 | Cron-monitor drift (money crons unmonitored) | MED | Easy |
| M5 | Student erasure soft-delete only | MED | Med |
| M6 | Money columns not numeric(_,2) | MED | Med |
| M7 | Missing FKs on invoice/payout links | MED | Easy-Med |
| M8 | Unindexed hot FKs (users.center_id, transactions.*) | MED | Easy |
| M9 | Orphan pages / unreachable admin screens | MED | Easy |
| M10 | Group-join-by-link OTP "coming soon" | MED | Med |
| L1–L12 | see above | LOW | mostly Easy |

*Per-workstream raw evidence files (WS1 db, WS2 security, WS3 loopholes, WS4 backend, WS5 frontend/privacy) were produced during the audit and back every line item here.*
