# Customer invoices page + underpayment handling (Phase 3 + 5)

The customer-facing payment surface where **wallet customers** and **card
customers whose bank declined the auto-charge** see and pay what they owe. The
Phase 2 midnight engine already routes both to an unpaid `invoices` row; this is
where the customer sees and pays it.

> Scope: this is **center-scoped**. Teachers have no rows in `invoices` — the
> midnight engine routes teacher dunning through `teacher_subscriptions.grace_until`,
> not an invoice — so the invoice/underpayment flow applies to center owners.

## The page — `/{locale}/billing`

`src/app/[locale]/billing/page.tsx` (client, Arabic-first, RTL, mobile-first),
fed by `GET /api/billing/customer-invoices`. Three clearly separated buckets:

- **3a. Unpaid (action required)** — outstanding invoices at the top, amber. Each
  shows the full breakdown via the existing redesigned layout
  (`ProcessingFeeBreakdown`: subscription → processing fee → total → VAT-included)
  and a one-tap **Pay now** that opens the existing Paymob flow
  (`POST /api/invoices/[id]/pay` → iframe via `PaymobInvoiceModal`, polled by
  `/api/paymob/invoice-status`). Statuses surfaced: `pending`, `overdue`, `failed`.
- **3b. Paid (history)** — reverse-chronological paid invoices with date, amount,
  and a receipt (PDF) download (`/api/invoices/[id]/pdf`).
- **3c. Upcoming (forecast)** — the next charge as a **preview line only**,
  computed by `computeUpcomingForecast` (`src/lib/billingForecast.ts`) from
  `centers.next_payment_due` + `centers.billing_amount` + the current processing
  fee. **It is never persisted as an invoice** — the API only ever reads; the line
  has non-actionable styling and no Pay button. It becomes a real invoice only when
  the billing date arrives and the Phase 2 cron creates one (mirrors Stripe's
  "upcoming invoice" preview). Labelled an estimate (plan change / proration may
  alter it).

### Reachability when locked

A locked center is redirected to `/suspended`; only `isSuspendedRouteExempt`
paths escape. `/billing` is therefore added to **both**
`AUTHENTICATED_ROUTE_PREFIXES` and `isSuspendedRouteExempt` (`src/proxy.ts`,
`src/lib/suspendedRouteExempt.ts`) so a locked customer can reach it and pay to
unlock.

## Underpayment (Phase 5)

A wallet/manual payment can settle **less** than the invoice total. Money-safety
rules:

- The invoice is **not satisfied** by a partial — it stays unpaid and the account
  stays locked (or locks at the normal point). A partial never unlocks.
- The partial amount is **held as credit toward the same invoice** (never lost).
- The invoice then shows only the **remaining difference** as due (e.g. paid 900
  of 999 → "99 EGP remaining to unlock"), payable via the same Pay now button.
- **No second processing fee** on the top-up — the flat fee already lives inside
  `total_amount`, and the top-up charges `remaining = total − received`, so there
  is nothing that re-derives or re-adds a fee. One invoice, one fee, regardless of
  how many partials complete it. No percentage is ever applied to the fee.
- **No countdown / no deadline** on the top-up. The balance simply sits.
- Paying the remaining difference satisfies the invoice and **unlocks
  immediately** (the engine unlocks on the "paid" signal). A lock that fired in the
  gap self-resolves the moment Paymob confirms the completing payment.

### Storage (verified live before building)

- `invoices.amount_received NUMERIC NOT NULL DEFAULT 0` — the single, reliably
  stored source of truth for "how much has actually been received against this
  invoice". `remaining = total_amount − amount_received`. Migration:
  `supabase/migrations/20260624000000_invoice_amount_received.sql`.
- `invoices.metadata.applied_txns` — jsonb array of Paymob transaction ids already
  credited, for per-transaction idempotency.
- `payment_amount` is **not** reused — it already carries the manual
  payment-proof (Instapay) claim, a different concept.

### Mechanism

- **Pure core** — `src/lib/invoiceBalance.ts`: `remainingBalance`,
  `isInvoiceSettled`, `applyPaymentToInvoice` (idempotent partial application).
  Fully unit-tested (`tests/unit/invoiceBalance.test.ts`).
- **Finalizer** — `finalizeInvoicePaymentSuccess(...,{ amountPaidEgp })`
  (`src/lib/invoicePaymobPayment.ts`). When the amount is supplied (from the
  webhook's `amount_cents`), a payment that doesn't cover the total is credited to
  `amount_received` and the invoice **stays unpaid with no side effects** (no
  unlock); the invoice is marked `paid` and the account unlocked only once the
  cumulative reaches the total. When the amount is omitted (MIT card charge / poll
  fallback — always full), the payment is treated as covering the full balance,
  preserving prior behaviour. Returns `settled` so the status poll distinguishes a
  completing payment from a partial. Idempotent at two layers: a duplicate
  transaction id (tracked in `applied_txns`) is never counted twice, and an
  already-`paid` invoice is a no-op — so a partial-then-complete sequence, or a
  webhook delivered twice, never double-counts or double-charges.
- **Pay link** — `POST /api/invoices/[id]/pay` charges `remaining` (not the
  total), regenerates a fresh Paymob order once a partial exists (the cached order
  is for the wrong amount), and uses a unique `merchant_order_id` per attempt.

### Tests

- `tests/unit/invoiceBalance.test.ts` — remaining balance, partial+top-up,
  multi-partial (credit never lost), idempotent replay, full payment.
- `tests/unit/billingForecast.test.ts` — forecast = subscription + fee on the next
  date; null when nothing to forecast.
- `tests/unit/invoiceUnderpaymentFinalize.test.ts` — finalizer: partial leaves
  invoice unpaid + locked; top-up settles + unlocks with exact total (no extra
  fee); idempotent replay; already-paid no-op; no-amount = full.
