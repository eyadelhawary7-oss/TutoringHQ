# Verification (e-KYC) — what the designs specify

**Written 26 July 2026. Design and product only. No code.**
Supersedes `C1-VERIFICATION-SCOPE.md`, which has been deleted.

Sources: `Merged-Verification-Payouts` §01–§06 in full · every screen whose name contains
"Verified" · every mention of Valify or National ID across all 26 merged files ·
`Merged-Public-Legal` §01 for the privacy conflicts.

## DECISION — 26 July 2026, locked

**Verification is a REDIRECT to a Valify-hosted flow. The ID document never touches our
infrastructure. We receive an outcome and store only that.**

**This is a decision, not a description of the current designs.** No design states it. §03 comes
closest — *"the ID scan and selfie happen on their side"* — but six frames then render a full
National ID number as if we held it, and the storage question was left open everywhere else. The
decision closes it.

| | |
|---|---|
| Document capture | **Never in our app.** Always on Valify's page. |
| ID image, selfie | **Never received, never stored.** Fetchable from Valify by transaction ID if ever needed. |
| Full National ID number | **Retained under a tax carve-out**, confirmed 26 July — Egyptian tax law requires the payee ID on the ETA e-receipt. Held for the statutory period, **never rendered in any UI** (§9.2, §9.5). This is the §9.5 carve-out resolving as predicted. |
| What we store | An outcome — status, timestamp, provider reference (§2c) — plus the ID number and legal name for the tax skeleton. Never the document. |
| Trust anchor | The **webhook**, never the redirect return. |

**Legal amended 26 July to match: `design/LEGAL-CHANGE-LEDGER.md`.**
**§9 specifies every frame this changes.** §1.2 and §2 below describe what the designs *said* before
this decision; they are left intact as the record.

## How to read this

- **Quoted text** is what a design actually says. Where I quote, the design specifies it.
- **SILENT** means I searched and the designs do not say. I have not invented an answer.
- Where a design contradicts another design, or contradicts a locked decision, it is marked **⚠ CONFLICT**.

**Coverage of the "silent" claims.** I swept all 26 files for the vocabulary each answer would need.
Where I say silent, the sweep returned zero hits in any verification screen.

---

# 1. What we collect, field by field

## 1.1 Presented to Valify

| Field | Center | Teacher | Design says |
|---|---|---|---|
| National ID card | ✅ (or commercial registration) | ✅ required | §03: *"Your National ID card"* |
| Commercial registration | ✅ **alternative to National ID** | ❌ | `Merged-Center-Attendance` §02: *"About 2 minutes · commercial registration or National ID · secured by Valify"* |
| Selfie | ✅ | ✅ | §03: *"A quick selfie in good lighting"* |

`Merged-Teacher-Money` §05 gives teachers the narrower set: *"About 2 minutes · **National ID** ·
secured by Valify"* — no commercial-registration alternative.

**Capture never happens on our side.** §03: *"we'll take you to Valify to confirm your National ID…
the ID scan and selfie happen on their side, then brings the user back with the result."* The pattern
is named: *"a hosted redirect, the same pattern as Paymob."*

## 1.2 Store versus pass-and-discard

**⚠ This is the question the designs answer least.** They show what is *displayed* after success. They
never distinguish what we hold from what passes through.

| Artefact | Design evidence it is stored | Verdict |
|---|---|---|
| National ID **number** | Rendered on §01, §04, §06, Admin Account Detail, Admin Receipts | **Stored.** Unambiguous. |
| Verified flag | Badge on ~every verified screen | **Stored.** |
| Verified date | §01: *"Al-Nahda Center · verified 12/07/2025"* | **Stored.** |
| Provider attribution | §01/§03/§04: *"via Valify"*, *"Verified by Valify e-KYC"* | **Stored.** |
| **ID card image** | Never mentioned after §03 | **SILENT** |
| **Selfie image** | Never mentioned after §03 | **SILENT** |
| **Valify transaction / reference id** | Never appears | **SILENT** |
| **Name as read off the ID** | Implied only — see below | **SILENT as a stored field** |
| **Date of birth, address, expiry from the ID** | Never appear | **SILENT** |

**The one hint that we hold a name from the ID:** `Merged-Teacher-Setup` §01 verified frame labels the
payout account holder *"Aly Shady"* with the note **"Matches your verified ID"**, and
`Merged-Verification-Payouts` §05 says *"The name on the account has to match your verified ID. We
cannot pay to an account we cannot confirm is yours."* A name-match rule requires a stored name to
match against. The designs never say we store it.

**The stated reason for holding the ID at all**, given to the user on §01:

> *"Your National ID is kept on file to issue electronic receipts for each withdrawal."*

## 1.3 Collected alongside, but not KYC

Both are provider-entered, not Valify outputs, and have their own lifecycle:

**Tax status** (`Merged-Center-Attendance` §02, third frame) — *"Registered · tax card on file"* →
e-invoice, or *"Not registered"* → e-receipt. Carries a **tax card number** (`123-456-789`).
*"You can change this at any time. If you register later, add your tax card here and we switch you to
e-invoices from the next document."* And: *"This only affects the document we issue you for our
collection fee. It does not change what you are charged."*

**Payout destination** (`Merged-Verification-Payouts` §04, `Merged-Teacher-Setup` §01) — method (bank
or mobile wallet), **account holder name**, **IBAN** or wallet number. §04: *"We use this only to pay
out your referral earnings."*

---

# 2. What Valify returns, and what we do with each outcome

## What the design shows

**One outcome. Success.** §03's return frame, in full:

> **Identity verified.** *"Valify confirmed your identity. Payouts are now enabled on your account."*
> → **Set up payout details** · *"Verified by Valify e-KYC"*

