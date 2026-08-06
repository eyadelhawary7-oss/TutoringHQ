# New features

**Added 6 August 2026.** Everything that did not exist before, with the logic behind it and where
its screens live.

`NEW-MODEL.md` says what the product is. This says what to build.

---

## 1. Attendance payment default

**Where:** `Merged-Center-Attendance`, screen 02.

**What it replaces:** a two-button method picker on a separate screen, and before that a "digital"
label that meant nothing specific.

### Logic

Marking the room present sets **every student to InstaPay** in one action. Tapping a student
switches that one to cash. No picker, no extra screen.

If InstaPay is off in settings, no pills render at all and the screen is a plain checklist.

The summary line counts both: `4 InstaPay` before anyone taps, `3 InstaPay · 1 cash` after.

### The one-way lock

After the session:

| From | To | Allowed |
|---|---|---|
| Cash | InstaPay | **Yes.** No fee charged yet; the parent receives an invoice. |
| InstaPay | Cash | **No.** The parent was invoiced for the service fee and paid it. |

**The blocked button carries the reason on screen.** A greyed control with no explanation reads as a
bug and generates a support call.

### What this needs

A payment method on the attendance record, defaulting to InstaPay. A transition guard that permits
cash to InstaPay and refuses the reverse. The fee attaches at **invoice creation**, not at method
selection, which is what makes the guard enforceable.

---

## 2. Parent upload

**Where:** `Merged-Public-App`, screen 04. Eight states.

**What it replaces:** a card and wallet checkout through a payment gateway.

### Logic

The parent opens a **short-lived link tied to one invoice for one student**, so identity is already
certain and the receipt is never read to work out who paid.

States drawn: before upload, accepted, wrong image, partial payment. Four more are specified in
`SPEC-instapay-fee-collection.md`.

### Rules

**Never tell a parent they did not pay.** A failed read is a system problem. When in doubt it goes
to the provider, never back at the parent as an accusation.

**A partial payment invites the rest** rather than rejecting what arrived.

**The accepted state says the centre confirms**, not that the payment is complete.

### What this needs

A tokenised link with expiry, an upload endpoint, and the reader. The reader returns structured
fields and **never sees database contents**; comparison happens after extraction.

**It needs an accuracy test against real screenshots before it ships.** A reader that is confidently
wrong is worse than one that fails, because a confident wrong amount gets confirmed by a tired
person at 9pm.

---

## 3. View and confirm

**Where:** `Merged-Center-Money` and `Merged-Teacher-Money`.

### Logic

The provider sees the receipt image, every extracted field, and the invoice it matched to. Then a
confirm button.

**Nothing becomes a payment without that press.** No auto-approval, no timeout.

The copy never claims the platform verified anything. It says the platform read the image and did
not verify the money moved, and asks the provider to confirm only after seeing it in their own
account.

### Duplicate references

Two parents upload the same reference. **The second is not rejected**, because a screenshot may have
been shared and the honest parent must not lose.

Both claims go to the provider **with both images**, and the provider decides. This is the one flag
where being wrong costs a real family real money.

---

## 4. Batch list upload

**Where:** `Merged-Center-Money` and `Merged-Teacher-Money`.

### Logic

A provider filters their own InstaPay history to a date range, screenshots the list, and uploads it.
One image covers many payments.

**Whichever side arrives first creates the record; the second matches into it.** Neither path is
required, because most payments will only ever have one.

A batch row carries amount, sender name and timestamp but **no reference number**, so uniqueness is
sender plus timestamp plus amount. A row that already exists from a parent upload matches into it
rather than creating a second record.

Anything ambiguous **waits for a human** rather than guessing.

---

## 5. The service fee bill

**Where:** `Merged-Center-Money` and `Merged-Teacher-Money`, InstaPay Fee Total.

### Logic

10 EGP accrues per **confirmed** receipt through the month. Failed uploads and retries are not
counted. Cash costs nothing.

At month end it reaches the platform on an invoice, and **every platform invoice carries the 20 EGP
processing fee, VAT inclusive.**

### The choice, and it is worth 20 EGP

