# Survey — `Merged-Center-Money`, 5 screens

**Written 28 July 2026.** Survey before building, per the standing rule. **Nothing built.**
`Merged-Center-Money` is one of the six protected money-and-auth files.

Every figure below is traced to the code or the live catalog that produces it, and where the same
figure appears on more than one screen it is checked for **one computation, not two**. That check is
the point of this pass: the upgrade fault and the balance helper were each one number with two
sources.

---

## Verdict

| § | Screen | Verdict |
|---|---|---|
| 01 | Payments | **Money.** Live at `/{locale}/payments`. Three header figures, all live-sourced |
| 02 | Center Payments Verified | **C1** — the whole screen is the verified state |
| 03 | Billing | **Money**, and the design shows a plan ladder that does not exist |
| 04 | Center Withdrawal Verified | **C1** |
| 05 | Center Receipts Verified | **C1** |

**Three of five are C1-blocked**, as the file's shape suggests. The verification state that gates
them is not merely unbuilt — **there is no column for it**: `verification_status`, `is_verified` and
`%kyc%` return **zero columns across the whole `public` schema**. §02, §04 and §05 also depend on
A11/A13 (online collection, provider balance and withdrawal), which `NEW-FEATURES.md` already marks
*"unblocked by B1, still needs C1"*.

So the survey's real work is §01 and §03.

---

## The finding: the centre's own price is computed five different ways

**One number — what a centre pays per month — has five implementations. Only one consults
`early_adopter_price`, and it is not either of the two screens the owner sees.**

| # | Where | Precedence | Reads `early_adopter_price`? |
|---|---|---|---|
| 1 | `lib/pricing.ts:203` `getQuarterlyAllInMonthlyRateFromCenter` — **the canonical helper** | `top_centers` → **`early_adopter_price`** → `all_in_price` → `PLANS[pk]` | **Yes** |
| 2 | `api/admin/billing/route.ts:105` | delegates to #1 | Yes |
| 3 | `settings/billing/page.tsx:634, 771, 821` — **owner-facing** | `all_in_price` → `pricing_plans` row → `PLANS[pk]` | **No** |
| 4 | `(dashboard)/billing/BillingPageClient.tsx:299` — **owner-facing** | `billing_amount` → `all_in_price` | **No** |
| 5 | `api/ceo/dashboard/route.ts:166` | `all_in_price` → **`billing_amount / 3`** → `subscription_monthly_fee` → `PLANS[pk]` | **No** — it *selects* the column at `:51` and `:149`, then never uses it |

### Why this bites, concretely

`POST /api/signup:190` sets `const allInPerMonth = PLANS[planKey].quarterlyAllIn` and writes it to
`centers.all_in_price` at `:252`. **Signup never considers early-adopter status** — it cannot, since
the flag is applied later by an admin (`admin/centers/[id]/centerManagementClient.tsx:868`,
`SubscriptionOverridesPanel.tsx:108`).

So the moment a centre is made an early adopter:

- `centers.all_in_price` still holds the **list** price written at signup;
- `centers.early_adopter_price` holds the **discounted** price actually owed;
- paths **1 and 2** return the discounted price — correct;
- paths **3, 4 and 5** return the list price — **wrong, and higher**.

The owner is shown a renewal figure **above what they actually pay**, on both of their billing
screens, while admin MRR shows the correct lower one. The discount exists in the database and is
invisible on the two screens whose entire job is to state the price.

`BillingPageClient.tsx:344` renders an **"Early adopter"** badge — sitting directly beside the
`displayAmount` computed at `:299`, which never consults the early-adopter price. **The badge and the
number it sits next to disagree by construction.** `Merged-Center-Money` §03 draws that badge too, on
the same card as "Renewal 8,990 /yr".

### Path 5's extra divergence

`billing_amount / 3` appears in no other path. `signup/route.ts:251` writes
`billing_amount: periodAmount` — the **period** total, not a quarterly one, and the DB CHECKs allow
only `monthly` / `annual` (`pricing.ts:23`). Dividing a monthly amount by 3 understates that centre's
MRR threefold. It is reachable only when `all_in_price` is NULL, which a signup-created centre never
is — so this one is **latent**, not systematic. It fires on admin-created and legacy rows.

### Status today: latent, not visible

**Checked the live catalog: there are two centres, both `is_test = true`, both
`is_early_adopter = false`.** So nothing is wrong on screen right now. This is a pre-launch finding,
which is the good case — the fault is in the code, not yet in anyone's invoice.