That is the entire returned contract. No score, no confidence band, no reason code, no partial pass,
no manual-review outcome, no asynchronous result.

## What we do with it

| Outcome | Design says |
|---|---|
| **Pass** | Set verified, stamp the date, store the ID, show the badge, **route the user straight to payout setup**. §03's only CTA is *"Set up payout details"*. |
| Fail | **SILENT** — see §3 |
| Inconclusive / manual review | **SILENT**. No such state exists in any design. |
| Provider error / timeout | **SILENT** |
| User abandons mid-flow at Valify | **SILENT** |

## ⚠ CONFLICT — the design draws a redirect and omits the callback

§03 says the pattern is *"the same as Paymob"*, but only draws the **user-facing redirect return**.
Live Paymob handling is a redirect **plus** a server-to-server callback with HMAC verification. If
verified state is settable from whatever comes back on the redirect, hitting the success URL makes
you verified.

The design gives no signed-callback frame, no webhook, no reconciliation step. **The trust anchor is
undefined.** This is not a styling gap; it is the security boundary of the whole feature.

**✅ Resolved against the vendor on 26 July — see §2b.** Valify's hosted Web Verification Flow does
fire a webhook alongside the redirect, so the design's Paymob comparison was correct and only its
drawing was incomplete. The webhook's payload and authentication are not publicly documented and must
be obtained from Valify.

---

# 2b. Valify's actual integration options — vendor research, 26 July

**Researched from Valify's public documentation, not from the designs.** Everything in this section
is vendor fact or explicitly marked as undocumented. Sources at the end of the section.

## A hosted redirect exists. The design's assumption was right.

Valify calls it the **Web Verification Flow** — *"a fully web-based verification experience that
allows you to launch customized identity verification flows through a single API call."*

| Step | Detail |
|---|---|
| 1 · Our backend requests a link | `POST https://verify.valifysolutions.com/api/link/v1/request/?lang=en`, header `X-Valify-Api-Key` |
| 2 · We send | `return_url` · `reference_id` (our own customer id) · `expires_at` (token expiry) · optional `flow` (UUID of a pre-configured module set) |
| 3 · Valify returns | `session_token` · `redirect_url` = `https://verify.valifysolutions.com/?token=<session_token>` |
| 4 · User verifies | On **Valify's** page. Document capture and selfie never touch us. |
| 5 · Valify returns the user | Redirects to our `return_url` |
| 6 · **Valify calls our webhook** | Configured **at account level**, fired with the result at the same time as the redirect |

**Modules are combinable** in one flow: Egyptian National ID OCR, **face match**, **liveness
detection**, email OTP, phone OTP.

### ✅ This resolves the §2 CONFLICT — and confirms the design's omission was the important half

The design said the pattern is *"the same as Paymob."* **It is.** Redirect *plus* a server-side
webhook, exactly like live `verifyHmac.ts` handling. The design drew step 5 and omitted step 6.
**Step 6 is where verified state must be set.** The `return_url` is a UX destination, nothing more.

### ⚠ And it is effectively the only option for this stack

Valify's SDKs ship for **iOS, Android, Flutter and React Native**. There is **no web SDK** in their
documentation index. TutoringHQ is a Next.js PWA. So the hosted Web Verification Flow is not one
option among several — it is the one that fits, which is fortunate because it is also the one the
design drew.

## What comes back

| Surface | Documented | Fields |
|---|---|---|
| Link request response | ✅ | `session_token`, `redirect_url` |
| **Webhook payload** | ❌ **NOT PUBLICLY DOCUMENTED** | Field names, whether it carries an overall decision, and **whether it is signed or HMAC-verified**, are all absent from the public docs. **Must be obtained from Valify before build.** |
| Transaction Inquiry (`POST /api/v1/transaction/inquiry/`) | ✅ partially | `transaction_id`, `token`, `time`, **`status`** (boolean), `service`, `data`. The contents of `data` are not public. |
| OCR REST endpoint (`POST /api/v1/ocr/`) | ✅ | Extracted fields, plus `transaction_id` and **`trials_remaining`** |
| Mobile SDK result (`VIDVDocumentKitResult`) | ✅ | `sessionID`, `extractedData` (name, NID number, DOB, address, expiry, gender, marital status), `captures` (base64 front/back), `hmacData` |

**Responses are encrypted.** Transaction Inquiry and Fetch Images return an AES-encrypted payload plus
an RSA-encrypted AES key; we decrypt the key with our private RSA key, then the payload. **We need an
RSA keypair and somewhere to keep the private key** — that is infrastructure the designs never
mention.

**Two auth schemes:** `X-Valify-Api-Key` for the link API; **Bearer token + `bundle_key`** for the
OCR and transaction APIs. Staging base is `valifystage.com`.

### `trials_remaining` partially answers the retry question

The OCR endpoint returns **`trials_remaining`**, so **Valify itself meters attempts per bundle**.
That does not decide our product rules — how many we grant, cooldown, lockout, and what the user sees
are still open questions 4 and 6 — but the counter exists at the vendor and does not need building.

## ✅ We do not have to store the images

Valify exposes **Fetch Images** — `POST https://<base-url>/api/v1/transaction/fetch-images/`, taking
a **transaction ID** and a flag for original or cropped, and returning the documents **and the
selfie**. Their own framing: *"enabling integrators to access documents and selfies without storing
them locally."*

**This closes the largest gap in §1.2.** The store-versus-discard answer the designs never gave is
available as an architectural choice, and the privacy-preserving option is the supported one: **hold
the transaction ID, fetch on demand, store no images.**

⚠ **Undocumented and must be asked: how long Valify retains the images.** If their retention is
shorter than our tax-record obligation, "fetch on demand" stops working and the decision reverses.

