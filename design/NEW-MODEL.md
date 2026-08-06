# The new model

**6 August 2026.** Read this before touching any screen.

---

## The one sentence

**Tuition never touches the platform.** A parent transfers directly to the center or teacher by
InstaPay, uploads the receipt, and the platform records and matches it.

Everything below follows from that.

---

## What died

Each existed in the previous version and is now **gone**. Not deferred.

| | Why |
|---|---|
| **Identity verification** | No Valify, no verified and unverified states, no gate. Verification existed to enable collection that no longer happens. The two-state account model does not exist. |
| **Online collection through a gateway** | No card checkout for tuition, no wallet, no Fawry. |
| **Platform payouts** | The platform holds no tuition, so there is nothing to pay out. No Thursday settlement, no bank destination, no payout ledger. |
| **The 90/10 split** | The platform does not take a percentage of tuition. |
| **7.5% markup and 1.5% parent processing** | Both replaced by a flat 10 EGP. |
| **Fawry, Vodafone Cash, card as tuition methods** | InstaPay covers wallets. Two methods only. |

If any of these appear in code, a design, or a document, it is stale.

---

## Attendance

**Two options, and attendance is the only way a session is logged.**

**InstaPay is the default for everyone.** Marking the room present sets every student to InstaPay in
one action. Tapping a student switches that one to cash. There is no method picker and no extra
screen, because the common case should cost nothing.

A center with InstaPay switched off in settings sees no pills at all and the screen is a plain
checklist.

### The switch runs one way

**Cash can become InstaPay.** No fee has been charged yet; the parent simply receives an invoice.

**InstaPay cannot become cash.** The parent has already been invoiced for the service fee and paid
it. Reversing would let a center keep a fee the parent funded.

**The screen says why rather than greying a button silently**, or staff read the block as a bug.

Screens: `Merged-Center-Attendance`, Attendance Payment Default.

---

## The two fees, and they are not the same thing

### 10 EGP service fee

One per **confirmed** InstaPay receipt. A visible line on the parent's tuition invoice, funded by
the parent. **It carries no processing fee of its own.**

Charged only on confirmed payments. A parent uploading four times generates one fee. **Cash costs
nothing at all.**

### 20 EGP processing fee, VAT inclusive

On **every** invoice the platform issues to a center or teacher: subscriptions, WhatsApp packs, card
orders, and the monthly service fee bill. **Never on a parent's tuition invoice.**

`lib/processingFee.ts` is the 20 EGP one. **It must never be used for a parent charge.** Conflating
the two is the collision that has already cost this project time once.

### Where the fees ride is a real choice

Accrued service fees can join the next subscription invoice as their own line, paying one 20 EGP
processing fee. Or arrive as a separate invoice and pay a second.

**The screen shows both totals rather than describing the difference.** Riding on the subscription
saves exactly 20 EGP and the card says so.

Screens: `Merged-Center-Money` and `Merged-Teacher-Money`, InstaPay Fee Total.

---

## How a payment becomes real

1. Attendance marks a student InstaPay. An invoice is created carrying the 10 EGP.
2. The invoice link goes to the parent on WhatsApp.
3. The parent transfers to the provider's own InstaPay account and uploads a screenshot.
4. The reader extracts amount, sender, recipient, reference and timestamp.
5. Those are compared against open invoices in the database.
6. **The center or teacher confirms receipt.**

**Nothing becomes a payment before step 6.** No auto-approval, no timeout that approves on its own.
Silently recording money that never arrived is the worst failure this system can produce.

### The second path

A center or teacher can screenshot their own InstaPay transaction list and upload it as a **batch**.
Whichever side arrives first creates the record; the second matches into it. Neither is required,
because most payments will only ever have one.

A batch row carries amount, sender name and timestamp but **no reference number**, so uniqueness is
sender plus timestamp plus amount.

Screens: parent upload in `Merged-Public-App`. Confirm, batch and duplicate handling in
`Merged-Center-Money` and `Merged-Teacher-Money`.

---

## Rules the screens encode

**Never claim the platform verified a payment.** It read an image and compared it to an invoice.
Only the provider can confirm money arrived, by looking at their own account. Every screen says so.

**Never tell a parent they did not pay.** A failed read is a system problem, not an accusation. When
in doubt it goes to the provider.

**Never reject a duplicate reference.** A screenshot may have been shared. Both claims go to the
provider with both images, and the provider decides. This is the one flag where being wrong costs a
real family real money.

**Never identify the student from the receipt.** The upload link belongs to one invoice for one
student, so identity is already certain.

---

## Referral credit

**One engine for every customer type: a recurring percentage commission.**

**25% the first month, 10% months 2 to 6, then 5%** for as long as the referred account keeps
paying.

Calculated on the plan value **excluding VAT**. Each referral row shows the plan ex-VAT, the rate
that applies this month, and what that produces.

**Paying is the trigger, not signing up.** A referral that signs up and never pays earns nothing,
and the screen says so before anyone asks.

**The reward lands after the settlement window**, not at the moment of payment, because a refund
inside that window would leave credit already spent.

**Credit is applied to platform invoices automatically** and **cannot be withdrawn as cash.** That
is what stops fake signups being profitable, and it avoids gateway fees and VAT on money that never
moves.

**State the lock before it bites.** The how-it-works sheet says the balance cannot be withdrawn.
Discovering that at the moment of trying is how a reward becomes a complaint.

**Expose the funnel.** The filter chips mirror real backend states, so a referrer who can see their
referral stuck on trial will nudge them rather than contacting support.

Screens: `Merged-Center-Insight` and `Merged-Teacher-Insight`, Referral Program.

---

## Revenue streams

Every pound that reaches the platform. **Tuition is not revenue; it never arrives.**

| Stream | Note |
|---|---|
| Subscriptions | Monthly and annual plans |
| Service fees | 10 EGP per confirmed InstaPay receipt |
| WhatsApp message packs | |
| WhatsApp parent packs | Priced separately so a reminder pack cannot be spent on marketing |
| Processing fees | 20 EGP per platform invoice, VAT inclusive |
| Branch add-on | 199 EGP / month |
| Per-student overage | Above plan limits |
| Analytics, benchmarks, team seats | **0 for now.** Priced later. |
| Card orders | **Parked.** Coming soon. |
| TutoringBot | **0.** Post-launch AI assistant for centers and teachers. |

Screen: `Merged-Admin-Money`, Admin Fee Collection.

---

## Still open

**Whether referral credit can be cashed out.** With the tax advisor. If it can, the lock copy on the
referral sheet and the send screen both change, and sending credit becomes a different regulatory
question.

**Analytics, benchmarks and team seat pricing.** Zero for now, a number later.
