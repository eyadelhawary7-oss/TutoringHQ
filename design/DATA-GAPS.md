# Data gaps — where a design shows data that may not exist

**Written 27 July 2026. Audit only, no code.**
Companion to the build order in `IMPLEMENTATION-PLAN.md`.

## Method, and its limit

Checked each design screen's data-bearing claims against **live code** — TypeScript types, the columns
each query actually selects, API route shapes, and `src/lib` helpers.

**⚠ This is not a live-catalog check.** The Supabase MCP connection has been dropping, and the
standing rule is that a column is only proven by `information_schema.columns`. **Every "exists" below
means "the code selects or types it", not "I saw it in the catalog."** Confirm before any of these
enters a query.

Confidence is marked per row:

| | |
|---|---|
| **✅ Exists** | A helper, table or route already supplies it |
| **🟡 Derivable** | No stored field, but computable from what exists — no new column |
| **🔴 Needs a decision** | No source. Either a new column, a new integration, or drop it from the design |
| **⛔ Blocked** | Depends on verification, which is blocked on Adsero |

---

# 1 · The roster unpaid tile — RESOLVED, and I was wrong

**PR #188, `Merged-Center-Students` §01.** The design shows *"Unpaid · 14 · 4,200 EGP due"*. I shipped
the count without the amount, reasoning that the roster query selects `payment_status` but no balance
column.

**That reasoning was right about the roster's own query and wrong about the answer. No new column is
needed. 🟡 Derivable — and the API for it already exists and was built for exactly this case.**

`src/lib/studentBalance.ts` exposes `getStudentBalances(supabase, { centerId })`. Its own docstring:

> *"Restrict to one center (**preferred for 'list many students' screens**)."*
>
> *"It is SET-BASED: a fixed number of bulk queries regardless of how many students a screen lists, so
> listing many students never becomes N+1."*

And the amount has a purpose-built function beside it:

> `sumOutstanding(balances)` — *"Total OUTSTANDING (money owed to the center) across a set of balances:
> sum of POSITIVE balances only — credits (negative balances) are not netted against other students'
> debt."*

**That is the design's two figures exactly:** count = balances where `balance > 0`; amount =
`sumOutstanding()`.

**Why it is trustworthy.** The charge is the **snapshotted** `attendance_scans.charged_fee` written at
scan time, not re-derived from the live group price — *"so editing a group's price or deleting the
group does NOT rewrite recorded history."* It is the same helper the student-detail balance and the
finance views use, which is the whole point: *"Every screen must compute through this helper so the
number can never disagree between screens."*

**There is deliberately no `students.balance_due` column and there should not be one.** The helper says
so: *"it never existed — selecting it made PostgREST 400 the whole query."* That is the July 8 outage.

**Cost of doing it properly:** three extra bulk queries on roster load (students, attendance_scans,
payments). The helper was designed to absorb that; it is a performance question, not a correctness one.

**Recommendation: build the amount.** No decision needed from you unless you want to weigh the extra
queries. My §01 commit is more conservative than it needed to be and should be revised before #188
merges.

---

# 2 · The rest, in build order

The six money-and-auth files are excluded throughout — they are never touched.

## Phase A

### `Merged-Center-Home`

| Screen | Design shows | Status |
|---|---|---|
| §01 Dashboard Verified | Available / Pending / Unpaid balance, "Processed Thursday", digital share % | ⛔ **Blocked.** Entire screen is the verified state. No provider balance exists. |
| §02 Notifications | Typed rows: payments, absences, new students, overdue fees, orders, payouts, system. Mark-all-read | ✅ `/api/notifications` exists with `mark-all-read`. **🟡 Verify the type vocabulary matches** — the design names seven kinds; confirm the live `type` enum covers them before building the icon map. |

### `Merged-Center-Students` — in progress

| Screen | Design shows | Status |
|---|---|---|
| §01 Roster | Unpaid count **and amount** | 🟡 **Derivable** — see §1 above |
| §02 Student Detail | Live balance, attendance, family, card-order CTA | ✅ All exist. Built. |
| §03 Verified | Per-student payment-link routing, "Covered" status, online/cash payment history | ⛔ **Blocked** |
| §04 Import & Pending | CSV/Excel upload, column matching, review; pending approval queue | ✅ Both routes exist and work |

### `Merged-Center-Groups`

