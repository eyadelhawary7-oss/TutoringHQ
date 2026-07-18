# Billing reliability hardening

> Synced against the live database and code on 2026-07-18. Shipped feature; facts confirmed live are tagged (verified live 2026-07-18). The tamper trigger, both ledger tables, and the reconciliation/nudge crons exist in the live catalog and repo. Note: the two migrations cited below were folded into the baseline snapshot and now live under `supabase/migrations_archive/`, not `supabase/migrations/`.

Safety net that lets the billing system run with real money: payments are never
double-counted or silently lost, finalized invoices can't be quietly altered, and
drift between our records and Paymob is caught automatically. Covers **both
centers and teachers** — they share the `invoices` machinery (owner-polymorphic:
`owner_type` ∈ `{center, teacher}`, with `center_id` XOR `teacher_id`).

Nothing here makes auto-charge live; it does not touch the
`PAYMOB_RECURRING_INTEGRATION_ID` dependency.

## What was already in place (audit, not rebuilt)

- **Webhook idempotency** — `webhook_inbox` (UNIQUE `idempotency_key`) dedupes
  Paymob / Bosta / Meta deliveries; HMAC verified per source. Payment application
  is additionally idempotent via `try_finalize_payment_session` (advisory lock),
  the partial-unique `idx_combined_sessions_order_paid`, and the
  `invoices.metadata.applied_txns` per-transaction guard. New billing + nudge
  flows reuse the SAME finalizer (`finalizeInvoicePaymentSuccess`) — no parallel
  path. A duplicate webhook cannot double-apply.
- **Autocharge audit** — the midnight-billing adapter already wrote `audit_log`
  rows (`autocharge_*`) for its own path.

## Gaps filled

### 1. Invoice immutability (tamper guard) — `chq_prevent_invoice_tampering`

The tamper trigger existed in the live DB but **was not tracked in any migration**
and blocked *all* status/money changes unconditionally (including the legitimate
`pending→paid` finalization), with no bypass. It is now brought into the repo
(`supabase/migrations_archive/20260626000000_billing_reliability_hardening.sql` —
archived into the baseline snapshot) and corrected to an
**owner-agnostic, finalized-invoice** guard (BEFORE UPDATE on `invoices`). The live
trigger is `trg_chq_prevent_invoice_tampering` (function `chq_prevent_invoice_tampering`),
present on `public.invoices` (verified live 2026-07-18):

- Owner identity (`owner_type`, `center_id`, `teacher_id`) is immutable for every
  invoice — a row can never be re-pointed to a different owner.
- Once `status='paid'`, the money-critical fields (`total_amount`,
  `amount_received`, `paid_at`, `invoice_type`, `paymob_transaction_id`) are
  immutable for **both centers and teachers**.
- The only in-place transition out of `paid` is the externally-forced reversal
  `paid→chargeback` (Paymob void/refund).
- A sanctioned, audited correction path may set
  `app.allow_invoice_correction = 'on'` (transaction-local) to bypass — mirroring
  the `app.allow_lifecycle_write` convention. Corrections should go through an
  explicit credit/adjustment, never a silent in-place edit.

Verified live for both owner types (rolled-back transaction): paid center/teacher
invoices reject money-field edits; `pending→paid` and `paid→chargeback` succeed;
owner re-point rejected; correction-GUC bypass works.

### 2. Nightly reconciliation cron — `/api/cron/billing-reconciliation`

Runs daily (`30 3 * * *`, `maxDuration 300`). `reconcileRecentBilling`
(`src/lib/billing/reconciliation.ts`) cross-checks a bounded recent window
(7 days) against Paymob via `inquirePaymobCardOrder`:

- **Scan A — paid invoice, does Paymob agree?** If a Paymob-settled invoice we
  show as `paid` is not paid at Paymob, flag `paid_without_paymob_success` into
  `billing_reconciliation_reports` (status `open`). **Never auto-mutated** in this
  direction — a human resolves it.
- **Scan B — Paymob paid, did we finalize?** (webhook-missed) If an unpaid invoice
  with a Paymob order is actually paid at Paymob, **self-heal** by calling the
  SAME idempotent finalizer the webhook uses. This only ever moves unpaid →
  correctly-paid. If the finalizer can't settle it, flag `paymob_paid_unfinalized`
  open for review.

Idempotent / safe to re-run: a healed invoice becomes `paid` and drops out of
Scan B; open findings are de-duplicated by a partial unique index
`(kind, invoice_id) WHERE status='open'`. Covers centers and teachers (both live
in `invoices`).

### 3. Audit completeness — `src/lib/billingAudit.ts`

`logBillingEvent(supabase, action, owner, details)` writes append-only `audit_log`
rows (system actor → `user_id` null), uniform across owner types. Wired into the
money chokepoints for **both centers and teachers**:

| Event | Where |
| --- | --- |
| `invoice_created` | `ensureTeacherSubscriptionInvoice`, `subscriptionBillingCron` |
| `invoice_payment_applied` (partial/underpayment) | `finalizeInvoicePaymentSuccess` |
| `invoice_paid` | `finalizeInvoicePaymentSuccess` |
| `invoice_payment_failed` | `finalizeInvoicePaymentFailure` |
| `invoice_chargeback` | `finalizeInvoiceChargeback` |
| `reconciliation_self_heal` / `reconciliation_mismatch_flagged` | reconciliation cron |

### 4. Decline / issuer tracking — `recurring_charge_declines`

Append-only. On every definitive decline of a merchant-initiated recurring
charge, the midnight-billing orchestrator calls `adapter.recordDecline`, which
records owner, invoice, billing period, attempt, `decline_code`,
`decline_classification` (`auth_required` / `hard_final` / `soft_retryable`),
error message, and card brand/last4 (weak issuer proxy). `issuer_bank` is left
null until Paymob exposes it on the recurring-charge response. For learning which
Egyptian issuers reject MIT and for support visibility — no customer-facing change.

## Tables

- `billing_reconciliation_reports` — reconciliation findings (review queue).
- `recurring_charge_declines` — append-only decline log.

Both: RLS on, no user-facing policies (service-role only), grants revoked from
`anon`/`authenticated` — same posture as `webhook_inbox` / `saved_card_*`.

## Tests

`tests/unit/billingReconciliation.test.ts`, `billingAuditTrail.test.ts`,
`billingDeclineTracking.test.ts`, `invoiceTamperGuard.test.ts` prove: duplicate
webhook does not double-apply; paid invoice money fields immutable for centers AND
teachers (DB-verified live + migration-source guard); reconciliation flags a
fabricated mismatch; the safe self-heal finalizes an unfinalized-but-paid invoice
and touches nothing else; a failed charge records its decline/issuer info; audit
entries are written for each money-critical event.