The test rows do show path 5 diverging already: `Test Center 333` has `all_in_price = NULL` and
`billing_amount = 1000`, so the CEO dashboard computes **333/mo** where paths 1–3 return the Starter
list price of **4,499**.

**Recommendation, not a build:** make `getQuarterlyAllInMonthlyRateFromCenter` the only way to answer
this question and route paths 3, 4 and 5 through it. Money, so it is Eyad's call — logged, not
actioned.

---

## §01 Payments — live, and the three header figures

Live at `/{locale}/payments`. The design's ledger, method filters, inline **Confirm** on pending rows,
the Record-Payment sheet and the receipt are all recognisably the live screen. The design's own note —
*"The app records payments, it does not process them"* — matches: this is the cash/manual ledger, not
online collection. Online collection is §02, which is C1.

**The three tiles are the figures:** Today `1,250` · Pending `600` · This month `18,400`, captioned
`EGP · June`.

These are aggregates over `payments` scoped by `center_id` and a Cairo day/month window. Two things
to hold onto rather than assume:

- **The window must be Cairo, not UTC.** `CLAUDE.md` is explicit and the `cairo/` helpers exist for
  it. "Today" and "This month" are exactly the shape of figure that silently shifts by a day when a
  `new Date()` slips in.
- **`is_test = false` is the documented default on aggregates.** Both live centres are test rows, so
  any figure that forgets the filter reads non-zero today and would read wrong on launch day.

**Export CSV · Pro** is an entitlement chip. The CSV export itself was clarified in #193; the Pro gate
is a plan check and is not a layout change.

**Not a layout job.** Every tile is a money figure, and the inline Confirm is a **write** that marks a
payment paid. Both come to Eyad under the standing rule.

---

## §03 Billing — the design's plan ladder does not exist

This is the largest single divergence in the file, and it is not a styling gap.

| Design shows | Live |
|---|---|
| **"TutoringHQ GROWTH"**, **"TutoringHQ SCALE"**, **"TutoringHQ STARTER"** | Centre plans are **Solo · Nano · Starter · Pro · Business · Enterprise** |
| Renewal **8,990 /yr**, monthly **899** | No centre plan is priced at 899 or 8,990. Live: 999 / 1,999 / 4,499 / 7,999 / 12,999 / 18,499 per month |
| "Renewal 8,990 /yr **Plus tax**" | **Contradicts the locked rule.** B1: *"All published subscription prices are VAT-inclusive at 14%."* "Plus tax" says the opposite on the screen where it matters most |
| "Billed Annually · **Saving 17%**" | Live annual is `pricing.interval.annual_multiplier = 10` — pay 10 of 12 — surfaced as the label **"2 months free"** (`pricing.interval.annual_label_en`), not a percentage |
| "Up to 250 students", "2 branches", "Up to 6 branches" | Caps are `weekly_student_limit` (50 / 120 / 200 / 500 / 1,000 / 2,000). No plan carries a **branch allowance** of any kind |
| Add-ons: **"Advanced Analytics +149 EGP / mo"** | **No add-on model.** Zero columns matching `%addon%` or `%add_on%` anywhere in `public` |
| "Early adopter" badge | **Real** — `centers.is_early_adopter`, `early_adopter_number`, `early_adopter_price` all exist |

Three of these are worth separating because they are different kinds of problem:

1. **"Scale" labelling a centre is already a known design error.** `NEW-FEATURES.md:1002`:
   *"**'Scale' is a teacher plan only** … It is wrong wherever it labels a centre."* §03 does exactly
   that, and adds "Growth", which is not a plan on either ladder.
2. **"Plus tax" is a rule breach, not a naming slip.** Every published price is VAT-inclusive. A
   billing screen that says "plus tax" beside a renewal figure misstates what the customer owes.
3. **The add-ons row is the B15/B16 shape** — a control with nothing behind it. "Advanced Analytics
   +149" needs an add-on model designed first; it is a feature, not a restyle. (The other two rows,
   "Parent WhatsApp pack" and "Extra branch", *do* have live counterparts — `parent_pack_enabled`,
   and branches which are billable — so the row is half-real, which is worse than wholly absent.)

The design's internal arithmetic is at least self-consistent: `899 × 10 = 8,990`, and
`1 − 8,990/(899 × 12) = 16.7%`, rounded to the "17%" shown. It is a coherent ladder — just not this
product's.

