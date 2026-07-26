# C1 — Identity verification: what the design actually specifies

**Written 26 July 2026. Design-side only, no code.**
Read from `Merged-Verification-Payouts` §01–§06 and every screen that renders a verified state.

**21 of the 105 designs sit behind this.** It is the longest pole in the project and the least
specified thing in the design set.

## The headline

**The design specifies a two-state world: `not verified` and `verified`. That is all of it.**

There is no third state anywhere in 26 files. No in-progress, no failed, no under-review, no expired,
no retry. `Merged-Verification-Payouts` §03 draws exactly two frames — **hand-off** and
**returned · verified** — and there is no *returned · anything else*.

I swept all 26 design files for the vocabulary a failure path would need. Every phrase below returns
**zero matches inside any verification screen**:

> verification failed · could not verify · not match · mismatch · try again · resubmit · under review ·
> in review · being reviewed · takes up to · expired · rejected · unsuccessful · لم نتمكن · أعد المحاولة ·
> قيد المراجعة · مرفوض · فشل

The words do appear elsewhere — "declined" on payment screens, "قيد المراجعة" on admin privacy
requests, "try again" on the auth OTP. **None of them in a verification context.**

So: the six questions below split into **three the design answers** and **three it does not**.

---

# 1. What we collect · SPECIFIED

Two different document sets, and the difference matters because it changes the Valify flow:

| Account type | Documents | Where stated |
|---|---|---|
| **Center** | **Commercial registration OR National ID**, plus a selfie | `Merged-Center-Attendance` §02: *"About 2 minutes · commercial registration or National ID · secured by Valify"* |
| **Teacher** | **National ID only**, plus a selfie | `Merged-Teacher-Money` §05: *"About 2 minutes · National ID · secured by Valify"* |

The hand-off screen (§03) lists what the user needs before starting:

> **Your National ID card** · **A quick selfie in good lighting**

**Capture never happens on our side.** §03 is explicit: *"we'll take you to Valify to confirm your
National ID… the ID scan and selfie happen on their side, then brings the user back with the
result."* Same pattern as Paymob. **Do not build a capture UI.**

**Stated duration: about 2 minutes, one time, ever.** That promise appears on every entry point and
is load-bearing for drop-off — it is not marketing copy to trim.

### Collected separately, and not part of KYC

**Tax status** (`Merged-Center-Attendance` §02, third frame) is a center-entered field, not a Valify
output:

- **Registered** → tax card number on file → we issue an **e-invoice**
- **Not registered** → no tax card → we issue an **e-receipt**
- *"You can change this at any time. If you register later, add your tax card here and we switch you to e-invoices from the next document."*
- *"This only affects the document we issue you for our collection fee. It does not change what you are charged."*

It is a separate field with its own lifecycle. Do not fold it into the KYC record.

---

# 2. What we store · PARTLY SPECIFIED

Every verified frame renders the same four things, so the stored record must carry at least:

| Field | Rendered as | Seen on |
|---|---|---|
| Verified flag | "Verified" badge / chip | ~every verified screen |
| Verified date | *"verified 12/07/2025"* | §01 Settings Verification |
| **National ID number** | `2 9805 15 01 02345`, **in full** | §01, §04, §06, Admin Account Detail |
| Provider attribution | *"via Valify"* / *"Verified by Valify e-KYC"* | §01, §03, §04, Admin Account Detail |

**The stated purpose of storing the ID is receipts**, and the screen says so to the user:

> *"Your National ID is kept on file to issue electronic receipts for each withdrawal."*

It then appears on the teacher subcontractor expense receipt, the referral expense receipt
(`Merged-Verification-Payouts` §06), the admin receipts log (`Merged-Admin-Money` §04) and admin
account detail (`Merged-Admin-Accounts` §01).

### What the design does not say about storage