| Option | Total |
|---|---|
| Ride on the next subscription invoice | 370 fees + 899 subscription + 20 processing = **1,289** |
| Separate invoice now | 370 fees + 20 processing = **390**, and the subscription still carries its own 20 later |

**The screen shows both totals** rather than describing the difference, and marks the saving on the
card.

---

## 6. Referral programme

**Where:** `Merged-Center-Insight` and `Merged-Teacher-Insight`.

Three screens: dashboard, how-it-works sheet, tracking.

### Logic

**Recurring percentage, not one-time.** 25% month 1, 10% months 2 to 6, 5% thereafter, for as long
as the referred account keeps paying.

**Calculated on plan value excluding VAT.** Each tracking row shows the plan ex-VAT, the rate that
applies this month, and what that produces, so a referrer can see the arithmetic rather than a
figure appearing.

**Paying is the trigger, not signing up.**

**Credit lands after the settlement window.** A refund inside that window would otherwise leave
credit already spent.

### Design decisions worth keeping

**Two metrics only on the dashboard**, referrals and balance. A third competes with the link.

**The lock is stated in the sheet**, not discovered at withdrawal.

**The funnel is exposed on purpose.** A referrer who can see their referral stuck on trial will
nudge them; one who cannot will contact support.

---

## 7. Active balance

**Where:** `Merged-Center-Home`, `Merged-Teacher-Home`, `Merged-Center-Money`,
`Merged-Teacher-Money`.

### Logic

The balance sits **on the dashboard above the day's numbers**, because it is money the account
already has.

On any paying page it is **applied before the total, not offered as an option afterwards**. The line
shows what it covered and what carries forward, so the arithmetic is visible rather than a balance
quietly dropping.

A provider with enough credit pays nothing and sees why.

**Showing it only inside the referral page would mean a provider paying an invoice it already had
the credit for.**

---

## 8. Send credit

**Where:** `Merged-Center-Money` and `Merged-Teacher-Money`.

Three screens: search, amount, confirmation.

### Logic

Search by **name or phone**. The result shows account type and location, because two centers can
share a name and a transfer to the wrong one is not recoverable.

**Credit stays credit on the other side.** It cannot be withdrawn as cash by either party, which is
what keeps this outside money transmission.

**The remaining balance is shown before the button**, not after the transfer when it is too late to
reconsider.

**No overdraft.** You cannot send more than your balance, and there is no borrowing against future
referrals.

**The lock is restated on this screen** rather than assumed known, because this is exactly where
someone expects cash to be possible.

---

## 9. Balance history

**Where:** `Merged-Center-Money` and `Merged-Teacher-Money`.

Two screens: the ledger and a transfer detail.

### Logic

One ledger holding **everything**: referral commissions earned, transfers sent, transfers received,
credit applied to invoices. Filters mirror those real categories.

**Every line carries a reference.** Both parties to a transfer see the same string.

**Neither side can delete a line.** A ledger a user can edit is not evidence of anything, and this
exists precisely for the moment two businesses disagree about whether a transfer happened.

**Credit spent on an invoice appears here like any other movement.** Folding it out would make the
balance appear to drop for no reason.

### The transfer detail

Sender and receiver see the **same screen with the same reference**. When one side says it sent and
the other says nothing arrived, there is a single string both can quote and a single record neither
can alter.

---

## Screens deleted, and why

| Screen | Reason |
|---|---|
| Center Collect ForMe | Said the platform collects and processes money to your bank every Thursday and issues a tax receipt. Every clause false. |
| Parent Payment | Card and wallet checkout through a gateway. Ruled out entirely. |
| Center Withdrawal Verified | Nothing to withdraw. |
| All six Verification-Payouts screens | Verification gone; platform payouts gone. The file is deleted. |

---

## Build order

1. **Attendance payment default and the one-way lock.** Everything downstream depends on a payment method existing on the record.
2. **Invoice creation with the 10 EGP line**, and the WhatsApp link.
3. **Parent upload and the reader.** The accuracy test gates this, not the code.
4. **View and confirm.** Nothing is a payment until this exists.
5. **Batch upload.** Second path, not required for the first.
6. **The service fee bill** and its billing choice.
7. **Referral credit**, then the balance, then sending, then the ledger.

Steps 1 to 4 are the minimum for a working flow. Everything after is additive.