| Screen | Design shows | Status |
|---|---|---|
| §01 Groups | Two stat tiles, copy-invite-link, **8-week attendance heatmap**, Members / Waitlist tabs | ✅ All exist — `AttendanceHeatmap`, `/api/groups/[groupId]/attendance-heatmap?weeks=`, waitlist with `waitlist_position` and `notify-waitlist` |
| §02 Groups Verified | Billing basis per session / monthly / bundle-of-N; "Parents pay [price]" per row | 🔴 **Ruled out by the 26 July decision** — `fee_per_class` only. The parent-price column is ⛔ blocked. Build the `fee_per_class` equivalent, record the difference. |
| §03 Rooms | Capacity, in-use / free chip, clash flags | ✅ Rooms exist; clash flags feed Schedule |
| §04 Branches | Per-branch students, **revenue**, attendance; totals strip | 🟡 Branch revenue — confirm it is aggregated per branch, not just per center. **Check before querying.** |
| §05 Schedule | By time / by room toggle, **room utilisation**, inline conflict flags, week grid | 🟡 `group_utilization` exists as a *benchmark* metric; whether the same figure is available per-room on the schedule is unconfirmed |

### `Merged-Center-Attendance`

| Screen | Status |
|---|---|
| §01 Attendance Verified | ⛔ **Blocked.** Digital/Cash chip, collection-fee summary, payment links. |
| §02 Collect ForMe | ⛔ **Blocked.** The opt-in itself. |

**This whole file is blocked.** Worth knowing before it comes up in the order.

### `Merged-Center-WhatsApp`

| Screen | Design shows | Status |
|---|---|---|
| §01 Templates | Per-template preview, variables, **auto-send toggle** | 🔴 **The auto-send toggle has no live equivalent** — no `auto_send` field found on the templates client. It also spends credit when on, which makes it a money control, not layout. |
| §02 Pack | One-time credit, never expires, two non-fungible balances | 🔴 **Deferred (B5).** Live is a per-parent monthly pack. Different model. |
| §03 Custom Flow | Custom amount, banded rate | 🔴 Same. No custom-amount flow exists. |

## Phase C

### `Merged-Public-Legal`
✅ All four documents and the data-rights form exist. Text is placeholder pending Adsero; that is a
content gap, not a data gap. **Two undrawn confirmation screens** are recorded in the legal ledger.

## Phase D

### `Merged-Center-Setup`

| Screen | Design shows | Status |
|---|---|---|
| §01 Onboarding | Five-step wizard | ✅ Exists |
| §02 Settings | Hub, General, Account | ✅ |
| §03 Settings Billing | Invoices per period, upcoming card | ✅ Rich already |
| §04 Center & Subjects | ✅ | |
| §05 Notifications & Support | ✅ | |
| §06 Scanner | ✅ | |
| §07 Team | **"3 of 5 seats used"**, per-plan seat allowance, "Add seats" add-on | 🔴 **No seat model exists.** No seat count, no per-plan allowance, no add-on. The design itself says the price is *"still to be set"*. Needs your decision — this is a new billing concept, not a column. |
| §08 Team Verified | ⛔ **Blocked** | |
| §09 My Teachers | Four tabs — Teachers, Requests, Slots, Add | ✅ All four exist |

### `Merged-Center-Insight`

