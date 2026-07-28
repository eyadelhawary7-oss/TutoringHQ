# Survey — `Merged-Admin-Money`, 7 screens

**Written 28 July 2026.** Survey before building. **Nothing built.** Protected file.

Internal-only screens — no customer sees these — but the figure rule still applies, and one of them
turns out to be the best-reconciled document in the whole design set.

---

## Verdict

| § | Screen | Live route | Verdict |
|---|---|---|---|
| 01 | Admin Fee Collection | **none** | **C1 / A11 / C5.** And it is the reference implementation of B1 — below |
| 02 | Admin Settlement | **none** | **C1 / A13.** Batch rows gate on "National ID on file" |
| 03 | Admin Finance Health | `/admin/finance` + `/admin/health` | **Live.** Money. Plan ladder wrong |
| 04 | Admin Receipts | **none** | **C1 / C4.** Receipts tied to a verified National ID |
| 05 | Admin Withdrawals Analytics | `/admin/withdrawals` + `/admin/analytics` | **Live.** Money on the withdrawals half |
| 06 | Admin Unpaid Recovery | **none** | **A11.** Needs online collection to have anything to recover |
| 07 | Admin Billing Pricing | `/admin/billing` + `/admin/pricing` | **Live.** Money. Plan ladder wrong |

**Four of seven have no live route**, and all four are the fee-collection/payout world that C1 gates.
Three are live and each pairs two screens onto one design section.

---

## §01 Admin Fee Collection — the reference implementation of B1

**Every figure on this screen derives from two inputs and reconciles exactly.** Taking total provider
fees `X = 320,000` and `n = 1,200` payments — the payment count is printed in the screen's own header:

| Line on screen | B1 formula | Computes to | Screen shows |
|---|---|---|---|
| Collection fees · 10% of provider fees | `0.10X` | 32,000 | **32,000** ✓ |
| Paid out to providers | `X − 10%` | 288,000 | **288,000** ✓ |
| Price markup · 7.5% + 7.5 | `0.075X + 7.5n` | 24,000 + 9,000 = 33,000 | **33,000** ✓ |
| Parent processing · 1.5% + 1.5 | `0.015(X + markup) + 1.5n` | 5,295 + 1,800 = 7,095 | **7,095** ✓ |
| Collected from parents | `X + markup + parent fee` | 360,095 | **360,095** ✓ |
| Our revenue | `360,095 − 288,000` | 72,095 | **72,095** ✓ |
| Revenue sources total | `32,000 + 33,000 + 7,095` | 72,095 | **72,095** ✓ |
| VAT on our fees (14% **inclusive**) | `72,095 − 72,095/1.14` | 8,854 | **8,854** ✓ |
| Net | `72,095 − 13,503 − 8,854` | 49,738 | **49,738** ✓ |

Nine figures, no rounding drift, and the VAT is inclusive as the locked rule requires. The screen's
own claim — *"Every figure reconciles"* — is **true**, and I could not find a design document in this
set that states B1 more completely.

**Keep this screen as the specification.** When A11/C5 are built, §01 is the arithmetic to implement
against, not a layout to restyle.

**One figure does not check out.** *"Paymob on collection −13,503"* is **3.75%** of 360,095. B1 says
*"Paymob's ~2.75% comes out of company margin"*, which on the same base is 9,903. The "~" makes 2.75%
approximate, but a full point of spread on the platform's largest cost line is worth pinning before
this drives any P&L. **The only unreconciled number on the screen.**

---

## The MRR figure — admin is consistent, the CEO dashboard is not

MRR appears on **§03** ("312K MRR") and **§07** ("MRR 312k"). Both live routes resolve it the same
way, through the canonical helper:

| Screen | Route | Path |
|---|---|---|
| §03 Finance | `/api/admin/finance:19` | `computeMrrSnapshot` → `getImpliedMonthlyMrr(row)` with `select('*')` |
| §07 Billing | `/api/admin/billing:111` | `getImpliedMonthlyMrr({…})` — **explicitly passes `is_early_adopter` and `early_adopter_price`** (`:116-117`), and its select at `:74` includes both |

