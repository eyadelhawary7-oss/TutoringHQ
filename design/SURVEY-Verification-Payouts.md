# Survey — `Merged-Verification-Payouts`, 6 screens

**Written 28 July 2026.** Survey before building. **Nothing built.** Protected file.

The expectation going in was that this file is almost entirely C1-blocked. **It is** — but the block
was confirmed per screen rather than assumed, and doing so turned up two things worth having: a
missing gate on a live money path, and a draft receipt that contradicts itself three ways.

---

## Verdict

| § | Screen | Verdict |
|---|---|---|
| 01 | Settings Verification | **C1.** The screen *is* the verification state |
| 02 | Verification In Context | **C1** — and it documents a gate live does not have. Below |
| 03 | Payout Verification | **C1.** A hosted Valify redirect |
| 04 | Withdrawal Payout Details | **Partly live.** Referral withdrawal exists; the design's net is wrong |
| 05 | Center Teacher Payouts | **C1 + A13**, and explicitly blocked on Paymob Send |
| 06 | Receipts | **C1 + C4**, draft — and its arithmetic does not hold |

**How complete the C1 block is:** `"Valify"` returns **zero hits across the entire codebase** — no
`.ts`, no `.tsx`. There is no `verification_status`, `is_verified` or `%kyc%` column anywhere in the
`public` schema. C1 is not partially built or stubbed; **nothing exists.**

---

## The finding: live pays out money with no verification gate at all

§02's first frame is the referral page for an **unverified** centre:

> Available to withdraw **1,350 EGP** · **"Verify to withdraw"** · *"Verify your identity to cash out
> referral commissions."* · *"Earnings keep accruing while unverified."*

**Live has no such gate.** `components/referrals/ReferralWithdrawalPanel.tsx` contains no reference
to verification, KYC or Valify of any kind, and neither does anything else in `src/`. A centre can
request a referral payout today without its identity ever having been checked.

So the relationship here is the reverse of the rest of the file. §01, §03 and §05 are screens that
**cannot be built** until C1 ships. §02 documents a **control that should already exist on a live
money path and does not**.

Whether that matters commercially is Eyad's call — referral payouts are approved by hand at
`/admin/withdrawals`, so a person is in the loop. But the design and the product disagree about
whether identity is required before money leaves, and **the design is the stricter of the two**. That
is worth deciding deliberately rather than by omission.

---

## §04 Withdrawal Payout Details — partly live, and the net is understated

The **model is real**: `withdrawal_requests` exists, `/admin/withdrawals` is live with Approve /
Decline, and the design's framing is accurate — *"Centers earn recurring referral commission and
withdraw it."*

**The design's rate is right and its net is wrong.**

| Design | | Live |
|---|---|---|
| Amount 2,100 | | — |
| **"Collection fee" −105** | 5% ✓ | `REFERRAL_WITHDRAWAL_FEE_RATE = 0.05` ✓ |
| **Net payout 1,995** | `2,100 × 0.95` | **Actual net is 1,976** |

Live deducts a **flat 20 EGP first**, then 5% on the remainder —
`referrals.withdrawalFeeNote`: *"A flat 20 EGP processing fee is deducted first, then a 5% withdrawal
fee on the remainder"*, and `lib/referralPayout.ts:6`: `Net received = (gross − processingFee) × (1 − 0.05)`.

So `(2,100 − 20) × 0.95 = 1,976`, not 1,995. **The design omits the 20 EGP entirely**, on the screen
whose whole purpose is showing the admin the net before they approve. Same gap recorded against
`Merged-Admin-Money` §05, here with a number attached.

**Also a naming collision worth catching now.** The design calls this 5% deduction a **"collection
fee"** — on §04 and again on §06. But:

- B1's **collection fee is 10%**, charged on tuition;
- live calls this one a **withdrawal fee** (`REFERRAL_WITHDRAWAL_FEE_RATE`, and the UI string
  `payoutWithdrawalFee` = *"Withdrawal fee (5%)"*).

**Two different fees, two different rates, one name** — structurally identical to the
processing-fee hazard that already has a standing NAMING RULE in `NEW-FEATURES.md`. That rule covers
"processing fee" only. **This is a second instance and is not yet written down.**

