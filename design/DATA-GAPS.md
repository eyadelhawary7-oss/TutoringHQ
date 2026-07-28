# Data gaps — where a design shows data that may not exist

**Written 27 July 2026. Catalog-verified 27 July 2026.**
Companion to the build order in `IMPLEMENTATION-PLAN.md`.

## Method

First pass checked each design screen's data-bearing claims against **live code** — TypeScript types,
the columns each query selects, API route shapes, and `src/lib` helpers.

**Second pass verified every load-bearing claim against `information_schema.columns` on production
(`lczmjpnbuhnsislcvzar`), one SELECT per call.** Code references are no longer accepted as evidence
anywhere in this document. That is the 8 July rule: code referenced `students.balance_due`, the column
never existed, PostgREST 400'd the whole query and fifteen screens went down.

**The catalog pass changed four answers.** Two things I marked missing exist, two things I marked
present do not, and one column I built on turned out to be inert. They are called out in §0 — it is the
most important section in this file.

Confidence is marked per row:

| | |
|---|---|
| **✅ Verified** | Confirmed present in `information_schema.columns` |
| **🟡 Derivable** | No stored field, but computable from verified columns — no new column |
| **🔴 Not found** | Confirmed absent from the catalog. New column, new integration, or drop it |
| **⛔ Blocked** | Depends on verification, which is blocked on Adsero |

---

# 0 · What the catalog changed

Five findings. The first is a live fault, not a design gap.

## 0.1 · `students.payment_status` is inert — and I shipped a tile on it 🔴

The roster tile in PR #188 counted `students.payment_status === 'unpaid'`. The catalog:

```
payment_status | text | NOT NULL | DEFAULT 'unpaid'::text
```

Every write site in the codebase writes `'unpaid'` at creation — `join/pending-enrollment`,
`join/[center_code]/[group_id]`, `onboarding/first-student`, `students/import`, `students/page.tsx`.
**No code path anywhere updates it afterwards.** Live data agrees: all four students carry `'unpaid'`.

The column exists, so nothing 400s. It is worse than a missing column — a missing column fails loudly,
this one renders **"Unpaid = total headcount"** on every roster and looks plausible.

The `'paid'` writes that made it look maintained are on `card_orders.payment_status`, a different
table. **Fixed in #188** — both halves of the tile now derive from the balance helper.

The wider question is whether the column should be dropped or backfilled. That is yours, and it is not
urgent now that nothing reads it.

## 0.2 · `auto_send` — the column exists, on an orphan table 🔴

**Corrected 27 July, second pass. My first correction was also wrong**, in the other direction, and this
is the accurate version.

I first marked the WhatsApp auto-send toggle 🔴 "no `auto_send` field found", having checked
`wa_templates`. I then found the column on `center_message_templates` and re-marked it ✅ "needs no new
column, move it to the build list." **That understated the problem.** There are not two template
tables but **three**, and the one with `auto_send` is wired to nothing:

| Table | Rows | Referenced by | Notes |
|---|---|---|---|
| `wa_meta_templates` | **45** | `whatsapp/page.tsx` → `WhatsAppTemplatesClient` | **The live screen.** Meta's registry: `template_name, category, status, variables_count` |
| `center_message_templates` | **0** | **nothing in `src/`** | Has `auto_send boolean DEFAULT false`, `template_type`, `message_body`, `enabled` |
| `wa_templates` | **0** | `googleDriveBackup.ts`, `dbProxyScope.ts` only | Never read or written by a screen |

`grep -rl center_message_templates src/` returns **no files**. The table is empty and orphaned.

**So the toggle is not a build-list item.** The live Templates screen renders Meta's approved message
*shapes* — a different concept from a per-center automation switch. Wiring `auto_send` in means
adopting an unused table, deciding how it relates to the 45 Meta templates, and building the sender
path that honours the flag. That is a feature with a design decision inside it, not a restyle.

**And it still spends WhatsApp credit with no human in the loop**, so it never auto-merges regardless.

**Verdict: back on the decision list.** The column existing was never the hard part.

## 0.3 · The notifications table is not called `notifications`, and the column is not `type` 🔴→✅

I wrote *"confirm the live `type` enum covers the design's seven kinds"*. Both halves were wrong.

- The table is **`in_app_notifications`**. There is no `notifications` table in `public`.
- The column is **`kind`**, not `type`.
- It is plain `text` — **no Postgres enum, no CHECK constraint**. Verified against `pg_constraint`:
  only a PK and two FKs.
- The table has **zero rows**.

