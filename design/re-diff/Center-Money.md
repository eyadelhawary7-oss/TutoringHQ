# Re-diff — `design/Merged-Center-Money.html`

**PROTECTED — carries money.** Diffed 8 August 2026 against the live dev app at `localhost:3000`,
authenticated as OWNER of "Test Center 333". Captures in `/tmp/rediff/center-money`.

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Center-Money.html | wc -l
50
```

Per section (script over the `mgd-num` bars, summing to the same 50):

| § | Screen | Frames | EN | AR |
|---|---|---|---|---|
| 01 | Payments | 5 | 4 | 1 |
| 02 | Center Payments | 5 | 3 | 2 |
| 03 | Billing | 4 | 3 | 1 |
| 04 | Center Receipts | 4 | 2 | 2 |
| 05 | InstaPay Invoice | 2 | 1 | 1 |
| 06 | InstaPay Uploaded Receipts | 4 | 2 | 2 |
| 07 | InstaPay Confirm | 2 | 1 | 1 |
| 08 | InstaPay Batch List | 4 | 2 | 2 |
| 09 | InstaPay Duplicate Reference | 2 | 1 | 1 |
| 10 | InstaPay Fee Total | 4 | 2 | 2 |
| 11 | Active Balance | 4 | 2 | 2 |
| 12 | Send Credit | 6 | 3 | 3 |
| 13 | Balance History | 4 | 2 | 2 |
| | **Total** | **50** | **28** | **22** |

Matches `MERGED-FILE-MAP.md` line 30 (13 screens, 50 frames).

---

## 2. Frame accounting

```
Drawn: 50 | Exercisable: 13 | Exercised: 11 | Blocked: 39
```

Blocked by reason — **not-built 37 · no-data 1 · tooling 1** (37+1+1 = 39).

| § | Blocked frame | Reason |
|---|---|---|
| 01 | EN · receipt | no-data — centre has zero payment rows (`Export 0 rows`, `No payments yet` both rendered); `ReceiptModal.tsx` exists but has nothing to open |
| 01 | EN · loading | tooling — the harness waits past skeletons by design, so the loading state cannot be photographed |
| 02 | EN · unpaid follow-up | not-built |
| 02 | EN · void an unpaid link | not-built |
| 02 | AR · إلغاء رابط غير مدفوع | not-built |
| 03 | EN · manage plan · add-ons | not-built |
| 03 | EN · switch billing | not-built |
| 04 | EN · payment confirmations | not-built |
| 04 | EN · tax documents | not-built |
| 04 | AR · تأكيدات الدفع | not-built |
| 04 | AR · المستندات الضريبية | not-built |
| 05 | EN + AR invoice (2) | not-built |
| 06 | all 4 | not-built |
| 07 | both 2 | not-built |
| 08 | all 4 | not-built |
| 09 | both 2 | not-built |
| 10 | all 4 | not-built |
| 12 | all 6 | not-built |
| 13 | all 4 | not-built |

**Route-level capture blocks** (separate from frame accounting, all *tooling*, never read as absent features):

- `/en/pay`, `/ar/pay` — bounced to `/login` on both the 6 s and 15 s runs; on a third probe stayed on
  `Loading…` for 11 s with `Failed to load user profile: AbortError`. See defect **A7** — I treat the
  behaviour as a defect *candidate* and the screen itself as NOT MEASURED.
- `/ar/settings/billing` direct load — never left skeleton, 3× `Internal Next.js error: Router action
  dispatched before initialization`. The **same URL** rendered fully when reached via `/ar/invoices`
  (which redirects to it), so the screen was measured by that path.

Route note: **`/en/invoices` and `/ar/invoices` redirect to `/{locale}/settings/billing`** —
`finalUrl` in both manifests. They are one screen, not two.

---

## 3. Per-screen verdict — does it exist live?

| § | Screen | Live? | Evidence |
|---|---|---|---|
| 01 | Payments | **YES, and closer to the model than the drawing** | `/en/payments`, `/ar/payments` measured; Collect-Payment sheet opened and photographed |
| 02 | Center Payments | **PARTIAL** — the ledger is `/payments`; no unpaid-links list, no void flow | only hit for `unpaidLink*` is a dashboard banner (`dashboard/page.tsx:63,299,695`); no void code anywhere |
| 03 | Billing | **PARTIAL** — plan card + next payment + history live; no manage-plan, no add-ons, no switch-billing | `/en/billing`, `/ar/billing` measured; `planChange\|switchBilling\|upgradeTo` matches only `admin/plan-requests` |
| 04 | Center Receipts | **NO** | no Records screen, no Payments/Tax tab pair, no tax-document list |
| 05 | InstaPay Invoice | **NO** | no parent tuition-invoice surface; no 10 EGP fee object (below) |
| 06 | InstaPay Uploaded Receipts | **NO** | see the three-way proof below |
| 07 | InstaPay Confirm | **NO** | `/api/payments/confirm` confirms a *manually recorded row* by `payment_id`; no image, no extracted fields, no reader |
| 08 | InstaPay Batch List | **NO** | no upload endpoint |
| 09 | InstaPay Duplicate Reference | **NO** | `duplicate_reference` → 0 files |
| 10 | InstaPay Fee Total | **NO** | `grep -rn 'SERVICE_FEE\|serviceFee' src/lib/` (excl. parentPack) = **0** |
| 11 | Active Balance | **PARTIAL, and inverted** — a "Platform balance" card exists on `/settings/billing`; it is **not** on the dashboard and **not** applied before an invoice total | `/en/dashboard` + `/ar/dashboard` measured: no balance card |
| 12 | Send Credit | **NO** | `sendCredit\|send_credit\|credit_transfer` → 0 files; 0 i18n keys |
| 13 | Balance History | **NO** | `balance_history\|creditLedger` → 0 files; 0 i18n keys |

### The proof that §06–§09 cannot exist

Three independent greps, all run this session:

```
$ grep -rl 'formData|multipart|.storage.' src/app/api/ | wc -l
0
$ grep -rhn "storage\s*\.\s*from(" --include=*.ts --include=*.tsx src/ | grep -o "from('[a-z-]*'" | sort -u
from('center-logos'   from('invoice-pdfs'
$ for k in uploadedReceipts batchList duplicateReference sendCredit balanceHistory serviceFee feeTotal activeBalance platformBalance; do grep -c "\"$k" messages/en.json; done
0 0 0 0 0 0 0 0 0
```

There is **no image-upload endpoint anywhere in `src/app/api`** and only two storage buckets, neither
for receipts. A screenshot has nowhere to land, so the receipt list, the confirm screen, the batch
list and the duplicate-reference screen are structurally impossible today. `confirmReceipt` is the
only near-miss i18n key and it is the *"Confirm Payment"* label on the payments ledger
(`messages/en.json:2487`), not receipt-image confirmation.

**Build order status (NEW-FEATURES "Build order"):** steps 1–4 are the minimum for a working flow.
Step 4 ("View and confirm — nothing is a payment until this exists") is **not started** in this file's
surfaces. Steps 5–7 likewise.

---

## 4. The 10 EGP / 20 EGP question, and verification claims

**The live app does not conflate the two fees — because only one of them exists.** There is no 10 EGP
service fee in `src/lib` at all (0 hits). The 20 EGP processing fee is applied correctly where it
belongs: the live API returns `subscription: 1000, fee: 20, total: 1020` for INV-007-2026-07, and both
`/billing` screens render `1,020 EGP`.

**The live app makes no claim to have verified a payment** — the receipt-reading flow does not exist,
and `/api/payments/confirm` asserts nothing about money moving.

Two adjacent problems, both real, neither the classic collision:

- **A12 — the 20 EGP fee used outside its defined scope.** `messages/en.json:1390`: *"A flat 20 EGP
  processing fee is deducted first, then a 5% withdrawal fee on the remainder."*
  `src/lib/referralPayout.ts` computes `net = (gross − 20) × 0.95`. A referral withdrawal is money
  leaving the platform, not "an invoice the platform issues to a center or teacher". NEW-MODEL's
  revenue table defines processing fees only as *"20 EGP per platform invoice"*. The 5% withdrawal fee
  and the quarterly cadence (`messages/en.json:5776`) appear in no model document.
- **A9 — dead verification copy still shipping.** Both dashboards render "Verification unavailable" /
  "التحقق غير متاح" to the owner today, and `messages/en.json:10341–10414` still carries *"Online
  collection switches on once your ID is verified"* and *"Verify your ID to switch on online
  collection."* NEW-MODEL: identity verification and online collection are gone, not deferred.

**The DESIGN does conflate them — see D1, the highest-priority fix in this file.**

---

## 5. Divergences AGAINST THE APP (live defects)

### Money-correctness

**A1 — Two live screens disagree on the plan price.**
`/en/billing` + `/ar/billing`: *"Starter · 1,000 EGP · Monthly"* / *"أساسي · ١٬٠٠٠ ج.م · شهري"*.
`/en/invoices` + `/ar/invoices` (→ `/settings/billing`): *"MONTHLY PRICE **4,499 EGP**"* /
*"السعر الشهري ٤٬٤٩٩ ج.م"*. Same centre, same session, minutes apart. The API agrees with 1,000
(`subscription: 1000`). The 4,499 hero is wrong, in both locales.

**A2 — Three contradictory statuses in one card.** `/settings/billing` plan hero simultaneously shows
the pill **Suspended**, the field **STATUS: Paid**, and a red **⚠ Overdue** banner. AR identical:
موقوف / مدفوع / متأخر.

**A13 — `?? 0` on a money field, on the credit balance.**
`grep -rn 'credit_balance ?? 0' src/` = **11** sites; `settings/billing/page.tsx:1835` renders
`formatNum(Number(center?.credit_balance ?? 0))`. This is the same defect class the student-detail fix
removed: a failed `center` load renders a confident `0`. The *"You have 0 EGP available."* line I
photographed cannot be distinguished from an unloaded balance by looking at it. (For this centre the
zero is genuine — the referrals page independently reports 0 referrals — but the render path is unsafe.)

**A14 — Credit is offered, not applied.** `settings/billing/page.tsx:2188` gates credit on a
`useCredits` toggle, and only on the reactivation path; `creditApplied` appears in 3 places total (2 in
`api/billing/reactivate/route.ts`, 1 in `settings/billing/page.tsx`). No invoice breakdown outside
reactivation nets the balance before the total. NEW-FEATURES §7 requires applied-before-total on **any**
paying page: *"Showing it only inside the referral page would mean a provider paying an invoice it
already had the credit for."* Live is worse than that — the balance sits in its own card with a
**Request withdrawal** CTA beside an unpaid 1,020 EGP invoice.

**A11 — Referral commission window contradicts NEW-MODEL (unresolved, needs Eyad).**
Live `/en/referrals`: *"25% Month 1 · 10% Months 2-12 · 5% Month 13+"*, mirrored by
`src/lib/referralProgram.ts:40–42`. NEW-MODEL.md and NEW-FEATURES.md §6, both 6 August: *25% month 1,
10% months 2 **to 6**, 5% thereafter*. `referralProgram.ts:15–16` knows about the conflict and cites
design correction **D2 — live wins** (`design/CHANGE-LOG.md:463`, 29 July). NEW-MODEL post-dates D2 by
eight days and opens *"Read this before touching any screen."* Months 7–12 pay 10% under live and 5%
under the model. I am flagging, not choosing.

**A12 — 20 EGP fee outside its scope.** See §4 above.

### Auth / reachability

**A7 — `/pay` bounces an authenticated owner to `/login`.**
`CustomerInvoicesView.load()` → `authHeader()` returns `null` → `window.location.href =
'/{locale}/login'` (`src/components/billing/CustomerInvoicesView.tsx:117–118`, again at 148–149).
The **same session's token returns HTTP 200** from `/api/billing/customer-invoices` — I called it
directly and got the invoice payload. On a longer probe the page instead sat on *"Loading…"* with
`Failed to load user profile: AbortError: signal is aborted without reason`. Either way the owner
cannot reach the invoice-paying screen. Not measured for diff purposes; reported as a defect candidate.

**A8 — `401 /api/summer/my-first-invoice`** on both `/en/billing` and `/ar/billing` while authenticated
(recorded in both manifests).

**A15 — `/ar/settings/billing` direct load never leaves skeleton**, 3× `Internal Next.js error: Router
action dispatched before initialization`. Dev-only class; flagged, not asserted.

### RTL / i18n on money screens

**A4 — The billing period renders backwards in Arabic.** DOM text is `2026-07-15 → 2026-08-15`
(confirmed identical in the EN and AR `.txt` captures); the RTL page *renders* it as
`2026-08-15 → 2026-07-15`. The neutral arrow is not bidi-isolated, so an Arabic reader sees the period
running end-to-start.

**A5 — Two numeral systems inside one Arabic money card.** `/ar/billing`: `١٬٠٠٠ ج.م`,
`٢٧ أكتوبر ٢٠٢٦`, `١٬٠٢٠ ج.م` beside `16 / 200`, `200`, `8%`. `/ar/invoices`: `١٬٠٢٠ ج.م` beside
`2026-07-15`.

**A6 — Arabic plan name heading the English page.** `/en/billing` leads the plan card with **أساسي** at
heading size, with "Starter" beneath it as the sub-label.

**A3 — Text overlap on the plan hero.** "Starter" collides with the "Billing Period: Monthly" pill on
`/en/invoices`; "أساسي" collides with "الفوترة فترة: شهري" on `/ar/invoices`.

**A10 — Dead-model "Online" tuition label.** Both dashboards: *"Digital share … Online 0 · Cash 0"* /
*"نسبة التحصيل الرقمي … أونلاين ٠ · نقدًا ٠"*. NEW-MODEL: two tuition methods, InstaPay and cash;
"digital"/"online" is the label that *"meant nothing specific"*.

**A16 — Arabic copy slips on money screens.** `معاملة مالية` for "Financial transaction log" (singular,
drops "log"); `الوقت الحالي` — *"the current time"* — for the **Today** filter chip; `الفوترة فترة: شهري`
for "Billing Period: Monthly" (word order reversed).

### Known defect — **VERIFIED FIXED, do not re-fix**

Both halves of the brief's known money defect are repaired, and I checked the code rather than the
comment:

- `src/lib/studentBalance.ts:193–195` — `build('payments', …).in('student_id', ids).eq('confirmed', true)`.
  The collection filter is `confirmed`, not `status`. `PAID_PAYMENT_STATUSES` now has **2** references
  in all of `src/`: its own declaration (`studentBalance.ts:59`) and a **comment** in `sync.ts:105`.
  It is dead as a filter.
- `src/app/[locale]/students/[id]/page.tsx:334–343` — `setBalance(b ? b.balance : null)` on the miss
  path and `setBalance(null)` in the `catch`. No `?? 0` on the displayed figure; the card stays in its
  unloaded state. (`(balance ?? 0) > 0` survives at line 936 but only derives an `owes` boolean, not a
  rendered amount.)

The unsafe `?? 0` pattern has migrated to **`credit_balance`** — see A13.

---

## 6. Divergences AGAINST THE DRAWING (stale design)

**D1 — §05 calls the parent's 10 EGP a "Processing fee". This is the exact collision NEW-MODEL names.**
Line 1414 secnote: *"It is the platform processing fee at its lower rate: 20 EGP on every invoice we
issue, 10 EGP on a tuition invoice because the parent funds that one."* The EN frame line reads
`Processing fee | 10.00`; the AR frame `رسوم معالجة | ١٠٫٠٠`. NEW-MODEL: the 10 is the **service fee**;
the 20 EGP processing fee is *"Never on a parent's tuition invoice"*; *"Conflating the two is the
collision that has already cost this project time once."* **The file contradicts itself** — §10 states
the rule correctly (*"The 10 EGP on a parent's tuition invoice is a different thing entirely and does
not carry it"*). Relabel §05 to **Service fee / رسوم الخدمة** in both frames and rewrite the secnote.
Highest-priority fix in this file. (`src/lib/processingFee.ts:47–66` carries the matching hazard in
code — a doc comment still instructing a future dev to build a *"PARENT PROCESSING FEE, 1.5% + 1.5 EGP"*
that NEW-MODEL killed, and citing a verification block that no longer exists.)

**D2 — §01 draws four tuition methods in EN and five in AR.** EN chips `Cash | Instapay | InstaPay |
Card`; AR chips `نقدي | إنستاباي | فوري | إنستاباي | بطاقة`. Card and Fawry are dead, and *Instapay* /
*InstaPay* appear as two separate chips — a botched find-replace also visible in the §01 masthead prose:
*"(cash, Instapay, InstaPay, InstaPay, card — colour-coded)"*. The Record-payment sheet repeats it.
**The live app is right and the drawing is wrong**: `/payments` offers `All · Cash · InstaPay` and the
Collect sheet offers `Cash | InstaPay`, cited to NEW-MODEL in `payments/page.tsx:47–52`.

**D3 — §02 draws the dead Thursday settlement.** *"Available now 12,480 EGP"* and *"Processed |
Thursday"*. The live dashboard **deliberately omits** "Available now" with the reasoning written out at
`dashboard/page.tsx:668–690` (*"the card's headline has no source at all"*, *"redefining it from other
data was raised with Eyad on 1 Aug and explicitly declined"*). Also *"Your price 168.75"* against
*"Amount 150 EGP"* — the dead 12.5% markup.

**D4 — §04's prose was swept on 6 August; its pixels were not.** The secnote is model-correct (tax
documents *"cover the platform's own fees alone — the 10 EGP service fee and the 20 EGP processing fee
— never the tuition"*). The frames underneath are entirely pre-InstaPay:
*"Your fee 150 · you receive 135"* (the dead **90/10 split**), `168.75` (the dead **markup**), method
badges **Card** and **Wallet**, and a Tax tab billing *"Collection fee (commission) 5,333.33 + VAT (14%)
746.67 = 6,080"* — a **commission on tuition**. Every one of these is in NEW-MODEL's "What died" table.
This is the largest stale block in the file after D1.

**D5 — §03 taxes exclusively and omits the processing fee.** *"Renewal 8,990 /yr **Plus tax**"* against
NEW-MODEL's *"Tax is 14% VAT only, inclusive"*. No 20 EGP processing-fee line appears on any §03
invoice, though every platform invoice must carry one — the live app gets this right (1,000 + 20 =
1,020). *"Advanced Analytics +149 EGP / mo"* against NEW-MODEL's *"Analytics, benchmarks, team seats —
**0 for now.** Priced later."*

**D6 — §13's transfer detail contradicts the ledger row that opens it, on the one reference the screen
exists to disambiguate.** §12 confirmation: TRF-8842 sent **to** Nile Prep Academy. §13 ledger row:
*"Sent to Nile Prep Academy · 3 Aug · TRF-8842 · −500.00"*. §13 detail for TRF-8842: **From** Nile Prep
Academy → **To** Giza Science Hub. Three directions, one reference, on a screen whose stated purpose is
*"a single string both can quote and a single record neither can alter."*

**D7 — §13's EN transfer detail renders its hero amount in Eastern Arabic numerals.** Line 2081:
`<div class="big mono" style="color:#0A514A">−٥٠٠٫٠٠</div>` inside `dir="ltr"`, sitting above an English
`Amount 500.00`.

**D8 — §12/§13 restate a lock the product no longer has.** *"This credit cannot be withdrawn as cash, by
you or by them."* Live: `/referrals` shows **Withdrawable** and **Request Withdrawal**; `/settings/money`
carries an InstaPay number field labelled *"Required for credit withdrawals via InstaPay"* /
*"مطلوب لسحب الرصيد عبر الإنستاباي"*. Referral-credit withdrawal is live, so the drawn lock is the stale
side. NEW-MODEL parks this under "Still open" — but the screens should stop asserting the lock as
settled until it is.

**D9 — §02 draws a "Failed" InstaPay tuition state** (*"Not received 17:06 · Failed"*). Nothing in the
model produces one: the provider either confirms or does not. Lower confidence than D1–D8; worth a look.

---

## 7. What the app gets right that the drawing does not

Worth recording so nobody "fixes" the app toward a stale design:

- Two tuition methods, one spelling, both on the ledger filter and in the Collect sheet — with
  `NEW-MODEL.md` cited in the source (`payments/page.tsx:47–52`). The drawing still has Card and Fawry.
- "Available now" is deliberately absent from the dashboard, with the omission argued in a comment.
- The 20 EGP processing fee rides the subscription invoice correctly: 1,000 + 20 = 1,020, verified
  against the live API response, not read off a screen.
- Balances filter on `payments.confirmed`, so an unconfirmed transfer is not money in hand.
- `/en/billing` says *"Online payment is not enabled."* beside a disabled Pay-now — honest about a
  capability it does not have.
