# Re-diff — `Merged-Center-Insight.html` vs LIVE

**Date:** 8 August 2026 · **Tenant:** Test Center 333 (owner session, `/tmp/state333.json`)
**Captures:** `/tmp/rediff/center-insight/{g1,g2,g3}` · **Design:** `/home/user/TutoringHQ/design/Merged-Center-Insight.html`

Read first, as instructed: `design/NEW-MODEL.md` ("Referral credit"), `design/NEW-FEATURES.md` §6, then the target file.

---

## 1 · Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Center-Insight.html | wc -l
13
```

Per section (`awk` over `mgd-name` bars, same file):

```
Analytics: 4
Benchmarks: 3
Referral Program: 6
TOTAL: 13
```

4 + 3 + 6 = **13**.

## 2 · Screens

| § | Name | Frames | Live route |
|---|---|---|---|
| 01 | Analytics | 4 | `/{locale}/analytics` (`/financial-intelligence` 302s here) |
| 02 | Benchmarks | 3 | `/{locale}/benchmarks` |
| 03 | Referral Program | 6 | `/{locale}/referrals` **and** `/{locale}/settings/referrals` |

**Routes measured: 10 of 10.** Every route returned `ok:true` with zero page errors and zero HTTP ≥400 (`_manifest.json`, all three batches). Two redirects, both benign and expected: `/en/financial-intelligence` → `/en/analytics`, `/ar/financial-intelligence` → `/ar/analytics`. **Nothing in this report is a tooling failure.**

## 3 · Frame accounting

**`Drawn: 13 | Exercisable: 8 | Exercised: 8 | Blocked: 5`**

(Exercisable = frames with a live counterpart reachable by this tenant and session. Exercisable + Blocked = 13; Exercised = Exercisable, i.e. everything reachable was rendered.)

Exercised (8): §01 frames 1, 2, 4 · §02 frame 1 · §03 frames 1, 2, 3, 4. 3 + 1 + 4 = 8.

**Blocked (5), each named:**

| Frame | Reason | Why |
|---|---|---|
| §01 f3 `EN · add-on (not a tier)` — 149 EGP Advanced Analytics gate | **by-design** | No such gate exists. `advanced_analytics` appears at exactly one place in `src/` (`src/lib/plans.ts:53`) and is referenced nowhere else — a dead flag, not an enforced gate. `/en/analytics` rendered fully unlocked. NEW-MODEL prices analytics at 0 for now, so the absence is correct. |
| §02 f2 `EN · enabled · fitted` | **no-data** | The percentile view **is built** (`src/app/[locale]/(dashboard)/benchmarks/page.tsx` — `percentile`, `district_median`, `showLiveBenchmarks`). It needs a district on the centre **and** `DISTRICT_TARGET = 10` peer centres. Test Center 333 has no district; live rendered the "set your district" state. Setting it would be a tenant mutation — not done. |
| §02 f3 `AR · RTL · enabled` | **no-data** | Same gate, same tenant. |
| §03 f5 `EN · tracking` | **no-data** | 0 referrals on this tenant — `"No referrals yet"` rendered. |
| §03 f6 `AR · tracking` | **no-data** | Same — `"لا توجد إحالات حتى الآن"` rendered. |

Sub-elements observed only in their empty state (frame still counted exercised): the Aging Report on §01 f2 rendered `"No overdue balances"` because the tenant's collection rate is 100%. The card, its `0–30 / 31–60 / 60+` bands and both per-row and bulk WhatsApp reminders are built (`src/components/analytics/AgingReport.tsx:79, 120, 193`).

---

## 4 · Divergences ruled AGAINST THE APP (defects)

### D1 — Commission ladder pays 10% for six months longer than the model says · MONEY

Rendered on `/en/referrals` (`crop_ref_comm_en.png`) and `/ar/referrals`:

> `25% Month 1` → `10% Months 2-12` → `5% Month 13+`

NEW-MODEL.md and NEW-FEATURES.md §6 both say **25% month 1, 10% months 2 to 6, then 5%**. Live runs 10% through month **12**.

This is not a copy slip — the backend agrees with the screen:

- `src/lib/referralProgram.ts:39-43` — `COMMISSION_TIERS` = `{25, 1–1}, {10, 2–12}, {5, 13–∞}`
- `src/app/api/referrals/process-commission/route.ts:106-108` — `if (months === 1) rate = 0.25; else if (months <= 12) rate = 0.1; else rate = 0.05;`

Months 7–12 pay **10% instead of 5%** — double the modelled rate for six months of every referral's life.

**This is a knowing, documented deviation, and that is the part needing a decision, not a bug fix.** `referralProgram.ts:8-18` carries a header comment: *"The design draws 'months 2 to 6' and 'month 7 onward'. That is design correction **D2 — live wins, 10% for twelve months**."* The page repeats it at `src/app/[locale]/referrals/page.tsx:198-200`. But **NEW-MODEL.md is dated 6 August 2026 and opens "Read this before touching any screen"** — it post-dates that correction and restates 2-to-6. Either NEW-MODEL is stale on this line or D2 is. One of the two documents has to move; right now the codebase cites an overruled correction as its authority for a money rate. Escalating rather than ruling.

### D2 — The screen states the wrong commission base · MONEY (copy only)

`messages/en.json:1324`-region key `commissionBasis`:

> `"Percentage of the referred center's monthly payment"`
> AR: `"نسبة من دفع السنتر المُحال الشهري"`

"Monthly payment" is the VAT-**inclusive** figure. NEW-MODEL requires the base to be the plan value **excluding** VAT, and the design's footer note says so explicitly.

The **arithmetic is correct** — `src/lib/referralNetBase.ts:10-13` divides `all_in_price` by 1.14 before applying the rate. So this is a correct calculation with a wrong explanation attached: a referrer reading the screen and multiplying their own plan price by 25% will get a number ~14% higher than what lands, and will open a ticket. Both locales.

### D3 — The no-cash lock is never stated; the screen states the opposite

NEW-MODEL: *"Credit is applied to platform invoices automatically and cannot be withdrawn as cash… State the lock before it bites."* NEW-FEATURES §6 repeats it as a design decision worth keeping.

Rendered on `/en/referrals` and `/en/settings/referrals`:

> `Request Withdrawal` · `A flat 20 EGP processing fee is deducted first, then a 5% withdrawal fee on the remainder. Minimum withdrawal: 1,000 EGP.` · `Processing within 3-5 business days`

Nowhere on either screen, in either locale, does any string say the balance is applied to platform invoices automatically or that it cannot be taken as cash.

**Per the settled rules I am not calling the withdrawal UI a dead model** — payout/withdrawal vocabulary is live for referral credit, and NEW-MODEL's own "Still open" section puts cash-out with the tax advisor. The reportable defect is narrower and holds either way: **the model's mandated lock statement is absent**, and the "How It Works" surface that was supposed to carry it says nothing about how the balance is spent. If cash-out stays, this copy needs the settlement rule stated; if it goes, the copy is actively wrong. Today it is neither stated nor contradicted — it is simply missing.

Two secondary notes on the same panel:
- The **20 EGP processing fee is being applied to an outbound withdrawal**. NEW-MODEL scopes that fee to "every invoice the platform issues to a center or teacher". A withdrawal is not an invoice the platform issues. Worth a ruling.
- The month-1 hold **is** implemented (`process-commission/route.ts:128-129`, `addDays(firstPaidDate, 30)` → status `hold`) but **only for month 1**; months 2+ insert straight to `withdrawable` with no hold. NEW-MODEL states the settlement window unconditionally. A refund in month 5 would find the credit already spendable — exactly the failure the rule exists to prevent. Only `/settings/referrals` mentions the hold at all (`Month 1: 25% - held for 1 month before withdrawal`); `/referrals` never mentions it.

### D4 — No per-row arithmetic on referral rows · NOT BUILT

Design: each row carries **plan ex-VAT · rate applying this month · what that produces**, so the referrer sees the arithmetic instead of a figure appearing.

Live table columns (`src/app/[locale]/referrals/page.tsx:238-242`): `Center · Status · Months · Monthly reward · Total`. There is **no plan-ex-VAT column and no rate column** — only the produced number. This is not-built, proven from source; the rendered empty state (`"No referrals yet"`) is why the frame itself is blocked as no-data.

### D5 — No funnel filter chips · NOT BUILT

Design: `All · Signed up · On trial · Paying`. Grep across `src/app/[locale]/referrals/page.tsx` for filter/chip/tab state returns nothing — the only status handling is the per-row badge at lines 254-270. No chips exist in either locale. (See §5 R2 — the chips as drawn would not have matched the backend anyway.)

### D6 — Monthly-revenue chart draws axes but no data series · BOTH LOCALES

`crop_chart_en.png`, `crop_chart_ar.png`. Axis ticks render (`0 / 15,000 / 30,000 / 45,000 / 60,000 EGP`, `Apr 2026 / Jun 2026 / Aug 2026`) and the plot area is **completely empty**. The same page's P&L table shows Jul 2026 = 57,800 EGP and Aug 2026 = 15,400 EGP, so there is data to plot and the Y-axis is scaled for it.

Not a capture artefact: `ok:true`, no page errors, 6 s settle, and every sibling label in the same SVG painted.

In EN the Y-axis labels are additionally **clipped on the left** (`0,000 EGP` where `60,000 EGP` belongs) and `Aug 2026` is clipped at the right card edge — the chart is laid out wider than its card. In AR the labels are intact but the plot is equally empty.

### D7 — Payment-methods donut does not draw · BOTH LOCALES

`crop_donut_en.png`, `crop_donut_ar.png`. A tall blank region — most of the card — sits under the "Payment methods" heading where the donut belongs. Only the legend paints: `cash 47,400 EGP · 65%` / `instapay 25,800 EGP · 35%`. Same class of failure as D6.

### D8 — Revenue-by-Group bars do not draw

`crop_group_en.png`. Group labels (`Physics 1`, `Mathematics A`, `Chemistry A`, `Biology A`, `English A`) and dotted gridlines render; **no bars**. The `28,000 EGP` axis label is clipped at the card's right edge.

D6, D7 and D8 together mean **every chart on the Analytics page is unreadable** while the numeric cards beside them are correct. Given the shared symptom (axes/legends paint, marks do not) these are likely one root cause, but I did not isolate it.

### D9 — Untranslated payment-method labels on the Arabic screen

`crop_donut_ar.png`: the legend on `/ar/analytics` reads Latin **`cash`** and **`instapay`** — raw enum values — beside correctly localised Arabic-Indic amounts (`٤٧٬٤٠٠ ج.م · ٪٦٥`). Arabic typography is a product rule; a raw English enum in the legend of an otherwise fully-Arabic screen breaks it.

### D10 — Mixed numeral systems on the Arabic referral screens

Both `/ar/referrals` and `/ar/settings/referrals` render:

> `المعالجة في غضون 3-5 أيام عمل`

Western `3-5` inside an Arabic sentence, on screens where every other figure is Arabic-Indic (`٢٥٪`, `٢٠`, `١٬٠٠٠`, `٠ ج.م`). Source: `messages/ar.json:6259` — the digits are hardcoded in the string.

Worse, on `/ar/settings/referrals` the mismatch is **inside one card**: `عدد السناتر المُحالة` → **`0`** (Western) directly above `إجمالي المبالغ المكتسبة` → **`٠ ج.م`** (Arabic-Indic). Cause is one line: `src/app/[locale]/settings/referrals/page.tsx:282` renders `{referrals.length}` raw, while line 288 correctly routes through `formatCurrency`. `formatNumber` is already imported on line 13 of that same file. This is a direct CLAUDE.md violation ("All number/date formatting goes through `formatNumber.ts` helpers").

### D11 — P&L card uses off-token colours and fails contrast

`crop_pnl_sum_en.png`: income/net render in a neon Tailwind green and expenses in a salmon red, against the warm `#FFFDF8` paper surface — visibly foreign to every other card on the page, which uses `var(--color-text-*)`.