**Two live screens, one design.** `/{locale}/billing` and `/{locale}/settings/billing` both exist and
`DUPLICATE-ROUTES.md` #1 already records it, noting settings is *"a superset in almost every
respect"* and that the design is *"a membership-management view"*. Whatever §03 becomes, it lands on
one of two screens that already disagree about how to compute the price — see the finding above.

---

## §02, §04, §05 — C1, and what they encode that is worth keeping

All three are verified-state screens and none can be built. But they are the clearest written
statement of the locked B1 rate card anywhere in the design set, and the figures **check out**:

**§05 Receipts** — three deliberately unmerged lists (payment confirmations · payout statements ·
tax documents). Its per-row figures are exactly B1:

| Design row | B1 formula | Checks |
|---|---|---|
| "Your fee 150 · you receive **135**" | `X − 10%` | 150 × 0.9 = 135 ✓ |
| provider price **168.75** | `X + (0.075X + 7.5)` | 1.075 × 150 + 7.5 = 168.75 ✓ |
| "Your fee 180 · you receive **162**" · **201.00** | same | 162 ✓ · 1.075 × 180 + 7.5 = 201.00 ✓ |

Both rows quote the **provider price**, never the parent total — which is precisely what B1's
presentation rule demands of a provider-facing screen. **§05 is faithful to the rate card.**

Payout statement: `15,200 − 1,520 (10%) − 171 = 13,509` ✓. Tax document:
`5,333.33 + 746.67 VAT = 6,080`, and `6,080 / 1.14 = 5,333.33` — **VAT-inclusive, correct**, and the
direct contrast with §03's "Plus tax" three sections earlier.

**§04 Withdrawal** — one free payout a month, extra under 10,000 = 250 EGP, extra over = 2%, instant
under 10,000 = 250 EGP, instant over = 3%, all VAT-inclusive. Its worked examples hold:
12,480 × 3% = 374 ✓; withdrawing 500 with a 250 fee leaves 250 ✓.

**§02** carries Available `12,480` / Pending `8,250` / Unpaid `1,350`, and §04 opens with the **same**
Available `12,480` — **one figure, two screens, consistent within the design** ✓.

**There is no live source for any of them.** The tables that exist are `withdrawal_requests`,
`payout_requests`, `commission_payouts` and `credit_ledger` — none of which is a provider balance
with a Pending/Available split or a Thursday clearing cycle. That model arrives with A13, which needs
C1.

**Worth recording rather than losing:** these three screens are where the rate card is drawn
correctly. When A11/A13 are built, §04 and §05 are the specification, not a restyle target.

---

## Figure provenance — the summary asked for

| Figure | Screens showing it | Source | Same computation everywhere? |
|---|---|---|---|
| Centre monthly price | §03; signup S4/S5; `/billing`; `/settings/billing`; admin billing; CEO dashboard | `centers.early_adopter_price` → `all_in_price` → `pricing_plans.all_in_price` → `PLANS[].quarterlyAllIn` | **No — five paths, one consults the early-adopter price.** The finding above |
| Plan list price + cap | §03; signup S4 | `pricing_plans` row → `SUBSCRIPTION_PLAN_DEFINITIONS` fallback | **Yes.** Both resolve DB-first, constant-fallback, and the live rows and constants agree exactly today |
| Provider price `168.75` | §05; `Merged-Public-App` §02 | B1: `1.075X + 7.5` | **Same formula, but §02 is parent-facing** — see `FAITHFULNESS-Public-App.md` |
| Provider keeps `135` (90%) | §05; §04 prose | B1: `X − 10%` | Yes ✓ |
| Available balance `12,480` | §02, §04 | none live — A13 | Consistent within the design ✓ |
| Today / Pending / This month | §01 | `payments` aggregates, Cairo window, `is_test = false` | Single screen; no cross-check needed |

---

## What comes to Eyad

**Money:** §01's three tiles and its inline Confirm write · §03's whole plan ladder · the add-ons row.

**Rule breaches, not preferences:** §03's **"Plus tax"** against VAT-inclusive; **"Scale"** and
**"Growth"** labelling a centre.

**The code finding:** five computations of the centre's own price; two owner-facing screens ignore
`early_adopter_price`; `/ceo/dashboard` selects that column and never uses it, and divides
`billing_amount` by 3. Latent today — both live centres are test rows and neither is an early
adopter.

**C1-blocked:** §02, §04, §05 — and the verification state has **no column at all**, so these are
further from buildable than "blocked on Valify" implies.
