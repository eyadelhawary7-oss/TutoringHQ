# CenterHQ — Full Platform Re-Audit (after Phases 0–5)

**Date:** 2026-06-26
**Scope:** Read-only diagnosis of live production (`lczmjpnbuhnsislcvzar`, Postgres 17.6) + committed code at `claude/platform-reaudit-phases-0-5-7dg56p` (master @ `2e30366`, PR #109 merged).
**Method:** Live catalog introspection (`information_schema`, `pg_proc.prosrc`, `pg_policies`, `pg_class`, `cron.job`, `net._http_response`, `vault.secrets`, Supabase security advisors) cross-checked against the actual code. Nothing taken from memory or stale files.
**Changes made:** NONE. This is diagnosis only. No migration, DDL, dashboard/MCP write, code edit, rotation, or PR.

---

## 1. Overall verdict

**The Phase 0–5 roadmap holds in production.** Every fix I was asked to confirm is actually live: the money/credit/billing RPCs are `service_role`-only with internal guards; `ai_execute_query` is gone; the combined finalize is atomic and idempotent; webhooks fail closed; CSRF and the rate-limiter fail closed; reconciliation self-heals one safe direction only; the DLQ is surfaced and retryable; and the literal `CRON_SECRET` is out of every `pg_cron` command and into Vault. **`prod == db/schema.snapshot` byte-for-byte** (independently re-derived today), and the from-migrations drift gate is green through Phase 5.

Three things temper that:

1. **One PARKED item is not merely "still standing" — it is actively firing in production right now.** The `pg_cron`→endpoint `CRON_SECRET` mismatch is returning **401 on every `pg_cron` invocation** (verified in `pg_net`'s response log, last hit 08:45 UTC today). It causes no outage *only* because the same crons are redundantly scheduled in `vercel.json` and Vercel's scheduler carries the correct secret. Phase 5 moved the token into Vault but did **not** make the Vault value match the deployment.

2. **A new class of cross-tenant / resource-abuse surface that Phase 1 did not cover:** ~30 `SECURITY DEFINER` RPCs remain `EXECUTE`-granted to `authenticated` (and 19 to `anon`) with no caller-owns-center guard. Phase 1 correctly hardened the *money* RPCs; the same treatment was never extended to `approve_student_rpc`, the commission-pause pair, and the global-recompute functions. Corroborated by 49 Supabase `*_security_definer_function_executable` advisories.

3. **The new live-drift gate is wired but unproven** (0 recorded runs) and silently skips when its DB-URL secret is unset; and the Phase-4 "no PII in browser storage" claim holds for `localStorage`/`sessionStorage` but **not** for the scanner's IndexedDB cache, which still persists student name/phone/balance.

None of the new findings are Critical. The sharpest items are the live cron-401 (Medium, masked) and the un-guarded `authenticated` definer RPCs (Medium).

---

## 2. Phase 0–5 — verified holding live (with evidence)

| Phase | Claim | Verdict | Live evidence |
|---|---|---|---|
| **0** | prod == `db/schema.snapshot` | ✅ **Confirmed** | Ran the committed `scripts/schema/introspect.sql` against live prod: **6166 objects, fingerprint `12e909b6387e157a552d5895ac96468c`** — identical line-count and order-independent md5 to the committed snapshot. Zero drift. |
| **0** | from-migrations drift gate wired & green | ✅ Holds | `schema-drift.yml` on master since 2026-06-25; all runs **success** through PR #109 (Phase 5) on 2026-06-26. Rebuilds baseline+5 phase migrations, introspects, diffs snapshot. |
| **0** | no ghost objects beyond baseline | ✅ Holds | Implied by the exact prod==snapshot match; snapshot is the from-migrations baseline output. |
| **0** | live-drift gate wired & green | ⚠️ **Unproven** — see NEW-4 | `schema-drift-live.yml` present on master (commit `087e980`, 2026-06-25) but **0 recorded runs**; skips silently if `SCHEMA_DRIFT_DATABASE_URL` unset. |
| **1** | money/credit RPCs `EXECUTE`=service_role only | ✅ Holds | `pg_proc.proacl` for `earn/spend/reserve/cancel_credits_atomic`, `process_payment_rpc`, `deduct_blast_balance_rpc`, `finalize_*`, `try_finalize_payment_session`, `redeem_promo_code`, `increment_promo_uses` = `postgres=X \| service_role=X` only. No `authenticated`/`anon`/PUBLIC. |
| **1** | internal caller/amount guards | ✅ Holds | Live `prosrc`: `process_payment_rpc` contains `assert_caller_center_access` + underpayment guard (`amount < total_amount` → raise) + `invoice_already_paid`; `earn/spend/reserve/cancel/deduct_blast` all call `assert_caller_center_access`. |
| **1** | `/api/ai/query` + `ai_execute_query` removed | ✅ Holds | No `ai_execute_query`/`ai_query`/`execute_query` function exists in `public` (catalog query returns ∅). |
| **1** | combined wallet+card finalize atomic, no stuck session | ✅ Holds | Live body of `finalize_combined_session_paid`: `pg_advisory_xact_lock` + `FOR UPDATE`, idempotent (`status='paid' OR finalized_at IS NOT NULL → 'already_done'`), credit spent in the same txn as the paid marker (rolls back together). Live: **0** sessions `status='paid' AND finalized_at IS NULL`. |
| **3** | DLQ surfaced + retryable | ✅ Holds | `process-outbox` inserts to `dead_letter_queue` + Sentry + CEO action on max-attempts; `/api/admin/dead-letter` lists/retries (super-admin+CSRF). Live: **0** unresolved DLQ, **0** dead outbox. |
| **3** | "paid" sent only when finalized | ✅ Holds | Webhook re-reads invoice/session `.eq('status','paid')` before `sendPaymentConfirmed`; underpayment path emits no paid notice (`invoicePaymobPayment.ts`). |
| **3** | invoice side-effects transactional | ✅ Holds | `finalize_subscription_invoice_paid`/`finalize_teacher_invoice_paid` mark-paid + renewal/centers updates in one body, guarded by `status <> 'paid'` row-count. |
| **3** | payment-collect server-permission-gated | ✅ Holds | `payments/collect/route.ts` gates on server-derived `auth.permissions.can_record_payments` / role / super-admin; `center_id` forced server-side. |
| **3** | Bosta webhook fails closed | ✅ Holds | `bosta/webhook/route.ts`: 401 if `BOSTA_WEBHOOK_SECRET` unset, 401 if signature absent, constant-time HMAC compare. |
| **4** | CSRF fails closed on missing secret | ✅ Holds | `csrf.ts`: `validateCSRFRequest` returns `false` (reject) when `isCSRFEnabled()` false (secret missing/malformed). |
| **4** | rate-limiter fails closed | ✅ Holds | `rateLimitCore.ts`: no Upstash env → `getUpstashRedis()` null → every limiter returns `success:false` (incl. `failClosedLimiter`). |
| **4** | two referral routes authed | ✅ Holds | `referral/route.ts` requires Bearer (401 else), center-scoped; `referral/validate` is read-only + masked. Privileged referral routes gated by super-admin / CRON_SECRET / permission. |
| **4** | reconciliation: no boundary gap, safe-direction self-heal | ✅ Holds | Daily run, 7-day lookback (overlapping → no gap); Scan A (we-think-paid) only flags for human review; Scan B self-heals **unpaid→paid only** via the idempotent finalizer. Never auto-reverses/refunds. |
| **4** | invoice-correction bypass writes audit_log | ✅ Holds | `chq_prevent_invoice_tampering()` (migration `…000005`) inserts full before/after to `audit_log` on the `app.allow_invoice_correction='on'` branch before `RETURN NEW`. |
| **4** | bidi build gate enforces | ✅ Holds | `check-bidi.ts` `process.exit(1)` on violations; wired into `build` + `verify:stabilization`. |
| **4** | no PII in browser storage | ⚠️ **Partial** — see NEW-5 | `localStorage`/`sessionStorage` clean (PII routed through in-memory cache), but scanner **IndexedDB** persists student name/phone/balance. |
| **5** | `CRON_SECRET` de-embedded from pg_cron into Vault | ✅ Holds (literal removed) | All 11 `cron.job` commands read `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret')`; `vault.secrets` has `cron_secret`. No literal bearer token in any job command or in `db/cron.snapshot`. **But the Vault value still mismatches the deployment — see PARKED-3.** |

---

## 3. Findings by severity

### CRITICAL
None.

### HIGH
None new. (The most operationally significant item, the live cron-401, is a re-confirmed PARKED item — see PARKED-3. It is masked by redundant scheduling, so it is not causing a functional outage.)

### MEDIUM

#### NEW-1 — `SECURITY DEFINER` RPCs `EXECUTE`-granted to `authenticated` with no caller-owns-center guard
**What:** Phase 1 hardened the money RPCs, but a broader set of definer functions is still directly callable by any signed-in user via `/rest/v1/rpc/<fn>`, with no `assert_caller_center_access`-style guard:
- `approve_student_rpc(p_student_id, p_center_id, …)` — flips a pending student to `is_active`, bumps counts, writes `parent_pack_monthly_counts`. It *does* scope by `WHERE id=p_student_id AND center_id=p_center_id`, but never checks the **caller** belongs to `p_center_id`; with a target student+center UUID, a user of center A can activate a student in center B.
- `append_commission_pause(p_center_id)` / `close_commission_pause(p_center_id)` — pause/resume referral commission T2 clocks for **any** `center_id` (money-adjacent).
- `complete_onboarding_step_rpc(p_center_id, p_step)` — mark another center's onboarding step complete.
- `upsert_scan_metric(p_center_id, …)` — inflate another center's daily scan metrics.
- `recalc_student_lifecycle(p_student_id)` — recompute lifecycle for an arbitrary student.

**Where:** live `pg_proc` (grants + bodies); `pg_proc.proacl` shows `authenticated=X`. Supabase advisor: 30× `authenticated_security_definer_function_executable`.
**Why it matters:** cross-tenant writes / metric tampering. Exploitability is bounded — it requires knowing target UUIDs (not enumerable through RLS) and impact is limited (no credit mint, no money movement) — but these are exactly the defense-in-depth gaps Phase 1 closed for the money RPCs, left open here.
**Fix direction:** add `PERFORM assert_caller_center_access(p_center_id)` to each (and a student→center lookup for the `p_student_id`-only ones), or revoke `authenticated`/`anon` `EXECUTE` and call them via the service-role wrapper like the money RPCs. Do **not** implement now.

#### NEW-2 — Global-recompute definer RPCs callable by any `authenticated` user (resource-exhaustion vector)
**What:** `recalc_all_lifecycle_status()` (loops **every** student), `recompute_all_health_scores()` (loops every active center), and `compute_benchmark_snapshots(date)` (platform-wide aggregation) are `SECURITY DEFINER` and `EXECUTE`-granted to `authenticated`. Any signed-in user can trigger a full-platform recompute on demand.
**Where:** live `pg_proc` bodies (`FOR r IN SELECT id FROM students LOOP …`, `… FROM centers WHERE status='active'`); advisor warnings.
**Why it matters:** availability / DB CPU exhaustion (repeated calls), and these write platform-wide rows. No data leak.
**Fix direction:** revoke `authenticated` `EXECUTE`; these are cron-only — keep `service_role` only.

#### PARKED-3 (re-confirmed, **actively firing**) — pg_cron `CRON_SECRET` mismatch → 401 on every pg_cron job
**What:** The `pg_cron` jobs post to the cron endpoints with `Authorization: Bearer <vault cron_secret>`, but the endpoints reject them. `net._http_response` over the last ~6h: **77 of 78 responses are 401**, every one landing on the `*/5` minute boundary (the `status-ping` job), most recent **08:45 UTC today**. The Vault `cron_secret` value does **not** equal the deployment's `CRON_SECRET`.
**Why no outage:** all but one of these crons are *also* registered in `vercel.json` (40 Vercel crons), and Vercel's scheduler authenticates correctly — the endpoints log `success` into `cron_log` from the Vercel-driven calls, which masks the dead pg_cron path.
**Why it matters:** the entire `pg_cron` scheduling layer is non-functional; the platform silently depends on Vercel redundancy. `mrr-snapshot` (the one pg_cron endpoint **not** in `vercel.json` as `snapshot-mrr`… note: it *is* present as `/api/cron/snapshot-mrr`, so even it is covered) — net: no current functional gap, but a latent single-point dependency and a misleading green `cron_log`.
**Fix direction:** rotate the Vault `cron_secret` to equal the deployment `CRON_SECRET` (or vice-versa), then verify `net._http_response` shows 200s. Separately decide whether the duplicate `pg_cron` jobs should exist at all given Vercel already schedules them.

#### PARKED — Child-safety / PDPL (Phase 2 skipped) — all still standing
- **PARKED-CS1 — Right-to-erasure recorded but never executed.** `privacy-request/route.ts:62` only `INSERT`s into `privacy_requests` (status `pending`); no reader/processor/anonymizer anywhere in `src/`. `deletion` requests sit unactioned. (The super-admin center-delete in `admin/centers/route.ts` is unrelated and not a data-subject path.)
- **PARKED-CS2 — Alert crons message parents without a consent gate.** `parent-absence-alerts` and `parent-balance-alerts` gate on `parent_pack_opted_in` only — **not** `parent_consent_given`. (The scan/weekly-summary path *does* check `parent_consent_given`; the absence/balance crons do not.) `fee-reminders` messages `payer_phone` with no consent concept.
- **PARKED-CS3 — Consent reply matched globally (cross-tenant).** `whatsapp/webhook/route.ts:349-353` matches the inbound `وافق` on `parent_phone` with **no `center_id` filter**, flipping consent and minting `parent_portal_tokens` for that parent's children in **every** center. The consent *request* side is correctly center-scoped; the reply side is not.
- **PARKED-CS4 — Parent-portal tokens: long-lived, unrevokable, bearer-in-URL.** `parent_portal_tokens` (baseline.sql) has no `revoked`/`used_at` column; generated with **1-year** expiry (`webhook/route.ts:356-357`); consumed as `?token=` query param (`parent/portal/route.ts:5`). No per-token revoke path.

#### NEW-5 — PII persists in scanner IndexedDB (qualifies the Phase-4 claim)
**What:** "No PII in browser storage" holds for `localStorage`/`sessionStorage` (deliberately routed through `clientMemoryCache`), but the offline scanner caches **full student objects** — name, phone, balance, student_number — in IndexedDB `centerhq-offline` (`src/lib/db.ts:70-84`), plus student names in `today_history` (7-day retention).
**Why it matters:** student PII (incl. minor data) at rest, unencrypted, in the browser. Likely an accepted trade-off for offline attendance, but it contradicts the unqualified "no PII in browser storage" claim and should be stated as a scoped exception.
**Fix direction:** document as an accepted exception, or minimize cached fields / encrypt the store / shorten retention. Not for this pass.

### LOW

#### NEW-6 — Live-drift gate unproven + silent-skip
`schema-drift-live.yml` has executed **0 times** despite being on master since 2026-06-25, and the guard step skips (not fails) when `SCHEMA_DRIFT_DATABASE_URL` is unset. The control may be a no-op in practice. (Today's prod==snapshot match was verified manually by me, not by the gate.) **Fix:** confirm the repo secret is set and trigger a `workflow_dispatch` to prove it runs green.

#### NEW-7 — Two unauthenticated, unthrottled mutation endpoints
`POST /api/demo-request` (insert `demo_requests`) and `POST /api/signup/persist` (upsert `pending_signups` keyed on phone) have no auth, no CSRF, and **no rate-limit** — unlike the sibling `/api/signup`, which is rate-limited. Pre-auth funnel tables only (low criticality), but spammable. **Fix:** add IP/phone rate-limiting, at least to `signup/persist` for parity.

#### NEW-8 — 19 `anon`-executable `SECURITY DEFINER` functions (least-privilege noise)
Mostly RLS helpers (`get_auth_center_id`, `get_my_center_id`, `has_center_role`, `is_super_admin`, …) that read `auth.uid()` and return caller context (benign for `anon`, which has none) and trigger functions (`chq_prevent_*`, `assign_*`) that error if invoked directly. Low real risk, but they widen the RPC surface. **Fix:** `REVOKE EXECUTE … FROM anon` on the non-helper ones.

#### NEW-9 — Minor Supabase config advisories
`extension_in_public` for `pg_net` and `pg_trgm` (move out of `public`); `auth_leaked_password_protection` disabled (enable HaveIBeenPwned check). Cosmetic/hardening.

#### NEW-10 — Subscription "paid" WA confirm can double-send on an `already_paid` race
`invoicePaymobPayment.ts` sends the confirmation even when the atomic finalize returns `already_paid`, relying on outbox/`sendPaymentConfirmed` dedupe. Not a false-paid (it's still post-finalize), just a possible duplicate message.

#### PARKED — Dead `pin_code` column + vestigial references — still standing
`users.pin_code varchar(6)` is **all-NULL in prod** (0 of 6 users non-null). Real phone+PIN auth uses the Supabase Auth account password (`auth/login-verify/route.ts:190` `signInWithPassword`), **not** `pin_code` (no `pin_hash` column exists). ~14 vestigial writers remain (mixing SHA-256 and bcrypt, harmlessly, since nothing reads them), and **5 always-false "pin_already_set" no-op gates** (`request-pin-setup-link`, `set-initial-pin` ×2, `signup/pin-setup-readiness`, `set-pin/page.tsx`). **Fix direction:** drop the column + dead references in a dedicated cleanup; verify no writer would error first.

---

## 4. Areas inspected and found clean

- **RLS coverage:** RLS enabled on **all 137** `public` base tables. Sensitive tables (`saved_cards`, `saved_card_consents`, `pin_setup_tokens`, `phone_verifications`, `*_otps`, `chargebacks`, `recurring_charge_declines`, `pending_signups`, `pending_enrollments`, `billing_reconciliation_reports`) have **0 policies = deny-all to anon/authenticated, service-role only** by design (matches the 18 INFO `rls_enabled_no_policy` advisories — expected, not a gap).
- **Webhook fail-closed + idempotency:** Paymob, WhatsApp (`/webhook` + `/inbound`), Bosta all 401 when secret unset / signature missing / mismatch (constant-time). Every `PUBLIC_WEBHOOK_PREFIXES` entry self-verifies HMAC. `webhook_inbox` unique-index dedupe + processor-level order/status guards.
- **Underpayment:** `isInvoiceSettled(total, received)` (0.005 tolerance); partial pay updates `amount_received` only, never clears the invoice; per-txn idempotency via `metadata.applied_txns`.
- **Refunds-as-credit:** credit minted only by `earn_credits_atomic`, sole app caller `billing/downgrade` (authed, capped `all_in_price*3`); Paymob refund/chargeback flips invoice to `chargeback` + suspends, never mints credit.
- **Secrets/config:** no hardcoded JWT/hex/`sk_live` secrets in `src/`; `SUPABASE_SERVICE_ROLE_KEY` referenced only in server routes/libs; no client component imports the admin client; `cron_secret` lives in Vault (not in job commands or `db/cron.snapshot`).
- **Number/VAT/date:** money RPC tax math matches the cascading-multiplication spec; reconciliation/billing windows use Cairo-aware helpers. No raw `toLocaleString` regressions surfaced (bidi/tolocale gates enforce in `build`).

---

## 5. Evidence appendix (key live queries)

- **prod==snapshot:** committed `db/schema.snapshot` = 6166 lines, per-line-md5 fingerprint `12e909b6387e157a552d5895ac96468c`; live `introspect.sql` (wrapped as `count(*), md5(string_agg(md5(line) ORDER BY md5(line)))`) = `{n:6166, fp:12e909b6387e157a552d5895ac96468c}`. **Identical.**
- **Money RPC grants:** `pg_proc.proacl` → service_role-only for all 9 revoked-list functions.
- **Live guard presence:** `position('assert_caller_center_access' in prosrc)>0` true for process_payment/earn/spend/reserve/deduct_blast; `position('underpayment' …)>0` true for process_payment_rpc.
- **Cron 401:** `net._http_response` 3-day window = 78×401 / 1×200; 77/78 401s on `*/5` boundary (status-ping). Vault: `vault.secrets` has `cron_secret`. All 11 `cron.job` commands reference `vault.decrypted_secrets`.
- **Reliability counters:** 0 paid-but-unfinalized sessions, 0 unresolved DLQ, 0 dead outbox.
- **pin_code:** 0/6 users non-null.
- **CI:** `schema-drift.yml` green through PR #109; `schema-drift-live.yml` 0 runs.
- **Advisors:** 30 authenticated- + 19 anon-`security_definer_function_executable` (WARN), 18 `rls_enabled_no_policy` (INFO, intentional), 2 `extension_in_public`, 1 leaked-password-protection-off.

*End of report. No changes were made to the database or codebase.*
