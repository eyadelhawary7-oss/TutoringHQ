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

**Decide D27 before D26, and treat that as a deadline even though nothing is scheduled.** D27 chooses
how a notification is composed: an i18n key plus params in `in_app_notifications.metadata`, translated
at render. D26 is the decision not to add notification writers yet. There are exactly **two** writers
today, so D27 reverses cleanly right now and gets expensive the moment D26 loosens and more arrive.
**A decision that reverses cheaply now and expensively later has a deadline whether or not anyone set
one.** Both are in `design/FINDINGS.md` under open decisions.

---

## Stage 4. The visual pipeline

Every non-protected screen brought to visual identity with its design.

Runs at 10 concurrent agents, one build agent per **file** rather than per screen. Claim-file mutex,
worktree isolation verified active before release.

**The six protected files are excluded** and come to Eyad per PR.

### Report frames exercised out of frames drawn. Never a single parity fraction.

`MERGED-FILE-MAP.md` counts **frames**, and frames are *states*. A file at 18 frames is 18 states to
reproduce, most of which need data. A single fraction that counts unexercised frames as passing is
the word "done" one level up: it reports parity that was never tested. **Every file reports how many
of its frames could actually be produced, and names the ones that could not.**

### Test tenant readiness, measured 6 August 2026

| | Test Center 333 | Test Owner Center |
|---|---|---|
| Users | 1 owner | **0 — no account exists to log in with** |
| Students / groups / subjects / rooms | 2 / 2 / 2 / 1 | 0 / 0 / 0 / 0 |
| Schedule slots / enrolments / invoices | 1 / 1 / 1 | 0 / 0 / 0 |
| Attendance scans / payments | **0 / 0** | 0 / 0 |

Neither is suspended: `centers.status` is `active` for both and neither has a `subscriptions` row, so
the middleware lets both through. `centers.subscription_status` says `suspended` on 333 and **is not
the column the middleware reads** (see `design/FINDINGS.md` entry 23).

**Center-Groups and Center-Students can start now, structure only.** 2 students give a real roster and
a real student detail; 2 groups, 1 room and 1 slot give the group and schedule screens something to
render. That is enough to compare layout, order and element presence.

**Everything attendance-, money-, insight- or home-shaped must wait for data.** With 0 scans and 0
payments those screens render empty states, and comparing a populated design against an empty screen
establishes nothing.

**Test Owner Center is not a test centre, it is a row.** Zero users means it cannot be logged into at
all. Give it an owner or delete it; it should not sit in the count as though it were usable.

### Frame coverage, measured before diffing (6 August 2026)

Both files' frames were enumerated from the HTML and each checked against the seeded data in Test
Center 333. **20 of 32 frames can be produced. 12 cannot, for three different reasons that need three
different fixes.**

| File | Frames | Exercisable | Blocked |
|---|---|---|---|
| `Merged-Center-Groups` | 18 | **10** | 8 |
| `Merged-Center-Students` | 14 | **10** | 4 |

**Schema-blocked, 3 frames.** All of `Merged-Center-Groups` §03 Branches: overview-one-expanded, add
branch, and the Arabic frame. No branch table exists. **A migration proposal, not a seed.**

**Data-blocked, 6 frames.** Each needs rows that do not exist yet:

- Groups §01 Detail · Waitlist — `students.waitlist_group_id` is set on **0** students
- Groups §04 Day-by-time conflict flag, EN and AR — **0** overlapping same-room slots exist. All 8 slots have a room and none collide
- Students §03 pending requests, request details, and the Arabic frame — `pending_enrollments` holds **0** rows

**Empty-state-blocked, 3 frames.** Groups §01 Empty, Groups §02 Rooms empty state, Students §01
Empty. These need a centre with an owner and no data. Test Center 333 cannot produce them without
destroying the seed, and **Test Owner Center could never have produced them either** — it had zero
users, so it could not be logged into. A second centre with an owner and an empty roster is the
vehicle, and it does not exist yet.

**Report frames exercised out of frames drawn on every file, and name which of these three categories
each blocked frame falls into.** A frame blocked on schema is a migration; a frame blocked on data is
a seed; a frame blocked on emptiness is a second tenant. Collapsing them into one number hides which
fix applies.

**Two screens need a migration, not data.** `Merged-Center-Groups`' Branches screen has **no backing
table of any kind** — the only branch-shaped table in `public` is `branch_user_assignments`. That is a
design with no schema behind it, so it needs a migration proposal before it can be built, and no
amount of seeding changes that. Do not log it as a data gap.

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