```
$ grep -o "text-green-400" src/components/analytics/PnLCard.tsx | wc -l   → 4
$ grep -o "text-red-400"   src/components/analytics/PnLCard.tsx | wc -l   → 4
```

8 hardcoded off-token classes (4 + 4) at `PnLCard.tsx` lines 123, 127, 133, 161, 164, 169. `design/TOKEN-SPEC.md:116,122` defines `good = #1A6D4D` and `danger = #9C3322`.

Contrast against the `#FFFDF8` surface, computed this session (WCAG relative-luminance formula): `text-green-400` `#4ADE80` → **1.71:1**; `text-red-400` `#F87171` → **2.72:1**. AA for body text is 4.5:1, and these are the numbers a centre owner reads their profit off.

### D12 — Brand wordmark is overlapped by the header buttons on every screen

`crop_header_en.png`: the header renders **`Tutoring H`** — the `Q` sits under the notification-bell button. The text node exists in the DOM (rendered text shows `Tutoring` / `HQ` as separate nodes) but is occluded. Present at 390 px on all four live screens in this file's scope, both locales (in AR only `Tutoring` is visible). Global chrome, not specific to these pages, but it is in every frame I rendered.

### D13 — Arabic referral share link drops the locale prefix

`src/app/[locale]/referrals/page.tsx:126-127`:

```ts
const localePrefix = locale === 'ar' ? '' : `/${locale}`;
const referLink = `${appUrl}${localePrefix}/refer/${data?.referralCode ?? ''}`;
```

An Arabic user shares `https://tutoringhq.app/refer/XRD3OKMK` with no locale segment, while `src/i18n/routing.ts:12` sets `localePrefix: 'always'` and the only page is `src/app/[locale]/refer/[code]/page.tsx`. **I did not fetch the unprefixed URL**, so whether the middleware redirect rescues it is unverified — but the product's most-shared URL is generated in violation of the routing rule the codebase states for itself, and at best costs a redirect hop.

### D14 — Two live referral screens for one designed section

`/referrals` and `/settings/referrals` are both live, both reachable (sidebar Setup group / Settings hub), with different layouts and **different commission copy** — only `/settings/referrals` mentions the month-1 hold. `design/DUPLICATE-ROUTES.md:75-94` already tracks this pair and rules `/referrals` the survivor, with the per-commission download to be ported. Still open; re-confirmed rendered in both locales.

---

## 5 · Divergences ruled AGAINST THE DRAWING (stale design)

### R1 — The 149 EGP and 99 EGP add-on paywalls are stale

The file's own mastheads sell them: Analytics is *"A premium add-on, not a plan tier… The gate is now an Advanced Analytics add-on you switch on for a flat monthly price"* (149 EGP/mo, frame §01 f3); Benchmarks is *"A paid add-on, like Advanced Analytics… billed via Paymob"* (99 EGP/mo, frame §02 f1).

