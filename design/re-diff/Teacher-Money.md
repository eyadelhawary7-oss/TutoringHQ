# Teacher-Money — re-diff against the live app

**File:** `/home/user/TutoringHQ/design/Merged-Teacher-Money.html` (PROTECTED — carries money)
**Role:** teacher **Aly Shady** `+201220601810`, state `/tmp/state-teacher.json`
**Captures:** `/tmp/rediff/teacher-money`, `/tmp/rediff/teacher-money2`, `/tmp/rediff/teacher-money3`
**Date of run:** 8 August 2026

## 0. Provenance — the KNOWN sweep is confirmed done

```
$ git log --oneline -3 -- design/Merged-Teacher-Money.html
b48944df design(protected): Teacher-Money, drop the verified income variant (#374)
cd92da4c Add files via upload
9e028aff Teacher-Groups: re-verify D18-D21 live, ~2.2/5 unchanged ... (#323)
```

Verified against the file as it is now, not against the note:

```
$ grep -o -i 'payout\|Thursday\|CIB\|4821\|90/10\|verif[a-z]*' design/Merged-Teacher-Money.html | sort | uniq -c
(no output)
```

Zero hits. The payout ledger ("Your balance 4,250 EGP · ready for your next payout", "Bank
payout · CIB ••4821") and both `verified` income variants are gone. Screen 01's masthead now
says "Income, one state, because there is only one". **The drawing is clean of dead model.**
The ladder is clean too — the only month labels in the file are `month 3` and `month 7`, both
consistent with 25% / 10% (m2–6) / 5% (m7+). No months 2–12, no month 13.

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Teacher-Money.html | wc -l
34
```

## 2. All 9 screens, frames per section

| # | Screen | Frames |
|---|---|---|
| 01 | Teacher Income | 2 |
| 02 | Teacher Earnings Calculator | 2 |
| 03 | InstaPay Uploaded Receipts | 4 |
| 04 | InstaPay Batch List | 4 |
| 05 | InstaPay Fee Total | 4 |
| 06 | Active Balance | 4 |
| 07 | Send Credit | 6 |
| 08 | Balance History | 4 |
| 09 | Teacher Billing | 4 |
| | **SUM** | **34** |

Per-section counts produced by splitting the body on `<div class="mgd-bar">` and counting
`class="phone"` inside each chunk; the parts sum to the 34 the file-wide grep reports.

## 3. Exercise ledger

`Drawn: 34 | Exercisable: 6 | Exercised: 6 | Blocked: 28`

**Blocked, every frame named:**

| Frames | Screen · state | Reason |
|---|---|---|
| 2 | 02 Teacher Earnings Calculator — EN, AR | `tooling` |
| 4 | 03 Uploaded Receipts — list EN/AR, detail EN/AR | `not-built` |
| 4 | 04 Batch List — before-upload EN/AR, read-and-matched EN/AR | `not-built` |
| 4 | 05 Fee Total — accrued EN/AR, how-to-pay EN/AR | `not-built` |
| 2 | 06 Active Balance — dashboard EN, dashboard AR | `not-built` |
| 2 | 06 Active Balance — pay-invoice EN, pay-invoice AR | `tooling` |
| 6 | 07 Send Credit — search EN/AR, amount EN/AR, confirmation EN/AR | `not-built` |
| 4 | 08 Balance History — ledger EN/AR, transfer-detail EN/AR | `not-built` |

24 `not-built` + 4 `tooling` = 28. 6 exercised + 28 blocked = 34.

**Why the two `tooling` entries are `tooling` and not "missing":**

* **02** — the live counterpart is `src/app/[locale]/teacher/IncomeCalculator.tsx`, mounted on
  `/teacher` (teacher home) at `(portal)/page.tsx:517`. That route is not in the assigned nine,
  so it was never photographed. **It is built** — established by reading source, not by capture.
* **06 pay-invoice** — `/en/teacher/pay` was attempted three times. Attempt 1 landed on
  `/en/login` (manifest `redirectedToLogin: true`, 141 chars). Attempts 2 and 3 timed out
  (`page.goto` 240 000 ms). A warm-up `curl` also aborted at 401 s. **NOT MEASURED.** Separately
  and independently of the capture, `grep -in 'balance\|credit' src/components/billing/CustomerInvoicesView.tsx`
  returns nothing, so the drawn credit-application line is provably absent from the component —
  but that is a source finding, not a screenshot finding.

**Capture manifest, all attempts:**

| Route | Result |
|---|---|
| `/en/teacher/income` | OK, 554 chars |
| `/ar/teacher/income` | OK, 519 chars |
| `/en/teacher/billing` | OK, 1562 chars (`401 /api/summer/my-first-invoice`) |
| `/ar/teacher/billing` | OK, 1389 chars (`401 /api/summer/my-first-invoice`) |
| `/en/teacher/pay` | **REDIRECTED-TO-LOGIN then 2× timeout — NOT MEASURED** |
| `/en/teacher/centers` | OK, 757 chars |
| `/ar/teacher/centers` | (see §3b) |
| `/en/teacher/subscription/upgrade` | (see §3b) |
| `/en/teacher/resubscribe` | (see §3b) |

The box was at load average 43 on 4 cores throughout (a ten-agent fan-out). First compiles of
the cold routes, measured by warm-up curl, were **279 s** (`/ar/teacher/centers`) and **157 s**
(`/en/teacher/subscription/upgrade`) — above the harness's 240 s ceiling, which is why the
first two batches failed. None of those three routes carries a frame from this file; they are
adjacent money routes, and their status is recorded in §3b for completeness only.

### 3b. Adjacent-route capture results

_(filled in below)_

---

## 4. Per-screen verdict

### 01 · Teacher Income — **EXISTS LIVE, both locales**

`/en/teacher/income` and `/ar/teacher/income` both render real data for Aly Shady: Lifetime
earned 700 EGP, Best month 700 EGP (June 2026), Monthly average 233 EGP, Collected this month
0 EGP, Outstanding 1,000 EGP, and three group rows (Physics Sun 4PM, Physics, usdjej). The
Arabic frame is correctly RTL with Arabic-Indic numerals. `Upgrade to export` / `الترقية للتصدير`
matches the drawing's `.exp` chip.

Not present live: the drawing's **nudge card** ("Tired of chasing that 900? · Send each parent
their InstaPay link · [Send]"). `grep -n 'instapay\|nudge\|remind\|Send' IncomeView.tsx` returns
only a `markPaid.instapay` method label. Layout differs — the drawing puts three KPIs in one
row, live puts Lifetime full-width with two beneath. Group rows differ in shape (drawing:
amount + "Outstanding N"; live: "Collected: X   Outstanding: Y").

### 02 · Teacher Earnings Calculator — **EXISTS LIVE, on a different route, with dead-model math**

`src/app/[locale]/teacher/IncomeCalculator.tsx`, mounted at `(portal)/page.tsx:517`. Two
sliders (students, fee per session) and an estimated-income readout — structurally the drawing
minus the plan picker.

**It carries a 5% platform cut of tuition.** `IncomeCalculator.tsx:21`:

```ts
const centerHqFee = Math.round(gross * 0.05);
```

rendered through `teacherPortal.calculator.feeNote`, present in **both** locales:

* en — `TutoringHQ fee: {fee} (5% on digital, zero on cash)`
* ar — `رسوم TutoringHQ: {fee} (٥٪ على الدفع الرقمي، صفر على الكاش)`

This is the killed model. `NEW-MODEL.md` § What died: "The 90/10 split — the platform does not
take a percentage of tuition"; "7.5% markup and 1.5% parent processing — both replaced by a
flat 10 EGP." The drawing's own point is the inverse of this: it shows the **plan price** as a
shrinking percentage of the teacher's income ("Your plan is about 2% of that … at 30 students
it drops to about 1%"), with the platform taking nothing from tuition. The live screen tells a
prospective teacher the platform takes a fifth of a tenth of every digital pound they earn.

### 03 · InstaPay Uploaded Receipts — **NOT BUILT**

```
$ find src/app -type d -name '*receipt*'
src/app/api/orders/[orderId]/receipt          ← card orders, unrelated
$ grep -ril 'uploaded_receipt\|instapay_receipt\|confirm_receipt\|receiptUpload' src/ supabase/migrations/
(no output)
```

No list, no detail, no image view, no Confirm/Flag buttons, no Pending/Confirmed/Flagged
states, no table. The teacher half of "nothing becomes a payment until the provider confirms
it" does not exist.

### 04 · InstaPay Batch List — **NOT BUILT**

No upload surface, no reader, no matched/needs-review rows, no `batch` route, API or table.

### 05 · InstaPay Fee Total — **NOT BUILT**

The 10 EGP service fee does not exist anywhere in the application except a single explanatory
comment:

```
$ grep -rn '10 EGP' src/ messages/
src/app/[locale]/ceo/CeoBoardSection.tsx:21: *   payment is the flat 10 EGP service fee billed to the PARENT, and it is not
```

No accrual counter, no confirmed-vs-cash-vs-failed breakdown, no ride-on-subscription-versus-
separate-invoice choice, no 370 / 1,289 / 390 arithmetic. Nothing.

### 06 · Active Balance — **NOT BUILT (dashboard) / NOT MEASURED (paying page)**

* **Dashboard frames** — `(portal)/page.tsx` has no balance surface at all. Its money-adjacent
  imports are `IncomeCalculator`, `CollectForYouCard` and `VerificationBadge`. There is no
  "Your balance … applied to invoices" card and no "Send credit" footer button.
* **Paying-page frames** — `/teacher/pay` exists (`teacher/pay/page.tsx` → shared
  `CustomerInvoicesView` against teacher endpoints) but was never measured; see §3. Source
  evidence, independent of the capture: `CustomerInvoicesView.tsx` contains no `balance` or
  `credit` string, and `api/teacher/billing/customer-invoices/route.ts` mentions balance only
  as `remainingBalance` (invoice underpayment). The drawn "Your balance −1,289.00 → Due 0.00"
  line has no implementation to render it.

`NEW-FEATURES.md` §7's rule — credit applied **before** the total, never offered afterwards —
has nothing to apply it to on the teacher side.

### 07 · Send Credit — **NOT BUILT**

```
$ grep -ril 'send_credit\|sendCredit\|credit_transfer\|creditTransfer' src/ supabase/
src/app/api/admin/billing/route.ts        ← unrelated admin billing
```

No account search by name/phone, no amount screen, no confirmation, no `TRF-` reference, no
transfer table. The five rules on the drawing's own Rules card have no code to govern.

### 08 · Balance History — **NOT BUILT**

No ledger route, no filter chips (All / Received / Sent / Referrals / Invoices), no transfer
detail, no shared reference, no append-only ledger table.

### 09 · Teacher Billing — **EXISTS LIVE, both locales**

`/en/teacher/billing` and `/ar/teacher/billing` render the plan card (Standard · Trial ·
Period start 20 July 2026 · Period end 3 August 2026), a Monthly/Annual segmented control with
"Annual: 416 EGP/mo, billed 4,990 EGP/year · 2 months free", the three plan cards, and a
history list. The annual figures match the drawing's sheet exactly (4,990 / 416 per month /
2 months free).

Differences are listed in §6.

---

### Summary of the InstaPay + credit half

| Drawn screen | Live |
|---|---|
| 03 Uploaded Receipts | **unbuilt** |
| 04 Batch List | **unbuilt** |
| 05 Fee Total | **unbuilt** |
| 06 Active Balance | **unbuilt** |
| 07 Send Credit | **unbuilt** |
| 08 Balance History | **unbuilt** |

Six of the nine screens — 26 of the 34 frames — have no counterpart in the application. The
database has moved (see §5), the interface has not.

---

## 5. Fee conflation, and claims that the platform verified a payment

### 5a. The 10 / 20 conflation — **the app does not conflate them**

`resolveProcessingFeeAmount` / `getProcessingFeeConfig` have 63 call sites outside
`processingFee.ts` and `pricingConfig.ts`, across 27 files. Every one is a platform→customer
invoice: subscriptions, upgrades, resubscribe, switch-interval, card-order checkout, parent
packs, reactivation, referral payout, renewals cron. **None is a parent tuition path.**
`collectionMath.ts:36-38` states the rule explicitly and imports none of them.

There is no 10 EGP service fee in the app to conflate with. The conflation risk is not
realised — because half the pair does not exist yet.

### 5b. **The app carries a parent percentage fee that the model killed**

`src/lib/collectionPayout/collectionMath.ts`, header, still encodes the locked-26-July rate
card:

```
provider fee                 X
collection fee        0.10 × X
price markup          0.075 × X + 7.5
parent processing fee 0.015 × provider price + 1.5
```

That is the 10% collection cut, the 7.5% markup and the 1.5% parent processing that
`NEW-MODEL.md` lists as dead, all three still in code. It is not reachable from any of the nine
teacher routes — its importers are the centre `/dashboard`, `api/collection/*`,
`api/admin/center-payouts/*`, `api/payouts/request` and `api/cron/payout-reconciliation` — but
it is live code implementing a killed rate card.

### 5c. **The app claims the platform collects, verifies, and pays out — on teacher routes**

Three live surfaces, both locales:

**`/teacher` (teacher home), `(portal)/page.tsx:302`** — `CollectForYouCard`, rendered whenever
`!verification.isVerified`:

* en — "Let us collect for you. **Verify your ID and TutoringHQ collects every student payment
  through the app, then pays you automatically.** No more chasing parents."
* ar — "دعنا نحصّل نيابةً عنك … وثّق هويتك وسيحصّل TutoringHQ كل مدفوعات الطلاب عبر التطبيق، ثم يحوّلها إليك تلقائياً."
* subline — "Hassle-free · paid straight to you · **we handle the tax receipt**"

`NEW-FEATURES.md` § Screens deleted: "**Center Collect ForMe** — Said the platform collects and
processes money to your bank every Thursday and issues a tax receipt. **Every clause false.**"
The screen was deleted from the designs; the copy is still shipping on the teacher home.

**`/teacher/settings`, lines 391 and 457** — `VerificationBadge` (`Verified` / `Not verified` —
the two-state account model that `NEW-MODEL.md` says "does not exist") and `CollectPaymentsRow`,
whose on-state subtitle reads:

> "On. We invoice parents and **process your payout every Thursday**."

**`verification.cta.whatYoullNeed`** — "About 2 minutes · commercial registration or National ID
· **secured by Valify**." Valify is named in `NEW-MODEL.md` as gone.

`CollectForYouCard.tsx`'s own docstring points at the design state that no longer exists: "The
VERIFIED frame (balance card, Pending/Available, Thursday payouts, recent payouts) is
`Merged-Teacher-Money` — PROTECTED, deliberately not built here." That frame was swept out of
this file in `b48944df`. The live app is anchored to a drawing that has since been corrected.

**Nothing in the live app claims to have verified a *payment*** — there is no receipt-reading
path at all, so the specific §3 failure mode ("the platform verified this transfer") cannot
occur. What it claims is that the platform verifies *identities* and collects and settles
*tuition*, which is the larger dead model.

### 5d. Referral-credit withdrawal is live — **but not for teachers**

`referralProgram.ts:10` already carries the corrected ladder: "month 1 → 25% · months 2 to 6 →
10% · month 7 onward → 5%". `referralPayout.ts` implements withdrawal —
`net = (gross − 20 EGP processing fee) × (1 − 0.05)`, minimum gross 1,000 EGP — and
`ReferralWithdrawalPanel` renders it. Its only two mounts are `/referrals` and
`/settings/referrals`, both **centre** routes, which `src/proxy.ts` walls teachers out of
(`userRecord.role === 'teacher'` may not reach centre prefixes). A teacher's only referral
surface is `ReferralCard.tsx`, a share-link card with no balance and no withdrawal.

So the live model is *narrower* than the drawing on one axis and *wider* on another: teachers
cannot withdraw, and the drawing's flat "credit cannot be withdrawn as cash, by you or by them"
lock copy (screen 07, twice, plus the Rules card) contradicts the live centre behaviour.

---

## 6. Divergences

### 6a. Against the app — live app wrong, drawing right

| # | Finding | Evidence |
|---|---|---|
| A1 | **Platform takes 5% of digital tuition** on the teacher home calculator, both locales. Killed model. | `IncomeCalculator.tsx:21` `Math.round(gross * 0.05)`; `teacherPortal.calculator.feeNote` en+ar |
| A2 | **"TutoringHQ collects every student payment … then pays you automatically … we handle the tax receipt"** on the teacher home. This is the deleted Collect-ForMe screen. | `verification.collectForYou.body`/`.subline`, en+ar; `(portal)/page.tsx:302` |
| A3 | **"We invoice parents and process your payout every Thursday"** in teacher settings. | `verification.settingsRow.subtitleOn`; `(portal)/settings/page.tsx:457` |
| A4 | **Identity verification live**: `Verified` / `Not verified` badge and "secured by Valify" CTA on teacher home and settings. | `verification.badge.*`, `verification.cta.whatYoullNeed`; settings lines 391, 457 |
| A5 | **Stale subscription price in live copy — 299 EGP.** Three strings in both locales say the private engine is 299 EGP/month while `teacherPlans.ts` charges 499 and the billing screen renders 499. Photographed on `/en/teacher/centers`: "The private engine starts at 299 EGP/month." | `teacherPortal.privateUpsell.priceLine`, `teacherPortal.createGroup.trialLine2`, `freeZone.centersBanner`; `TEACHER_PLANS.teacher_standard.priceGross = 499` |
| A6 | **Killed rate card still in code**: 10% collection cut, 7.5% markup, 1.5% + 1.5 EGP parent processing. Not on a teacher route. | `collectionPayout/collectionMath.ts:9-20` |
| A7 | **No 20 EGP processing fee shown on the teacher billing screen.** The drawing's "then 499 + 20/mo" has no live equivalent; `grep -rn 'processingFee' src/components/teacher/ src/app/[locale]/teacher/` returns nothing. The fee *is* computed by `api/teacher/billing/customer-invoices` — but only surfaces on `/teacher/pay`, which could not be measured. | grep, and route source |
| A8 | **Six drawn screens unbuilt** — 03, 04, 05, 06, 07, 08 (26 of 34 frames). | §4 |
| A9 | **Arabic Latin leaks on the live billing screen**: `teacherBilling.planPro = "Pro"`, `planScale = "Scale"`, `bestForPartTimeBadge = "الأنسب للـ Part-Time"`, `upgradeCta = "رقّي إلى Pro"`. The drawing translates all four (احترافي / توسّع / الأنسب لغير المتفرّغ / الترقية إلى الاحترافي). (`CSV` is untranslated in both, so it is not a divergence.) | `messages/ar.json` `teacherBilling.*`; `ar_teacher_billing.png` |
| A10 | **`/en/teacher/centers` money panels fail to load** — "What centers owe me" and "Center attendance records" both render "We could not load your portal. Please try again." with a Try-again button. This is the teacher's centre-side receivables view. | `en_teacher_centers.png` |
| A11 | **`/en/teacher/pay` hard-redirects to `/en/login`** when `authHeader()` returns null. `authHeader` does a network `supabase.auth.getUser()` and treats any failure as "logged out", so a slow Supabase round-trip evicts a signed-in teacher from her own invoice page rather than showing an error. | `CustomerInvoicesView.tsx:80-88, 116-118`; manifest `redirectedToLogin: true` |

The database is already on the new model — `20260808020632_drop_split_model_columns.sql` dropped
`platform_gross`, `platform_net`, `customer_commission_amt`, `teacher_commission_amt`,
`snap_customer_pct`, `snap_teacher_pct`, `teacher_net` from `public.transactions`, and
`20260807185735` narrowed tuition methods to `cash | instapay`. **A1–A4 and A6 are the interface
still telling teachers about a split the schema no longer has columns for.**

### 6b. Against the drawing — drawing wrong or incomplete

| # | Finding | Evidence |
|---|---|---|
| D1 | **Screen 09's Scale tier is stale.** Drawing: "up to 150 active students, then +16 EGP per active student above 150". Live: cap 100, +20 EGP. Both locales of the drawing. | `teacherPlans.ts` `teacher_scale: studentCap: 100, overagePerStudent: 20`; `en_teacher_billing.png` |
| D2 | **Screen 09's Pro WhatsApp benefit is stale.** Drawing: "50 WhatsApp messages a month". Live: "100 EGP WhatsApp credit monthly". | `teacherPlans.ts` `teacher_pro.blastCreditsMonthly: 100` |
| D3 | **Screen 03 omits the copy `NEW-FEATURES.md` §3 makes mandatory.** The detail frame shows the image, four fields and a Confirm button with no line saying the platform only read the image, did not verify the money moved, and that the provider should confirm after seeing it in their own account. `grep -ci 'did not verify\|your own account\|read the image'` over the whole file → **0**. This is the single most important sentence in the InstaPay flow and it is not drawn. |
| D4 | **The duplicate-reference flow is not drawn at all.** `grep -ci 'duplicate'` → 0. §3 calls it "the one flag where being wrong costs a real family real money"; the drawing has a red `Flagged` pill on Omar Khaled and nothing behind it — no both-images screen, no both-claims-go-to-the-provider state. |
| D5 | **Screen 08's transfer detail contradicts screen 08's own ledger.** Ledger row: "Sent to Nile Prep Academy · 3 Aug · TRF-8842 · −500.00". Detail for that same `TRF-8842`: "From **Nile Prep Academy** → To **Giza Science Hub**". Same reference, opposite parties. This is the screen whose entire purpose is being the one record two businesses can quote at each other. | lines 1222 and 1260-1261 |
| D6 | **Screen 08's EN transfer-detail hero renders Arabic-Indic digits** — `−٥٠٠٫٠٠` inside `dir="ltr"`. Both frames use the identical string. | lines 1257 and 1278 |
| D7 | **Screens 06, 07 and 08 are drawn as a centre, inside the teacher file.** The dashboard says "Dashboard · Nile Prep Academy" with "Sessions today / Students expected / Collected / Attendance"; the send-credit target and the transfer detail are both centres; the copy says "another center or teacher" and "a center with enough credit pays nothing". Ten of the thirty-four frames show a teacher nothing that identifies as their own account. Screen 07's own results list ironically contains "Aly Shady · Teacher · Physics" as a *recipient*. | lines 983, 985, 994, 1122, 1260-1261, 975 |
| D8 | **Screen 07's lock copy contradicts live behaviour.** "This credit cannot be withdrawn as cash, by you or by them" (twice, plus the Rules card) — but referral withdrawal is a live, shipped feature on the centre side with its own fee schedule. `NEW-MODEL.md` § Still open flags the question as open with the tax advisor; the drawing states it as settled. | `referralPayout.ts`; `NEW-MODEL.md:187` |
| D9 | **Screen 09 draws four "Plan options" rows the app does not have** — Switch billing cycle, Payment method (Add a card), Refer a teacher, Redeem a code. Live has none; the cycle switch is an inline segmented control, not a row leading to a sheet, and there is no card-on-file row, no teacher referral entry point from billing, and no promo-code redemption. | `TeacherPlanSection.tsx`; `en_teacher_billing.png` |
| D10 | **Screen 09's "Invoices" block does not mean what the live block under the same position means.** The drawing shows platform invoices ("First charge · 499 EGP · Upcoming" / "No past invoices yet"). Live renders `BillingHistory` — per-class tuition rows ("Physics · Jul 20, 2026 · 1 present · 700 EGP · Pending"). Real platform invoices live on `/teacher/pay`, a route the billing screen never links to. | `BillingHistory.tsx:110-125`; `en_teacher_billing.png` |
| D11 | **Screen 01's nudge is not built** — "Tired of chasing that 900? Send each parent their InstaPay link · [Send]". It is the only place in the file that connects income to the InstaPay flow, and it depends on screens 03–05 existing. | `IncomeView.tsx` |
| D12 | **Screen 09's switch-cycle sheet cannot be exercised even where it exists.** Live shows the toggle but every plan CTA collapses to "Payments are unavailable right now, please try again later" because `PAYMOB_ENABLED=false` in this environment. `by-design` for dev, but it means no drawn payment action in this file was ever executed. | `TeacherPlanSection.tsx:225-232`; both billing captures |

### 6c. Where drawing and app agree

* Annual billing: 4,990 EGP/year, 416 EGP/mo, "2 months free" — exact match, both locales.
* Standard 499 / Pro 999 / Scale 2,499 gross prices — exact match.
* Trial end date 3 August 2026 — match.
* "Best for Part-Time" as the only plan label — match (`teacherPlans.ts` header states the rule).
* Referral ladder 25% / 10% (m2–6) / 5% (m7+) — the drawing's `month 3` and `month 7` rows are
  consistent with `referralProgram.ts:10`.
* Screen 05's separation of the two fees is stated correctly and prominently ("Ten pounds a
  receipt, twenty pounds an invoice"; "The 10 EGP on a parent's tuition invoice is a different
  thing entirely and does not carry it") and its arithmetic checks out: 370 + 899 + 20 = 1,289
  and 370 + 20 = 390.
* Screen 06's balance arithmetic checks out: 1,840 − 1,289 = 551 carried forward.
* Screen 07's arithmetic checks out: 1,840 − 500 = 1,340.

---

## 7. What this file is worth right now

The drawing is in good shape and has been correctly swept. Its remaining defects are D1/D2
(stale plan numbers), D3/D4 (two mandatory model behaviours simply not drawn), D5/D6 (two bugs
inside the one screen that exists to be evidence), and D7 (ten frames wearing a centre's
identity in a teacher file).

The application is the gap. Six of nine screens do not exist, and the live teacher portal is
still selling identity verification, platform collection, Thursday payouts and a 5% cut of
tuition — every one of which `NEW-MODEL.md` lists as dead, and the last of which the database
dropped columns for on 8 August 2026.