So there is no vocabulary to conform to. The live writers use exactly two kinds —
`card_order_status_update` and `privacy_request` — against the design's seven. Nothing blocks the icon
map; the seven kinds are a **naming decision**, not a schema constraint. Whatever the map uses becomes
the vocabulary. Pick the names once and write them down, because nothing in the database will enforce
them.

## 0.4 · There is no `branches` table, and no `branch_id` anywhere 🟡

`SELECT ... WHERE column_name = 'branch_id'` returns **nothing, in any table**. There is no `branches`
table either. What exists:

```
centers.organization_id                  uuid  NULL
branch_user_assignments (id, user_id, center_id, organization_id, created_at)
```

**A branch IS a center; an organization groups centers.** The design's "Branches" screen is a
multi-center rollup under one `organization_id`.

That makes branch revenue **🟡 derivable with no new column** — it is per-center revenue grouped by
organization, which the finance layer already computes per center. It is not the missing aggregation I
flagged. It does mean the screen's unit is the center, so a single-center org shows one row.

## 0.5 · `demo_requests` — both design columns are absent, and the failure is silent 🔴

The one Eyad asked for first. Full catalog, 12 columns:

```
id, name, phone, email, center_name, status, notes,
assigned_to, handled_at, handled_by, created_at, updated_at
```

**`area` — not found. `student_count` — not found.**

The live route (`/api/demo-request`) inserts `name, phone, email, center_name, status` — all five
verified present, so **live is safe today**.

**The silent failure is real, but it is not where I said it was.** The insert would fail *loudly*: the
route checks `if (error)` and returns 500, so adding `area` to the insert object would 500 every lead
submission — total lead loss with a visible error.

The silence is one layer up. `demoRequestSchema` is a plain `z.object({ name, phone, email,
centerName })`, and **Zod strips unknown keys by default**. Build the design's two fields into the
form and they are posted, silently discarded at the parse, and the route returns `{ success: true }`.
The center believes it sent its area and student count. Nothing errors. Nothing is stored.

**So Lead Capture needs a migration adding both columns, plus the schema and insert, or the two fields
come off the design.** Your call — it is the highest-value new build in Phase F.

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

**Cost of doing it properly: zero.** I was wrong about this too. The roster page *already* calls
`getStudentBalances({ centerId })` to render the per-row balance column, so the total is a sum over
data the page has already fetched. Not three extra queries — none.

**All 15 columns the helper selects are catalog-verified present** before the query was written:
`students.{id, is_active, center_id}` · `attendance_scans.{student_id, status, charged_fee, billable,
center_id}` · `payments.{student_id, amount, status, center_id}`.

**BUILT** in #188 (`9e6a1ff`). Count and amount both derive from the balance helper so the two halves
of one tile can never describe different populations — see §0.1 for why the count had to change too.

---

# 2 · The rest, in build order

The six money-and-auth files are excluded throughout — they are never touched.

## Phase A

### `Merged-Center-Home`

| Screen | Design shows | Status |
|---|---|---|
| §01 Dashboard Verified | Available / Pending / Unpaid balance, "Processed Thursday", digital share % | ⛔ **Blocked.** Entire screen is the verified state. No provider balance exists. |
| §02 Notifications | Typed rows: payments, absences, new students, overdue fees, orders, payouts, system. Mark-all-read | ✅ **Verified, and unblocked** — table is `in_app_notifications`, column is `kind` (free text, no enum, no CHECK, zero rows). The seven kinds are a naming decision, not a schema constraint. See §0.3. |

### `Merged-Center-Students` — in progress