`NEW-MODEL.md:177` — **"Analytics, benchmarks, team seats | 0 for now. Priced later."**

**Answering the brief's item 7 directly: the live app does NOT show these as paid or locked add-ons, so there is no divergence to report in that direction.** `/en/analytics` rendered the full unlocked page — MRR, collection gauge, methods, heatmap, revenue by group, P&L with CSV export, aging report. No gate, no price, no upsell. Neither `149` nor `99` appears anywhere in `src/lib/pricing*`. **Live is right and the drawing is stale.** Both paywall frames should be struck.

### R2 — The benchmarks lock is a district lock, not a paywall — and live's version is better

Design §02 f1 locks Benchmarks behind payment. Live locks it behind a **prerequisite**: *"Set your district to unlock real benchmarks… Please set your district in settings to enable benchmark comparison"*, with a Settings CTA and a "Learn more" link. Properly translated and mirrored in AR (`حدّد منطقتك لتفعيل المقارنات الحقيقية`).

This is the honest lock — percentiles against 34 nearby centres are meaningless without knowing which centres are nearby, and the code enforces a real floor (`DISTRICT_TARGET = 10`). Redraw the locked frame as the district prompt.

### R3 — The funnel chips as drawn do not mirror the live backend states

The design's own rationale (`NEW-MODEL.md`, NEW-FEATURES §6) is that the chips *"mirror the real backend states"*. The drawn chips are `Signed up · On trial · Paying`. The live `referrals.status` values handled at `src/app/[locale]/referrals/page.tsx:254-270` are **`pending` · `active` · `converted` · `disputed`** — no trial state at all, and a `disputed` state the design has no chip for.