Both reach `getQuarterlyAllInMonthlyRateFromCenter` (`pricing.ts:250`). **Admin's two MRR figures
agree by construction** — worth stating positively, since I went looking for a divergence here and
there is none.

**The outlier is `/api/ceo/dashboard`**, which feeds `Merged-CEO` rather than this file. It computes
MRR inline (`:165-173`) with `all_in_price → billing_amount / 3 → subscription_monthly_fee → PLANS`,
never consulting `early_adopter_price` despite selecting it at `:51` and `:149`. It also applies a
**different eligibility filter** (`subscription_status in (active, overdue)`, `status = active`,
`is_test = false`) from `computeMrrSnapshot`'s `isCenterEligibleForSubscriptionMrr`.

So the same headline number — MRR — is computed one way for the two admin screens and another way for
the CEO screen, differing in **both** the rate resolution and the population counted. Recorded in
`SURVEY-Center-Money.md` as path 5; this survey narrows it: **the fault is CEO-only, not admin-wide.**

---

## §03 Finance Health and §07 Billing Pricing — the plan ladder, a third and fourth time

Both live, both money, and both label centres with plans that do not exist.

**§03, "REVENUE BY PLAN":** Starter 68K · **Growth** 159K · **Scale** 85K.
**§07, "CENTER PLANS · PER MONTH":** Starter 300 EGP · **Growth** 700 EGP · …

Live centre plans are **Solo · Nano · Starter · Pro · Business · Enterprise**. There is no Growth.
"Scale" is a **teacher** plan — `NEW-FEATURES.md:1002`: *"It is wrong wherever it labels a centre."*

**This is now the third and fourth instance** of the same wrong ladder, after `Merged-Center-Money`
§03. It is a systematic defect in the design set, not four independent slips, and it should be fixed
once as a design correction rather than screen by screen.

§07's prices are self-flagged (*"Design only, prices are placeholders"*), so **300 / 700 is not a
finding** — but **the plan names are not placeholders**, and a pricing admin screen listing a
non-existent plan is how a wrong plan key reaches a config editor.

**§03's other figures** are internally consistent where checkable: `312K MRR × 12 = 3.744M` → the
**3.74M ARR** shown ✓. Its fee-collection block (net profit 24,074 · Paymob 7,420 · remitted to ETA
13,356) reappears verbatim on **§04 Receipts** (net profit 24,074 · remitted 13,356) — **one figure,
two screens, consistent** ✓.

**`/admin/health` is not money at all** — uptime, response time, error count, per-service status. It
is the one genuinely layout-shaped half in this file, and it is already live.

---

## §05 Withdrawals Analytics — live, and the money half is referral payouts

The design is explicit and correct about what this is: *"Withdrawals is the one money action left for
a person: approving referral-earning payouts to referrers."* Not provider settlement — that is §02.

