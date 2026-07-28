# Survey — `Merged-Teacher-Money`, 5 screens

**Written 28 July 2026.** Survey before building. **Nothing built.** Protected file.

Same figure rule as `SURVEY-Center-Money.md`: every number traced to its source, and every number
appearing on more than one screen checked for **one computation**.

---

## Verdict

| § | Screen | Verdict |
|---|---|---|
| 01 | Teacher Income | **Money.** Unverified half is live at `/teacher/income`; the verified half is **C1** |
| 02 | Earnings Calculator | **Money.** Live as `IncomeCalculator` on `/teacher` — and it renders a fee rate the locked card contradicts |
| 03 | Teacher Billing | **Money.** Live at `/teacher/billing`. Three plan figures disagree with `TEACHER_PLANS` |
| 04 | Instant Payout | **C1** + payouts (A13). Its fee also contradicts the centre rate card |
| 05 | Collect Opt-in | **C1** — the screen ends in Valify by design |

---

## The good news first: `outstanding` has exactly one source

The teacher's outstanding balance appears on **three** surfaces and all three resolve to the same
place — the credit-aware **`ar_by_student`** view:

| Surface | Path |
|---|---|
| `/teacher` (Home) tile | `page.tsx:158` → `/api/teacher/private/income` |
| `/teacher/income` §01 | same endpoint — `route.ts:255`, *"headline outstanding from the canonical AR view (credit-aware)"* |
| `/teacher/analytics` payment risk | `teacherAnalytics.ts:748` → `.from('ar_by_student')` |

`teacherAnalytics.ts:417` states the rule outright: *"read straight from the canonical credit-aware
`ar_by_student` view (**we never hand-roll outstanding math**)"*.

**This is the pattern the centre price should follow and does not.** Worth naming as the house
standard rather than leaving it implicit: one view, three screens, no drift. It is the direct
counterexample to the five-path price finding in `SURVEY-Center-Money.md`.

---

## §02 Earnings Calculator — live shows a 5% fee; B1 locks 10%

The design and live agree on the **base formula**. `IncomeCalculator.tsx:20`:

```
const gross = students * 4 * fee;   // weekly sessions assumed
```

Design §02: 15 students × 350 EGP → **21,000** monthly. `15 × 4 × 350 = 21,000` ✓ — same defaults
(`students = 15`, `fee = 350` at `:17-18`), same arithmetic. The design's derived percentages also
hold: `499 / 21,000 = 2.4%` → *"about 2%"*, and at 30 students `499 / 42,000 = 1.2%` → *"about 1%"* ✓.

**The next line is the problem.** `IncomeCalculator.tsx:21`:

```
const centerHqFee = Math.round(gross * 0.05);
```

rendered at `:82` as `t('feeNote', { fee: … })`. So the live calculator tells a prospective teacher
that TutoringHQ takes **5%**.

- **B1, locked 26 July:** *"One rate card. Every provider keeps 90%, the platform keeps 10%."*
- **The design's §02 shows no platform fee at all** — its whole argument is *plan cost as a shrinking
  share of income*, deliberately: *"The percentage only ever appears as an output the teacher
  generated."*

So there are three positions: live says 5%, the locked card says 10%, the design says don't show a
rate here. **The live number is a public-facing figure that understates the platform's own fee by
half**, on a marketing surface aimed at teachers who have not signed up. Money, and it needs
correcting whichever way §02 is eventually drawn.

---

## §03 Teacher Billing — three plan figures wrong, one right that the other file got wrong

Live is `/teacher/billing` (807-line settings sibling confirmed in Phase E). The membership card,
plan options, upgrade card, invoices and switch-cycle sheet are all recognisable.

| Design | `TEACHER_PLANS` (`lib/teacherPlans.ts`) | |
|---|---|---|
| Standard 499 · trial ends after 14 days | `priceGross: 499`, `trialDays: 14` | ✓ |
| Pro 999 · **"Best for part-time"** | `priceGross: 999`; the file calls this *"the only label"* on the ladder | ✓ |
| Pro · **"50 WhatsApp messages a month"** | `blastCreditsMonthly: **100**` | ✗ |
| Scale 2,499 | `priceGross: 2499` | ✓ |
| Scale · **"up to 150 active students"** | `studentCap: **100**` | ✗ |
| Scale · **"then +16 EGP per active student above 150"** | `overagePerStudent: **20**` | ✗ |