So D5 (chips not built) cannot be closed by building the drawn chips: the drawing needs redoing against the real states first, including a `disputed` chip. Both documents are wrong in opposite directions.

### R4 — The payment-methods donut legend is dead model *and* internally broken

Design §01 f1 legend, six slices: `TutoringHQ online 41% · Cash 18% · Instapay 12% · InstaPay 13% · InstaPay 10% · Card 6%`.

Two problems. **"TutoringHQ online" (41%) and "Card" (6%) are dead** — NEW-MODEL kills online collection through a gateway and card as a tuition method outright. And the drawing lists **`Instapay` / `InstaPay` / `InstaPay` three times** as separate slices with three different colours and three different percentages, which is a copy-paste error in the design, not a product concept.

Live shows exactly two methods — `cash 65%` / `instapay 35%` — which is precisely the "two tuition methods only" rule. Live is right; the drawn legend should be replaced with the two-slice version.

### R5 — "Two metrics only" vs live's four (design rule, live diverges)

Ruling this one **against the app**, but recording it here because it is a design-decision item rather than a model rule. NEW-FEATURES §6: *"Two metrics only on the dashboard, referrals and balance. A third competes with the link."* Live renders **four** KPI tiles: `Total Referrals · Pending · Withdrawable · Total Earned`.

Compounding it, live pushes the share link/code **below** Active Referrals and Reward History — past the midpoint of a 2,365 CSS-px page (4,730 px capture at 2× DPR) — whereas the design puts it third from the top, directly under the hero, precisely because it is the primary action. The design's stated reasoning survives contact with the live page: four tiles and a buried link is exactly the dilution the rule was written to prevent.

Also missing from live: the gradient hero stating the deal in one line, and the this-year / lifetime split from the sheet.

### R6 — Design's `tutoringhq.app/r/nileprep` vs live `/refer/XRD3OKMK`

Design: *"The link carries the account's own name so it can be shared as-is."* Live issues an opaque 8-char code on a longer `/refer/` path. Low severity and arguably the safer choice — a name-derived link is guessable and enumerable, an opaque code is not. Flagging the mismatch, recommending the drawing change rather than the app.

### R7 — Live is ahead of the drawing in two places

The Attendance Heatmap on `/en/analytics` and `/ar/analytics` is not drawn anywhere in §01. The Aging Report's **bulk** "remind all" action (`AgingReport.tsx:120, 147`) is also undrawn — the design shows only per-band Remind buttons. Both worth back-filling into the design.

---

## 6 · Referral Program — direct answers

**Does the live app implement the recurring 25/10/5 model or an older one-time reward?**
**Recurring percentage, not one-time.** Confirmed at three layers: rendered chips on `/en/referrals` and `/ar/referrals` (`25% Month 1 → 10% Months 2-12 → 5% Month 13+`), the constant table `COMMISSION_TIERS` (`referralProgram.ts:39-43`), and the only writer of `commission_rate` (`process-commission/route.ts:106-108`). The engine is the right shape. **The middle tier's boundary is wrong** — 10% runs to month 12 instead of month 6, so months 7–12 pay double the modelled rate. See D1: this is a documented deviation ("D2 — live wins") that NEW-MODEL, dated later, contradicts. Needs a ruling, not a patch.

