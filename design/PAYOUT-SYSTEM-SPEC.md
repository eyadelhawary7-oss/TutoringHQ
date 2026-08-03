# Payout system — specification for review

**Produced 2 August 2026. Nothing here is built. No code was written.**

This is a document to **review and answer against**, not to build from. Every open decision is marked
**`→ DECISION`** and phrased so it can be answered by picking an option. Where I have a recommendation I
say so and argue it; where the answer is genuinely yours, I do not pre-empt it.

Sources: the live production catalog (Supabase `lczmjpnbuhnsislcvzar`), the live codebase, and Paymob's
own documentation across three estates (`payouts.paymobsolutions.com/docs`, `developers.paymob.com`, the
official Postman collection). Facts sourced from Paymob are quoted. Facts about our own system come from
the live catalog, never from a migration file and never from code that merely references a column.

---

## 0. The headline finding: this is two systems, not one

The original request described "a ledger tracking what's collected per center." Verified against
production, that describes money **the platform has never held**:

| table | live rows |
|---|---|
| `payments` | **0** |
| `payout_requests` | **0** |
| `withdrawal_requests` | **0** |
| `attendance_scans` | 3 |
| `transactions` | 3 |
| `invoices` | 2 |
| `centers` | 2 |

`digital_student_fee_collection.enabled` — the switch governing online tuition collection — **has no row
in `platform_config` at all**, and the module reads fail-closed (*"Default is false (dormant)... any error
→ false"*). `platform_config.lesson_commission` is `{teacher_pct: 0, customer_pct: 0, processing_flat: 0}`.

So the work splits cleanly:

- **System 1 — Referral and credit payouts.** Real money the platform genuinely owes centers today, on
  rails that already exist. **Shippable without V3.** Specced in full below.
- **System 2 — Tuition settlement payouts.** The "collected per center" ledger. **Cannot be built now** —
  it is downstream of V3 online collection. Cross-referenced in §9, deliberately not designed.

---

# SYSTEM 1 — Referral and credit payouts

## 1. What money this actually moves

Two distinct obligations, both real, both already accrued in production code:

**(a) Referral earnings.** Centers earn recurring commission (25% month 1, 10% months 2–12, 5% month 13+)
for referring other centers. Accrues into `referral_commissions` via a live monthly cron. Withdrawn via
`POST /api/referrals/payout` → `payout_requests`.

**(b) Credit cash-out.** Centers accumulate `centers.credit_balance` and convert it to cash at **2:1** —
`cashAmount = creditAmount / 2; feeAmount = creditAmount / 2`. Requested via `POST /api/billing/withdrawal`
→ `withdrawal_requests`.

Current live terms:

| | Referral (a) | Credit (b) |
|---|---|---|
| minimum | 1,000 EGP (`REFERRAL_WITHDRAWAL_MIN_EGP`) | 2,000 credits → 1,000 EGP |
| fee | flat 20 EGP, then 5% of remainder | 50% (the 2:1 rate) |
| destination | InstaPay only | InstaPay only (`centers.instapay_number`) |
| cadence | on request | quarterly window |
| approval | **none exists — see §2** | `PATCH /api/admin/withdrawals/[id]` |

**→ DECISION 1.** Do (a) and (b) become one payout pipeline with one ledger, one approval queue and one
Paymob integration, or stay two? **Recommendation: unify.** They are the same operation — move EGP to a
center's InstaPay handle — differing only in what accrued the balance. Two pipelines means two of every
control in §6, and the controls are the expensive part.

## 2. Seven blocking defects that must be fixed before anything ships

These are **live today**, found by direct code and catalog reads. Each is a prerequisite, not a nice-to-have.

**2.1 — `payout_requests` has no approval path whatsoever.** No API route and no admin page anywhere reads
`payout_requests` for approval. A center can submit a referral payout request today and **its status can
never leave `pending` through any code path in the application.** Six files reference the table; none can
approve.

**2.2 — The credit-withdrawal approval races, and double-pays on a double-click.**
`src/app/api/admin/withdrawals/[id]/route.ts` performs four separate un-transacted round trips: a
non-locking `.select` (:37), a `status !== 'pending'` check (:57), `cancel_reservation_atomic` (:74),
`spend_credits_atomic` (:84), then `.update({status:'paid'})` (:105). Two admins processing the queue
simultaneously — or one operator double-clicking — both pass the :57 check, both proceed, and **both
return `{success:true}` and both fire the "withdrawal processed" WhatsApp.** A zero-row `UPDATE` returns no
error from PostgREST, so the loser is indistinguishable from the winner. On the other branch, if
`spend_credits_atomic` raises after `cancel_reservation_atomic` already released the reservation, the
center's full balance is restored and immediately re-withdrawable **while the cash has already been sent**.
*Fix as a standalone PR before any payout work:* one `SECURITY DEFINER` RPC doing `SELECT ... FOR UPDATE`,
idempotent re-call, release + spend + status flip + `audit_log` in one transaction; plus
`UNIQUE INDEX one_pending_withdrawal_per_center ON withdrawal_requests(center_id) WHERE status='pending'`.

**2.3 — `centers.instapay_number` is writable through the `/api/db` proxy.** It is not in
`CENTERS_PROTECTED_COLUMNS`, and `centers` is a direct `TABLE_SCOPE` entry. Anyone holding a center
session can change the payout destination. The existing `/api/billing/withdrawal` route already snapshots
the number onto the request row, which limits the blast radius today — but any new design that reads a
destination at release time instead of a snapshot reintroduces it. See attack **A2**.

**2.4 — The quarterly window tells centers the wrong date.** `nextProcessingQuarterStart('2026-01-05')`
returns **`2026-04-01`** — three months away — for a request made *inside* the open January window. The
center is told to wait a quarter for money they just successfully requested.

**2.5 — Credit reservations never expire.** `credit_reserved` is set by `reserve_credits_atomic` with no
expiry, no ledger row and no sweeper. The two crons calling `cancel_reservation_atomic`
(`cleanup-expired-sessions`, `check-stuck-payments`) never look at `withdrawal_requests`. An abandoned or
errored request fences the center's credits **indefinitely** — unspendable and unwithdrawable.

**2.6 — None of the three money-movement routes validates CSRF.** Wider than the existing **S7**, which
only ever covered the referral route. Verified by direct grep — `validateCSRFRequest` appears **zero
times** in all three:

| route | what it does | CSRF |
|---|---|---|
| `POST /api/referrals/payout` | creates a referral payout request | **none** (S7) |
| `POST /api/billing/withdrawal` | creates a credit withdrawal request | **none — not previously logged** |
| `PATCH /api/admin/withdrawals/[id]` | **marks a withdrawal paid — authorises real money** | **none — not previously logged** |

The admin route is the serious one: it is the gate that releases money, and it is unprotected. S7's "low
blast radius because `available` is always 0" reasoning never applied to it at all, and stops applying to
any of them the moment this system works.

**2.7 — The two payout-initiating routes have asymmetric authorization, and unifying them could silently
widen access.** `/api/billing/withdrawal` is **owner-only** (`auth.role !== 'owner'` → reject).
`/api/referrals/payout` gates on a **delegable staff permission**, `can_request_referral_payouts` — which
is currently `true` on exactly **1 row in the entire database**. Two routes that move money out of the same
center enforce two different rules. **Decision 1 (unify the pipelines) must therefore also pick a gate**,
and picking the weaker one would hand payout initiation to staff accounts at centers that today are
owner-only, with no announcement. *Recommendation: unify on owner-only plus step-up auth, and treat
`can_request_referral_payouts` as request-only — never release.*

**→ DECISION 2.** Confirm all seven are in scope as prerequisites. If any is deferred, say which — each one
independently can pay real money twice or strand it.

## 3. The ledger (spec item 1)

**Recommendation: an append-only, double-entry ledger.** This codebase has no double-entry pattern
anywhere — every balance today is either a mutable column (`centers.credit_balance`) or a running
aggregate recomputed on read (`getStudentBalances`). Both are wrong here, for one specific reason: **a
running aggregate silently changes when a historical row is amended.** For a display balance that is
tolerable. For a figure that authorises money leaving a bank account, it means the number you approved
and the number you paid can differ with no trace.

```
ledger_accounts        -- one row per (center_id, account_kind)
  id, center_id, kind, currency, created_at
  kind ∈ (referral_earnings, credit_balance, payable, paid_out,
          reserve_withheld, clawback_receivable, paymob_budget,
          platform_bank_instapay, payout_fees)

ledger_transactions    -- the journal; append-only, never UPDATEd, never DELETEd
  id, occurred_at timestamptz, cairo_date date GENERATED ALWAYS AS
      ((occurred_at AT TIME ZONE 'Africa/Cairo')::date) STORED,
  kind, center_id, payout_id nullable, reverses_id nullable,
  idempotency_key text UNIQUE NOT NULL, actor, reason_key, metadata jsonb

ledger_entries         -- the postings; every transaction's entries sum to zero
  id, transaction_id, account_id, amount_minor bigint, created_at
  -- amounts in PIASTRES (integer). Never floats. Never EGP decimals.

center_payouts         -- one row per payout attempt
  id, center_id, status, gross_minor, fee_minor, vat_minor, net_minor,
  rail ∈ (paymob_payouts, manual_instapay),
  -- IMMUTABLE DESTINATION SNAPSHOT, written at approval, UPDATE-blocked by trigger:
  snap_issuer, snap_msisdn, snap_bank_code, snap_account_or_iban, snap_full_name,
  client_reference_id uuid UNIQUE, client_reference text UNIQUE,
  provider_transaction_id text UNIQUE nullable,
  requested_at, approved_by, approved_at, submitted_at, settled_at

payout_provider_events -- raw Paymob callbacks and inquiry results, append-only
  id, source, raw_body jsonb, received_at, matched_payout_id nullable,
  processing_error nullable
```

**Payout lifecycle states.** The four you named are not enough — three more are load-bearing:

| state | money reality |
|---|---|
| `requested` | center asked; funds **held** (a `payout_hold` posting), not sent |
| `approved` | a human authorised it; destination snapshotted; still not sent |
| `submitting` | `/disburse/` call in flight — **the dangerous state** |
| `indeterminate` | **new, essential.** Call timed out or errored; we do **not** know if Paymob accepted it. Never auto-retried. |
| `settled` | Paymob *inquiry* (not a callback) confirms the money moved |
| `settled_pending_bank` | **new.** Bank Card code `8222` — *"Successful with warning, a transfer will take place once authorized by the receiver bank."* Not terminal; stays in inquiry rotation |
| `failed` | terminal per inquiry; hold released |
| `returned` | **new.** Money came back after apparent success (codes `000100/000102/000105/000108`) |
| `reversing` | a clawback is in progress against this payout |

**Non-negotiable invariants:**

1. **Every posting is in piastres, as an integer.** No floats anywhere in the money path.
2. **`ledger_transactions` and `ledger_entries` are never in `/api/db`'s `TABLE_SCOPE`.** Neither is
   `center_payouts`. A `BEFORE UPDATE OR DELETE` guard trigger on `center_payouts` blocks any change to
   amounts, status, references or destination, mirroring the existing `guard_transactions_lifecycle`
   precedent, with the only bypass being the transition RPC's transaction-local flag.
3. **`UNIQUE INDEX one_open_payout_per_center ON center_payouts(center_id) WHERE status IN
   ('requested','approved','submitting','submitted','indeterminate','reversing')`.** Without this, two
   concurrent requests each read the same available balance and both pass. See attack **A3**.
4. **The balance read and the hold insert are one transaction, serialized per center** —
   `pg_advisory_xact_lock(hashtext('payout:'||center_id))`, mirroring the `FOR UPDATE` that
   `reserve_credits_atomic` already takes.
5. **The counter-account is derived from `center_payouts.rail` inside the transition RPC, never passed by
   the caller.** `paymob_budget` for `paymob_payouts`; `platform_bank_instapay` for `manual_instapay`.
   Manual settlements require a NOT NULL bank reference. Without this, every hand-sent InstaPay silently
   under-reports the Paymob float — see attack **A6**.

**→ DECISION 3.** Append-only double-entry, or extend the existing mutable-column pattern? The alternative
is genuinely cheaper to build and consistent with the rest of the codebase; it is also how the current
withdrawal bug (§2.2) became possible. I recommend double-entry **for this subsystem only** — not a
migration of the whole product.

**→ DECISION 4.** During transition, `centers.credit_balance` and the new ledger would both be authoritative
over the same credits. `billingEngine.ts` still calls `spend_credits_atomic` (:244) and
`earn_credits_atomic` (:261), neither of which can see the ledger. **This dual-authority window can pay the
same credits out twice** — see attack **A5**. Pick one: (a) migrate the credit-spend path in the same PR,
or (b) keep credits on the old rail and have the ledger reserve via `reserve_credits_atomic` so the
`FOR UPDATE` on `centers` still serializes both consumers. **No third option is safe.**

## 4. "Available now" and the clearing delay (spec item 2)

For System 1, "available now" is **not** a claim about money the platform is holding for a center. It is
the settled balance of an obligation the platform has accrued. That distinction should be visible in the
copy — the design's "Available now" over a big number reads as custody, and for referral commission it
isn't custody, it's a debt.

```
available_minor(center) =
    SUM(entries on the center's payable account)
  − SUM(open holds)
  − SUM(reserve_withheld)
  − SUM(clawback_receivable)
```

**Does System 1 need a clearing delay? Largely no — and that is the useful answer.** A clearing delay
exists to cover money that can be pulled back after you've paid it out. Referral commission is accrued from
a *subscription payment another center already made to TutoringHQ* — by the time it accrues, the risk
window on that payment has already run. Credits are internal scrip. Neither carries the card-chargeback
exposure that motivates a hold.

Two real exceptions:

- **Referral commission accrued from a subscription that is later refunded or charged back.** Rare, but
  it is the one case where money can reverse after accrual. Handled in §5, not by a blanket delay.
- **Accrual correctness.** A commission row written by the monthly cron could be wrong. A short hold buys
  time to notice.

**Recommendation: `clearing_days = 0` for credits, and a short configurable hold (suggest 7 days) on newly
accrued referral commission**, on the grounds of accrual correctness rather than settlement risk.

**Critical implementation note.** Clearing must attach to the **origin** of the money, not to the sign of
the ledger entry. If a payout is returned by the bank, the restoring `+` entry must inherit the
`cleared_at` of the transaction it reverses — otherwise the center's own returned money is invisible for
another 7 days and can miss the quarterly window entirely. See attack **A8**.

**→ DECISION 5.** Confirm 0 days for credits and 7 for referral, or set your own numbers. Note that
lowering the number later releases every held entry for every center **simultaneously** — a step-change in
payable liability against a fixed Paymob float, which is its own incident.

## 5. Refund or clawback after a payout has gone out (spec item 4)

**The controlling fact: outbound payouts in Egypt are irrevocable.** Across Paymob's entire Payouts
product there is exactly one cancel capability — an **undocumented** `POST /api/secure/transaction/aman/cancel/`
found only in the live Swagger, for Aman kiosk cash pickup. **There is no recall for wallets, bank card, or
instant bank.** Once sent, it is gone.

**Therefore the control must be preventative, not corrective.** Any design that assumes "we'll claw it
back" is assuming a capability that does not exist on the rail.

Mechanisms, in the order I'd apply them:

1. **Prevent** — the clearing hold in §4 exists precisely so the common case never becomes a clawback.
2. **Net against future earnings** — a `clawback_receivable` posting reduces future `available_now`. Costs
   nothing, works silently, and is what Stripe Connect does (negative balance carried forward).
3. **Block further payouts** while `clawback_receivable > 0`.
4. **Invoice the center** — falls back to the existing subscription-invoice rail, which already has
   dunning and suspension behind it. This is the only mechanism with real teeth.
5. **Write off** — an explicit, named, audited decision, never an automatic one.

**The case that has no clean answer, stated plainly:** the center's balance is zero, they have no upcoming
earnings, and they stop using the product. Options 2 and 3 do nothing. Option 4 works only while they still
care about their subscription. **The honest position is that some clawbacks will be written off**, and the
clearing hold in §4 is what keeps that number small. Every marketplace hits this; the spec should not
pretend otherwise.

**What the center sees matters as much as the mechanism.** A negative balance appearing unexplained is how
a support crisis starts. Every clawback posting carries a `reason_key` rendered bilingually, with the
originating event linked.

**→ DECISION 6.** Confirm the ladder (net → block → invoice → write off), and set the threshold above which
a clawback goes to invoice rather than sitting as a receivable.

## 6. When a payout fails partway through Paymob's side (spec item 5)

Paymob provides **no idempotency key of any kind**. This was verified exhaustively — a grep for
`idempot|duplicate|unique|retry|replay|timeout` across all 12 portal pages, all 29 GitBook pages, the live
`swagger.json` and the official Postman collection returned **zero idempotency guarantees**. The docs are
explicit that `client_reference_id` is *"generated UUID by the client to be saved as reference in case of
timeouts"* — **a reconciliation aid, not a dedup key.** A retried `/disburse/` call is accepted and
processed as an entirely independent transaction with a fresh `transaction_id`.

**Everything below follows from that one fact.**

| failure | state | policy |
|---|---|---|
| **(a) `/disburse/` times out** | `indeterminate` | **Never auto-retry.** Inquire by reference. Resend only on *positive* evidence of absence — see below. |
| **(b) Accepted, then callback says failed** | stays until **inquiry** confirms | Callbacks are advisory only. Do not move state on a callback. |
| **(c) Callback never arrives** | unchanged | The reconciliation sweep is the primary mechanism; callbacks are an optimisation. Wallets fire **no callbacks at all**. |
| **(d) Budget insufficient mid-batch** | halt the run | Detect **structurally**, not by prose — see below. |
| **(e) Terminal vs retryable code** | `indeterminate` on anything unrecognised | The docs **never classify** terminal vs retryable. Anywhere. |
| **(f) Crash between `submitting` and result** | `indeterminate` | Same as (a). |

**Three rules that prevent the specific double-pays found in review:**

1. **A callback may only enqueue an inquiry job.** It may never write a ledger entry, never call the
   transition RPC, never move a payout state. Enforce this *structurally* — give the callback handler a DB
   role with `INSERT` on `payout_provider_events` and no rights on the ledger or payout tables. **HMAC is
   off by default** and must be requested from the account manager by email; the payout HMAC algorithm,
   field order and transport are **undocumented**. Until it's on and verified, an unauthenticated public
   POST can otherwise fabricate a "failed" callback for a payout that succeeded and get the balance
   credited back. See attack **A1**.
2. **Resend requires positive evidence, not absence of evidence.** A resend is permitted only when a
   successful HTTP 200 inquiry for that specific reference completed recently and returned **zero matches**
   — and, because the inquiry endpoint's `bank_transactions` flag selects between two different stores and
   `bank_wallet` is classified **both ways across Paymob's own docs**, the sweeper must query with the flag
   **both true and false** and only conclude "not found" when both return zero. See attack **A4**.
3. **Never let an unrecognised response be terminal.** Default every unmatched `status_code` to
   `indeterminate` and escalate. In particular, insufficient-budget is an HTTP **200** with
   `status_code: "400"`, distinguishable from a generic validation error **only by substring-matching
   English prose** that contains a typo (*"exceeds you budget limit"*). If Paymob fixes the typo, a
   prose-matching implementation silently marks a whole batch permanently failed. Detect budget exhaustion
   by reading `/budget/inquire/` before the run and decrementing a local projection. See attack **A7**.

**The reconciliation job is not optional.** It sweeps `indeterminate` and non-terminal rows, inquires by
reference, and repairs state. Inquiry endpoints are throttled to **5 requests/minute, 50 objects/page** —
shared across transaction and budget inquiry — so it needs a global token bucket (Upstash is already a
dependency) and must pack pages to the limit.

## 7. Approval (spec item 6)

**Recommendation: maker–checker for every payout above a threshold; nothing fully automatic in v1.**

Two arguments carry this. First, **Paymob's own Payouts dashboard implements maker–checker with a PIN** —
the provider treating this operation as warranting two humans is a strong signal. Second, the failure modes
in §6 are all *silent*: an over-payment does not throw, it succeeds twice.

| option | when it fits | cost |
|---|---|---|
| Fully automatic on a schedule | high volume, low value, mature reconciliation | a bug pays out 100× with nobody in the loop |
| **Auto below threshold, manual above** | **recommended after v1 proves stable** | needs a trustworthy threshold |
| Always manual admin approval | **recommended for v1** | an unstaffed queue silently stops all payouts |
| Maker–checker (two distinct admins) | highest value | slowest; needs two available admins |

**Controls that apply regardless of which is chosen:**

- Per-payout maximum, per-run maximum, and a **daily aggregate cap**.
- An anomaly check: this payout is N× the center's trailing average → force manual review.
- A **kill switch** that halts all releases, reachable without a deploy.
- **Step-up auth on approval**, reusing `verifyPasswordForSensitiveAction` — the mechanism already exists
  and is already used for permission edits. Do not invent a new one.
- Every state transition writes `audit_log` **inside the same transaction** as the state change, not
  fire-and-forget.
- **The approval queue needs a staffing answer, not just a screen.** An approval queue nobody watches is
  how payouts silently stop for a quarter — and §2.1 shows this project has already shipped exactly that
  failure once.

**→ DECISION 7.** Pick the approval model for v1, and name the threshold if you pick a hybrid.

**→ DECISION 8.** Who is the approver — super-admin only (`isSuperAdminPhone`), or a new named permission?
And is maker–checker two *different* humans, enforced?

## 8. What Paymob integration actually requires (spec item 3)

A readiness checklist. Every fact below is quoted or directly sourced from Paymob documentation.

**Credentials and onboarding.** *"There are no self-signup steps. Your account is provisioned by Paymob."*
The sequence is: account manager → legal agreement → staging credentials by email → integration → test →
Paymob technical approval → production. **This is lead time that runs in parallel with everything else —
start it now.**

- Auth: `POST {ENV}/o/token/`, OAuth2, `grant_type=password`. **Four mandatory credentials**: `client_id`,
  `client_secret`, `username`, `password`.
- Access token lives **3600s**. The refresh token is **one-time-use rotating** — *"will last forever until
  the next use"* — which is a real concurrency hazard: two workers refreshing simultaneously will invalidate
  each other. Token refresh must be centralised and locked.
- Base URLs: staging `stagingpayouts.paymobsolutions.com/api/secure/`, production
  `payouts.paymobsolutions.com/api/secure/`.

**The float.** *"Every disbursement is charged from a pre-funded balance called your budget. No budget, no
disbursements."* The Payouts budget is **separate from the Accept balance**. Top-up is
`POST {ENV}/topup/request/`, `multipart/form-data`, with `type ∈ [from_bank_transfer, from_accept_balance]`.
Approval is **human by default** at Paymob's end, with no published SLA. `GET /budget/inquire/` returns
**prose, not a number**: `{"current_budget": "Your current budget is 888.25 LE"}` — the balance must be
regex-parsed out of an English sentence.

> **⚠ Regulatory warning, carried forward from the Paymob research.** The `from_accept_balance` sweep is
> clean **only** for System 1, where the money being disbursed is the platform's own obligation. If a float
> is ever funded from collections that economically belong to centers, the platform is holding third-party
> funds — which under Egyptian law is **Payment Facilitation Services**, a licensed activity (EGP 10–30m
> paid-up capital, Egyptian joint-stock company, sole-purpose requirement). Egypt has **no commercial-agent
> exemption**; "we're just an agent for the centres" has no safe harbour. This constrains System 2, not
> System 1 — but the same API call is the doorway to both, so the boundary must be explicit in code.

**Recipient KYC — the good news.** Payouts recipients are **anonymous and need no Paymob account**. The
Egypt Post response field is literally `anon_recipient`. **Arbitrary IBANs are payable.** `national_id` is
flagged mandatory in the portal's field table but is absent from every non-Egypt-Post sample, the Postman
collection and the GitBook field lists — GitBook scopes it to Egypt Post only. **Ask Paymob to confirm in
writing.** Name matching is *guidance only*; no document states it is enforced, and a name mismatch
surfaces as a `Returned`.

*(This is the sharpest contrast with Split Amount, which is a different product: recipients are identified
only by connected merchant ID and **must be onboarded Paymob merchants**. Do not conflate them.)*

**Minimums per channel:** mobile wallets **1 EGP**, Bank Card **5 EGP**, Instant Bank **112 EGP**, Egypt
Post **5 EGP**. Recipient-side wallet limits: 60,000 EGP per transaction, 60,000/day, 200,000/month —
*"these limits apply to the recipient's wallet, not your account."*

**Fees: no schedule is published anywhere.** Checked the portal docs, every GitBook payout page, Swagger,
Postman, `paymob.com/en/pricing` and `paymob.com/en/payouts`. Per-transaction `fees` and `vat` come back on
the response; VAT is 14%. **Store what is returned; never compute.** `customer_bears_fees` flips who pays —
and note the asymmetry: on a **returned** transaction with `customer_bears_fees=true`, *"the merchant is
refunded the amount minus fees and VAT (fees are penalty)."*

**What we must build that Paymob does not provide:**
- Idempotency (there is none — §6).
- The reconciliation job and its throttle budget.
- Callback capture that returns 200 unconditionally and parses asynchronously.
- A budget projection and low-float alerting.
- A period-close report (§10).

**Questions to put to Paymob in writing before building:**
1. Is `client_reference` uniqueness server-enforced, and what is returned on collision?
2. Is `national_id` genuinely required for non-Egypt-Post channels?
3. Which store does `bank_wallet` land in for inquiry — `bank_transactions` true or false?
4. What is the payout HMAC algorithm, field order and transport?
5. What is the fee schedule per channel?
6. Is disbursement-capability on the dashboard user disableable? (See attack **A9**.)
7. Bank Card final status — 2 working days or 3? The two doc estates disagree.

## 9. SYSTEM 2 — Tuition settlement payouts (cross-reference only, not specced)

**Cannot be built now.** It depends entirely on **V3 online collection**, which is dormant: the
`digital_student_fee_collection.enabled` flag has no row, `lesson_commission` is all zeros, `payments` has
0 rows, and the `transactions` fee-stack columns (`platform_gross`, `customer_commission_amt`, …) have
**no writer anywhere in `src/` or `supabase/`**.

Designing a ledger for it now would be designing against a switch that isn't wired. When V3 ships, this
section becomes real and will differ from System 1 in four ways that matter:

1. **Custody.** The platform would hold parents' money — the licensing question in §8 becomes live.
2. **A real clearing delay.** Card chargebacks create genuine post-payout exposure; §4's "largely no"
   becomes "yes, and the number matters."
3. **Settlement timing.** Paymob's Accept gateway settles **weekly** per their own Egypt pricing FAQ, so
   clearance must be gated on *confirmed receipt*, not on the capture timestamp — otherwise the platform
   funds payouts from its own working capital. See attack **A10**.
4. **Volume.** System 1 is tens of payouts per quarter. System 2 is per-center, per-cycle, continuously.

**Related open items:** `V3`, `V4`, `V1` in `BUILD-AFTER-REDESIGN.md`; `Merged-Center-Money` §04/§05 and
`Merged-Verification-Payouts` §04/§05 in `FILE-COMPLETION-TABLE.md`; `STATE-OF-THE-BUILD.md` §2.

## 10. Adversarial findings — System 1

Ten agents produced 26 attacks. These are the ones that apply to **System 1 as it would actually ship**.
Each is a concrete sequence, not a general concern.

**A1 · Callback replay drains the platform** — `loses_money`. HMAC is off by default and the callback URL
is a public POST with no event id, signature or timestamp. A center owner can see their own payout's
`transaction_id` on their own detail screen. They POST a fabricated `disbursement_status: "failed"` for a
payout that already settled; the handler credits their balance back; they repeat per historical payout.
**Unbounded, repeatable, no credentials needed beyond their own session.** *Fix:* callbacks may only
enqueue an inquiry job — enforced by DB role, not by convention.

**A2 · Destination swap inside the approve→release gap** — `loses_money`, 48,000 EGP. Approval snapshots a
destination on Jan 3; the owner changes `centers.instapay_number` on Jan 5 via `/api/db` (confirmed
writable — §2.3); release on Jan 7 reads the *live* destination. A 14-day change-cooldown does not catch
it, because the cooldown is evaluated at request time. *Fix:* immutable snapshot columns on
`center_payouts` with an UPDATE-blocking trigger, and abort at release if the live destination differs.

**A3 · Concurrent requests both pass the balance check** — `double_pays`, 10,000 EGP against a 5,000 EGP
obligation. Two submissions 40ms apart each `SELECT SUM` → 5,000 before either commits. Unique constraints
on the *reference* fields don't help — the references genuinely differ. *Fix:* the
`one_open_payout_per_center` partial index plus a per-center advisory lock.

**A4 · Resend authorised on false evidence** — `double_pays`, 50,000 EGP. A `bank_wallet` payout goes
indeterminate; the sweeper inquires with the wrong `bank_transactions` flag (the docs classify
`bank_wallet` **both ways**), gets zero matches three times, and a human — correctly reading the evidence
in front of them — authorises a resend. *Fix:* query both flags; show the operator the exact queries
issued, not a summarised verdict.

**A5 · Credits consumed twice during the dual-authority window** — `loses_money`, 4,000 EGP. The ledger
holds the credits; `centers.credit_balance` is untouched; the monthly billing run spends the same credits
against an invoice via `spend_credits_atomic`; the payout then releases the cash. *Fix:* Decision 4 — no
dual-authority window.

**A6 · Manual InstaPay corrupts the float model** — `strands_money`, 90,000 EGP immobilised. Hand-sent
payouts posted against `paymob_budget` make the modelled balance drift below reality; the low-float alarm
fires and finance tops up money that was never needed. *Fix:* counter-account derived from `rail`.

**A7 · A typo fix at Paymob strands a whole batch** — `strands_money`, ~18,600 EGP for 12 weeks. Budget
exhaustion is detectable only by matching the prose *"exceeds you budget limit"*. Paymob corrects the typo;
the matcher misses; 16 payouts are written terminally failed for a reason that never existed, and the
quarterly window closes. *Fix:* structural budget projection; unrecognised → never terminal.

**A8 · A returned payout is invisible for 7 days** — `strands_money`, 9,000 EGP. The bank returns it; the
restoring `+` entry is treated as newly-arrived money needing to clear; the center sees 0 available until
after the window closes. *Fix:* reversals inherit the `cleared_at` of what they reverse.

**A9 · A dashboard CSV upload pays 40 centers twice** — `loses_money`, 84,000 EGP. An admin clears a
backlog through Paymob's own dashboard bulk upload. Wallets fire no callbacks; **no Paymob endpoint
enumerates disbursements by date**, so our sweep — which only inquires about rows in *our* table — iterates
zero of them. The in-app requests are later approved and paid again. *Fix:* ask Paymob to disable
disbursement on the dashboard user; make the budget delta the completeness tripwire.

**A10 · Clearing from the capture timestamp funds payouts from working capital** — applies to System 2, but
listed because it constrains the shared design: Paymob Accept settles **weekly**, so a 7-day clearing
window computed from capture can release money before it has landed.

**A11 · Reconciliation findings written where nobody reads them** — `reconciliation_drift`, 26,600 EGP
unseen. Verified precedent: `src/lib/billing/reconciliation.ts` writes to `billing_reconciliation_reports`,
and a grep across all of `src/` finds **exactly two references — both writers, zero readers**. The payout
reconciler would inherit that shape. *Fix:* every mismatch must also create a `ceo_action_queue` row (that
queue has a UI) and, above a floor, WhatsApp `CEO_PHONE`. **And ship a reader for the existing dead table
as part of this work** — inheriting a dead pattern validates it.

**A12 · The reconciler is never scheduled and nothing notices** — verified: `vercel.json` schedules 42
crons while `src/app/api/cron` contains **43 route directories**. `renewal-reminders` exists and is
scheduled nowhere, and nobody has noticed. The watchdog only iterates `cron_health_log` rows that already
exist, so a cron that never ran once is invisible to it. *Fix:* seed the health row in the same migration;
assert against a declared registry; add a CI check that every cron directory appears in `vercel.json` —
which also catches the existing gap.

**A14 · CSRF on the route that authorises money to leave** — `loses_money`. `PATCH /api/admin/withdrawals/[id]`
has no CSRF validation and is the gate that marks a withdrawal paid. An admin with a live session who loads
any page that can issue a cross-origin request is one forged call away from releasing a queued withdrawal
nobody approved. Compounded by **A15**: the same route's handler double-pays on concurrent invocation
(§2.2), so a forged call racing a legitimate click produces two payments and two success responses.
*Fix:* `validateCSRFRequest` on all three routes in §2.6 before any payout work, with the client changes
landed in the same PR — the CEO/admin client helpers do not send `X-CSRF-Token` today, so server-side
validation added alone would break the UI.

**A15 · Authorization asymmetry becomes a silent privilege widening** — `operational_only`, but it is the
kind that turns into a loss. Unifying the two pipelines (Decision 1) means choosing one gate. If the
delegable `can_request_referral_payouts` wins, every center whose credit withdrawals are owner-only today
silently gains a second, non-owner path to move money — and the permission is currently set on exactly one
row, so nobody would notice the semantics changed until it was used. *Fix:* make the gate an explicit part
of Decision 1 rather than an implementation detail; separate *request* from *release* authority.

**A13 · Six months in, the question is unanswerable.** There is no per-period statement, no completeness
proof, and no way to see anything never recorded. *Fix:* a `payout_reconciliation_periods` table — one
immutable row per Cairo month holding opening/closing budget, top-ups enumerated from `/topup/inquire/`,
settled/fees/vat/returned totals, and `unexplained_delta_minor`. **A period cannot be closed while the
delta is non-zero**; closing with variance requires a named human and a written reason. This is the only
control that forces someone to look on a schedule rather than in response to an alert nobody wired up.

## 11. Decisions summary

| # | Decision | My recommendation |
|---|---|---|
| 1 | Unify referral + credit payouts — **and, per §2.7, which authorization gate survives the merge?** The two routes disagree today: `/api/billing/withdrawal` is owner-only, `/api/referrals/payout` is a delegable permission. Unifying necessarily picks one. | **Unify, on owner-only + step-up auth.** Treat `can_request_referral_payouts` as *request*-only, never *release* — picking the weaker gate silently widens who can move money at every owner-only center |
| 2 | Are all seven §2 defects in scope as prerequisites? | **Yes — all seven** |
| 3 | Append-only double-entry ledger, or extend the mutable-column pattern? | **Double-entry, this subsystem only** |
| 4 | How to eliminate the credit dual-authority window? | **(a) migrate the spend path in the same PR** |
| 5 | Clearing days | **0 credits / 7 referral**, config-driven |
| 6 | Clawback ladder and invoice threshold | **net → block → invoice → write off** |
| 7 | Approval model for v1 | **always-manual v1**, hybrid later |
| 8 | Who approves, and is maker–checker enforced? | **super-admin + step-up auth**; maker–checker above a threshold |
| 9 | Does System 1 ship before V3 at all? | **Yes — that is the point of the split** |

**Not decisions — facts to act on:** start the Paymob commercial conversation now (it gates everything and
runs in parallel), and get written answers to the seven questions in §8.
