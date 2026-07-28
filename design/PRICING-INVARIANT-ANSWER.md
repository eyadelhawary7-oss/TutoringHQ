# `early_adopter_price` — does it mean anything beyond "has a negotiated price"?

**Written 28 July 2026. Answer to the gating question. Nothing changed.**

**Short answer: no, it has no independent meaning — and it is worse than redundant.** It is not
maintained, has three writers with no invariant, is never displayed as its own figure, and is read
*first* by three resolvers, which lets a stale value outrank the live one.

**Your reading is right. One refinement to the proposed invariant, at the end.**

---

## STOP — a live bug found while answering this, and it outranks the rename

`app/api/admin/centers/route.ts:845` writes **`early_adopter_date`**. That column **does not exist**
in the live catalog:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='centers' AND column_name LIKE '%early_adopter%';
-- early_adopter_number · early_adopter_price · is_early_adopter        (no early_adopter_date)
```

It is the **only** reference to that name in the entire codebase, so it is not an alias of something
real. And the update that carries it is **not error-checked** (`:848-851`):

```ts
await supabaseAdmin
  .from('centers')
  .update(centerUpdates)
  .eq('id', centerId);          // no { error }, no throw, no Sentry
```

PostgREST rejects an update naming an unknown column (`PGRST204`). The error is discarded, so **the
whole `centerUpdates` write is voided** — `approved_at`, `approved_by`, `subscription_status`,
`next_payment_due`, `subscription_start_date`, `auto_suspend_at`, `billing_status`,
`subscription_billing_period`, `billing_amount`, `all_in_price`, `is_early_adopter`,
`early_adopter_price`, `early_adopter_number`. **None of it lands.**

Execution then continues normally: the welcome WhatsApp sends, the admin action is logged, a referral
code is generated. **The admin sees success and the customer gets a welcome message, while the centre
row is untouched and the centre is never actually activated.**

### It fires on the first real early adopter

```ts
const earlyAdopterEligiblePlans = new Set(['solo','nano','starter','pro','business','enterprise']);
const canBeEarlyAdopter = (earlyAdopterCount ?? 0) < 10 && earlyAdopterEligiblePlans.has(plan);
```

Live count of `is_early_adopter = true` is **0**, and **all six centre plans are eligible**. So
`canBeEarlyAdopter` is **true for the next centre approved on any standard plan** through this route.

This is the July 8 failure mode verbatim — a column that does not exist, passing every gate because
CI has no live database. It is a two-line fix (drop the phantom field, check the error) and it
should go first, ahead of any renaming.

---

## The answer, with evidence

### It has three writers and they disagree

| Writer | Writes `early_adopter_price` as | Equals `all_in_price`? |
|---|---|---|
| `admin/centers/route.ts:843` (approval) | `monthlyInvoiceAmount` — derived from `all_in_price`, but a **separate variable** | same for monthly; not guaranteed |
| `subscription/override-price:57` | `= allIn`, i.e. exactly `all_in_price` | **always** |
| `centerManagementClient.tsx:869` (admin form) | an **independent form field** | **not constrained** — can differ, or be null while the flag is true |

### Nothing reads it as a distinct figure

Grep across `app/` and `components/` for client-side use: **zero**, other than the admin edit form
round-tripping it into its own input. Every other consumer is either a price resolver (R1/R2/R3 in
`PRICING-PATHS-MAP.md`) or a raw passthrough in an API response no component renders.

### It is never updated on a plan change — and that is the sharp end

`PATCH /api/admin/centers/[id]` (`:405-411` and `:472-479`) writes `plan`, `billing_amount`,
`all_in_price`. **It does not touch `early_adopter_price`.**

Because R1, R2 and R3 all check `early_adopter_price` **before** `all_in_price`, an early adopter who
changes plan keeps being priced at the pre-change rate on those paths — indefinitely:

| After a plan change | Resolves to |
|---|---|
| R2 `billing/initiate-payment` ("Pay now") | **stale** `early_adopter_price` — the old plan's rate |
| R7 renewal crons | new `billing_amount` — the new plan's rate |
| R1 canonical / MRR | **stale** `early_adopter_price` |

So a plan change on an early-adopter centre makes "Pay now" charge the old plan forever, while the
renewal charges the new one. **A second charging split, independent of the `override-price` one
already logged.**

### The discount itself lives in `all_in_price`, exactly as you said

`admin/centers/route.ts:819`:

```ts
const effectiveAllInPerMonth = canBeEarlyAdopter ? Math.round(listAllInPerMonth * 0.6) : listAllInPerMonth;
```

**A hardcoded 40% discount, capped at 10 centres, gated to the six standard plans.** The discount is
delivered by `all_in_price`. `early_adopter_price` only ever mirrors a value already computed from
it. That is the whole of its meaning.

**Worth flagging separately:** a 40% price rule, a 10-centre cap and the plan eligibility list are
business terms living inline in a route file, not in `pricing.ts` or `platform_config`.

---

## The refinement to your invariant

You proposed: *the badge derives from `all_in_price` being present.*

**Right in direction, but `all_in_price` presence is not the same claim.** Two cases break it:

1. **`top_centers`** is custom-priced by design (`centers.all_in_price`, code throws on NULL). Those
   centres carry a non-null `all_in_price` and are **not** early adopters. Deriving the badge from
   presence would put an "Early adopter" badge on every top-tier custom-priced centre.
2. **A negotiated price is not necessarily a discount.** `override-price` accepts any non-negative
   number, so `all_in_price` can be *above* catalog. "Has a negotiated price" and "is an early
   adopter" are not the same predicate.

**What actually identifies the cohort is `early_adopter_number`** — an ordinal 1…10 assigned at
approval. That carries real information the price cannot reconstruct: *which* early adopter, in what
order. It should not be derived away.

So the invariant I would propose instead:

> **`early_adopter_number IS NOT NULL` is the cohort marker. It may not be set unless
> `all_in_price IS NOT NULL`.** `is_early_adopter` becomes derived (or a stored mirror with a CHECK).
> `early_adopter_price` is **dropped as a price** — nothing reads it as a figure, and its read-first
> position in three resolvers is what makes a stale value authoritative.

That keeps your rule — *a centre is an early adopter because it has a negotiated price* — while
preserving the ordinal and not mislabelling `top_centers`.

**Both of these are the same invariant you described.** The difference is only which column carries
the badge. If you would rather keep `is_early_adopter` as a stored boolean with a CHECK constraint
tying it to `all_in_price`, that works equally well and is a smaller change; a CHECK is a migration,
so it is a manual apply either way.

---

## Answering the rest

**`all_in_price` nullable — agreed, keep it.** Most centres are on catalog price, and NULL is the
honest representation of "no negotiated price". Noted, not changed.

**Parent processing fee as an invoice line — logged against C1, not built.** Agreed it is the right
shape and agreed it is blocked: the parent-facing collect-for-me flow does not exist, so there is
nothing to invoice. Recorded in `NEW-FEATURES.md` under B1/C1 rather than actioned.

---

## Not mine — please confirm before I scope them

Four items in the brief were attributed to me that I did not raise. I would rather say so than
invent a scoping to match:

| Item | Status |
|---|---|
| "your three-PR plan" | I recommended a three-**step order**: fix the `override-price` missing `billing_amount` write, decide the authority column, then collapse. Not three PRs |
| "the four undated tables" | Never raised. I have no finding about undated tables |
| "the invoice-lines gap" | Never raised, beyond the parent-processing-fee point above |
| "the 3-way sync, `plan_key` on centers / subscriptions / invoices" | Never raised. It is plausible — `centers.plan` and `teacher_subscriptions.plan_key` and the invoice snapshot are three stores of the same fact — but I have not verified it and will not log it to `DATA-GAPS.md` as a finding until I have |

If those came from another session or your own reading, tell me and I will verify each properly
before anything is scoped against them.

---

## Recommended order

1. **The phantom `early_adopter_date` write** — live, silent, total failure of early-adopter centre
   approval, fires on the first one. Two lines. Ahead of everything.
2. **`override-price` missing `billing_amount` write** — the overcharge already logged in
   `PRICING-PATHS-MAP.md`.
3. **The plan-change staleness** — either update `early_adopter_price` on plan change or stop reading
   it as a price. Dropping the read is the smaller and safer change and it subsumes this.
4. **The rename** — `resolvePlanCatalogPrice` / `resolveCenterBilledPrice` — plus the badge
   invariant, once you have picked which column carries it.

Nothing above has been built.