Live `/admin/withdrawals` exists, and the underlying model is real: `withdrawal_requests`, plus
`REFERRAL_WITHDRAWAL_FEE_RATE = 0.05` and the flat 20 EGP processing fee documented in
`referrals.withdrawalFeeNote` (*"A flat 20 EGP processing fee is deducted first, then a 5% withdrawal
fee on the remainder"*).

**The design shows none of that deduction.** Rows read `3,200 EGP`, `2,750`, `2,500` with an
Approve/Decline pair and a `Pending payouts 8,450 EGP` total (`3,200 + 2,750 + 2,500 = 8,450` ✓
internally). What the referrer actually receives is `(gross − 20) × 0.95`, so on 3,200 that is
**3,021** — a figure the approver never sees before approving. **Money, and the approver is the
person who most needs the net.**

`/admin/analytics` is product usage — accounts, sessions, attendance, messaging, feature adoption.
**Not money**, already live.

---

## §06 Admin Unpaid Recovery — blocked, and its figures are right

No route. It cannot exist before A11: with no online collection there are no declined cards and no
unopened payment links to recover.

Its arithmetic holds — `14 + 9 + 6 = 29` payments ✓, `4,180 + 2,660 + 1,580 = 8,420` ✓ matching the
"Outstanding right now 8,420" headline.

**And it uses B1's parent total correctly.** Two rows show **172.78**, which is exactly
`168.75 + 4.03` — provider price plus parent processing fee. B1 reserves the parent total for
parent-facing surfaces and forbids showing it to a **provider**; an internal recovery queue is
neither, and the parent total is the right number here because it is what the parent actually owes.
**Correct use**, and a useful contrast with `Merged-Public-App` §02, which shows the *provider* price
to a parent.

The screen's operational rule — *"the bulk action excludes anyone reminded in the last two days"*, and
*"Admin reminders come out of company credit, not the provider's"* — is a spend decision with no
model behind it today. Worth carrying into A11 rather than rediscovering.

*(Minor: the sample data uses "Test Center 333", which is a real row in the live database. Harmless,
but the file's own rule says sample data is placeholder.)*

---

## §02 Admin Settlement and §04 Admin Receipts — C1 by construction

Neither has a route and neither can be built.

**§02** gates every batch row on **"National ID on file"**, falling back to wallet when there is no
bank account, and rolling over anyone "Below minimum". Its cashflow block reconciles
(`74,000 − 66,000 = 8,000` ✓). The National ID gate is C1; the payout run itself is A13.

One thing to reconcile later: §02 rolls a teacher over for being **below minimum**, while
`Merged-Center-Money` §04 states *"There is no minimum: a center can withdraw 500 if it wants to."*
Those are different mechanisms — an automatic biweekly run versus a manual withdrawal — so not
necessarily a contradiction, but **the two screens say opposite things about minimums** and someone
will read them side by side.

**§04** is the receipt log behind the tax position: *"Every fee collection and withdrawal issues an
electronic receipt tied to a verified National ID"*, feeding a monthly write-off. C1 for the ID, C4
for document issuance. Its totals tie to §03 as noted above.

---

## Figure provenance — summary

| Figure | Screens | Source | Same computation? |
|---|---|---|---|
| MRR | §03, §07 | `getImpliedMonthlyMrr` → canonical helper | **Yes** ✓ both admin routes |
| MRR (elsewhere) | `Merged-CEO` | inline in `/api/ceo/dashboard` | **No** — different rate path *and* different population |
| Net profit 24,074 · remitted 13,356 | §03, §04 | none live — C5 | Consistent within the design ✓ |
| Parent total **172.78** | §06; B1 | `168.75 + 4.03` | ✓ correct, and correctly placed on an internal screen |
| Provider price **168.75** | `Center-Money` §05; `Public-App` §02 | B1 `1.075X + 7.5` | Formula same; **audience wrong** on Public-App §02 |
| §01's nine revenue lines | §01 | B1, from `X = 320,000`, `n = 1,200` | **All nine reconcile** ✓ |
| Paymob cost | §01 | design uses **3.75%**; B1 says **~2.75%** | **No** |
| Referral payout amount | §05 | `withdrawal_requests`; net is `(gross − 20) × 0.95` | Design shows **gross only**, never the net |
| Centre plan names | §03, §07, `Center-Money` §03 | live ladder is Solo…Enterprise | **No** — "Growth" and "Scale" in four places |

---

## What comes to Eyad

**Money, live now:** §05's approve action shows gross where the referrer receives
`(gross − 20) × 0.95` · §03 and §07's plan ladder on live admin screens.

**Design correction, one fix not four:** "Growth" and "Scale" labelling centres —
`Merged-Center-Money` §03, `Merged-Admin-Money` §03 and §07.

**Reconcile before building:** §01's Paymob rate (3.75% drawn vs ~2.75% locked) · the minimum-payout
contradiction between `Center-Money` §04 and `Admin-Money` §02.

**Keep as specification:** §01 is the complete, correct statement of B1 — nine figures, all
reconciling. It is the thing to build against, not to redraw.

**C1-blocked:** §01, §02, §04, §06 — four of seven, none with a live route.

**Narrowed from the previous survey:** the MRR divergence is **CEO-only**. Both admin paths are
correct.
