# Customer invoices page + underpayment handling (Phase 3 + 5)

The customer-facing payment surface where **wallet customers** and **card
customers whose bank declined the auto-charge** see and pay what they owe. The
Phase 2 midnight engine already routes both to an unpaid `invoices` row; this is
where the customer sees and pays it.

> Scope: centers AND teachers. The `invoices` table is **owner-polymorphic**
> (`owner_type ∈ {center, teacher}`, see migration
> `20260625000000_teacher_invoices_parity.sql`); teachers now get full invoice
> parity through the **same** table, finalizer, Paymob pay flow, forecast and
> underpayment machinery. The only differences are the data model (a teacher has
> no center row; access is gated by `teacher_subscriptions`) and the teacher-scoped
> routes/page. See **Teacher invoice parity** at the end of this doc.

## The page — `/{locale}/pay`

`src/app/[locale]/pay/page.tsx` (client, Arabic-first, RTL, mobile-first), a
**standalone** page outside the `(dashboard)` route group (so it has no dashboard
chrome and stays reachable while locked — note `(dashboard)/billing` already owns
`/billing`). Fed by `GET /api/billing/customer-invoices`. Three separated buckets:

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
paths escape. `/pay` is therefore added to **both**
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

## Teacher invoice parity

Teachers reach **full parity** with centers: real invoice records (owed / paid /
unpaid / upcoming), created on the billing date by the Phase 2 midnight engine,
with the same statuses, the same idempotent finalizer, the same Paymob pay flow,
the same forecast and the same underpayment handling. The teacher and center
surfaces share the same machinery and the same redesigned invoice templates, so a
future invoice redesign applies to **both at once**.

### Data model (verified live before building)

The existing `invoices` table was extended to be **owner-polymorphic** rather than
forking a parallel `teacher_invoices` table — the entire downstream charge stack
(`card_charge_intents.invoice_id → invoices`, `saved_cards` / `card_charge_intents`
already keyed by `owner_type ∈ {center, teacher}`, `combined_payment_sessions`
with `teacher_*` session types) was already built expecting teachers to flow
through `invoices`. Migration `20260625000000_teacher_invoices_parity.sql` (additive,
applied to an empty table; before/after fingerprint verified; ends `NOTIFY pgrst`):

- `owner_type text NOT NULL DEFAULT 'center'` (CHECK `center|teacher`), `teacher_id
  uuid` FK → `teacher_profiles(user_id)` ON DELETE CASCADE, `center_id` relaxed to
  nullable, XOR CHECK (exactly one owner matching `owner_type`).
- Teacher RLS `invoices_select_own_teacher` (`teacher_id = auth.uid()`), mirroring
  `teacher_subscriptions_select_own`. Existing center policy never matches teacher
  rows (`center_id IS NULL`). Service-role writes bypass RLS.
- Teacher partial indexes on `teacher_id` and `(teacher_id, status)`.

### Creation + finalize (shared)

- **Creation** — `ensureTeacherSubscriptionInvoice` (`src/lib/teacherBilling.ts`):
  on the billing day the engine creates the teacher's `subscription` invoice
  (`owner_type='teacher'`, `total = price_gross + flat fee`, fee snapshotted in
  `metadata.processing_fee`). Idempotent + retry-safe: it **reuses an existing open
  invoice** (a dunning retry never mints a second invoice or a second fee — one
  invoice, one fee, exactly like centers).
- **Finalize** — `finalizeInvoicePaymentSuccess` is owner-aware: when
  `owner_type='teacher'` it advances `teacher_subscriptions` one month and restores
  private-engine access (`advanceTeacherSubscriptionPaid`: status `active`,
  `grace_until` cleared, `next_billing_at` +30 Cairo days) instead of touching
  `centers`. Underpayment/idempotency core is unchanged and shared.

### Midnight engine wiring

`src/lib/midnightBillingAdapter.ts` reads due teachers from
`teacher_subscriptions.next_billing_at` (within the Cairo day), creates/reuses the
invoice, and routes them through the **same** invoice path as centers:

- **card teacher** → `chargeSavedCard` (MIT) → finalize → invoice `paid` +
  subscription advanced.
- **wallet / no-card teacher** → unpaid invoice + Paymob pay link + `grace_until`
  set (the **free-tier drop is preserved** — she pays the invoice to restore the
  engine).
- **bank decline** → the same fallback as centers: soft → retry (day 0 → +3 → +7,
  reusing the same invoice); hard / auth-required → manual unpaid (no retry);
  retries exhausted → lock at next Cairo midnight.

Still **inert** until `PAYMOB_RECURRING_INTEGRATION_ID` + live Paymob credentials
arrive (`chargeSavedCard` returns `recurring_integration_not_configured` → manual
surface). This readies teacher auto-charge; it does not make it live.

### Teacher surface (shared template)

- **Page** — `src/app/[locale]/teacher/pay/page.tsx`, a thin wrapper over the
  shared `src/components/billing/CustomerInvoicesView.tsx` (extracted from the
  center `/pay` page — both are now wrappers, so a redesign lands on both).
  Distinct path from center `/pay` (no collision, the `/billing` vs `/pay` lesson).
  Reachable while locked/free-tier (endpoints use `requireTeacherAuth`, **not** the
  private-access gate), so a lapsed teacher can pay to restore access.
- **APIs** (teacher-scoped, `requireTeacherAuth`): `GET
  /api/teacher/billing/customer-invoices` (buckets; forecast from
  `teacher_subscriptions.next_billing_at` + `price_gross` + fee), `POST
  /api/teacher/invoices/[id]/pay` (charges `remaining` only, no second fee), `GET
  /api/teacher/paymob/invoice-status` (poll → shared finalizer), `GET
  /api/teacher/invoices/[id]/pdf` (receipt; `generateInvoicePdf` renders the
  teacher document via its `owner_type='teacher'` branch).

### Tests

- `tests/unit/teacherInvoiceParity.test.ts` — invoice creation + retry reuse (one
  fee); finalizer teacher branch (full pay → paid + access restored; partial →
  unpaid + still locked; pay-difference → settled, no second fee); engine adapter
  (listDue creates the invoice; wallet → unpaid + pay link + `grace_until`; card →
  finalize + advance); engine routing parity (card → charged, wallet →
  manual_unpaid, hard decline → manual no-retry, soft → retry).