| Screen | Design shows | Status |
|---|---|---|
| §01 Roster | Unpaid count **and amount** | ✅ **Built** (#188 `9e6a1ff`). Both halves through the balance helper — see §1 and §0.1 |
| §02 Student Detail | Live balance, attendance, family, card-order CTA | ✅ All verified. Built. |
| §03 Verified | Per-student payment-link routing, "Covered" status, online/cash payment history | ⛔ **Blocked** |
| §04 Import & Pending | CSV/Excel upload, column matching, review; pending approval queue | ✅ Both routes exist and work |

### `Merged-Center-Groups`

| Screen | Design shows | Status |
|---|---|---|
| §01 Groups | Two stat tiles, copy-invite-link, **8-week attendance heatmap**, Members / Waitlist tabs | ✅ `AttendanceHeatmap`, `/api/groups/[groupId]/attendance-heatmap?weeks=`; `students.waitlist_position` and `students.waitlist_group_id` **verified present** |
| §02 Groups Verified | Billing basis per session / monthly / bundle-of-N; "Parents pay [price]" per row | 🔴 **Ruled out by the 26 July decision** — `fee_per_class` only. The parent-price column is ⛔ blocked. Build the `fee_per_class` equivalent, record the difference. |
| §03 Rooms | Capacity, in-use / free chip, clash flags | ✅ **Verified** — `rooms (id, center_id, name, capacity, created_at)` |
| §04 Branches | Per-branch students, **revenue**, attendance; totals strip | 🟡 **Derivable, no new column** — but not as drawn. There is no `branches` table and no `branch_id` anywhere; a branch is a center under `centers.organization_id`. See §0.4. |
| §05 Schedule | By time / by room toggle, **room utilisation**, inline conflict flags, week grid | 🟡 **Derivable** — `schedule_slots.room_id`, `bookings.room_id` and `group_slot_proposals.room_id` all verified, against `rooms.capacity`. Per-room utilisation is a join, not a new column. |

### `Merged-Center-Attendance`

| Screen | Status |
|---|---|
| §01 Attendance Verified | ⛔ **Blocked.** Digital/Cash chip, collection-fee summary, payment links. |
| §02 Collect ForMe | ⛔ **Blocked.** The opt-in itself. |

**This whole file is blocked.** Worth knowing before it comes up in the order.

### `Merged-Center-WhatsApp`

| Screen | Design shows | Status |
|---|---|---|
| §01 Templates | Per-template preview, variables, **auto-send toggle** | ✅ **Verified — I was wrong.** `center_message_templates.auto_send boolean DEFAULT false`. I checked `wa_templates`, the wrong table. Still a money control (spends credit unattended), so still never auto-merged. See §0.2. |
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
| §07 Team | **"3 of 5 seats used"**, per-plan seat allowance, "Add seats" add-on | 🔴 **Confirmed absent.** No column matching `%seat%` exists in any table. `pricing_plans` is `plan_key, arabic_name, english_name, weekly_student_limit, cost_per_student, setup_fee, is_active, all_in_price` — no seat allowance. The design says the price is *"still to be set"*. A new billing concept, not a column. |
| §08 Team Verified | ⛔ **Blocked** | |
| §09 My Teachers | Four tabs — Teachers, Requests, Slots, Add | ✅ All four exist |

### `Merged-Center-Insight`

| Screen | Design shows | Status |
|---|---|---|
| §01 Analytics | MRR, **month-end forecast**, **projected-revenue bar**, collection-rate gauge, methods donut, revenue by group, **P&L**, **aging report** with WhatsApp reminders | ✅ Mostly. `collection_rate` computed in `/api/analytics/revenue`; `AgingReport` exists; **P&L verified** — `center_expenses (center_id, month, rent, salaries, utilities, other, notes)`. 🟡 Month-end forecast still needs a judgement call: `billingForecast.ts` forecasts *charges*, which is not projected revenue. |
| §02 Benchmarks | Five metrics: **Monthly revenue**, Retention, Attendance, **Average fee**, **New students / mo** | ✅ **Resolved as a design correction, not a data gap** — Eyad, 27 July. `benchmark_snapshots` verified: exactly four metric families, each with `avg`/`p25`/`p50`/`p75` — `attendance_rate`, `revenue_per_student`, `retention_rate_30d`, `group_utilization`. Cohort is `district` + `student_count_tier`. Build the four, **keep group utilisation**, drop average fee and new-students-per-month from the design. |
| §03 Referrals | Per-referral rate, monthly pay, **days until it drops**, rate-decay timeline | 🟡 **Derivable — verified.** `referral_commissions` carries `commission_rate`, `period_month`, `months_since_activation`, `referred_plan_fee`, `commission_amount`. Days-to-drop is arithmetic against the **twelve-month** band (not the design's six). |

### `Merged-Center-Orders`

| Screen | Design shows | Status |
|---|---|---|
| §01–§03 Orders, Detail, Checkout | Status timeline, **courier tracking**, delivery address, price summary, four-step wizard | ✅ Bosta integration exists — `bosta.ts`, `bostaShipping.ts`, `autoBookBosta.ts`, shipping rates loader |
| §04 Coming Soon | Teaser + **notify-me** | 🔴 **Confirmed: no destination.** The only waitlist table is `waitlist_notifications (student_id, group_id, notified_at, response)` — that is the *group* waitlist, unrelated. Small, but still a write with nowhere to go. |

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
| §02 Teacher Referrals | Recurring teacher referral income, days-to-drop, credit-vs-withdraw | 🔴 **Confirmed absent.** All five referral tables are center-to-center *only* — every referrer/referred column is `*_center_id` (`referrals`, `referral_codes`, `referral_commissions`, `referral_rewards`, `referral_reward_records`). No `teacher_id`, no polymorphic referrer. A teacher referral model is a new schema, not a column. Credit-vs-withdraw is additionally ⛔ blocked. |
| `Merged-Teacher-WhatsApp` §01 | **"Your Pro plan includes 50 a month"**, platform-paid vs teacher-paid split | 🔴 **Confirmed absent.** `pricing_plans` has no message-allowance column of any kind. The platform-paid half additionally depends on collection, ⛔ blocked. |
| `Merged-Teacher-Setup` §01, §02 | Payment details half ✅ · Payout details half ⛔ | |

## Phase F

### `Merged-Public-Marketing`
§01–§03 ✅ — landing, audience and pricing all exist and read from live plan data.
§04 Lead Capture — 🔴 **`area` and `student_count` are confirmed absent from `demo_requests`.** Needs a
migration, or the two fields come off the design. Live is safe today — the route inserts only verified
columns. **Full detail and the exact silent-failure mechanism in §0.5.**

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

# Summary — after the catalog pass

| | Count | Change |
|---|---|---|
| 🔴 **Needs a decision from you** | **6** | was 9 |
| ⛔ Blocked on verification | 10 screens across 7 files | unchanged |
| 🟡 Derivable — no new column | 4 | all now proven, none pending a check |
| ✅ Verified | the large majority | |

## The five catalog checks — all closed

| # | Check | Result |
|---|---|---|
| 1 | `demo_requests.area`, `.student_count` | 🔴 **Not found.** Both absent. Migration or drop from design — §0.5 |
| 2 | `notifications.type` enum | ✅ **Unblocked.** Wrong table *and* wrong column; free text, no enum — §0.3 |
| 3 | Branch-level revenue | 🟡 **Derivable.** No `branches` table at all; branch = center under `organization_id` — §0.4 |
| 4 | Room utilisation per room | 🟡 **Derivable.** `schedule_slots.room_id` × `rooms.capacity` |
| 5 | Teacher referral tables | 🔴 **Not found.** Every referral table is center-to-center only |

## The eight that still need you

Was nine, then six, now eight. Benchmarks and the notifications vocabulary are genuinely resolved;
WhatsApp auto-send came **back** on second inspection (§0.2), and `schedule_slots.day_of_week` is new.

1. **`demo_requests` migration** (`Public-Marketing` §04) — add `area` + `student_count`, or drop both fields. Blocks the highest-value new build in Phase F
2. **`schedule_slots.day_of_week` convention** — JS weekday (Sat=6) or Egypt index (Sat=0)? Two live readers disagree; one of the Schedule board or the daily-summary WhatsApp is reading the wrong day. Blocks `Center-Groups` §05
3. **WhatsApp auto-send** (`Center-WhatsApp` §01) — the column sits on an empty, orphaned table. Adopting it is a feature with a design decision inside it. See §0.2
4. **Team seats** (`Center-Setup` §07) — no seat model anywhere, and the design says the price is unset
5. **WhatsApp pack model** (`Center-WhatsApp` §02, §03) — already deferred as B5
6. **Group billing basis** (`Center-Groups` §02) — already deferred as B12
7. **Card-order notify-me** (`Center-Orders` §04) — a write with no destination
8. **Teacher referral model** (`Teacher-Insight` §02) — confirmed absent; a new schema, not a column

The two route builds that needed no decision — **`/admin/teachers`** and
**`/admin/teachers/[id]`** — were built on 28 July and then **closed unmerged on Eyad's
call**: one teacher console, not two. `/ceo/teachers` already covers the data, and it was
checked for the profile-versus-subscription fault the build avoided — it does not have it.
See the Phase E section of `SKIPPED-SCREENS.md`.

## Resolved without you

- **Benchmarks** — your design correction, 27 July. Four metrics, keep group utilisation
- **Notifications vocabulary** — nothing to conform to; naming is ours to choose. Built in #190
- **Roster unpaid amount** — built in #188, and it fixed an inert-column bug on the way
- **Rooms in-use chip** — built in #191, weekly rather than daily, pending decision 2 above

## A note on how twice-wrong entries happen

`auto_send` was marked absent, then present, then "present but orphaned". Each pass was a wider search:
code grep, then catalog, then **cross-referencing the catalog against the code that reads it**. A column
existing is necessary and not sufficient — `students.payment_status` (§0.1) is the mirror case, a column
that exists, is written, and is still dead. **Check the readers, not just the schema.**

## One thing to decide that was not on any list

**`students.payment_status` is dead weight.** NOT NULL, defaults to `'unpaid'`, written once at
creation, never updated by anything. Nothing reads it now that #188 is fixed. Drop it, or backfill and
maintain it — but leaving it is how the next screen counts it and ships the same bug. See §0.1.

**Nothing in Phase A or Phase B is blocked on a missing column.** The real gaps cluster in Setup,
WhatsApp and the teacher portal — Phases D and E.