---

# 2c. What has to be stored on our side to render the twelve verified screens

Derived from what the twelve screens actually render, not from what Valify offers. **Valify returns
considerably more than these screens need.**

## Required — the screens cannot render without these

| Field | Rendered by | Evidence |
|---|---|---|
| `verification_status` | All twelve, via the **Verified** badge | Two states drawn; §4 of this spec argues more are needed |
| `verified_at` | Settings Verification, Admin Account Detail | §01: *"Al-Nahda Center · verified 12/07/2025"* |
| `national_id` | Settings Verification · Withdrawal Payout Details · Receipts · Admin Account Detail · Admin Receipts | §01: *"National ID on file · 2 9805 15 01 02345"* |
| `verified_name` | Payout details, for the account-holder match | §05: *"The name on the account has to match your verified ID."* `Merged-Teacher-Setup` §01: *"Matches your verified ID"* |
| `valify_transaction_id` | Nothing user-facing | Needed for Fetch Images, Transaction Inquiry, and audit. **No design mentions it; it is required anyway.** |

**Five fields.** That is the whole KYC footprint of twelve screens.

## Not required — Valify returns them, no screen renders them

`date_of_birth` · `address` · `gender` · `marital_status` · `document_expiry` · **ID card images** ·
**selfie image** · face-match score · liveness score.

**⚠ Storing the full `extractedData` blob would be over-collection**, and it lands directly on the
PDPL conflicts in §7 — particularly 7.1 and 7.3, where the published policy neither discloses nor
permits any of it. The screens need a number, a name, a date and a status.

## Stored alongside, but not KYC and not from Valify

| Field | Screen | Note |
|---|---|---|
| `tax_status` + `tax_card_number` | `Merged-Center-Attendance` §02 | Provider-entered, changeable any time |
| Payout method, `account_holder`, IBAN or wallet | §04, `Merged-Teacher-Setup` §01 | Provider-entered; validated against `verified_name` |

## Still blocked on Valify, not on us

1. **The webhook payload** — field names, whether it carries a decision, and how it is authenticated. This is the security boundary and it is undocumented.
2. **Image retention period** — decides whether fetch-on-demand is viable.
3. **Whether the flow returns a decision or only extracted data.** Transaction Inquiry has a boolean `status`, but whether that means "the transaction completed" or "the person passed" is not stated. These are very different things.
4. **What a failed or abandoned session produces** — the public docs cover HTTP errors only, not user-facing outcomes.

**Ask `techsupport@valify.me`.** Questions 1 and 3 block build; 2 blocks the storage decision.