**Scale is wrong in the same two places as `Merged-Public-App` §01 S4b** — cap and overage — so the
error is consistent across the design set and consistently wrong against live. Two files, one fault,
which is how a wrong number survives review.

**The two design files also disagree with each other on the unit**, and only one is right:

- `Merged-Teacher-Money` §03: *"up to 150 **active students**… trued up monthly"* — **correct unit**.
- `Merged-Public-App` §01 S4b: *"150 **a week**"* — wrong unit; live counts active students per
  billing month (`countActiveStudentsThisMonth`).

Same for the Pro label: §03 carries *"Best for part-time"* (matches live), Public-App §01 S4b omits
it. **Where the two files differ, `Merged-Teacher-Money` is the more accurate document.** Worth
recording so a future pass corrects toward it rather than away.

**One row promises a declined feature.** *"Refer a teacher — Earn a share of every teacher you
refer."* The teacher referral model was **answered NO on 28 July**: *"Centers are well built,
teachers are not, and I am not designing a second referral model before the first has run."* All five
referral tables are centre-to-centre (`*_center_id`, no `teacher_id`). The row has nothing behind it.

---

## §01 Teacher Income — live unverified, C1 verified

**Unverified half is live.** Lifetime earned, best month, monthly average, the by-month chart,
collected vs outstanding, and the by-group breakdown are the live `/teacher/income` screen. Every
tile is a money figure, so any change comes to Eyad regardless of how layout-shaped it looks.

The design's nudge — *"Tired of chasing that 900? **Verify** and we collect it for you"* — is the
C1 gate, and the figure in it (`900`) is the same `outstanding` traced above. Consistent ✓.

**Verified half is C1 and A13.** Balance / Available / Pending / "Next processed Thu 23/07" / recent
bank payouts is the provider-balance model. As recorded in `SURVEY-Center-Money.md`, the tables that
exist (`withdrawal_requests`, `payout_requests`, `commission_payouts`, `credit_ledger`) are not a
provider balance with a Pending→Available clearing cycle.

Design note on the screen: *"Take-home figures throughout, never a percentage"* — worth keeping. It
is the opposite of what the live §02 calculator does with its 5%.

---

## §04 Instant Payout — the fee contradicts the centre rate card

C1-blocked (payouts), but the figures should be reconciled before it is ever built.

Design §04: Available **8,400** · instant fee **−300** · receives **8,100**.

`Merged-Center-Money` §04's rate card, on the same locked model:

| Line | Centre §04 | Teacher §04 implies |
|---|---|---|
| Instant, **under 10,000** | **250 EGP** | **300 EGP** on an 8,400 payout |

8,400 is under 10,000, so under one rate card the fee should be **250**, not 300. 300/8,400 is 3.57%,
which matches neither the flat 250 nor the 3% over-10,000 band (that would be 252).

B1 is explicit: **"One rate card"**, every provider on it. Either teachers are on a different card —
which contradicts B1 — or one of the two screens is wrong. **One fee, two screens, two answers.**

The rest is internally consistent: 8,400 − 300 = 8,100 ✓, and the Thursday-free / instant-priced
split matches Centre §04's structure.

---

## §05 Collect Opt-in — C1, and a deliberate silence worth checking

The screen ends in *"Verify my ID to switch on · About 2 minutes · National ID · secured by Valify"* —
C1 by construction. `DECISION-national-id-2026-07-26.md` covers why the National ID is standard
rather than sensitive data.

It names the fee's **categories** — card and wallet fees, payment processing, taxes, support, the
platform — with **no figures**, deliberately: *"so the margin stays private without inventing
anything."*

**That sits against B1.** The locked card makes the 10% collection fee **provider-visible**
(*"The 10% collection fee and the 7.5% + 7.5 markup are provider-visible"*), and
`Merged-Center-Money` §05 shows *"Collection fee (10%)"* plainly on the receipts screen. So a teacher
opts in **without seeing the rate**, then meets it afterwards on their statements.

Not a contradiction in arithmetic — a **disclosure choice**, and one made at the moment of consent.
Flagging it as a decision rather than a defect: the design states its reasoning, but "the fee is
stated" is the screen's own claim in its lede, and no rate appears.

