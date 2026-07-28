# The centre price — every path that resolves it

**Written 28 July 2026. Report only, nothing consolidated.** Commissioned after the
`SURVEY-Center-Money.md` finding that a centre's monthly price is computed in several places.

**Two corrections to that survey up front:**

1. **It is seven paths, not five.** Two more resolvers exist — `billing/initiate-payment` and
   `billingLockoutAdapter` — plus the renewal crons, which the survey did not trace.
2. **The survey said the canonical helper is correct and the owner screens are wrong. That is
   backwards.** The helper reads a column that no charging path uses and that has no single writer.
   Detail under Q2.

---

## Q1 · The paths, what each computes, and which reads `early_adopter_price`

They divide into three questions. Conflating them is most of the problem.

### (a) Rate resolution — "what per-month rate does this centre pay?"

| # | Where | Precedence | Reads `early_adopter_price`? |
|---|---|---|---|
| **R1** | `lib/pricing.ts:203` `getQuarterlyAllInMonthlyRateFromCenter` | `top_centers` → **`early_adopter_price`** → `all_in_price` → `PLANS[]` | **Yes** |
| **R2** | `api/billing/initiate-payment/route.ts:90-96` | **`early_adopter_price`** → `all_in_price` → `PLANS[]` | **Yes** — hand-rolled copy of R1 minus `top_centers` |
| **R3** | `lib/billingLockoutAdapter.ts:61-67` | **`early_adopter_price`** → `all_in_price` → `PLANS[]` | **Yes** — hand-rolled again; its comment says *"mirroring billing/initiate-payment"* |
| **R4** | `settings/billing/page.tsx:634, 771, 821` | `all_in_price` → `pricing_plans` row → `PLANS[]` | **No** |
| **R5** | `(dashboard)/billing/BillingPageClient.tsx:299-301` | **`billing_amount`** → `all_in_price` | **No** |
| **R6** | `api/ceo/dashboard/route.ts:165-173` | `all_in_price` → **`billing_amount / 3`** → `subscription_monthly_fee` → `PLANS[]` | **No** — it *selects* the column at `:51` and `:149`, then never uses it |
| **R7** | `lib/centerRenewal.ts:42` `centerRenewalBaseAmount`, via **both renewal crons** | annual → `all_in_price × 10`; **monthly → `billing_amount`** | **No** — neither cron even selects it (`grep -c early_adopter lib/subscriptionBillingCron.ts` → `0`; same for `summerBillingCron`) |

### (b) Cycle charge — "what do we invoice this cycle?"

`getChargeFromQuarterlyAllIn(rate, period)` — monthly = rate, quarterly = rate × 3, annual =
`getAnnualChargeRounded(rate, 10)`. Consumed by R2 and R3. **R7 does not use it** — it has its own
rule (above).

### (c) Booked revenue — "what monthly-equivalent MRR?"

`getImpliedMonthlyMrr(row)` → eligibility filter → **R1** → `computeImpliedMonthlyMrrFromBase`
(annual divides the annual total by 12, so it differs from (b) by design). Consumed by
`mrrSnapshot.ts:58`, `api/admin/billing:111`, `api/admin/finance` and
`commission/ownerFinancials.ts:32`.

**(b) and (c) are genuinely different questions** — an annual centre is *charged* `rate × 10` once
and *books* `rate × 10 / 12` per month. Those must not collapse. **(a) is one question with seven
implementations.**

---

## Q2 · Which is correct

**Not R1**, which is what the earlier survey implied. Working from what the customer is actually
charged:

**`centers.billing_amount` is the authority for a monthly centre. `all_in_price` is the authority
for an annual one.** That is R7, and `lib/centerRenewal.ts:33-40` states the contract in its own doc
comment:

> *monthly … → the stored `billing_amount` exactly as the cron/paid handler uses it: for a monthly
> center that is the monthly charge. **Respects custom / early-adopter amounts (never recomputed).***

So the intended design is: **`billing_amount` already carries the negotiated number**, and
`early_adopter_price` is a *record that a negotiation happened* — a label, not a price.

### The problem: `early_adopter_price` has no single writer, so it means three different things

| Writer | What it writes |
|---|---|
| `api/admin/centers/[id]/subscription/override-price` | `all_in_price = X` **and** `early_adopter_price = X` — always equal |
| `centerManagementClient.tsx:864-870` → `PATCH /api/admin/centers/[id]` | `all_in_price`, `billing_amount` and `early_adopter_price` from **three independent form fields** — nothing constrains them to agree |
| `api/admin/centers/route.ts:843` | `early_adopter_price = monthlyInvoiceAmount` |

A column written three ways, with no invariant, that three code paths (R1, R2, R3) treat as
authoritative. **Any of them is reading a number with no guaranteed meaning.**

### And two real charging paths already disagree

| Path | Fires when | Charges |
|---|---|---|
| **R2** `billing/initiate-payment` | owner clicks **Pay now** | `early_adopter_price` (when flagged) |
| **R7** renewal crons | automatic monthly renewal | `billing_amount` |

**`override-price` never writes `billing_amount`** — verified,
`grep -c billing_amount …/override-price/route.ts` → `0`.

So the sequence that bites:

1. Admin reprices a centre through the guarded route (reason required, audit-logged, WhatsApp sent).
2. `all_in_price` and `early_adopter_price` become the new negotiated rate. **`billing_amount` stays
   at the old one.**
3. **"Pay now" charges the new rate. The monthly renewal keeps charging the old rate.**