- **No retention period.** Nothing states how long the ID is kept, or what happens on account closure.
- **No deletion path.** A PDPL deletion request arrives at `/admin/privacy-requests`; nothing says whether a stored National ID is in scope or exempt as a tax record.
- **Document images and the selfie are never mentioned again** after §03. Whether we receive them, store them, or only ever get a pass/fail is undefined.
- **No Valify reference.** No transaction id, no audit trail linking our verified flag back to their check.
- **The ID is displayed unmasked.** Every other identifier in the design set is masked — `CIB ····4821`, `Wallet ····5521`, `Visa •••• 7937`. The National ID is rendered in full, to the user **and to admin staff**. That is an inconsistency, and it is the one I would question first.

---

# 3. What Valify returns · SPECIFIED, AND TOO THIN

The design draws a **binary, synchronous, always-successful** return:

> **Identity verified.** Valify confirmed your identity. Payouts are now enabled on your account.
> → *Set up payout details*

That is the entire contract. No score, no confidence band, no reason code, no partial result, no
asynchronous path.

**⚠ The design draws the redirect and omits the webhook.** §03 says the pattern is *"the same as
Paymob"*. Live Paymob handling is a redirect **plus** a server-to-server callback with HMAC
verification (`verifyHmac.ts`), and the redirect is never the trust anchor. The design shows only the
user-facing return. **Verification state must not be settable from a redirect parameter** — that is a
"click the success URL and become verified" hole. The live `/set-pin` page already models the right
shape: the page render is a UX shortcut, the submit route is the security boundary.

---

# 4. What happens on a failed check · NOT SPECIFIED

**Nothing. It is drawn nowhere.**

This is the single largest gap. Everything below needs a decision from you before anyone builds:

1. **Does a failure exist as a state, or does the user simply stay `not verified`?** Simplest is: no failure state, the user remains unverified and may start again. That is probably right and it is also what the design implicitly assumes.
2. **Is there an in-progress state?** Valify e-KYC is usually near-instant, but if it can take minutes, a user who returns before the callback lands sees… what? Today the design would show them "Not verified", which reads as *rejected*.
3. **Do we surface a reason?** "Blurry photo" is actionable; "check failed" is not. Reasons also leak how the check works, which fraud teams normally avoid.
4. **Does anything change for the account on failure?** I would say no — they keep everything they had. But it should be stated.
5. **Is there manual review?** No admin approve/reject control appears anywhere. Admin sees verification as a **read-only fact** — a badge, an ID on file, an "Unverified" filter chip. If someone legitimate fails repeatedly, today there is no route to a human.

---

# 5. Who can retry · NOT SPECIFIED

No retry affordance is drawn. No attempt limit, no cooldown, no lockout.

Open questions:

6. **Attempt limit and cooldown.** Valify charges per check. Unlimited retries is a cost and a fraud surface; too few is a support queue.
7. **Who may start verification at all?** The design never says. `Merged-Center-Setup` §08 is emphatic that **withdrawing money and changing the payout account are owner-only and cannot be delegated** — but verification itself, which unlocks both, has no stated actor. **My reading: it must be owner-only too**, or a manager verifies with their own ID and unlocks the owner's money. Worth stating explicitly.
8. **Whose identity is it?** For a center, the verified party is a person, but the account is an organisation. If the owner leaves, does verification survive? The design shows the center's own name against "Identity verified" (*"Al-Nahda Center · verified 12/07/2025"*) while storing a personal National ID. Those are not the same thing.
9. **Does verification expire?** Nothing says. IDs expire; commercial registrations renew.

---

# 6. What each state gates · SPECIFIED, and this part is good

The design is precise here. Both types keep everything they already had — **verification only ever unlocks.**

## Center