---

## Correction to the record — D2's premise is wrong

Found while tracing §03's "Refer a teacher" row. **This is not a Teacher-Money finding, but it
invalidates a recorded one, so it goes here rather than nowhere.**

`SKIPPED-SCREENS.md` states, for `Merged-Center-Insight` §03 Referrals:

> Rate ladder **25% month 1 / 10% months 2–6 / 5% month 7+** — **Ruled out.** Live is **10% for
> twelve months**. The 26 July decision: *"People have been told a rate, so live wins and the design
> is wrong."* Logged as design correction **D2**.

**Live is not 10% for twelve months. Live is a 25 / 10 / 5 ladder.**
`app/api/referrals/process-commission/route.ts:105-108`:

```
let rate: number;
if (months === 1) rate = 0.25;
else if (months <= 12) rate = 0.1;
else rate = 0.05;
```

and `/{locale}/referrals/page.tsx:177-185` renders it to the owner:

| Live string | Value |
|---|---|
| `tier1Label` / `tier1Value` | Month 1 · **25% of referred center's payment** |
| `tier2Label` / `tier2Value` | Months 2–12 · **10% / month** |
| `tier3Label` / `tier3Value` | Month 13+ · **5% per month (perpetual)** |

So the engine pays the ladder and the UI advertises it. The design and live **agree on the shape and
on all three rates**; they differ on **one boundary** — the design ends tier 2 at month 6, live ends
it at month 12.

"10% for twelve months" appears to have come from reading the middle tier alone and missing the 25%
first month and the 5% perpetual tail.

**Why it matters beyond the correction.** §03 Referrals was reclassified out of the layout queue on
the reasoning *"With the 25/10/5 ladder stripped per D2, what remains is money plus a verification
gate."* The ladder is not stripped — it is live, and it is the screen's main content. **The
classification may still be right** (the withdraw-vs-credit half is genuinely B8 and
verification-gated), **but it no longer rests on a true premise.** Not re-opening a settled decision;
recording that its basis needs restating.

**One more, same area:** `REFERRAL_WITHDRAWAL_FEE_RATE = 0.05` (`lib/referralPayout.ts:14`) plus
*"A flat 20 EGP processing fee is deducted first, then a 5% withdrawal fee on the remainder"* — a
**third** distinct 5% in the referral area, unrelated to the calculator's 5%. Three different 5%s
(calculator platform fee, referral tier 3, referral withdrawal fee) is a naming hazard of the same
kind the B1 processing-fee rule already warns about.

---

## Figure provenance — summary

| Figure | Screens | Source | Same computation? |
|---|---|---|---|
| Teacher `outstanding` | §01; `/teacher` Home; `/teacher/analytics` | **`ar_by_student`** view | **Yes** ✓ — single canonical view, explicitly enforced |
| Estimated monthly income | §02; live `IncomeCalculator` | `students × 4 × fee` | **Yes** ✓ same formula, same defaults |
| Platform fee rate | live §02 calculator; B1; `Merged-Center-Money` §05 | — | **No.** Live renders **5%**, locked card is **10%**, design §02 shows none |
| Teacher plan price | §03; Public-App §01 S4b; `/teacher/billing` | `TEACHER_PLANS` constant | Prices ✓ all three agree |
| Scale cap / overage | §03; Public-App §01 S4b | `TEACHER_PLANS.teacher_scale` = 100 / +20 | **No.** Both designs say 150 / 16; they also disagree on the unit |
| Pro WhatsApp allowance | §03 | `blastCreditsMonthly: 100` | **No.** Design says 50 |
| Instant payout fee | §04; `Merged-Center-Money` §04 | none live — A13 | **No.** 300 here, 250 under the centre card for the same band |

---

## What comes to Eyad

**Money, live, and wrong now:** the calculator's **5%** against B1's locked **10%** — the only item
here that is on a live public surface today.

**Money, design vs live:** Scale cap and overage (again) · Pro's WhatsApp allowance · the §04 instant
fee against the centre rate card.

**Declined feature still drawn:** §03's "Refer a teacher" row.

**Decision, not defect:** §05 withholding the rate at the moment of consent.

**C1:** §01's verified half, §04, §05.

**Correction to the record:** D2's premise — live implements 25/10/5, not 10% for twelve months.