**Sources:** [Web Verification Flow](https://valify.gitbook.io/documentation/kyc/kyc-features/egy-nid-ocr) ·
[Fetch Images](https://valify.gitbook.io/documentation/apis/fetch-images) ·
[Transaction Inquiry](https://valify.gitbook.io/documentation/apis/transaction-inquiry) ·
[Commercial Register OCR](https://valify.gitbook.io/documentation/kyb/know-your-business-ekyb/data-extraction-and-verifications/egy-cr-ocr) ·
[SDK response](https://valify.gitbook.io/valify-ios-sdk-documentation/dockit/ios-native-sdk/sdk-response) ·
[Valify eKYC](https://valify.me/e-kyc/)

---

# 3. What happens on a failed check

## Nothing. It is drawn nowhere.

I swept all 26 files for every phrase a failure path would need. **Every one returns zero hits inside
any verification screen:**

> verification failed · could not verify · couldn't verify · not match · mismatch · try again ·
> resubmit · re-submit · under review · in review · being reviewed · takes up to · within 24 ·
> expired · rejected · declined · unsuccessful · لم نتمكن · أعد المحاولة · قيد المراجعة · مرفوض · فشل

The words exist elsewhere in the corpus — "declined" on payment rows, "قيد المراجعة" on admin privacy
requests, "try again" on the auth OTP screen — **never in a verification context**.

## Who can retry, how often, what they see

All three: **SILENT.**

- **No retry affordance** is drawn anywhere.
- **No attempt limit, cooldown or lockout.**
- **No cost consideration**, though Valify charges per check.
- **No manual-review escape hatch.** Admin sees verification as a read-only fact — a badge, an ID on file, an "Unverified" filter chip on `/admin/centers` and `/admin/teachers`. There is **no approve, reject, override or re-run control anywhere in the admin designs.** A legitimate provider who keeps failing has no route to a human.

## Who may start verification at all — also SILENT

No design names the actor. This matters more than it looks: `Merged-Center-Setup` §08 is emphatic
that two permissions **cannot be delegated** —

> *"Only the owner can withdraw money or change the payout account. That cannot be delegated."*

…but verification is what *unlocks* both, and no design restricts who may perform it. As drawn, a
manager could verify with their own National ID and thereby unlock the owner's money.

---

# 4. Every state a provider can be in

**The designs support exactly two states.** There is no third anywhere in 26 files.

## 4.1 Center — not verified

| | |
|---|---|
| **Can** | Everything the platform does today. Attendance, students, groups, schedule, rooms, branches, WhatsApp, card orders, subscription. Record payments **by hand** — `Merged-Center-Money` §01: *"The app records payments, it does not process them."* Methods: cash, Instapay, Fawry, Vodafone, card. Send a receipt on WhatsApp manually. |
| **Cannot** | Have parents pay in the app. Hold a balance. Withdraw tuition (none exists). Withdraw referral earnings — §02: *"Verify to withdraw"*. See payout statements or tax documents. |
| **Still works** | Referral earnings **accrue** — §02: *"Earnings keep accruing while unverified."* Spendable as in-app credit. |
| **Parent sees** | No payment link from us. Fee reminders only, if the center sends them. The center chases and collects directly. |

## 4.2 Center — verified

| | |
|---|---|
| **Can** | Everything above, plus: parents pay in the app; a Pending/Available balance; withdraw (1 free/month, then priced); payout statements; tax documents; per-student payment-link routing; void an unpaid link; bulk reminders. |
| **Cannot** | **Refund.** `Merged-Center-Money` §02 is explicit: *"There is no refund flow, since billing happens after the session and the service was already delivered; what exists instead is voiding an unpaid link, which withdraws an invoice rather than returning money."* |
| **Changes shape** | Every group collects digitally by default. Cash becomes a per-student, per-session switch. Team permissions split into DAILY and MONEY with two owner-only locks. Records split into three lists that must not be merged. |
| **Parent sees** | A WhatsApp payment link after each session. The parent payment page showing **the provider price** plus the parent processing fee — never the collection fee or markup. A WhatsApp receipt. Reminders if unpaid. **Exactly one person per student receives payment links.** |

## 4.3 Teacher — not verified (self-collect)

| | |
|---|---|
| **Can** | Private groups, students, schedule, sessions. Collect manually — `Merged-Verification-Payouts` §02: *"Right now you record payments by hand."* Choose a class-level method (Cash / InstaPay / Vodafone Cash). Mark collected after the fact. |
| **Cannot** | Auto-collect — §02: *"Auto-collect fees · Available after verification"*. Withdraw. Instant payout. |
| **Still works** | Referral earnings accrue, **credit only**. Cash stays entirely theirs. |
| **Parent sees** | **No payment link.** `Merged-Teacher-Setup` §01 unverified: *"Parents pay you directly. We only relay these in fee reminders, **never a payment link**."* |

## 4.4 Teacher — verified

| | |
|---|---|
| **Can** | Per-student **Digital or Cash** at attendance time. Balance with Pending/Available. Thursday payout. Instant payout for a fee. Withdraw referral earnings to bank **or** spend as credit. |
| **Changes shape** | Settings section renames from **Payment details** to **Payout details**. Income screen leads with a take-home balance instead of collected-vs-outstanding. |
| **Parent sees** | Invoice and payment link from us; automatic receipts — §02: *"Students and parents pay you in the app. Receipts are issued automatically."* |

## What is SILENT about states

No **in-progress / submitted** state · no **failed** state · no **expired** state · no **suspended /
revoked** state · no **partially verified** state (e.g. ID passed, bank details not yet added — though
§03 routes to payout setup as a separate step, implying it exists and is undrawn).

---

# 5. The twelve "Verified" screens — what actually differs

Nine screens carry "Verified" in the name. Three more draw both states inside one screen. **None of
the twelve is only a badge** — but two are close, and I say so.

### 1 · Center Dashboard Verified — `Merged-Center-Home` §01
*No unverified design twin; the comparison is the live `/dashboard`.*
**Substantially different.** A money block leads: **Available now 12,480 EGP**, with Pending, Unpaid
and *"Processed · Thursday"*. An unpaid-links alert sits directly under it. Adds a **digital share**
meter — *"the one metric that tells a center whether the switch away from cash is actually
happening."* Today's KPIs (sessions, students expected, collected, attendance) survive.

### 2 · Center Students Verified — `Merged-Center-Students` §03 vs §01
**Substantially different.**
- Header count changes from *"128 active · 3 branches"* to *"142 enrolled · **8 behind**"*
- Filters change from subject + standing chips to **All / Behind / Paid up**
- List becomes **sectioned**: BEHIND first, then ALL STUDENTS
- Outstanding amount and days-behind move **onto the row**
- New status **"Covered"** for monthly-plan students
- **New student detail**: outstanding hero, Remind / Record cash, payment history with method + status, contacts with Call and WhatsApp
- **New sub-screen — payment-link routing**, with the rule: *"Only one person can receive payment links. If two people had them, the same session could be paid twice."*

### 3 · Center Groups Verified — `Merged-Center-Groups` §02 vs §01
**Different in substance.** Adds *"6 groups · all collecting digitally"* and the standing note that
*"Every group collects digitally by default."* Each row gains **"Parents pay [provider price]"**
beside the center's own fee. Adds a billing-basis control — **per session / monthly / bundle**.
⚠ Billing basis is **deferred** (B12); live keeps `fee_per_class` only, so that part is out of scope.

### 4 · Center Attendance Verified — `Merged-Center-Attendance` §01
*No unverified design twin.*
**Substantially different, and it is the billing trigger.** Each row gains a **Digital / Cash chip**
and three separate tap targets — *"Tap the box for present or absent · Tap the chip to switch digital
or cash · Tap the name for student details."* A counter reads *"5 digital · 1 cash · 1 covered · 1
absent"*. **Select all** *"Marks the room present and bills digitally."* The end-session sheet shows
the center **Tuition 750 → Collection fee (10%) −75 → You receive 675**, plus cash collected and
covered counts, and states *"Payment links go out on WhatsApp now."*

### 5 · Center Payments Verified — `Merged-Center-Money` §02 vs §01
**Substantially different.** Balance block replaces the today/pending/month stats. Method filter
chips collapse to **All / Online / Cash**. Status vocabulary expands to include **Failed** (card
declined) and **Voided**. Adds a footer *"Processed to CIB ····4821 every Thursday"* with a
**Withdraw** button. Adds an **unpaid follow-up** screen with overdue buckets and *"Remind all —
sends one WhatsApp nudge each · Reminders use your notification credit."* Adds a **void** sheet.
The manual **Record payment** sheet disappears; cash becomes *"Mark cash."*

### 6 · Center Withdrawal Verified — `Merged-Center-Money` §04
**Entirely new. No twin.** Covered as A13.

### 7 · Center Receipts Verified — `Merged-Center-Money` §05
**Entirely new. No twin.** Three lists that *"deliberately"* must not be merged.

### 8 · Center Team Verified — `Merged-Center-Setup` §08 vs §07
**Different in substance, not layout.** §07 is a flat member list with six permission switches and a
seat counter. §08 **regroups permissions into DAILY and MONEY**, adds *"Void an unpaid link"* and
*"Set prices and billing basis"* as delegatable money permissions, and locks **Withdraw money** and
**Change payout account** to the owner: *"That cannot be delegated."* Adds an audit note — *"Every
billing action records who did it, so a session always shows which member of staff ended it."*
The seat/add-on block from §07 does not appear.

### 9 · Teacher Class Session Verified — `Merged-Teacher-Groups` §05 vs §04
**Substantially different, and pre-class is identical** — the design says so.
- §04 sets **one payment method for the whole class** (Cash / InstaPay / Vodafone Cash)
- §05 sets **Digital or Cash per student**, defaulting to Digital when you tick them present
- §05 adds a **confirmation dialog when switching a student to Cash** — *"Take Youssef in cash?"* with **Keep Digital** as the green button
- Summary changes from Collected / Outstanding to **Digital / Cash to collect**
- *"No percentage or fee is shown, only take-home and status"*

### 10 · Teacher Home — `Merged-Teacher-Home` §01, both states in one screen
**Substantially different.** Unverified leads with a **"Let us collect for you"** conversion card and
an earnings estimator. Verified replaces both with a **balance card** (Available, Pending, *"Next
processed Thu 23/07"*) and a **recent payouts** list. *"This month"* changes from
*"Outstanding 900 EGP"* to *"Collected and paid to you."*

### 11 · Teacher Income — `Merged-Teacher-Money` §01, both states in one
**Substantially different.** Unverified shows **Collected vs Outstanding** and a conversion prompt —
*"Tired of chasing that 900? Verify and we collect it for you."* Verified leads with the balance,
replaces outstanding with **recent bank payouts**, and unlocks **Export** (gated as *"Upgrade to
export"* when unverified). *"Take-home figures throughout, never a percentage."*

### 12 · Teacher Settings — `Merged-Teacher-Setup` §01, both states in one
**One section changes; the rest is identical.** Account, My code, Change PIN, Your account and Manage
billing are unchanged. The payment block flips:
- Unverified: **Payment details** — InstaPay address, Vodafone wallet, methods accepted, default method. *"Parents pay you directly."*
- Verified: **Payout details** — account holder *(**"Matches your verified ID"**)*, bank, IBAN. *"Held in Pending, then processed every Thursday. Cycle: Thursday 12:00 am to the next Wednesday 11:59 pm."*
- The *"Collect payments for me"* row changes from a **Verify** CTA to *"On. We invoice parents and process your payout every Thursday."*

**Closest to badge-only:** #12 Teacher Settings (one section swap) and #8 Center Team Verified
(regrouping plus two locks). Neither is *only* a badge.

---

# 6. Where verification gates money

**Both. And a third thing the summary usually misses.**

| Surface | Gated? | Evidence |
|---|---|---|
| **Online collection** (parents pay in app) | ✅ **Gated** | §01 center: *"Online collection — Parents pay tuition through the app"* listed under WHAT THIS UNLOCKS |
| **Tuition payouts / withdrawal** | ✅ **Gated** | §01: *"Withdrawals — Cash out collected tuition and referral earnings"* |
| **Referral earnings — withdrawal** | ✅ **Gated** | §02: *"Verify to withdraw · Verify your identity to cash out referral commissions"* |
| **Referral earnings — accrual** | ❌ **Not gated** | §02: *"Earnings keep accruing while unverified."* |
| **Referral earnings — spend as credit** | ❌ **Not gated** | Both referral screens offer credit in the unverified state |
| **Teacher fee collection automation** | ✅ **Gated** | §02: *"Auto-collect fees · Available after verification"* |
| Subscription, WhatsApp packs, card orders | ❌ Not gated | Unchanged in both states |
| Attendance, students, groups, schedule | ❌ Not gated | Unchanged in both states |

**What differs by account type** — §01 spells it out:

- **Center**: unlocks *"Online collection"* **and** *"Withdrawals"*
- **Teacher**: unlocks *"Fee collection"* **and** *"Withdrawals"*

**The third thing:** verification also gates **who may act**, not only what is possible. Once
verified, `Merged-Center-Setup` §08 makes *withdraw money* and *change payout account* owner-only and
undelegatable. Verification changes the permission model, not just the feature set.

---

# 7. PDPL conflicts

`Merged-Public-Legal` §01 renders the Privacy Policy, **Version 2.0 · Updated 22 June 2026**. Section
1, *What data we collect*, says in full:

> *"We collect what you give us: names, phone numbers, billing address, and a 6-digit PIN stored only
> as a secure hash, never in plain text. Center owners and staff also enter student and parent contact
> details on behalf of their center. **We do not process sensitive data, and we do not collect anything
> from third parties.** Card details are handled entirely by Paymob, never stored by us."*

**Not resolving these, as instructed. Flagging all of them.**

### ⚠ 7.1 "We do not process sensitive data" versus storing a National ID
The verification design stores a National ID number and renders it on six surfaces. Under Egypt's
Law 151 of 2020 a national identifier is a strong candidate for sensitive personal data. The policy
sentence and the feature cannot both stand.

### ⚠ 7.2 "We do not collect anything from third parties" versus Valify
Valify is a third party and the entire design is *"a hosted redirect… then brings the user back with
the result."* Whatever comes back is data collected from a third party.

### ⚠ 7.3 The enumerated collection list is incomplete
The policy lists names, phone numbers, billing address, hashed PIN. The verification and payout
designs add: **National ID number**, **tax card number**, **IBAN or wallet number**, **account holder
name**, verified date, and possibly ID and selfie images (§1.2, SILENT). None is disclosed.

### ⚠ 7.4 Controller versus processor is unaddressed for provider data
Policy §3: *"If you are a student or a parent, your tutoring center is the controller of your data.
TutoringHQ only processes it on the center's instructions, as its processor."* For a **provider's own
National ID** we are plainly the **controller**, not a processor. The policy has no section for that
relationship.

### ⚠ 7.5 Retention is a heading with no body
Policy §4 is titled *"How long we keep it"* and the design renders **no text under it**. The ID is
kept *"to issue electronic receipts"*, which implies a tax-record retention period nobody has stated.

### ⚠ 7.6 Deletion rights versus a retained tax identifier
Policy §5 grants deletion under the PDPL, qualified by *"Some data may be kept where the law requires
it."* Whether a stored National ID falls inside that carve-out is undecided, and
`/admin/privacy-requests` — which completes deletion requests — has no design showing how an ID is
handled.

### ⚠ 7.7 Admin staff can read the full National ID
`Merged-Admin-Accounts` §01 renders *"National ID on file · Valify · 2 9805 15 01 02345"* to internal
staff. `Merged-Admin-Accounts` §02 (Admin Staff) has permission toggles, **none of which mentions ID
visibility**. There is no least-privilege control drawn.

### ⚠ 7.8 The ID is unmasked while every other identifier is masked
Bank and card identifiers throughout the design set are masked — `CIB ····4821`, `Wallet ····5521`,
`Visa •••• 7937`. The National ID is rendered **in full**, to the provider and to admin. Whatever the
legal answer, the inconsistency is deliberate-looking and probably is not.

### ⚠ 7.9 Identity proof for a data-rights request
Policy §5: *"we will never ask for your PIN to verify you."* The data-rights form is public and
*"never asks for a PIN"*. How a requester is authenticated against a record keyed to a National ID is
undrawn.

---

# 8. Open questions to answer before anyone builds

Ordered by what each one blocks.

### The flow cannot be built without these
1. **Does a failure state exist, or does a failed user simply remain `not verified`?**
2. **Is the check synchronous?** If a user can return before Valify's result lands, what do they see — today they would see "Not verified", which reads as *rejected*.
3. **Do we show a failure reason?** Actionable for the user, informative for a fraudster.
4. **Attempt limit, cooldown, lockout.** Valify charges per check.
5. **Who may start verification — owner only, or any admin?** It unlocks two permissions the design says cannot be delegated.
6. **Is there a manual-review route?** No admin approve, reject or override control exists anywhere.

### The data model cannot be built without these
7. **Do we receive and store the ID image and selfie, or only a pass/fail plus the ID number?**
8. **Do we store a Valify transaction reference for audit?**
9. **Do we store the name read off the ID?** The payout name-match rule needs something to match against.
10. **Retention period, and what happens on account closure.**
11. **Is a stored National ID in scope for a PDPL deletion request, or exempt as a tax record?**
12. **Mask the ID in the UI?** And separately: **which internal roles may see it at all?**
13. **Does verification expire and need renewal?** IDs expire; commercial registrations renew.

### The org model cannot be built without these
14. **Whose identity verifies a center — the owner as a person, or the business?** The design shows *"Al-Nahda Center · verified"* against a personal National ID. A center may present a **commercial registration instead**, which is a business document — so the two paths may produce different kinds of verified entity.
15. **Does verification survive an owner change?**

### Legal, before launch not before build
16. **Every conflict in §7.** The privacy policy is Version 2.0 dated 22 June 2026 and will need a version bump. This is Adsero's call, not ours.

### Two contradictions to resolve while you are here

17. **⚠ The teacher fee rate contradicts the locked rate card.** `Merged-Teacher-Home` §01's lede says an unverified teacher *"self-collects (parents pay them directly, **5% on digital**)"* while a verified teacher *"receive[s] **90%** automatically."* B1 locks **one rate card, 10% collection fee, every provider keeps 90%**. Where the unverified 5% comes from — and what it is charged on, when we are not collecting — is unexplained.

18. **⚠ The teacher opt-in withholds the fee that the receipt discloses.** `Merged-Teacher-Money` §05 deliberately states the fee only as categories under a *"Private to you"* heading, with *"no figures beside them"*, while `Merged-Verification-Payouts` §06 prints **Collection fee (10%)** on the expense receipt and `Merged-Center-Attendance` §02 shows centers **"Collection fee (10%) −75"** at end-of-session. Either teachers see the number at opt-in or they do not.

---

---

# 9. Applying the redirect decision — every frame affected

## 9.0 First, a correction to the premise

**`Merged-Center-Setup` and `Merged-Teacher-Setup` do not show ID uploads. Neither file has any ID
capture UI at all.**

I checked before specifying changes to them, because respecifying screens that already conform is
wasted work:

| File | upload / photo / attach / capture | ID references |
|---|---|---|
| `Merged-Teacher-Setup` | **zero matches** | **zero** |
| `Merged-Center-Setup` | `camera` ×2, `scan` ×20 — **all of them the QR attendance scanner** in §06 Settings Scanner: *"SCAN INPUT · Scan with Camera · Camera Back · ON EACH SCAN · Sound · Vibrate · DUPLICATES"* | **zero** |

**Swept all 26 files for in-app capture vocabulary** — `upload`, `take a photo`, `photo of`, `attach`,
`browse`, `choose file`, `front of your`, `back of your`, `capture`, `ارفع`, `التقط`. Four hits, none
of them ID:

- `Merged-Center-Students` — *"Upload a file · Bring your student list in from a spreadsheet · CSV or Excel, up to 500 rows"*. The student import.
- `Merged-Public-Marketing` — *"lead capture form"* and *"gives the claim something to attach to"*. Prose.
- `Merged-Teacher-Home` — *"Drag to estimate your monthly income"*. The earnings slider.

**So on document capture, the designs already match the decision.** The instinct about *Settings* was
right — the screen is titled *"Identity verification in Settings"* — but it lives in
`Merged-Verification-Payouts` §01, not in either Setup file, and it uploads nothing.

**What actually contradicts the decision is different and narrower: the full National ID number,
rendered on six frames across three screens, plus "on file" language on four more.**

## 9.1 The pattern all verification entry points must follow

Three parts, in this order. **`Merged-Verification-Payouts` §03 already is this** — it is the model,
not a screen needing redesign.

**1 · Explain what is about to happen, before leaving.**
Already drawn correctly in §03: *"To enable payouts, we'll take you to Valify to confirm your National
ID. It takes about 2 minutes."* Plus **WHAT YOU'LL NEED** — *"Your National ID card · A quick selfie
in good lighting"*. Keep verbatim. Naming the document you will need at Valify is not the same as
holding it.

**2 · A button that leaves the app.**
Already drawn: **Continue with Valify**, with the departure stated under it — *"You'll be securely
redirected to Valify and brought back when done."* Keep. It should read as leaving, not as submitting.

**3 · The states on return.** ← **this is the gap.** §03 draws exactly one: *"returned · verified"*.
Five more are needed and none exists anywhere in the 26 files.

| Return state | Trigger | What it must say | Exists? |
|---|---|---|---|
| **Verified** | Webhook confirms pass | Already drawn: *"Valify confirmed your identity. Payouts are now enabled on your account."* → *Set up payout details* | ✅ §03 |
| **Pending** | User returned before the webhook landed | The check is still running; nothing is lost; we will notify. Must **not** read as rejected — today the user would land on "Not verified", which does. | ❌ new |
| **Failed** | Webhook reports a fail | Not verified, what to do next, and whether a reason is shown (**open question 3**). Account unchanged, nothing lost. | ❌ new |
| **Abandoned** | User left Valify without finishing | Returns to the unverified entry point, no error tone. | ❌ new |
| **Expired** | `expires_at` elapsed before use | The link expired; start again. Valify's link API takes `expires_at`, so this state is unavoidable. | ❌ new |
| **Provider error** | Valify unreachable or 5xx | Not the user's fault; try later. Distinct from Failed. | ❌ new |

**Retry** hangs off Failed, Abandoned and Expired, and is undesigned in all three — see open
questions 4, 5 and 6.

## 9.2 Frames that render the full National ID — must change

**Six frames, three screens.** Each renders `2 9805 15 01 02345` or `2 8703 22 01 04412` in full.

| # | Screen | Frames | Renders today | Under the decision |
|---|---|---|---|---|
| 1 | `Merged-Verification-Payouts` §01 Settings Verification | EN center · verified · EN teacher · verified · AR ×2 = **4 frames** | *"National ID on file · 2 9805 15 01 02345"* | Replace the number. Options in §9.4. |
| 2 | `Merged-Verification-Payouts` §06 Receipts | EN teacher payout · EN referral payout · AR ×2 = **4 frames** | *"Dina Fouad · National ID 2 9805 15 01 02345"* on the expense receipt | ⚠ **Blocked on the accountant** — see §9.5 |
| 3 | `Merged-Admin-Accounts` §01 Admin Account Detail | EN center · EN teacher · AR ×2 = **4 frames** | *"National ID on file · Valify · 2 9805 15 01 02345"* | Replace the number. Internal staff have less reason to see it than the owner does. |

*(Frame counts include the Arabic mirrors, which carry the same number in Western digits.)*

## 9.3 Frames that assert we hold it, without rendering it — wording only

Softer, but they describe a storage relationship the decision changes.

| Screen | Text | Note |
|---|---|---|
| `Merged-Verification-Payouts` §01 | *"Your National ID is kept on file to issue electronic receipts for each withdrawal"* · lede: *"keep the National ID on file for the e-receipt"* | The user-facing justification for holding it. Rewrite to match whatever §9.4 lands on. |
| `Merged-Verification-Payouts` §02 | *"recorded as an expense under your National ID"* | Same. |
| `Merged-Verification-Payouts` §06 | *"Logged against the payee's verified National ID"* · *"against the center's verified National ID"* | Blocked with §9.5. |
| `Merged-Admin-Money` §02 Admin Settlement | *"National ID on file"* as a per-teacher row label, ×3 rows, EN + AR | Becomes a verified/unverified indicator; the settlement run needs to know the payee is verified, not what their number is. |
| `Merged-Admin-Money` §04 Admin Receipts | *"tied to a verified National ID"* · *"Expense receipts carry the verified National ID"* | Blocked with §9.5. |

## 9.4 Frames that already conform — leave alone

| Screen | Text | Why it is fine |
|---|---|---|
| `Merged-Verification-Payouts` §03 | *"WHAT YOU'LL NEED · Your National ID card · A quick selfie"* | Tells you what to bring **to Valify**. We never receive it. |
| `Merged-Center-Attendance` §02 | *"About 2 minutes · commercial registration or National ID · secured by Valify"* | Entry CTA. Names the document, holds nothing. |
| `Merged-Teacher-Money` §05 | *"About 2 minutes · National ID · secured by Valify"* | Same. |
| `Merged-CEO` §02 | *"6 of 88 teachers not yet verified, so their fee collection is paused until National ID matching completes"* | Describes matching **at Valify**. |

## 9.5 The one thing that may force the ID number to stay

**`Merged-Verification-Payouts` §06 prints the National ID on the expense receipt**, and the stated
reason is tax: *"Expense receipts carry the verified National ID and feed the monthly write-off"*
(`Merged-Admin-Money` §04), *"Logged against the payee's verified National ID"*.

If Egyptian tax law requires a payee's national identifier on a subcontractor expense receipt, then
we must hold it — and the decision needs a documented carve-out for the receipt pipeline rather than a
blanket "we never store it".

**This is an accountant question, not a design one, and §06 is already stamped Draft — pending legal
and accountant review.** Do not design around it until answered. Two shapes if the answer is yes:

- **Narrow carve-out** — the ID is held encrypted, used only at receipt generation, never rendered in any UI including admin. §9.2 items 1 and 3 still change; item 2 stays.
- **Fetch at issue time** — pull from Valify by transaction ID when a receipt is generated, store nothing. Depends on Valify's image and data retention, which is **undocumented** (§2b, question 2 to Valify).

## 9.6 What replaces the number, if the answer to §9.5 is "not needed"

Three options, cheapest first. **Not choosing between them — this is yours.**

1. **Nothing.** Show *"Identity verified · via Valify · 12/07/2025"* and drop the identifier entirely. Nothing in the twelve Verified screens needs it (§9.7). Cleanest against PDPL §7.1 and §7.3.
2. **Masked last-4** — *"National ID ••••2345"*. Reassures the owner that we verified the right person. Requires storing at least 4 digits, which is a smaller but non-zero footprint, and 4 digits of an Egyptian national ID are low-entropy.
3. **A provider reference** — *"Valify ref VF-8823-0412"*. Zero personal data, auditable, meaningless to the user. Best for admin; poor for the owner-facing frame.

**A reasonable split:** option 1 or 2 on the owner-facing §01, option 3 on the internal
`Merged-Admin-Accounts` §01.

## 9.7 ✅ None of the twelve Verified screens renders the National ID

Checked directly. `Merged-Center-Home`, `Merged-Center-Students`, `Merged-Center-Groups`,
`Merged-Center-Money`, `Merged-Center-Setup`, `Merged-Teacher-Groups`, `Merged-Teacher-Home`,
`Merged-Teacher-Setup` — **zero National ID references between them.**

**So the twelve need less than expected.** Against the expectation of *"a status, a timestamp, a
provider reference, and possibly a masked last-4"*:

| Field | Needed by the twelve? | Evidence |
|---|---|---|
| **status** | ✅ | The Verified badge on all twelve |
| **timestamp** | ⚠️ **Not by the twelve.** Only by `§01 Settings Verification` — *"verified 12/07/2025"* — which is not one of them. Store it anyway; it is one column and the audit needs it. | |
| **provider reference** | ✅ but **never rendered** | Required for the webhook, Transaction Inquiry and Fetch Images. Backend only. |
| **masked last-4** | ❌ **not needed by any of the twelve** | No ID appears on any of them |
| **name-match assertion** | ✅ **and this is the one beyond the expectation** | See below |

### The one field beyond the list

**`Merged-Teacher-Setup` §01 — screen 12 of the twelve — renders a name-match claim.** Its verified
frame shows *"Account holder · Aly Shady · **Matches your verified ID**"*, and
`Merged-Verification-Payouts` §05 states the rule: *"The name on the account has to match your
verified ID. We cannot pay to an account we cannot confirm is yours."*

That badge needs something to have been compared. Two ways, and **only the second is consistent with
the decision**:

- Store `verified_name` and compare on entry → stores a second piece of personal data from the document.
- **Store a boolean `payout_name_matches`, computed once at the moment the provider enters the account holder, then discard the name.** Renders the badge, stores no name.

**Recommendation: the boolean.** The screen shows an assertion, not a name — the name it displays is
the one the provider typed.

### Minimum set

```
verification_status          enum
verified_at                  timestamp
valify_transaction_id        string, backend only, never rendered
payout_name_matches          boolean, set once at payout-details entry
```

**Four fields, one of which is never rendered.** No ID number, no last-4, no document, no image —
unless §9.5 forces the receipt carve-out.

## 9.8 ✅ Confirmed: nothing else in the 105 designs implies we hold the ID

Two sweeps across all 26 files:

- **In-app capture** — `upload`, `take a photo`, `photo of`, `attach`, `browse`, `choose file`, `front of your`, `back of your`, `capture`, `ارفع`, `التقط`. Four hits, all accounted for in §9.0, **none ID-related**.
- **National ID / الرقم القومي** — 37 hits across **six files only**: `Merged-Verification-Payouts` (19), `Merged-Admin-Money` (9), `Merged-Admin-Accounts` (4), `Merged-Center-Attendance` (2), `Merged-Teacher-Money` (2), `Merged-CEO` (1). **Every one is classified in §9.2, §9.3 or §9.4.** Twenty of the 26 files never mention it.

**No design anywhere shows the document itself** — no image, no thumbnail, no "view document", no
preview. The strongest claim any design makes is *"on file"*, which is about the number, not the
document.


# What this document does not cover

`Merged-Verification-Payouts` §04 and §06 are stamped **Draft — pending legal and accountant review**.
§06's teacher payout receipt is a confirmed design error (`NEW-FEATURES.md` C4 and Appendix D4). The
payout mechanics, tax documents and the center→teacher split ride on verification but are separate
decisions, tracked as A13, C3 and C4.

Nothing here is a code question yet. When it becomes one, every column gets checked against
`information_schema.columns` first.