| | **Not verified** | **Verified** |
|---|---|---|
| Attendance, students, groups, schedule, rooms, branches | ✅ full | ✅ full |
| Record a payment | ✅ by hand, cash and manual methods | ✅ plus digital, automatically |
| **Parents pay in the app** | ❌ | ✅ *"We invoice every parent for you"* |
| **Withdraw collected tuition** | ❌ (no balance exists) | ✅ 1 free payout/month, then priced |
| Referral earnings | ✅ **accrue normally** | ✅ accrue |
| **Withdraw referral earnings to bank** | ❌ *"Verify to withdraw"* | ✅ |
| Spend referral earnings as in-app credit | ✅ | ✅ |
| Payout statements, tax documents | ❌ | ✅ |
| Card orders, WhatsApp packs, subscription | ✅ | ✅ |

**Verified additionally changes shape, not just capability:**

- **Every group collects digitally by default.** Cash stops being a property of a group or a student and becomes *"a switch made for one student in one session, while taking attendance"* (`Merged-Center-Groups` §02).
- **A balance appears** with Pending / Available buckets and Thursday clearing (`Merged-Center-Home` §01).
- **The team permission model splits** into DAILY and MONEY groups, with **two permissions locked to the owner and undelegatable**: *withdraw money* and *change payout account* (`Merged-Center-Setup` §08). Delegatable money permissions are *void an unpaid link* and *set prices and billing basis*.
- **Every billing action records who did it** — *"a session always shows which member of staff ended it."*
- **Records become three lists that must not be merged** — payment confirmations, payout statements, tax documents (`Merged-Center-Money` §05).

## Teacher

| | **Not verified** | **Verified** |
|---|---|---|
| Private groups, students, schedule, sessions | ✅ | ✅ |
| Collect fees | ✅ **manually** — *"Manual until verified. No app payments or automatic receipts yet."* | ✅ automated — *"Students and parents pay you in the app. Receipts are issued automatically."* |
| Auto-collect toggle | ❌ *"Available after verification"* | ✅ |
| Withdraw / instant payout | ❌ | ✅ |
| Referral earnings | ✅ accrue, **credit only** | ✅ accrue, withdraw **or** credit |
| Settings payment section | "Payment details" — where parents pay **them** | "Payout details" — where we send **their** money |
| Cash taken in person | ✅ stays entirely theirs | ✅ stays entirely theirs |

**The rule that holds across both:** *"Earnings keep accruing while unverified."* Verification gates
the **withdrawal**, never the earning. And the locked state still **shows the amount** — hiding the
number removes the reason to verify.

---

# The decisions I need from you

Grouped by what they block.

### Blocking the flow itself

1. **Failure state: does one exist, or does the user just stay unverified?**
2. **In-progress state: is the check synchronous, or can a user return before the result?**
3. **Do we show a failure reason?**
4. **Attempt limit and cooldown.**
5. **Who may start verification — owner only, or any admin?** (I read this as owner-only, since it unlocks two permissions that are explicitly undelegatable.)

### Blocking the data model

6. **Do we receive and store document images and the selfie, or only a pass/fail plus the ID number?**
7. **Retention period, and what happens on account closure.**
8. **Is a stored National ID in scope for a PDPL deletion request, or exempt as a tax record?**
9. **Mask the National ID in the UI?** It is currently rendered in full to the user and to admin staff, while every bank and card identifier is masked.
10. **Does verification expire and need renewal?**

### Blocking the org model

11. **Whose identity verifies a center — the owner as a person, or the business?** And does it survive an owner change?
12. **Is there a manual-review route for a legitimate user who keeps failing?** No admin approve/reject control exists anywhere in the design.

### Blocking nothing, but decide before build

13. **Confirm the trust anchor is a server-side callback, not the redirect return.** The design draws only the redirect.

---

# What this does not cover

`Merged-Verification-Payouts` §04 and §06 are stamped **Draft — pending legal and accountant
review**, and §06's teacher payout receipt is a confirmed design error (see `NEW-FEATURES.md` C4).
The payout and tax-document questions ride on this feature but are separate decisions, tracked as
A13, C3 and C4.

Nothing here is a code question. When it becomes one, every column still gets checked against
`information_schema.columns` first.
