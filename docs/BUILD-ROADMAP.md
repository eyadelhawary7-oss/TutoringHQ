# Build roadmap

**6 August 2026.** Replaces the old implementation plan, which was phased around verification and
platform payouts.

---

## Where the build actually stands

**The design is finished.** 25 files, 110 screens, both languages, on the token scale.

**The live app does not match it.** Zero screens are visually identical. Work merged before 6 August
was built against a model that no longer exists.

**First job is not building.** It is establishing what already merged is invalid and what still
stands.

---

## Stage 0. Reconcile, before anything else

Claude Code was midway through a build when the model changed. Some of what merged is fine, some is
now meaningless.

**Still good regardless of the model change:**

- The phone identity fix, `+20` E.164 with exact comparison
- The sessions and `session_students` migration, additive
- The `day_of_week` fix for parent alerts and the daily summary
- The Cairo month-boundary fix
- The import and export row-loss fixes
- The reject-route fix and `inactive_reason`
- The cross-tenant grant lockdown
- The referral table consolidation onto `referral_commissions`
- The pay-window re-anchor

**Now invalid, built for a model that is gone:**

- Anything referencing verification, Valify, or verified account states
- Anything about platform payouts, withdrawals, or bank destinations
- The 90/10 split and the percentage collection fee
- Card, Fawry and Vodafone Cash as tuition methods

**Deliverable:** a list, per merged PR, of which bucket it falls in. Nothing else starts until that
exists.

---

## Stage 1. The InstaPay flow

The minimum for a working product. Steps 1 to 4 in `design/NEW-FEATURES.md`.

| | |
|---|---|
| **1.1** | Payment method on the attendance record, defaulting to InstaPay. The one-way transition guard. |
| **1.2** | Invoice creation carrying the 10 EGP line. The WhatsApp invoice link. |
| **1.3** | The parent upload page, the tokenised link, and the reader. |
| **1.4** | View and confirm. Nothing is a payment until this exists. |

**1.3 is gated by an accuracy test against real screenshots**, not by the code being written.

Everything after Stage 1 is additive. If the build stalls partway through Stage 2 it stalls
somewhere usable.

---

## Stage 2. The rest of the fee flow

| | |
|---|---|
| **2.1** | Batch list upload. The second evidence path. |
| **2.2** | Duplicate reference handling, both claims to the provider. |
| **2.3** | The service fee bill, accrual, and the ride-on-subscription choice. |

---

## Stage 3. Credit

Depends on nothing in Stages 1 and 2, so it can run in parallel.

| | |
|---|---|
| **3.1** | Referral commission at 25/10/5 on plan value ex-VAT, with the settlement window. |
| **3.2** | The balance, on dashboards and applied before the total on every paying page. |
| **3.3** | Sending credit between accounts. |
| **3.4** | The balance ledger, with references neither side can delete. |

---

## Stage 4. The visual pipeline

Every non-protected screen brought to visual identity with its design.

Runs at 10 concurrent agents, one build agent per **file** rather than per screen. Claim-file mutex,
worktree isolation verified active before release.

**The six protected files are excluded** and come to Eyad per PR.

---

## Stage 5. The seven defects

Independent of everything above. Two of them cost correctness today.

Listed in `STATE-OF-PLAY.md`. Numbers 1 and 2 first: `payout_requests` has no approval path, and
credit-withdrawal approval double-pays on a double-click.

---

## What gates launch, and none of it is code

| | Owner | Note |
|---|---|---|
| `first_charge_release` flip | **Nobody yet** | 30 August floor. Silent failure if missed. |
| Paymob live credentials | Eyad | Still test mode. |
| WhatsApp template approvals | Eyad | 24 to 48 hours each. |
| Legal documents rewritten | Eyad and Adsero | Every draft describes the old model. |
| PDPC licensing answer | Legal advisor | Open since 26 July. |
| VAT registration | Eyad | Overdue since March. |
| Penetration test | Eyad | Before any real center loads student data. |

**Building faster does not move any of these.**

---

## What is deliberately not in this roadmap

**Card orders.** Parked. The screens exist and the revenue line reads zero.

**TutoringBot.** Post-launch.

**Analytics, benchmarks and team seat pricing.** Zero for now.

**Cash-out of referral credit.** With the tax advisor. If allowed, the lock copy changes and sending
credit becomes a different regulatory question.