That is an **overcharge on the automatic path**, on the exact route whose entire purpose is
repricing, and it needs no unusual admin behaviour to trigger — just using the route as designed.

**This is the thing to fix, and it is separate from consolidation.** It is a missing write, not a
duplicated read.

---

## Q3 · Can they collapse the way `getStudentBalances` did?

**Partly — and not the way that precedent went.**

`getStudentBalances` worked because balance is **one question with one answer**: charges minus
payments. Every caller wanted the same number, so one set-based helper could serve them all.

Here there are **three questions** (a/b/c above). (b) and (c) must stay separate — collapsing them
would make an annual centre's MRR equal its annual invoice.

**But (a) — the rate primitive — should collapse to exactly one function, and the architecture for
it already exists.** `getImpliedMonthlyMrrFromCenterFields` at `pricing.ts:250` already does the
right thing: resolve the rate via R1, then apply the period rule. The fault is that **R2–R7 skip
that layer and hand-roll the resolution**, each with slightly different precedence.

**The blocker is not code, it is a decision.** You cannot collapse seven readers onto one helper
until it is settled what the rate *is*, because the three candidate columns can legitimately hold
three different numbers today:

- Is `billing_amount` the truth (what R7 charges), with `all_in_price` a derived per-month view?
- Or is `all_in_price` the truth, with `billing_amount` a cache that must be rewritten on every
  reprice?
- And is `early_adopter_price` a price at all, or only a label?

**Collapsing before answering that just promotes one screen's guess to product-wide truth.** My
reading — and it is a recommendation, not a finding — is the second: `all_in_price` is the per-month
rate, `billing_amount` is the derived per-cycle amount that every reprice must rewrite, and
`early_adopter_price` becomes a non-price label (or is dropped, since `is_early_adopter` already
carries the flag).

---

## Q4 · What would change output if they collapse

Only rows where the three columns disagree produce a different number. Everything below reads one of
R1–R7.

### Screens — 7

| Screen | Path | Question it asks |
|---|---|---|
| `/{locale}/settings/billing` | **R4** | rate, upgrade proration, reactivation amount |
| `/{locale}/billing` | **R5** | the "Renewal" figure beside the **Early adopter** badge |
| `/{locale}/admin/finance` | R1 via (c) | MRR, ARR, revenue-by-plan |
| `/{locale}/admin/billing` | R1 via (c) + `adminCycleAmount` | MRR, per-centre cycle amount |
| `/{locale}/ceo` | **R6** | MRR, ARR |
| `/{locale}/admin/overview` | passthrough | displays the column raw |
| `/{locale}/admin/centers/[id]` | passthrough | the three editable fields |

### Crons — 4

| Cron | Path | Effect of a change |
|---|---|---|
| **`process-renewals`** (`subscriptionBillingCron`) | **R7** | **the amount actually invoiced** |
| **`summer-billing`** (`summerBillingCron`, currently the enabled mode — `summer.promo.enabled = true`) | **R7** | **the amount actually invoiced** |
| `snapshot-mrr` (`computeMrrSnapshot`) | R1 via (c) | the stored MRR history series |
| `billing-lockout` | **R3** | whether a centre is judged paid-up, i.e. **suspension** |

`subscription-autocharge`, `payment-retry`, `billing-reconciliation`, `ceo-briefing`,
`commission-t2-check`, `upgrade-nudge` and `weekly-owner-report` do **not** resolve the rate
themselves — they read amounts already stored on invoices, or delegate.

### APIs — 7

`billing/initiate-payment` (**R2**, charges), `billing/dashboard`, `settings/billing`,
`admin/finance`, `admin/billing`, `ceo/dashboard`, `admin/overview`.

### Blast radius on live data today: **zero**

| Centre | `is_test` | `all_in_price` | `billing_amount` | early adopter | Columns disagree? |
|---|---|---|---|---|---|
| Test Owner Center | true | 2000.00 | 2000.00 | false | no |
| Test Center 333 | true | **null** | 1000.00 | false | **yes** — `all_in_price` null vs `billing_amount` 1000 |

Two centres, both test rows, neither an early adopter. **No production centre changes output if this
is consolidated today.** The one disagreement that exists is the null `all_in_price` on a test row,
which is exactly what drives R6's `billing_amount / 3` branch — CEO reports **333/mo** where R4 and
R1 report the Starter list price of **4,499**.

**This is the cheapest moment this will ever be.** It stops being free the day a real centre is
signed on a negotiated rate — which, as you put it, is what an early adopter is.

---

## Summary

- **Seven paths**, not five: R1–R7. Three read `early_adopter_price`, four do not.
- **The correct authority is `billing_amount` (monthly) / `all_in_price` (annual)** — R7, because
  that is what is actually charged. The earlier survey had this inverted.
- **`early_adopter_price` is a label with three writers and no invariant.** R1, R2 and R3 treat it as
  a price.
- **A live overcharge exists independently of consolidation:** `override-price` updates
  `all_in_price` and `early_adopter_price` but never `billing_amount`, so after a reprice the
  monthly renewal keeps charging the old rate while "Pay now" charges the new one.
- **The rate primitive can collapse to one helper; the cycle-charge and MRR computations cannot** —
  they answer different questions and already consume the primitive correctly at `pricing.ts:250`.
- **Consolidation is blocked on one decision:** which column is the truth.
- **Impact today is zero rows.** Both centres are test rows.

**Recommended order, not actioned:** fix the `override-price` missing `billing_amount` write first —
it is a real overcharge, is independent of the rest, and is a few lines. Then decide the authority
question. Then collapse R2–R6 onto the primitive.
