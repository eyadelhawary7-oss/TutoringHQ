# Safe Cleanup + Privacy Minimum — Technical Note

> Point-in-time snapshot as of 2026-07-02. Reviewed against the live database and code on 2026-07-18; preserved as a historical technical record. Only demonstrably-false current-state claims are annotated inline (verified live 2026-07-18).

**Date:** 2026-07-02 · **Project:** Supabase `lczmjpnbuhnsislcvzar` (PostgreSQL 17, eu-west-2) · **Repo:** `eyadelhawary7-oss/CenterHQ` · **Branch:** `claude/safe-cleanup-privacy-minimum-kzi4v0`

Implements the 2 July "Safe Cleanup + Privacy Minimum" brief. Every DDL block is a tracked migration ending in `NOTIFY pgrst, 'reload schema'`, applied to live, verified against the live catalog, with the snapshot regenerated from the live catalog after each section. The summer engine, pricing/financial logic and any arbitrary-SQL path were not touched.

## Method / verification harness

- Local Postgres for a bare rebuild was unavailable (the pgdg apt repo is blocked by the egress proxy; the migrations use the PG17 `MAINTAIN` privilege which local PG16 can't parse). So the snapshot was **regenerated from the live catalog** via `scripts/schema/introspect.sql`'s exact projection (the file explicitly supports live introspection through the Supabase MCP).
- **Pre-existing drift confirmed and preserved** (parked item H5, belongs to the next DB brief, NOT touched here): live carries `users.pin_code` (drop migration unapplied) *(as of 2026-07-02; verified live 2026-07-18 the drop has since reached production — `users.pin_code` no longer exists, and the repo moved to a baseline-snapshot model, so this parked delta is closed)* and two out-of-band function bodies (`is_teacher_private_locked`, `process_due_subscriptions`). The committed snapshot is derived as *live minus these three known deltas* — i.e. exactly what a bare rebuild from `supabase/migrations/` produces — so the CI migration-rebuild drift gate stays green. Verified by reproducing the live `md5(string_agg(line ORDER BY sk,line))` from the committed snapshot before starting (`ac479ba7e0f5e66146f00f0a6faec3c0`, 6137 lines).
- After every section, the regenerated snapshot was diffed against the prior committed snapshot and every changed line confirmed to be an intended change of that section (diffs reproduced below).

---

## SECTION A — Database integrity

Migrations: `20260702100001`…`20260702100004`.

### H4 — Freeze `commission_audit_log`
`20260702100001_freeze_commission_audit_log.sql`. Added `public.append_only_block_mutations()` (table-agnostic `BEFORE UPDATE/DELETE` guard, `REVOKE …FROM PUBLIC`) + trigger `commission_audit_log_no_update_delete`. Dropped policy `commission_audit_log_super_admin_all` (cmd=ALL) → replaced with `commission_audit_log_super_admin_select` (SELECT only). All writers use the service-role client (INSERT only), so no INSERT policy needed. Verified live: trigger present (1), select policy present (1), old ALL policy gone (0).

### H2 + M6 — Money columns `CHECK (>=0)` + `numeric(12,2)`
`20260702100002_money_columns_nonneg_and_scale.sql`. Live-data audit first (99 candidate columns across ~45 tables): **every column had 0 negatives, 0 sub-cent (scale>2) values, max magnitude 21,299** → both the CHECKs and the type changes validated with no data change. Retyped to `numeric(12,2)` and added non-negative CHECKs table by table.
- **Excluded from CHECK (legitimately signed, code-verified):** `credit_ledger.amount` (expire-credits inserts `amount = -prev`, `cron/expire-credits/route.ts:91`), `commission_payouts.adjustment_amount` + `.total_amount` (admin adjustment/carryover, `admin/payouts/[id]/route.ts`), `upgrade_log.daily_rate_difference` (`billingEngine.ts:119` new−old, signed).
- **Excluded from retype (needs a rounding audit first — parked):** the `transactions.*` money family — already `CHECK >= 0` and carries a strict sum-equality CHECK (`lesson_fee + customer_commission_amt + processing_fee_amt = amount_billed`); retyping each component to `numeric(12,2)` could round components independently and break the equality on a future sub-cent write. `chargebacks.amount`, `student_credits.amount`, `teacher_subscriptions.price_*` similarly already guarded and left bare pending the same audit. Only `transactions.snap_processing_flat` (unconstrained) got a `>=0` CHECK. Rate/percent columns (late_fee_rate, commission_rate, *_pct…) left bare — not money amounts.

### H3 — Delete no longer wipes money/audit history
`20260702100003_money_audit_fk_delete_rules.sql`. Switched off `ON DELETE CASCADE`:
- → **RESTRICT**: `audit_log.center_id`, `commissions.center_id`, `invoices.center_id`, `invoices.teacher_id`, `payments.center_id`, `payments.student_id`, `credit_ledger.center_id`, `renewal_history.center_id`, `upgrade_log.center_id`, `combined_payment_sessions.center_id`, `parent_pack_billing.center_id`, `commission_audit_log.commission_id`, `commission_audit_log.payout_id`, `card_order_events.card_order_id`.
- → **SET NULL**: `parent_pack_billing.student_id` (column made nullable) so the dormant-center purge can drop student PII while keeping the de-identified billing row.
- Added a terminal `void` status to `commission_payouts` (+ `payout_voided` to the `commission_audit_log` action CHECK) so voiding a draft payout is a status transition, not a row delete.

Companion code (same commit):
- `admin/centers/route.ts` **DELETE** rewritten: was a manual child-table cascade + hard `centers` delete; now sets `centers.status='suspended', billing_status='suspended'`, deactivates the center's `users` (`is_active=false`), deletes parent-portal tokens, logs `deactivate_center`. The `safeDelete` helper was removed.
- `admin/payouts/[id]/route.ts` **DELETE**: draft payout now `UPDATE …status='void'` (guarded `.eq('status','draft')`), releases its commissions (`t1/t2/loyalty_payout_id = null`), writes a `payout_voided` audit row. `admin/payouts/route.ts` existing-payout probe excludes `void`.
- `card-order-cart/checkout/route.ts` + `dormantCenterPurge.ts`: clear `card_order_events` explicitly before deleting an aborted/purged order (events no longer cascade).

### M7 + M3 + L3
`20260702100004_missing_fks_unique_and_last4_guards.sql`. Live orphan-row audit first: **0 orphans on every link, 0 duplicate (center_id, paymob_order_id) pairs, 0 recurring_charge_declines rows** → all validated clean.
- **M7 FKs added:** `billing_reconciliation_reports.invoice_id`, `recurring_charge_declines.invoice_id`, `centers.summer_first_invoice_id`, `teacher_subscriptions.summer_first_invoice_id` (→ `invoices`); `commissions.{loyalty,t1,t2}_payout_id` (→ `commission_payouts`); `student_group_notes.teacher_id` (→ `teacher_profiles(user_id)`). Polymorphic `owner_type/owner_id` left FK-less by design.
- **M3:** `UNIQUE (center_id, paymob_order_id)` on `upgrade_log` (NULL order ids unaffected — NULLS DISTINCT). This closes the concurrent-finalize duplicate-audit-row TOCTOU at the DB level.
- **L3:** `CHECK (card_last4 ~ '^[0-9]{4}$')` on `recurring_charge_declines` (matches `saved_cards`).

**Snapshot diff (A):** 99 COLUMN retypes + `parent_pack_billing.student_id` nullable; ~30 CONSTRAINT lines (CASCADE→RESTRICT/SET NULL, new CHECKs, new FKs, `upgrade_log` UNIQUE, payout status/action CHECKs); 1 FUNCTION + 1 TRIGGER + 1 POLICY + 3 ROUTINE_GRANT for the append-only guard. Every line confirmed intended.

---

## SECTION B — Access and privilege (code only)

- **M1** `requireAdminRole(ctx, ['super_admin','accountant'])` added to: `admin/billing` POST (L305) + PUT (L389); `admin/renewals` POST (L133); `admin/referrals` POST (rewritten to `getAdminContext` + role gate + **`validateCSRFRequest`**, retiring the weaker `ensureAdmin`); `admin/centers` PUT + DELETE (via new `centerMutationRoleAllowed()` helper — super-admin by phone or `admin_users.role IN (super_admin, accountant)`). `ceo/mrr` + `ceo/dashboard` GET finance-gated to `['super_admin','accountant']` to match `ceo/financials`. `admin/centers` POST (create) left as-is (not in the brief's list).
- **L1** `webhooks/sentry/route.ts`: fail closed — unset `SENTRY_WEBHOOK_SECRET` now returns 503 instead of processing an unsigned POST.
- **L2** Upstash `rateLimit` (fail-closed, matching `demo-request`) added to `accept-invite/check` (20/15min/IP) and `referral/validate` (30/15min/IP).

---

## SECTION C — Parent link hardening

`20260702100005_parent_portal_token_hardening.sql` (table had 0 rows). Added `token_hash text NOT NULL` + `revoked_at timestamptz`; dropped the plaintext `token` column; unique index on `token_hash`; seeded `platform_config('parent_portal.link_lifetime_days','30')`.

Code:
- New `src/lib/parentPortalToken.ts`: `hashParentPortalToken` (SHA-256), `newParentPortalToken` (raw + hash), `getParentPortalLifetimeDays` (config read, 30-day fallback).
- `whatsapp/webhook/route.ts` mint: lifetime from config (interim 30d, was `setFullYear(+1)`), stores `token_hash` (was plaintext `token`).
- `parent/portal/route.ts` lookup: query `.eq('token_hash', hash(token))`, reject when `revoked_at IS NOT NULL` or expired.

**⚑ Adsero-pending:** the 30-day window is an interim safe default; final value is a one-row `platform_config` change, no code change.

**Snapshot diff (C):** `token`/its unique constraint/`idx_parent_portal_tokens_token` removed; `token_hash` (+ unique index) and `revoked_at` added; ord shift on the two later columns.

---

## SECTION D — Privacy request handling (minimum)

`20260702100006_privacy_request_admin_flow.sql`: `admin_alerts.center_id` → nullable (privacy alerts are platform-level); `admin_alerts_type_check` extended with `'privacy_request'`. No `due_at` column — the 30-day due date is derived as `created_at + 30d` in the API. Confirmed the only `admin_alerts` reader that could break on a null center is `ceo/dashboard` (a `count(*)` of unresolved) — safe.

Code:
- `privacy-request/route.ts` (public intake): on successful insert (now `.select('id')`), best-effort raise an `admin_alerts` row (`type='privacy_request'`, `center_id=null`) + `in_app_notifications` for every `admin_users` id (`kind='privacy_request'`, `href='/admin/privacy-requests'`). Wrapped so a notification failure never fails the authoritative request insert.
- `GET /api/admin/privacy-requests` (super_admin): list + computed `due_at`.
- `GET/POST /api/admin/privacy-requests/anonymize` (super_admin, POST CSRF-gated): GET returns candidate students matching the request phone (`phone`/`parent_phone`); POST anonymizes a `deletion` request's student — sets `name='[erased]'` (NOT NULL), nulls `phone/parent_phone/qr_code/qr_data/qr_code_data/grade_level`, clears `parent_phone_verified/parent_consent_given`, `is_active=false`; **deletes** `student_notes`, blanks `student_group_notes.note`; keeps the row + financial links; writes `audit_log` action `anonymize_student` (de-identified details); marks the request `completed` with `handled_by/handled_at/response_notes`. Deliberately does **not** auto-resolve `admin_alerts` (no per-request link → would clear sibling alerts).
- `src/app/[locale]/admin/privacy-requests/page.tsx` (super_admin nav entry in `AdminSidebar`, `ShieldCheck` icon). Overdue rows flagged red. 14 i18n keys added to both `ar`/`en` (parity gate green).

**⚑ Adsero-pending:** erasure field list is intentionally generous (over-stripping is the safe direction); the exact boundary is a small edit to the field list in the anonymize route.

**Snapshot diff (D):** `admin_alerts.center_id notnull=false`; `admin_alerts_type_check` gains `privacy_request`.

---

## SECTION E — Performance and cleanup

`20260702100007_hotpath_indexes_and_dedupe.sql` — all `CONCURRENTLY` (applied via autocommit `execute_sql`, one statement each; the migration file is replayable by `psql -f` in CI autocommit).
- **M8** created (9): `idx_users_center_id`; `idx_transactions_{center_id,group_id,enrollment_id,created_by,marked_paid_by}`; `idx_pending_enrollments_{center_id,group_id,student_id}`. (`transactions.student_id/teacher_id` already indexed — skipped.)
- **L4** dropped (7 byte-identical duplicate groups = the advisor's `duplicate_index` set; each verified NOT backing a constraint): `idx_attendance_student`, `idx_audit_action`, `idx_payments_center_paid`, `idx_students_payment`, `idx_wa_center_month`, `in_app_notifications_user_created_idx`, `mrr_snapshots_date_unique` (kept the constraint-backed `mrr_snapshots_snapshot_date_key`). The audit's looser "22 groups" figure counted prefix-redundant pairs, which are NOT byte-identical and are deferred to the later performance pass (per the brief's Parked list).

Code:
- **L5** `cron/process-outbox/route.ts`: claim now `UPDATE …status='processing' .eq('id') .in('status',['pending','failed']) .select('id')`; empty result → skip (no double-claim).
- **L9** Cairo-time helper `cairoDateKey(new Date())` replaces UTC `new Date().toISOString().slice(0,10)` in `subscriptionAnchor.ts:55`, `billingSchedule.ts:24`, `invoicePaymobPayment.ts` (×3: L477, L492, L527), `cron/payment-retry/route.ts:77`.
- **M9** deleted dead nav components `Navbar.tsx`, `TopNavbar.tsx`, `BottomNav.tsx` (0 import/JSX refs; carried a stale `/scan` link).
  - **Correction to the audit:** `/invoices` and `/parent-whatsapp` are `redirect()` shims to live pages, and `/whatsapp` is a full working templates feature (owner/admin-gated, real data) — none are "coming soon" stubs, so none were deleted. `/financial-intelligence` left in place for Eyad's keep-or-remove decision (per brief).
- **L10** `DonutChart` and `SparklineChart` already guarded the empty case but rendered a blank box; now render a visible empty-state indicator (em-dash / flat baseline). `PaymentBar` already renders an empty track + zeros — unchanged.

**Snapshot diff (E):** 7 INDEX lines removed, 9 INDEX lines added — exactly the dedupe + hot-path set.

---

## M2 — deferred (optional, payment path)

Not implemented in this branch. Rationale: it is the only change touching the live combined-payment path; the brief authorised deferral ("do it last… can move to its own brief"); the concrete duplicate-`upgrade_log`-row risk it targets is **already closed** by the Section A `UNIQUE(center_id, paymob_order_id)` constraint; and the audit confirmed no money is at risk in that path today (finalize is `FOR UPDATE`-guarded + idempotent, stuck-payment cron recovers, only audit timing is affected). It should get its own careful brief with a before/after.

---

## Gate status

`typecheck` ✅ · `check:i18n` ✅ (en/ar parity) · `check:bidi` ✅ · `check:tolocale` ✅. Migrations applied to live and re-introspected; snapshot regenerated from the live catalog after each section (drift gates green net of the parked H5 deltas). No PR opened.