| Screen | Design shows | Status |
|---|---|---|
| §01 Analytics | MRR, **month-end forecast**, **projected-revenue bar**, collection-rate gauge, methods donut, revenue by group, **P&L**, **aging report** with WhatsApp reminders | ✅ Mostly. `collection_rate` computed in `/api/analytics/revenue`; `AgingReport` component exists; **P&L is supported** — `center_expenses` carries `rent`, `salaries`, `utilities`, `other`. 🟡 Confirm the month-end forecast: `billingForecast.ts` forecasts *charges*, which is not the same as projected revenue. |
| §02 Benchmarks | Five metrics: **Monthly revenue**, Retention, Attendance, **Average fee**, **New students / mo** | 🔴 **Two of the five do not exist.** Live supplies `attendance`, `revenue_per_student`, `retention_30d`, `group_utilization`. There is **no average fee** and **no new-students-per-month** metric — and the design drops `group_utilization`, which live has. Three of five line up; two need building or dropping. |
| §03 Referrals | Per-referral rate, monthly pay, **days until it drops**, rate-decay timeline | 🟡 **Derivable.** `commission_rate` and `period_month` exist on commission rows; days-to-drop is arithmetic on the referral start date against the **twelve-month** band (not the design's six). |

### `Merged-Center-Orders`

| Screen | Design shows | Status |
|---|---|---|
| §01–§03 Orders, Detail, Checkout | Status timeline, **courier tracking**, delivery address, price summary, four-step wizard | ✅ Bosta integration exists — `bosta.ts`, `bostaShipping.ts`, `autoBookBosta.ts`, shipping rates loader |
| §04 Coming Soon | Teaser + **notify-me** | 🔴 **No destination for the notify-me registration.** No waitlist table found. Small, but it is a write with nowhere to go. |

## Phase E — Teacher portal

| File | Notable | Status |
|---|---|---|
| `Merged-Teacher-Home` §01 | Verified balance half | ⛔ Blocked. Unverified half ✅ |
| §02 Schedule | ✅ | |
| `Merged-Teacher-Students` §01 | ✅ | |
| §02 Student Detail | Drawn as a screen; live is a modal | 🟡 Routing decision, not a data gap |
| `Merged-Teacher-Groups` §01–§03 | ✅ incl. per-group invite queue | |
| §04 Class Session | ✅ `finish_class_and_bill` exists | |
| §05 Session Verified | ⛔ Blocked | |
| `Merged-Teacher-Insight` §01 Analytics | ✅ `teacherAnalytics.ts` exists and labels its forecast an estimate | |
| §02 Teacher Referrals | Recurring teacher referral income, days-to-drop, credit-vs-withdraw | 🔴 **Confirm a teacher referral model exists.** Center referrals are well-built; the teacher equivalent is unverified. The credit-vs-withdraw split is ⛔ blocked. |
| `Merged-Teacher-WhatsApp` §01 | **"Your Pro plan includes 50 a month"**, platform-paid vs teacher-paid split | 🔴 **No plan-included message allowance found.** The platform-paid half depends on collection, ⛔ blocked. |
| `Merged-Teacher-Setup` §01, §02 | Payment details half ✅ · Payout details half ⛔ | |

## Phase F

### `Merged-Public-Marketing`
§01–§03 ✅ — landing, audience and pricing all exist and read from live plan data.
§04 Lead Capture — 🟡 **Confirm `demo_requests` has `area` and `student_count`.** The current stub
writes nothing, so those columns may not exist. **This is the one to check in the catalog first** — it
is the highest-value new build and its insert would fail silently on a missing column.

## Phase G

| File | Notable | Status |
|---|---|---|
| `Merged-Admin-Accounts` §01 | `/admin/teachers/[id]` | 🔴 Route does not exist. Data does. |
| §02 Staff | ✅ | |
| §03 Center Assignments | ⛔ **Do not touch** — different feature, live route is rep commission machinery |
| §04 Admin Referrals | ✅ | |
| `Merged-Admin-Platform` §01 | `/admin/teachers` list | 🔴 Route does not exist |
| §02–§06 | ✅ | |
| `Merged-CEO` §01, §02 | ✅ | |
| §03 Centers Benchmark | Verified vs unverified cohorts, verification rate | ⛔ **Blocked.** Renders 0% until verification ships. |

## Foundations

`Merged-Design-Patterns` §01–§06 — ✅ no data. Component work.

---

# Summary

| | Count |
|---|---|
| 🔴 **Needs a decision from you** | **9** |
| ⛔ Blocked on verification | 10 screens across 7 files |
| 🟡 Derivable or needs a catalog check | 9 |
| ✅ Exists | the large majority |

## The nine that need you

1. **Team seats** (`Center-Setup` §07) — no seat model at all, and the design says the price is unset
2. **Benchmarks metrics** (`Center-Insight` §02) — average fee and new-students-per-month do not exist; `group_utilization` does and the design drops it
3. **WhatsApp auto-send toggle** (`Center-WhatsApp` §01) — no field, and it spends credit
4. **WhatsApp pack model** (§02, §03) — already deferred as B5
5. **Group billing basis** (`Center-Groups` §02) — already deferred as B12
6. **Card-order notify-me** (`Center-Orders` §04) — a write with no destination
7. **Teacher referral model** (`Teacher-Insight` §02) — confirm it exists
8. **Teacher message allowance** (`Teacher-WhatsApp` §01) — no plan entitlement found
9. **`/admin/teachers` and `/admin/teachers/[id]`** — new routes, data exists

## Check in the catalog before building, in this order

1. **`demo_requests.area`, `demo_requests.student_count`** — blocks lead capture, and a missing column fails silently on insert
2. **`notifications.type` enum** — blocks the Notifications icon map
3. **Branch-level revenue aggregation** — blocks `Center-Groups` §04
4. **Room utilisation per room** — blocks `Center-Groups` §05
5. **Teacher referral tables** — blocks `Teacher-Insight` §02

**Nothing in Phase A's buildable screens is blocked on a missing column** once the roster amount is
built through `getStudentBalances`. The gaps cluster in Insight, WhatsApp and Setup — Phase D.