**Does each tracking row show plan ex-VAT + the rate applying this month + what it produces?**
**No.** The row shows `Center · Status · Months · Monthly reward · Total` (`referrals/page.tsx:238-242`) — the produced figure with no visible arithmetic. Plan ex-VAT and rate columns are not built. The referrer sees a number appear, which is exactly what the design set out to prevent. Compounding it, the one place the basis *is* stated (`commissionBasis`) states it **wrongly** as "monthly payment" rather than plan value ex-VAT (D2), even though the backend correctly divides by 1.14. Rendered evidence is the empty state (`"No referrals yet"` / `"لا توجد إحالات حتى الآن"`) — 0 referrals on this tenant — with the column set proven from source.

**Is the no-cash-withdrawal lock stated in the sheet before anyone tries?**
**No — and there is no sheet.** The design's bottom sheet does not exist; live has an inline "How It Works" card on `/referrals` and a bullet list on `/settings/referrals`. Neither says the balance is applied to platform invoices automatically, and neither says it cannot be withdrawn as cash. What the screen *does* say is `Processing within 3-5 business days` alongside a `Request Withdrawal` button and fee schedule. I am **not** ruling the withdrawal UI dead model — that vocabulary is settled as live for referral credit, and NEW-MODEL itself parks cash-out as "Still open". The defect that holds regardless of how that lands: the mandated lock statement is absent, in both locales, on both routes (D3).

**Are the funnel filter chips present and do they mirror real backend states?**
**Not present.** No filter/chip/tab state exists in `referrals/page.tsx`; only per-row status badges (lines 254-270). And the chips **as drawn would not have mirrored the backend anyway** — the drawing offers `Signed up · On trial · Paying` while the live states are `pending · active · converted · disputed`, with no trial state and an undrawn `disputed` state (D5 + R3). Both the code and the drawing need work here, in that order.

**Rendered, in support of the above:** `/en/referrals`, `/ar/referrals`, `/en/settings/referrals`, `/ar/settings/referrals` — all four `ok:true`, screenshots and rendered text in `/tmp/rediff/center-insight/g2/`, tier-chip close-up at `/tmp/rediff/center-insight/crop_ref_comm_en.png`.

## 7 · Analytics / Benchmarks pricing (brief item 7)

**No divergence in the direction asked about.** NEW-MODEL prices both at 0 for now, and the live app charges for neither. `/en/analytics` rendered fully unlocked with no gate, no price and no upsell; `advanced_analytics` exists at `src/lib/plans.ts:53` and is referenced nowhere else in `src/`, making it a dead flag rather than an enforced tier. `/en/benchmarks` is gated on a **district setting**, not payment. Neither `149` nor `99` appears in `src/lib/pricing*`.

The divergence runs the other way: the drawing still sells a 149 EGP Analytics add-on and a 99 EGP Benchmarks add-on billed via Paymob. Both frames are stale (R1, R2).

---

## Suggested order

1. **D1** — rule on the 10% boundary (months 2-6 vs 2-12). Money, and it is currently paying out on the wider band. Whichever way it goes, one of `NEW-MODEL.md` or the `D2` comment must be corrected so the next agent does not re-litigate this.
2. **D2** — one-string fix, both locales; stops a predictable support queue.
3. **D6 / D7 / D8** — every chart on Analytics is blank. Likely one root cause.
4. **D3** — state the lock (or state the settlement rule) once cash-out is settled with the tax advisor.
5. **D10, D11, D12** — i18n numerals, off-token colours, wordmark occlusion. Small, mechanical, each provably one or two lines.
6. **D4 / D5 + R3** — redraw the chips against real backend states, then build rows and chips together.
7. **R1 / R2 / R4** — strike the two paywall frames, redraw the benchmarks lock as the district prompt, replace the six-slice donut legend with the live two-slice one.

*Incidental, found by grep and **not** rendered on any route in this file's scope, so not counted as a finding here: `messages/ar.json` carries `"totalEarned": "إجمالي Earned"` in the `nav`, `common`, `billing` and `cardOrders` namespaces, plus `"creditsEarned": "رصيد Earned"` under `downgrade` — half-translated strings that will surface as English words on Arabic screens elsewhere. Worth a separate ticket against whichever file re-diffs those namespaces.*