*(§04's other half — the centre saving its own payout details, IBAN kept in Western digits, "minimum
200 EGP" — is verification-gated in the design and has no live equivalent.)*

---

## §06 Receipts — the total is exact, the itemisation is not

Draft, and marked *"pending legal and accountant review"*, which is the right status. Recording the
arithmetic so that review has something to work from.

### Frame 1 — parent tax e-receipt

The **headline is B1-exact.** For provider fee `X = 1,000`:

```
provider price   = 1.075 × 1,000 + 7.5   = 1,082.50
parent processing = 0.015 × 1,082.50 + 1.5 =    17.74
parent pays                               = 1,100.24   ← the figure shown
```

**1,100.24 is right**, and it is the same figure `Merged-Admin-Money` §06 shows in its recovery
queue — one number, two files, consistent ✓.

**The line items below it are not.** The receipt shows:

| Line | Amount |
|---|---|
| Tutoring · VAT-exempt educational service | 1,000.00 |
| Collection fee | 65.13 |
| VAT (14%) | 9.12 |
| **Total paid** | **1,100.24** |

`1,000.00 + 65.13 + 9.12 = 1,074.25` — **25.99 short of its own total.** (The VAT line is at least
internally right: `65.13 × 0.14 = 9.12` ✓.) Under B1 the correct itemisation is
`1,082.50 + 17.74`. **A tax document that does not add up is the one kind that must.**

### Frame 2 — teacher subcontractor expense receipt

One document, one 1,000.00 base, **three mutually exclusive deductions**:

| Line | Amount | Implied rate |
|---|---|---|
| Gross tuition base | 1,000.00 | — |
| **Collection fee** | −92.34 | 9.23% |
| VAT (14% on fee) | −12.92 | — |
| Tuition collected | 1,000.00 | *(the base restated)* |
| **Collection fee (10%)** | −100.00 | 10% |
| **Net to wallet** | **850.00** | implies **15%** |

The fee is **92.34** on one line and **100.00** on another, on the same base, in the same receipt.
The net follows from neither: `1,000 − 100 = 900`, and `1,000 − 92.34 − 12.92 = 894.74`. **850.00
matches nothing on the document.**

Only the `−100.00 (10%)` line agrees with B1. The 92.34 looks like residue from a superseded fee
model.

### Frame 3 — referral expense receipt

`200.00 − 10.00 = 190.00` ✓ — 5%, matching live's referral withdrawal rate. Same "collection fee"
naming problem as §04, and the same missing 20 EGP.

---

## §01, §03, §05 — C1 by construction

**§01 Settings Verification** is the verified/unverified state itself. Its content is a decision
record as much as a screen: centres unlock **online collection + withdrawals**, teachers unlock **fee
collection + withdrawals**, and the National ID is kept on file **to issue the e-receipt**. That last
point is the basis of `DECISION-national-id-2026-07-26.md` and is why the ID is standard rather than
sensitive data. **Keep the screen for that reasoning.**

**§03 Payout Verification** is a hosted redirect to Valify — *"the same pattern as Paymob"*, ID scan
and selfie on their side, return with a result. Nothing to build without the integration; the pattern
choice is sound and already proven by the Paymob flow.

**§05 Center Teacher Payouts** is doubly blocked. Beyond C1, its own note says: *"Payment method
options are placeholders until Paymob confirms what Send actually supports."* `NEW-FEATURES.md`
records the same open item. Its economics do reconcile — one free payout a month, splitting eight
ways charges 250 for the other seven → `7 × 250 = 1,750` ✓, matching `Merged-Center-Money` §04's
250 extra-payout band ✓ — and the design's principle is worth preserving: **the centre never stores
its teachers' bank details; each teacher maintains their own method.**

**Note the contrast with `Merged-Teacher-Money` §04**, which prices an instant payout at 300 where
the 250 band applies. §05 uses 250 correctly. Two teacher-payout screens, two answers, already logged
against Teacher-Money.

---

## Figure provenance — summary

| Figure | Screens | Source | Same computation? |
|---|---|---|---|
| Parent total **1,100.24** | §06 frame 1; `Admin-Money` §06 | B1, `X = 1,000` | **Yes** ✓ exact in both |
| §06 frame 1 line items | §06 | — | **No** — sum to 1,074.25 against a 1,100.24 total |
| Collection fee on a payout receipt | §06 frame 2 | B1 = 10% | **No** — 9.23%, 10% and an implied 15% on one document |
| Referral withdrawal fee 5% | §04, §06 frame 3 | `REFERRAL_WITHDRAWAL_FEE_RATE = 0.05` ✓ | Rate ✓, but **net omits the flat 20 EGP** in both |
| The name "collection fee" | §04, §06 | B1's is **10% on tuition**; live's is a **5% withdrawal fee** | **No** — one name, two fees |
| Extra-payout fee 250 | §05; `Center-Money` §04 | none live — A13 | **Yes** ✓ |
| Instant payout fee | `Teacher-Money` §04 | same band | **No** — 300 there vs the 250 band |

---

## What comes to Eyad

**The live gap:** referral withdrawal has **no verification gate** in code, while §02 designs one.
Money leaves today on an identity that was never checked. A human approves each one, so it is a
policy question rather than a hole — but it should be answered on purpose.

**Money, wrong on a live-adjacent screen:** §04's net omits the flat 20 EGP, understating what the
approver is deciding about.

**Before any legal/accountant review of §06:** frame 1 does not sum to its own total, and frame 2
carries three different collection-fee figures. The totals are B1-correct; the itemisation is not.

**Naming, worth a rule:** "collection fee" now means the 10% tuition fee **and** the 5% referral
withdrawal fee. The existing NAMING RULE covers "processing fee" only.

**Keep as reasoning, not as a build:** §01's unlock matrix and the National ID / e-receipt basis;
§05's principle that a centre never holds its teachers' bank details.

**C1:** §01, §02, §03, §05, §06 — five of six, and the block is total. §04 is the only screen with
any live counterpart.
