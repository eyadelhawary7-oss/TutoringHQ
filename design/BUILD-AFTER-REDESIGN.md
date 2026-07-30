# Build after the redesign — the working queue

**Started 28 July 2026. This is the queue, not the archive.**

Open this file, start at the top, work down. Nothing here should need re-deciding.

`NEW-FEATURES.md`, `SKIPPED-SCREENS.md` and `DATA-GAPS.md` stay exactly as they are. They hold the
reasoning, the catalog checks and the audit trail. This file holds the **work**, in the order it can
actually be done, and it is the one that gets updated as the restyle hits new gaps.

## How this is ordered

1. **§1 READY** — nothing blocks it. Build it.
2. **§2 BLOCKED ON EYAD** — one decision from you and it moves to §1.
3. **§3 BLOCKED ON VALIFY** — identity verification, and everything downstream of it.
4. **§4 BLOCKED EXTERNAL** — Paymob, the ETA, Adsero, Meta, an accountant.
5. **§5 DESIGN CORRECTIONS** — edits to the merged files. Not builds.
6. **§6 FOUNDATIONS DEBT** — what the redesign itself left behind.

**§0 SECURITY sits above all of it** and is read first. It is empty in the happy case; it is not empty today.

Every entry carries the same six fields: **what it is** in one sentence · **where it is drawn** ·
**what exists today** · **what has to be built** · **touches** (money / auth / account state) ·
**blocked by**. `READY` in the blocked field means nothing blocks it.

**Touches is not a severity rating, it is a routing rule.** Anything marked money or auth comes to
Eyad regardless of how small the diff looks.

---

# §1 · READY — nothing blocks these

**On the six protected files.** `Public-App`, `Center-Money`, `Teacher-Money`, `Admin-Money`,
`Verification-Payouts` and `Lifecycle` come to Eyad. Two entries below are *drawn* from one of them,
which is not the same thing — **behaviour, not file, decides what comes to you**, and both are
flagged inline with the test applied. Nothing in this section restyles a protected screen.

## R0 · `summer.first_charge_release` is HELD — the 30 August first invoice will not fire
- **What:** the summer trial is fully built and working. The one thing standing between it and revenue is a single config flag that is deliberately off, with no alarm attached to it.
- **Found:** 29 July 2026, tracing the suspension gate. Read from live `platform_config`, not from code.
- **Evidence, live:**

  | key | value |
  |---|---|
  | `summer.promo.enabled` | `true` |
  | `summer.free_until` | `2026-08-16` |
  | `summer.first_charge_floor` | `2026-08-30` |
  | `summer.trial_days` | `14` |
  | `summer.first_charge_release` | **`HELD`** |

- **Why it matters:** `firstChargeAllowed()` (`src/lib/summer/config.ts:138`) is `enabled === true && firstChargeRelease === 'RELEASED'`. While it is `HELD`, no first invoice is issued for any centre. The same flag also makes `isCenterLockedForEnforcement` return `false` globally (`billingLockoutPolicy.ts:305`), which is why nothing is currently locked and why that is not evidence the lock path works.
- **The date:** the first invoice floor is **30 August 2026**. On that morning, either the flag is `RELEASED` and invoices issue, or nothing happens and nobody is told. It is correct today and silently wrong on the 30th.
- **Build:** decide who flips it and when; add a check that fails loudly if `first_charge_floor` has passed while the release is still `HELD`; confirm the first invoice actually issued rather than assuming.
- **Touches:** money. The first-charge path runs through the invoice and Paymob code, so **`Center-Money` and `Admin-Money` are in scope and this comes to Eyad** regardless of how small the flag change looks.
- **Blocked by:** nothing technical. It is a decision plus a guard.

### What HELD does today, and what RELEASED changes

**Today (HELD).** `decideSummerAction` (`src/lib/summer/engine.ts:71-77`), case `enrolled`:
`if (firstChargeReleased && ... todayCairo >= firstInvoiceAt) return issue_invoice` — else `none`.
The code comment is explicit: *"While HELD, the customer stays enrolled, free, and active
indefinitely."* The lock is gated on the same flag (`case 'invoiced'`), so **a HELD operator cannot
lock anyone either**. Nothing charges, nothing locks, nothing expires. No error is raised, because
nothing has gone wrong from the code's point of view.

**On RELEASED.** The next `summer-billing` run issues a first invoice to every enrolled centre whose
`summer_first_invoice_at` has passed, and the lock path arms.

**Who flips it and where.** `platform_config.summer.first_charge_release`, value `HELD` → `RELEASED`
(compared uppercase, `billingLockoutPolicy.ts:270`). Writable through
`PATCH /api/admin/pricing-config` (`route.ts:275`), or by hand in SQL. Note the state is **cached
in-process** with a TTL (`getLockoutPolicyState`), so it is not instantaneous across instances.

**Cron cadence:** `/api/cron/summer-billing`, `0 23 * * *` in `vercel.json:43` — once daily, 23:00 UTC
(01:00 Cairo). `decideSummerAction` returns **one** action per centre per run, so a centre moves
`enrolled → invoiced` on one run and `invoiced → locked` on a later one, never both at once.

### ⚠ What happens if it is flipped LATE — the answer is "they catch up, and that is the problem"

**The invoices are not lost.** The condition is `todayCairo >= state.firstInvoiceAt` — **`>=`, not
`===`**. Flip it on 2 September and the next run invoices the entire 30 August cohort at once. No
revenue is skipped and no period is forfeited.

**But the pay window collapses.** `pay_window_days` is **1** in live config, so
`lockDay = first_invoice_at + 1`. For the 30 August cohort that lock day is **31 August — already in
the past** by the time of a 2 September flip. The sequence becomes:

| run | centre state | action |
|---|---|---|
| 2 Sep 01:00 Cairo | `enrolled`, invoice date passed | **issue_invoice** → `invoiced` |
| 3 Sep 01:00 Cairo | `invoiced`, `lockDay` 31 Aug already past | **lock** |

The centre is invoiced and locked on consecutive runs regardless of how late the flip is — a
15 September flip produces the same one-run gap. The window is not measured from when they were
actually billed, so **the later the flip, the more centres get invoiced and locked back-to-back with
no meaningful chance to pay.** That is the risk in flipping late, not lost revenue.

**Worth deciding before 30 August:** whether a late release should re-anchor `lock_at` to the actual
invoice date rather than the originally-computed one. That is a behaviour change, not a config
change, and it is Eyad's call.

### What proves it actually fired, since the failure mode is silence

Nothing today emits an alert. On **31 August** these should be true, and if they are not, the flip
did not happen or the cron did not run:

```sql
-- 1. the flag is actually released
select value from platform_config where key = 'summer.first_charge_release';   -- expect RELEASED

-- 2. no enrolled centre is still sitting past its invoice date
select count(*) from centers
where summer_status = 'enrolled' and summer_first_invoice_at <= current_date;  -- expect 0

-- 3. invoices exist for the cohort
select summer_status, count(*) from centers
where summer_first_invoice_at is not null group by summer_status;              -- expect invoiced/paid, not enrolled
```

**Build:** a guard that fails loudly when `summer.first_charge_floor` has passed while
`first_charge_release` is still `HELD`. Today that state is indistinguishable from a healthy one.

### Which protected money files the first-charge path touches

`Center-Money` and `Admin-Money`. The issue-invoice step writes `invoices`
(`summerBillingCron.ts:187`) and the pay path runs through Paymob, so the centre billing screen and
the admin invoice views both sit on it. `Lifecycle` is adjacent — the lock action is what moves a
centre into the suspended state those screens describe. **All three come to Eyad**, which is why the
flag flip is not the small change it looks like.

### How the trial dates actually resolve, since the design reads ambiguously

`computeSummerSchedule` (`src/lib/summer/dates.ts:72`) is `trialStart = max(signupDate, freeUntil)`, then `+trial_days`, then the first invoice is floored at `first_charge_floor`. So 16 August is **not** a cutoff and the trial is **not** simply 30 days from signup:

| signs up | trial starts | +14 days | first invoice |
|---|---|---|---|
| 20 July | 16 Aug | 30 Aug | **30 Aug** |
| 20 Aug | 20 Aug | 3 Sep | **3 Sep** |

Everyone joining before 16 August waits until 16 August to start their 14 days; everyone after gets 14 days from signup. A centre signing up on 20 August gets a full trial, not a wall.

## R1 · Lead capture funnel
- **What:** A five-field "have us call you" form at `/talk-to-us` whose submissions land in the existing admin queue and route to the rep who owns that area.
- **Drawn in:** `Merged-Public-Marketing` §04. Receiving end `/admin/demo-requests` has no design — see `NEW-FEATURES.md` Appendix B.
- **Exists:** `POST /api/demo-request`; `/admin/demo-requests` (180 lines, four statuses); `/demo-request` as a 55-line stub with a hardcoded `wa.me` link and no form. Territory data exists on `center_assignments.territory_city`.
- **Build:** the `/talk-to-us` route, five fields, area→territory→rep routing on insert, the submitted state that keeps "Start free trial" on screen, and the new fields surfaced in `/admin/demo-requests`. Decide what `/demo-request` becomes — the two cannot both be the lead door.
- **Touches:** none.
- **Blocked by:** ~~the `demo_requests` migration, D1.~~ ✅ **NOTHING — unblocked 29 July 2026.** Migration `20260728120000` (PR #211, `20a0d74`) was applied to production by hand. Verified in `information_schema.columns` after the apply: `area text NULL`, `student_count integer NULL`, both present on `public.demo_requests`. R1 is buildable now.
- **Do not "improve" away:** it is not a demo booking (no calendar), area is load-bearing not optional, and WhatsApp stays as a third door below the form.

## R2 · Coming Soon pattern — the locked row half
- **What:** The list-row variant of the Coming Soon pattern: shown and locked with a badge, rather than hidden.
- **Drawn in:** `Merged-Lifecycle` §06.
- **Exists:** `src/components/shared/ComingSoon.tsx`, built 28 July, adopted at `/orders` when `card_orders_enabled` is false. Presentational only, gates nothing. The **row** was deliberately not built.
- **Build:** the locked-row variant, and flip `Sidebar.tsx:166` from hiding the Orders item to showing it locked.
- **Touches:** account state.
- **Blocked by:** READY.
- ⚠ **Drawn from a protected file** (`Merged-Lifecycle`). Behaviour test: this changes how an already-gated feature is *presented*, from hidden to visible-and-locked. It gates nothing new, moves no money, and the entitlement check stays where it is in the route. Ship it — but the diff is worth a glance because the field says account state.
- **Design intent:** the full screen always names the working alternative. Hiding the row — what the sidebar does today — is explicitly not the pattern.

## R3 · Teacher earnings calculator as its own screen
- **What:** Pick a plan, set students and average fee, see estimated monthly income.
- **Drawn in:** `Merged-Teacher-Money` §02. Marked `LOOKS LIKE A RESTYLE` in `INVENTORY.md`.
- **Exists:** `src/app/[locale]/teacher/IncomeCalculator.tsx` as a component, not a screen.
- **Build:** promote it to its own surface with the design's layout.
- **Touches:** none — display-only arithmetic, no charge.
- **Blocked by:** READY. Plan naming was settled 26 July.
- **Note:** `Merged-Teacher-Money` is a **protected file**. This entry is the calculator only; anything else in that file goes to Eyad.

## R4 · Empty states, loading states and row-action patterns
- **What:** Six pattern sheets covering the first hour of a real center and the second every day after.
- **Drawn in:** `Merged-Design-Patterns` §01–§06.
- **Exists:** ad hoc per screen.
- **Build:** the pattern set as shared components, then adopt screen by screen.
- **Touches:** none.
- **Blocked by:** READY — the token layer landed in #209, which was its only dependency.

## R5 · Admin teacher ↔ center linking, on a new route
- **What:** An internal view of which teachers are linked to which centers, with an assign form.
- **Drawn in:** `Merged-Admin-Accounts` §03. The design is titled "Admin Center Assignments" but is **not** the live route of that name.
- **Exists:** nothing at this shape. ⚠ **`/admin/center-assignments` is do-not-touch commission machinery** — a different feature that happens to share the name. Confirmed 26 July.
- **Build:** a new route. Do not extend the existing one.
- **Touches:** account state.
- **Blocked by:** READY.

## R6 · Referral rate display, countdown and step-date detail
> ⚠ **No longer READY — moved to D22 in §2, 29 July 2026.** Building this surfaced that
> `/referrals`' entire data source (`referral_reward_records`) is never written by anything live —
> see D22. Adding a rate/countdown display on top of a permanently-empty table would dress up a
> broken pipe as a working feature. Held for Eyad's decision on which table is canonical.
- **What:** Per referral, which rate it is on and when that changes.
- **Drawn in:** `Merged-Center-Insight` §03, `Merged-Teacher-Insight` §02.
- **Exists:** `/referrals` is live and owner-only, reachable from the sidebar rather than the settings hub.
- **Build:** the rate/countdown display against the **live** ladder — 25% → 10% → 5% (D2). The design's month-6 drop is wrong.
- **Touches:** money (read only — displays a commission calculated elsewhere).
- **Blocked by:** **D22** (below). The credit-versus-withdraw block on the same screen is **V4** and stays blocked regardless.

## R7 · Admin teacher list and teacher account detail
- **What:** The teacher half of the admin portal — a solo-teacher list beside the center list.
- **Drawn in:** `Merged-Admin-Platform` §01, `Merged-Admin-Accounts` §01.
- **Exists:** nothing under `/admin` for teachers. `/admin/billing`, `/admin/finance` and `/admin/renewals` already call `normalizeOwnerFilter`, so the data model distinguishes the two customer types — only these screens do not.
- **Build:** both routes, filter chips, and the split of customers / revenue / students across centers and teachers on the overview.
- **Touches:** money (read only).
- **Blocked by:** READY **except the Unverified filter chip**, which needs V1.
- ⚠ **Built 28 July and closed unmerged on Eyad's call:** one teacher console, not two. `/ceo/teachers` already covers the data. Re-read `SKIPPED-SCREENS.md` Phase E before rebuilding this.

## R8 · Card orders coming-soon screen
> ### ✅ CLOSED — built 29 July 2026, PR #231
> `src/components/orders/CardOrdersTeaser.tsx` — the ID-card preview and four-point feature list,
> swapped in for the plain shared `ComingSoon` at the `card_orders_enabled = false` gate in
> `/orders`. The design's own "Notify me when it launches" CTA and the "Notified" confirmation
> state were **not** built, per D7 below — the CTA slot instead carries the same, already-working
> "enable it in Settings" link the gate showed before, unchanged.
- **What:** The teaser a center sees while card ordering is gated.
- **Drawn in:** `Merged-Center-Orders` §04.
- **Touches:** account state.
- **Blocked by (the notify-me control only, not the screen):** the notify-me registration is **D7 in §2** — it is a write with no destination.

## R9 · A centre cannot see its own outgoing teacher-link requests
- **Raised:** 29 July 2026, building R5. Out of scope for that PR and logged here instead.
- **What Eyad described:** "a rejected request is indistinguishable from a pending one, so a centre cannot tell whether a teacher declined or has not answered. Needs a status value and a UI state."
- ⚠ **The premise is narrower than that, and the correction matters** — checked against the live catalog and the live components on 29 July, not against the decision note:

| assumed missing | actually | evidence |
|---|---|---|
| a status value | **exists** | `teacher_center_requests_status_check` allows `pending \| accepted \| declined \| withdrawn`. Both respond routes write `'declined'` **with `responded_at` and `responded_by`**, so a decline is timestamped and attributed, not just distinguishable |
| a UI state | **exists — on the teacher's side** | `src/app/[locale]/teacher/CenterRequestsTracker.tsx:93` already renders the declined branch |

- **The real hole is the CENTRE side, and it is total.** `GET /api/center/teacher-links` already returns every outgoing centre-initiated request with its status and `responded_at`, and **no screen renders any of them** — pending, declined or otherwise. `/my-teachers` → "Requests" mounts `GroupProposalsTab`, which is *group proposals*, a different feature. So the centre owner types a teacher's code, gets a confirmation, and never hears anything again either way.
- **Build:** a centre-side outgoing-requests list against the existing GET. No new column, no new status, no new write — the data is served today and thrown away by the UI.
- **Also affected:** `/admin/teacher-links` (R5) lists pending requests only. Once the centre view exists, the admin screen should show declined alongside them for the same reason.
- **Touches:** account state (read only).
- **Blocked by:** READY.

## R10 · `/students/import` sends a `notes` field the `students` table has no column for — every import with a mapped Notes column fails at insert
- **What:** `src/app/[locale]/students/import/page.tsx`'s `importPayloadAndMembers` unconditionally includes a `notes` key (real value or `null`) on every row it posts to `dbInsert({table: 'students', ...})`. `students` has **no `notes` column** — confirmed live via `information_schema.columns` (the only `notes` column anywhere in the schema is on `pending_enrollments`, a different table). `studentInsertSchema` in `src/lib/validations.ts:136` explicitly declares `notes` as a valid field and passes it straight through its `.transform()` (which only strips `fee`/`monthly_fee`), so nothing upstream of the database catches this — the row reaches `supabaseAdmin.from('students').insert(...)` in `src/app/api/db/route.ts:497` carrying a key with no matching column.
- **Why it matters:** PostgREST rejects an insert referencing an unknown column outright (`PGRST204: Could not find the 'notes' column of 'students' in the schema cache`) — it does not silently drop it. Because the `notes` key is present on every row regardless of value, this is not a conditional edge case: **every batch of every import fails at the insert step**, whether or not any row actually has notes content. Found while investigating the cron fix below, not exercised in the live 4-student dataset (no import has been run against it since the last schema change removed/never-added this column).
- **Build:** stop sending `notes` on the students insert — drop the field from `importPayloadAndMembers`'s row objects (and from `studentInsertSchema`'s pass-through, since nothing valid can use it). If import notes are wanted as real data, they need a real destination (no `student_notes`-style table exists either, confirmed live) — that's a separate, bigger decision; the immediate fix is just to stop constructing an insert that cannot succeed.
- **Touches:** none (bug fix, no design judgment — matches CLAUDE.md's own "confirm it physically exists in the live schema before adding it to a query" rule, applied backwards: this is a column that stopped existing, or never did, out from under a live write path).
- **Blocked by:** READY. Not built yet — found during tonight's cron work and flagged rather than folded into an unrelated PR; surfaced to Eyad directly.

---

# §2 · BLOCKED ON EYAD — one decision each

## ~~D1 · `demo_requests` needs `area` and `student_count`~~ — DECIDED 28 July: add both
- **Decision:** add both columns. Approved by Eyad, 28 July 2026.
- **Was stuck because:** `POST /api/demo-request` exists but the live stub writes nothing, and both columns were confirmed absent from `information_schema`. The failure is silent — an insert naming them fails at runtime, not at build.
- **Status:** migration written — `supabase/migrations/20260728120000_demo_requests_area_and_student_count.sql`. Both columns nullable on purpose; the live endpoint sends neither, and a `NOT NULL` column would 500 it the moment the migration lands. Area stays required **at the form boundary**, which is where `Merged-Public-Marketing` §04 puts it.
- ⚠ **Manual apply.** Branching never auto-applies to production on merge. Apply by hand, confirm both columns in `information_schema.columns`, then let the code deploy.
- **Unblocks:** R1.
- **Source:** `DATA-GAPS.md` §0.5.

## D2 · `schedule_slots.day_of_week` — JS weekday or Egypt index?
- **The decision:** Sat = 6 (JS) or Sat = 0 (Egypt)?
- **Why it is stuck:** two live readers disagree. **One of the Schedule board or the daily-summary WhatsApp is reading the wrong day right now.**
- **Blocks:** `Center-Groups` §05 Schedule.
- **Touches:** this is a live correctness bug, not only a design blocker.

## D3 · `students.payment_status` is dead weight
- **The decision:** drop it, or backfill and maintain it.
- **Why it is stuck:** `NOT NULL`, defaults to `'unpaid'`, written once at creation, **never updated by anything**, and nothing reads it since #188. Leaving it is how the next screen counts it and ships the same bug.
- **Correction, 30 July 2026:** "nothing reads it" does not hold — confirmed live, real readers exist today. Fixed this pass (all swapped to `getStudentBalances`, same helper, same math): the roster and student-detail screens, the `/dashboard` paid/unpaid KPI tile and payment-status donut chart, and `excel-export.ts`'s `buildDashboardExcelBuffer` (its sibling `exportToExcel` has zero callers and was left alone). **Not fixed, flagged instead — see D25:** the `parent-balance-alerts` cron also reads this column to decide who gets a paid WhatsApp message, and needs Eyad before it's touched. Whatever "#188" checked, it did not catch these four. The column's write behaviour is exactly as dead as described above — it was the reader count that was wrong.
- **Source:** `DATA-GAPS.md` §0.1.

## D4 · WhatsApp auto-send
- **The decision:** adopt the column, or design the feature properly first.
- **Why it is stuck:** `center_message_templates.auto_send boolean DEFAULT false` **exists**, but on an empty, orphaned table. Adopting it is a feature with a design decision inside it, and it spends credit unattended.
- **Touches:** money.
- **Source:** `DATA-GAPS.md` §0.2. Marked absent, then present, then present-but-orphaned — **check the readers, not just the schema.**

## D5 · WhatsApp Pack as a one-time top-up
- **What:** Replace the per-parent monthly pack with a one-time credit that never expires.
- **Drawn in:** `Merged-Center-WhatsApp` §02, §03. `LOOKS LIKE A RESTYLE`.
- **Exists:** a per-parent monthly pack. A different model, not a partial one.
- **Touches:** money. **This changes what an existing customer is charged.**
- **Blocks:** D6.

## D6 · Teacher WhatsApp screen and message allowance
- **What:** Balance, what used it, the template list.
- **Drawn in:** `Merged-Teacher-WhatsApp` §01.
- **Touches:** money.
- **Blocked by:** D5, plus the allowance decision itself.

## D7 · Card-order notify-me — a write with no destination
- **The decision:** where does a notify-me registration go?
- **Why it is stuck:** the only waitlist table is `waitlist_notifications (student_id, group_id, …)`, which is about group waitlists, not card orders.
- **Blocks:** the notify-me control in R8 only. The screen itself can ship without it.

## D8 · Team seats as a paid add-on
- **The decision:** the seat model, and the price.
- **Why it is stuck:** **no column matching `%seat%` in any table**, `pricing_plans` has no seat allowance, and the design itself says the price is *"still to be set"*.
- **Touches:** money.

## D9 · Owner notification preferences
- **Decided 28 July: do not build.** Kept here so it is not re-raised.
- **Why:** the whole preference model is absent. The only `notify_*` columns are `students.notify_on_absence` / `notify_on_balance` / `notify_on_scan`, which are **per-student parent** toggles — a different feature, not a partial one. *"Do not build a preference model to satisfy a restyle."*
- **Effect:** `Center-Setup` §05 is skipped, live screen untouched.

## D10 · Scanner behaviour preferences
- **Decided 28 July: do not build.** Kept here so it is not re-raised.
- **Why:** `centers` carries exactly one scanner column, `scanner_default_mode`, which live already exposes. Separately, "Mark attendance automatically" **changes what gets written** to `attendance_scans`, so it is Eyad's regardless of storage.

## D11 · Region and display preferences
- **What:** app language, currency, week start, time format, date format.
- **Drawn in:** `Merged-Center-Setup` §02, the General frame.
- **Touches:** **every formatted number and date in the product.** No money figure changes, but every money figure is re-rendered.
- **Why it is stuck:** needs a storage decision and a formatting-layer decision together.

## D12 · Group billing basis
- **Deferred 26 July.** Live keeps `fee_per_class` only. Build the `fee_per_class` equivalent and record the difference. Deferred, not rejected.
- **Touches:** money.

## D22 · The centre-facing `/referrals` page reads a table nothing live ever writes — a ticking time bomb, not yet a live wrong number only because zero referrals exist yet
- **What:** `GET /api/referral` (feeding `/{locale}/referrals`, the screen every centre owner sees for their OWN referral earnings) reads exclusively from `referral_reward_records`. The live, monthly-scheduled commission engine (`/api/cron/referral-automation`, registered in `vercel.json`, confirmed getting `getRate()` = 25%/10%/5% right) writes exclusively to a **different** table, `referral_commissions`. Neither reads or writes the other's table anywhere.
- **Found:** 29 July 2026, building `Merged-Center-Insight` (R6). Not a survey guess — confirmed by grepping every writer of both tables and cross-checking against `vercel.json`'s registered crons.
- **Evidence:**
  - `src/app/api/cron/referral-automation/route.ts` (the only cron in `vercel.json` for this feature) inserts exclusively into `referral_commissions` (line 189). This is the same table the **admin** dashboards (`/admin/referrals`, `/admin/referrals/commissions`) correctly read — the admin side is fine.
  - `src/app/api/referral/route.ts` (the centre's own `/referrals` page) reads exclusively from `referral_reward_records` (line 41) — a **different** table.
  - The only writer of `referral_reward_records` is `src/app/api/referrals/calculate-rewards/route.ts`. It is **not registered in any cron** (`vercel.json` has no entry for it) and has **no UI caller anywhere in `src/`** — it is reachable only by someone hitting the route directly. It has never run in production.
  - `ReferralWithdrawalPanel.tsx` (the "Withdraw" button on the same page) calls `/api/referrals/payout`, which also reads/deducts against `referral_reward_records` — so a centre's payout request is checked against a balance that can never be anything but zero.
  - Live counts, checked directly: `referrals` = 0 rows, `referral_commissions` = 0 rows, `referral_reward_records` = 0 rows — **matching Eyad's own inventory note that these tables start empty.** This is why the bug hasn't been seen yet: no referral has completed a first paid month, so the cron has never had a row to insert. The moment one does, `referral_commissions` gets a row and `referral_reward_records` still does not — the centre's own `/referrals` page will show 0 EGP forever while the admin dashboard correctly shows the same commission as owed.
- **Why it matters:** this is not hypothetical or already-manifested like D16/D19 — it is a bug that will fire the first time the referral programme actually pays out, silently, with no error anywhere (every query succeeds, it just reads the wrong table). A centre owner who referred someone and is owed money will see an empty page.
- **Build:** pick one table as canonical and repoint the other side. Repointing `/api/referral` and `/api/referrals/payout` at `referral_commissions` (matching the admin side and the live cron) is the smaller change; retiring `referral_reward_records` and `calculate-rewards` entirely is the alternative. Either way, R6's rate/countdown display should be built on top of whichever table survives this decision, not before.
- **Touches:** money.
- **Blocked by:** Eyad's decision on which table is canonical.

## D23 · Adding a branch silently clones the parent's full plan price — there is no "extra branch" add-on
- **What:** `Merged-Center-Groups` §04 draws "Extra branch · 199 EGP/mo · billed via Paymob" as a flat add-on charge.
- **Found:** 30 July 2026, building `Merged-Center-Groups`.
- **Evidence:** `POST /api/branches` clones the parent centre's entire `billing_amount`/`all_in_price` onto the new branch's own `centers` row — a full second subscription at the org's existing plan price, not a 199 EGP add-on. Grepped `199` and "branch add-on" across `src/lib/pricing*` and `docs/PRICING_SPEC.md` — zero hits anywhere; no such price exists in the model today.
- **Why it matters:** if the design's copy shipped verbatim it would misstate what the centre is actually billed — today a second branch is free to add but silently doubles the org's billed plan cost, the opposite problem from what the design describes.
- **Build:** decide the real model — a flat per-branch add-on fee (matching the design), a percentage, or intentionally free — before any "extra branch" pricing copy ships.
- **Touches:** money.
- **Blocked by:** Eyad's decision on the add-on model and price.

## D13 · Advanced Analytics / Benchmarks as paid add-ons
- **Closed 26 July, parked.** Both stay as they are — Analytics keeps `canViewRevenue`, Benchmarks stays free. No purchase flow. Parked until AI features ship.
- Kept here only so a designer reading `Merged-Center-Insight` §01/§02 does not re-open it.

## D14 · Teacher referral model
- **The decision:** a new schema, not a column.
- **Why it is stuck:** **every referral table is center-to-center only.** Confirmed absent, not merely unfound.
- **Drawn in:** `Merged-Teacher-Insight` §02.
- **Touches:** money.

## D15 · "Mark collected" and "Send reminder" on the teacher's student-detail balance card
- **What:** the design's Balance card carries two buttons: `Mark collected` (the teacher confirms a parent paid them directly) and `Send reminder` (nudge the parent about an outstanding balance).
- **Drawn in:** `Merged-Teacher-Students` §02.
- **Found:** 30 July 2026, building `Merged-Teacher-Students`. Not built — this is a WRITE that changes money state, on a screen with no protected-file wall. Per the standing rule, behaviour decides, not filename.
- **`Mark collected` is mostly plumbing, not a new decision.** `POST /api/teacher/private/transactions/[id]/mark-paid` already exists, is already audited (`apply_transaction_transition`, idempotent, ownership-checked), and is already called from two places today — `GroupClassesTab` and the session-detail page. Wiring a third caller from student-detail reuses it; it does not invent new money logic. The one open question is UI, not backend: the endpoint requires a `method` (`cash | instapay | vodafone_cash | other`), so a single-tap "Mark collected" button needs a small method picker, same as the two existing callers already have.
- **`Send reminder` has no existing per-student manual trigger.** The only related code is a bulk nightly cron (`send-balance-reminder`); sending one on a teacher's tap, per student, per outstanding balance, is new functionality, not reuse. It would also spend WhatsApp cost per send, which is the same class of decision as D4/D5.
- **Touches:** money (write), WhatsApp cost (for the reminder).
- **Blocked by:** Eyad's call on whether to build `Mark collected` (small UI reusing an existing endpoint) and, separately, whether/how to build `Send reminder` (new, and cost-bearing).

## D16 · The center-class commission engine is dormant — every teacher's "Owed" figure on `Merged-Teacher-Setup` §02 reads 0.00 EGP, live, today
- **What:** the design's hero ("Owed to you across centers", This month / All time) and the per-center "Owed" figures are drawn as one populated block. Live, this is split across two already-shipped components — `CenterCutsSection` (`/api/teacher/center-cuts`) and `CenterEarningsSection` (`/api/teacher/center-attendance`) — and both read `transactions.kind = 'center_fee'`, which has never had a row written to it in production.
- **Drawn in:** `Merged-Teacher-Setup` §02.
- **Found:** 29 July 2026, building `Merged-Teacher-Setup`, via an independent verification pass then confirmed directly against the live catalog and code (not taken on the pass's word — see the standing rule on AI summaries not being evidence).
- **Evidence, live and code, both checked:**
  - `select count(*) from transactions where kind = 'center_fee'` → **0**, ever.
  - The only function that would create such a row, `finish_center_class_and_bill`, exists in the database (`pg_proc` confirms it) and is fully correct — but `grep -rn "finish_center_class_and_bill" src/` finds **zero `.rpc()` call sites** anywhere in the app.
  - Both real "finish a session" endpoints — `teacher/private/schedule/sessions/[sessionId]/finish` and `teacher/private/groups/[groupId]/sessions/[sessionId]/finish` — explicitly gate `group.kind !== 'private' → 403 not_your_session` and call the sibling function `finish_class_and_bill` instead. **No route in the app can ever finish or bill a `kind = 'center'` session.**
  - Even if it were called, `finish_center_class_and_bill` never populates `transactions.teacher_net` / `snap_teacher_pct` — it only sets `amount_billed` (the centre's cut). The read side computes the teacher's cut from `teacher_net`, falling back to `snap_teacher_pct * amount_billed`, falling back to 0 — so it would still read 0 for center-fee rows. `src/app/api/teacher/center-cuts/route.ts` already carries its own comment saying so: *"no current write path populates it… the center-fee billing path is not yet live… When the Paymob split finalizer lands and writes teacher_net, this picks it up automatically."* This is pre-existing, self-documented product debt, not a silent regression.
  - Separately, the design's proposal-card subtraction ("Student rate / You earn / Center keeps") reads off `student_groups.fee_per_class` and `center_cut_egp`, which **are** live and populated — a different, working negotiation model. No UI computed "You earn" for it until this PR; that display-only gap is fixed here (see the PR notes), since it is pure arithmetic on already-real values with no dependency on the broken ledger.
- **Why it matters:** unlike V4 (dormant schema nothing reads), this is **already-shipped UI** reading a real, empty ledger. Every teacher with a center group sees "Owed: 0.00 EGP", "This month: 0.00 EGP", "All time: 0.00 EGP" and every attendance-session row shows "earned: 0.00 EGP" — for everyone, always, today, in production, independent of this redesign.
- **Build:** pick one commission model for center-run classes — the live flat-cut negotiation model (`fee_per_class − center_cut_egp`, already surfaced in proposals) or a percentage-split model (matching the unused `teacher_net` / `snap_teacher_pct` / `teacher_split_pct` columns) — and wire a real finish-and-bill path for `kind = 'center'` sessions. Until decided, the hero and tiles are left exactly as they are: honestly reading real (zero) data rather than being restyled to look more finished than the product is.
- **Touches:** money.
- **Blocked by:** Eyad's decision on which commission model to build and wire.

## D17 · `JoinCenterCard`'s "Share your profile" tab links to a page that does not exist
- **What:** the "Share your profile" tab renders a link and QR code at `https://tutoringhq.app/teacher/profile/<teacherId>` for a center owner to open and add the teacher directly.
- **Drawn in:** `Merged-Teacher-Setup` §02, "Join a center" → the second tile.
- **Found:** 29 July 2026, building `Merged-Teacher-Setup`.
- **Evidence:** no route matches `/teacher/profile/[id]` anywhere under `src/app/[locale]/` (checked by glob across the whole app router tree). `src/app/api/teacher/profile/route.ts` is the authenticated teacher's own profile API, not a public page. The shared link and QR both lead to a 404 today.
- **Build:** a public, unauthenticated teacher-profile page a center owner can open from the link or QR. A new page, not a restyle — same class of hole as R9 (Teacher Link Rejection).
- **Touches:** none to build the page itself; once it exists, whatever "add this teacher" action it offers touches account state and comes back to Eyad then.
- **Blocked by:** Eyad's decision on whether/when to build the page. Left as-is in the meantime — it matches the design, and hiding a designed feature is itself a decision beyond restyle scope.

## D18 · §03's "manual approval" premise doesn't happen — every enrollment auto-activates today
- **What:** `Merged-Teacher-Groups` §03 draws a request-review screen: a pending student waits for the teacher to Approve/Decline, with request detail (grade, school, a note from the requester, how they found the group).
- **Drawn in:** `Merged-Teacher-Groups` §03 (Teacher Group Invite Pending).
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`, via an independent verification pass, then re-confirmed directly against the live RPC and both live callers.
- **Evidence:** `create_enrollment` (`pg_get_functiondef`, live) only lands `status = 'pending'` unless the group's `approval_mode = 'auto_cap'`. `groups/route.ts:232` hardcodes `approval_mode: 'manual'` on every group at creation, and `grep -rn "auto_cap" src/` returns zero hits — no live path ever sets a group to `auto_cap`. But **both** ways an enrollment gets created immediately promote it anyway: `roster/route.ts` (teacher walk-in add, lines 374-399) and `verify-otp/route.ts` (public self-enroll link, lines 238-257) each call `apply_enrollment_transition(..., 'active', ...)` unconditionally right after `create_enrollment` returns `'pending'`. Both carry code comments explaining this is intentional. Net effect: an enrollment only stays `pending` if that best-effort auto-activate call itself errors — §03's entire "review before they join" premise doesn't occur on the happy path for either route into the roster.
- **Also missing, and needs new schema if the gate becomes real:** the request-detail fields the design draws. `students.grade_level` exists and is now surfaced (this PR); "school" has no column anywhere on `students`; "note from the requester" has no backing column on `enrollments` at all (its exact columns are `id, group_id, student_id, status, payer, source, approved_by, joined_at, created_at`).
- **Why it matters:** any product narrative built on "you review who joins" is false today — a teacher who thinks pending review is protecting their roster is not being protected by it.
- **Build:** decide whether a real review gate is wanted (set `approval_mode` per group, stop the auto-activate calls, add the missing `school`/note columns for the request-detail screen) or whether §03 should be redrawn around the reality that joining is already instant.
- **Touches:** account state (who gets to join a teacher's group, and when).
- **Blocked by:** Eyad's decision on which behaviour is correct.

## D19 · Private-lesson commission columns are never populated — Teacher Analytics revenue reads 0.00 EGP, live, today
- **What:** `finish_class_and_bill` (the ACTIVE, correctly-called function for finishing a teacher's own private-group session — not to be confused with `finish_center_class_and_bill` in D16) inserts every `kind = 'lesson'` charge without `teacher_commission_amt`, `teacher_net`, `platform_gross` or `platform_net` — all four stay at their `NOT NULL DEFAULT 0`.
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`, confirmed independently via `pg_get_functiondef('finish_class_and_bill')` and `pg_get_functiondef('compute_lesson_money')`.
- **Evidence:** `compute_lesson_money(p_lesson_fee, p_method)` is a live SQL function clearly built to populate exactly these four columns (`teacher_net := lesson_fee` for cash-class methods) — but it is called by **zero** code anywhere (`grep -rn "compute_lesson_money" src/` finds nothing; it's independently listed as a "ghost" function in `docs/SCHEMA_GHOST_INVENTORY.md`). `src/lib/teacherAnalytics.ts:702-710` sums exactly `teacher_net` for `kind='lesson', status='paid'` to drive the Teacher Analytics revenue figure.
- **Why it matters:** the Teacher Analytics page reads **EGP 0 revenue for every teacher's private-group income, always**, regardless of real collected money — a live, wrong number today, independent of this redesign. (The separate teacher Income page is correct — it reads `amount_billed`, not `teacher_net`.)
- **Build:** wire `finish_class_and_bill` to call `compute_lesson_money` and populate the four columns, or repoint Teacher Analytics at `amount_billed` like Income already does — a money-correctness decision, not a restyle.
- **Touches:** money (a live, wrong number).
- **Blocked by:** Eyad's decision on which fix is correct.

## D20 · Two divergent "run a class" builds exist; only one is reachable
- **What:** `src/app/[locale]/teacher/(portal)/groups/[groupId]/sessions/[sessionId]/page.tsx` is the route `INVENTORY.md` maps §04/§05 to. It is fully built and correct, but **zero live navigation reaches it** — confirmed by grepping every `href`/`router.push`/`Link` in the teacher app for that route pattern. The actual live surface for running a class is `SlotActionSheet.tsx`, opened from `/teacher/schedule`.
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`.
- **Why it matters:** the two implementations are not identical, and each has something the other lacks. The orphaned page has mark-collected on the session record (all four payment methods: `cash | instapay | vodafone_cash | other`) and a simpler single confirm-and-finish flow. `SlotActionSheet.tsx` has Start/Reschedule/Cancel/live-attendance/guest-attendees — materially more of the design — but its recorded-session view is **read-only**: no mark-collected button exists there at all, and its sibling `GroupClassesTab`'s inline collect only offers `cash`/`instapay` (Vodafone Cash is silently unreachable from it, despite the API/DB supporting it).
- **Build:** decide whether to retire the orphaned page, link it in as-is, or move its mark-collected capability into `SlotActionSheet`'s recorded phase (reusing the existing, already-audited `mark-paid` endpoint — the same "mostly plumbing" shape as D15, and held for the same reason: it is a money-state write on a screen that doesn't have one yet, and behaviour decides regardless of file). Also decide whether to add Vodafone Cash to `GroupClassesTab`'s collect dropdown, which is the same category of decision for the same reason.
- **Touches:** money (write, once either fix is chosen), and account state (which page teachers actually use to run a class).
- **Blocked by:** Eyad's decision on which surface is canonical and whether to wire the missing collect paths.

## D21 · The self-enroll join link uses the full group UUID, not the design's 6-character code
- **What:** the design draws `tutoringhq.app/j/7K2M9P`, a short code. Live, `GroupJoinLinkCard.tsx` builds `https://tutoringhq.app/ar/join/g/<full-UUID>`.
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`.
- **Why it matters:** shortening it is a URL-scheme change (a new short-code table or column, a lookup, and a decision on collision/rotation), not a copy change — the same class of decision as the admin teacher-link short codes elsewhere in this codebase.
- **Touches:** none directly; a URL scheme change on an already-live, already-shared link is worth flagging before touching regardless.
- **Blocked by:** Eyad's decision on whether the short code is worth building, given the full-UUID link already works and is already shared via QR/WhatsApp.

## D24 · `students.is_active` is both the pending-signup gate and a directly-editable "paused" toggle — the roster leak can't be silently filtered
- **What:** `Merged-Center-Students` §01 (roster) draws only active, already-approved students; the design's Pending queue (§04) is a separate screen. Live, `students/page.tsx`'s roster query has no `is_active` filter at all, so students still awaiting sign-up approval (`is_active=false`, inserted by the public join flow, e.g. `src/app/api/join/[center_code]/[group_id]/route.ts`) show up mixed into the main roster before anyone has approved them.
- **Why it's not a mechanical fix:** `is_active` is not a pure "pending" flag. `PATCH /api/students/[id]` (`src/app/api/students/[id]/route.ts:37`) has `is_active` in its allowed-fields set alongside `name`/`phone`/`notes` — center staff can toggle it directly on any existing, already-approved student, presumably to "pause" someone without losing their history. Adding a hard `is_active=true` filter to the roster query would also hide these deliberately-paused students, with no visible trace of why they disappeared.
- **Found:** 30 July 2026, building `Merged-Center-Students` §01.
- **Build:** needs a decision on what `is_active=false` should mean when it is not a pending signup — a distinct "paused" state the roster surfaces with its own filter/badge, or something the roster should keep hiding. Either way it's a UI/semantics decision, not a query filter.
- **Touches:** account state (changes which students are visible where).
- **Blocked by:** Eyad's call on the two meanings of `is_active=false`.

**Built and closed, 30 July 2026.** Before proposing, this was verified two auditors deep and turned out to be four live meanings, not two — full writeup and the definitive answer on why `pending_enrollments` alone can't disambiguate them are in the fuller addendum landing via PR #241. Eyad approved the proposed shape; `students.inactive_reason text` (nullable, `CHECK`'d to `pending_signup | rejected | paused | anonymized`) is applied to production (migration `20260730110000_students_inactive_reason.sql`), and the four real write sites are stamped — including the actual bug fix, `pending/[id]/reject` now also marking the student row instead of leaving it forever indistinguishable from a genuine pause. `'paused'` is a valid value with **no writer** — no pause feature was built, and none should be inferred from the constraint existing. See this PR's own commit message for the full list of write sites.

## D25 · `parent-balance-alerts` cron reads the dead `payment_status` column to decide who gets messaged, and a stale fee field to decide what the message says they owe
- **What:** `src/app/api/cron/parent-balance-alerts/route.ts:63` filters candidates with `.eq('payment_status', 'unpaid')` — the same write-once-at-insert column D3 condemns. The quoted amount (lines 70, 97) reads `students.fee`, which `studentBalance.ts`'s own header documents as a "NULL-in-practice fallback for a group-less scan," not the authoritative price (`student_groups.fee_per_class` is).
- **Why it matters:** this is a live, running, WhatsApp-cost-bearing cron, not a display bug. Today it under-targets (any student whose `payment_status` wasn't left at `'unpaid'` from creation never gets a reminder no matter how much they actually owe) and the amount it quotes to a real parent is very likely wrong whenever `students.fee` doesn't match the group's real per-class fee.
- **Why it's not a mechanical fix:** correcting the filter to real balances (`getStudentBalances`, same helper as the D3 fixes elsewhere this pass) changes who gets a paid WhatsApp message sent to them and what EGP figure they're told they owe — a messaging-cost and customer-communication change, not a pure read-path correction.
- **Found:** 30 July 2026, building `Merged-Center-Students` (D3's other live wrong consumers).
- **Build:** swap the filter to `balance > 0` from `getStudentBalances`, and the quoted amount to that same `balance` (rounded), scoped to `parent_pack_opted_in` centers as today.
- **Touches:** money, messaging cost.
- **Blocked by:** Eyad's decision to proceed with the corrected targeting/amount.

---

# §3 · BLOCKED ON VALIFY — verification and everything downstream

Nothing in this section can start until V1 lands. Ordered so that V1 unblocks the rest.

## V1 · Identity verification (e-KYC via Valify)
- **What:** A one-time hosted identity check that unlocks online collection and withdrawals.
- **Drawn in:** `Merged-Verification-Payouts` §01, §02, §03. **Protected file — comes to Eyad.**
- **Touches:** auth, account state.
- **Blocked by:** **Valify** — a vendor agreement, sandbox credentials, and their hosted flow. Nothing can be stubbed here.

## V2 · Verified as a second account state across the platform
- **What:** Verification is not one screen; it is a second state most of the platform has to know about.
- **Touches:** money, account state.
- **Blocked by:** V1, plus the locked fee model.

## V3 · Online collection — centers ("Collect for me") and teachers ("Collect for you")
- **What:** TutoringHQ invoices each parent, collects, and processes the money.
- **Drawn in:** `Merged-Center-Attendance` §02, `Merged-Teacher-Money` §05, `Merged-Verification-Payouts` §02. **Two protected files.**
- **Touches:** money, account state.
- **Blocked by:** V1 and X2 (tax documents). The **rate card is locked** — 10% collection fee · 7.5% + 7.5 markup · parent processing fee 1.5% + 1.5. Provider screens quote the provider price, never the parent total.
- ⚠ **Naming rule:** the parent-side fee is **PARENT PROCESSING FEE** throughout, and it is a different thing from the flat 20 EGP processing fee on charge invoices. Two fees, one name, fails silently. See D10 in §5.

## V4 · Provider balance, clearing and withdrawal · referral credit vs withdrawal
- **What:** How a verified center or teacher gets collected money out, and whether referral earnings can be withdrawn or only spent as credit.
- **Drawn in:** `Merged-Center-Money` §04, `Merged-Teacher-Money` §04. **Two protected files.**
- **Touches:** money, account state.
- **Blocked by:** V1, V3. Bank-batch mechanics overlap X1.
- **Groundwork already in the catalog, confirmed 29 July while building `Merged-Teacher-Home`:** `transactions.settlement_status` / `expected_settlement_at` / `settled_at` / `settlement_retry_count` all exist, and `teacher_profiles.payout_destination` (jsonb) exists. **All four are entirely dormant** — `select count(*) from transactions where settled_at is not null or settlement_retry_count > 0` returns 0, and `grep -rl "settlement_status\|payout_destination" src/` returns nothing. This is schema scaffolding for exactly this entry, not a partial implementation — nothing computes into it and nothing reads it. Recorded so whoever builds V4 checks it before adding parallel columns, and so a future survey doesn't mistake "column exists" for "feature exists" the way `public.groups` vs `student_groups` already did once (#223).

## V5 · CEO centers benchmark, verified vs unverified
- **What:** An internal comparison of verified against unverified centers.
- **Drawn in:** `Merged-CEO` §03.
- **Touches:** money (read only).
- **Blocked by:** V1 — technically buildable today, but **every row reads 0 / 100% until verification ships**, which is worse than not having it.

## V6 · `Center-Setup` §08 Team Verified · `Center-Home` §01 verified dashboard · `Center-Attendance` §01–§02
- Verified state end to end. `Center-Attendance` is blocked **wholesale** — worth knowing before it comes up in the restyle order.
- **Blocked by:** V1.

---

# §4 · BLOCKED EXTERNAL — not Valify, not Eyad

## X1 · Center → teacher split payouts
- **Blocked by:** **Paymob.** The design says so outright — *"payment method options are placeholders"*.
- **Drawn in:** `Merged-Verification-Payouts` §05. **Protected file.**
- **Touches:** money.

## X2 · Tax documents — ETA e-receipt and e-invoice
- **Blocked by:** **an accountant and legal.** Every frame in `Merged-Verification-Payouts` §06 is unverified against real ETA requirements.
- **Touches:** money.

## X3 · Admin money ledgers for online collection
- **Drawn in:** `Merged-Admin-Money` §01, §02, §04. **Protected file.**
- **Blocked by:** V1, V3, X2.

## X4 · Legal document text
- **Blocked by:** **Adsero.** The routes and layout exist; only the text is missing.
- **Drawn in:** `Merged-Public-Legal` §01.
- **Touches:** none. This is the only external blocker with no money or auth attached, so it can land the moment the text arrives.

## X5 · Self-enrollment and the minor-consent question
- **Blocked by:** **Adsero** for the consent question, **Meta** for the template.
- **Drawn in:** `Merged-Public-App` §03. **Protected file.**
- **Touches:** account state, and **minors' data**.

## X6 · Parent payment page
- **Drawn in:** `Merged-Public-App` §04. **Protected file.**
- **Blocked by:** V1, V3 — there is nothing to pay without collection.

---

# §5 · DESIGN CORRECTIONS — edits to the merged files, not builds

## D0 · The KPI/stat tile is drawn at two different radii across the merged files
- **What:** `Merged-Center-Home` `.kpi` and `Merged-Center-Groups` `.stat` are the same component in
  the product — a bordered figure tile on panel — but the first is drawn at **12** and the second at
  **16**. `Merged-Center-Students` `.kpi` is also **16**.
- **Found:** 29 July 2026, restyling Center Groups.
- **Why the token layer could not catch it:** both 12 and 16 are on the §3 scale (`radius-md` and
  `radius-lg`). A check can only flag values that are off the scale, not two on-scale values used for
  one role. This is the class of drift that survives a token layer.
- **What was done:** nothing, deliberately. `KpiCard` is shared and was settled at **12** in #214,
  which is §3's stated "cards, rows — the default". One outlier in one file does not justify forking
  a shared component or adding a size prop, and absorbing it silently would have hidden the
  inconsistency.
- **Decision needed:** pick one and correct the merged files to match. 12 is the current
  implementation and the §3 default; 16 is what two of the three files draw.
- **Touches:** none — a design-file edit plus, if 16 wins, a one-line change to `KpiCard`.


These change drawings, not code. Full text in `NEW-FEATURES.md` Appendix D.

| | Correction | Scope |
|---|---|---|
| D1 | Rename the parent-side fee to **PARENT PROCESSING FEE** | 5 screens |
| D2 | Correct the referral step-down — live wins, 10% for twelve months | 2 screens |
| D3 | Correct the plan names — Solo / Nano / Starter / Pro / Business / Enterprise; teachers Free / Standard / Pro / Scale | 12 screens |
| D4 | Fix the teacher payout receipt — the 850 and the 105.26 are not in the money model | 1 screen |
| D5 | Replace the stale prices in `Merged-Admin-Money` §07 | 1 screen |
| D6 | Add the teacher Free tier | every teacher pricing frame |
| D7 | Note `top_centers` so nobody deletes it — custom-priced, reads `centers.all_in_price` | no design |
| D8 | Reword the ambiguous fee line in `Merged-Verification-Payouts` §02 | 1 screen |
| D9 | Correct the Benchmarks metric set — four metrics, keep group utilisation | 1 screen |
| D10 | Name the two processing fees apart | 5 frames + a code warning |

**New, 28 July — `TOKEN-SPEC.md` §2, `text-3xl`.** The spec gave 44px, derived from 105 design-file
uses that are almost entirely reference-file mastheads — a thing the product does not have. In the
app that token backs **KPI figures in 14 places**. Corrected to **30px**, the KPI value, which is its
only product role. 44 stays in the design files. No second alias. Landed in #209; the dated
correction is in `TOKEN-SPEC.md` §2.

---

# §0 · SECURITY — ahead of everything else

## S1 · `users.teacher_group_ids` is self-writable and feeds a cross-tenant read policy
> ### ✅ CLOSED — applied to production 29 July 2026
> Migration `20260729010000_users_lock_self_writable_policy_inputs.sql`, PR **#213**, merged as
> `2fc494a0`. Eyad applied it by hand; the merge came after, on verified evidence.
>
> Confirmed from the live catalog **after** the apply, not from the migration file:
>
> | | |
> |---|---|
> | `has_table_privilege('authenticated','public.users','UPDATE')` | `false` |
> | `has_column_privilege('authenticated', … ,'teacher_group_ids','UPDATE')` | `false` |
> | `has_column_privilege('anon', … ,'teacher_group_ids','UPDATE')` | `false` |
> | `has_column_privilege('service_role', … ,'teacher_group_ids','UPDATE')` | `true` |
> | `chq_prevent_user_escalation` body guards all four new columns | yes |
>
> The chain below is kept as written. It is the record of how the hole was found and why the
> obvious fixes were wrong, and both of those stay true after the fix.

- **What:** any authenticated user of any centre — including the lowest-privilege staff account — can read another centre's students.
- **Found:** 28 July 2026, reading `pg_policies`, `information_schema.column_privileges` and the trigger body from the live catalog. Not from migration files.
- **The chain, every link verified:**
  1. `students` SELECT has two **PERMISSIVE** policies, which OR. The second, `students_teacher_select`, has no `center_id` check: `EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = students.id AND e.group_id = ANY(get_auth_teacher_group_ids()))`.
  2. `get_auth_teacher_group_ids()` reads `users.teacher_group_ids`.
  3. `authenticated` holds a column-level `UPDATE` grant on that column.
  4. The RLS UPDATE policy permits it — `USING (id = auth.uid())`, `WITH CHECK (id = auth.uid() AND center_id = get_auth_center_id())`; `center_id` is unchanged so the check passes.
  5. `chq_prevent_user_escalation` raises on `role` and `center_id` only. It never looks at this column.
  6. The group UUID it needs is **published by design** — `GroupJoinLinkCard.tsx` builds `https://tutoringhq.app/ar/join/g/<groupId>` and centres send it to parents.
- **Reproduce** from the browser console of an ordinary logged-in session: `supabase.from('users').update({teacher_group_ids:['<centre-B-group>']}).eq('id', myId)`, then `supabase.from('students').select('*')`.
- **Touches:** auth, and minors' data — names, phones, parent phones.
- **Blocked by:** READY. Nothing is waiting on anything.
- **Fix (not applied):**
  ```sql
  REVOKE UPDATE ON public.users FROM authenticated, anon;   -- table-level, no re-grant
  ```
  plus matching branches in `chq_prevent_user_escalation` for `teacher_group_ids`,
  `can_manage_students`, `can_record_payments` and `is_active`. **That is the whole fix.**

  ⚠ **Do NOT add `AND center_id = get_auth_center_id()` to `students_teacher_select`.** An earlier
  draft of this entry suggested it as extra scoping. It would break the teacher portal completely.
  That policy exists precisely so a teacher can reach students in groups they teach at a centre
  they do **not** belong to — Model B, teachers span centres. `users.center_id` is nullable and
  **all teachers currently have it NULL**, so the added clause would evaluate `NULL = NULL` → NULL
  → false and deny every teacher every student. The column feeding the policy is the problem, not
  the policy; once `teacher_group_ids` cannot be self-written, the policy is sound as it stands.

  ⚠ **A column-level revoke does NOT work here, and the first draft of this entry got it wrong.**
  `authenticated` holds a **table-level** `UPDATE` on `public.users` (`has_table_privilege` =
  true). In PostgreSQL a table-level privilege authorises every column, and
  `REVOKE UPDATE (col, …)` does not remove it — the revoke would have been a silent no-op that
  looked like a fix. The revoke has to be table-level.

  **No re-grant is needed**, which was checked rather than assumed: all seven writers of
  `public.users` are server routes on the **service-role** client — `/api/user/locale`,
  `/api/auth/set-initial-pin`, `/api/auth/verify-pin-reset`, `/api/auth/change-pin`,
  `/api/teacher/settings/change-pin`, `/api/settings/staff/[userId]/permissions`,
  `/api/permissions` — plus `centerOwnerProvision`, which is an INSERT. `service_role` holds its
  own grants and bypasses RLS, so none of them is affected. There is no browser-side write to
  `users` anywhere in the codebase.

## S2 · Three more self-writable columns feed policy decisions
- **What:** the same root as S1. Five helpers read `public.users`; the trigger guards two columns.

  | Policy input | Column | Guarded? |
  |---|---|---|
  | `get_auth_center_id` | `center_id` | yes — trigger **and** `WITH CHECK` |
  | `has_center_role` | `role` | yes — trigger |
  | `get_auth_teacher_group_ids` | `teacher_group_ids` | **no** → S1, cross-tenant |
  | `can_manage_students_fn` | `can_manage_students` | **no** → self-grant, within tenant |
  | `can_record_payments_fn` | `can_record_payments` | **no** → self-grant, within tenant |

- Also unguarded: `is_active`, so a deactivated account can re-activate itself.
- **Touches:** auth. Within-tenant escalation, not cross-tenant.
- **Blocked by:** ~~READY, same fix as S1.~~ ✅ **CLOSED 29 July 2026** — same migration as S1
  (`20260729010000`, PR #213, `2fc494a0`). `chq_prevent_user_escalation` now raises on
  `teacher_group_ids`, `can_manage_students`, `can_record_payments` and `is_active` beside the
  existing `role` and `center_id`, and the table-level `UPDATE` grant is gone, so the trigger is
  a backstop rather than the only control.

## S3 · The posture is defence in depth, and it is worth stating correctly
- **Both layers are live.** This was checked rather than assumed, because getting it backwards in either direction leads somewhere bad.
- **RLS is enforcing, not inert.** There is no `app.center_id` and **0 of 220 policies read `current_setting`**. Scope comes from `auth.uid()` — the Supabase-signed JWT — through `get_auth_center_id()`, which is `SECURITY DEFINER` with `search_path` pinned. `anon` and `authenticated` both have `rolbypassrls = false`. A browser holds the anon key and a session, so RLS is a **reachable, load-bearing boundary**, which is exactly why S1 matters.
- **Application code is the second layer**, and it is what protects the service-role paths, where RLS is bypassed by design. `/api/db` derives `actorCenterId` from the verified token and force-applies `.eq(center_id, actorCenterId)` **after** client filters; `dbProxyScope.ts` denies unlisted tables and teachers outright.
- **Neither layer is decorative, and neither alone is sufficient.** An auditor will ask which one is load-bearing; the answer is both, for different callers.
- **The route audit (29 July) found no gaps** — see the note at the end of this file.

## S4 · Per-family cross-tenant denial tests
- **What:** a test per route family that asserts centre A, authenticated, gets 403/404/empty when it reaches for centre B's rows.
- **Why:** the 29 July audit was clean, but it is a **point-in-time read of convention**. A new route that forgets the filter is caught by no policy, no test and no type error — it just returns another centre's data, and the next audit is whenever someone thinks to run one.
- **Shape:** one fixture with two seeded centres, then per family — centre route, `[groupId]` IDOR, teacher-private, `/api/db` proxy, public join, parent portal — a case that must fail. It is the audit's table turned into CI.
- **Touches:** auth. No production write; test-only.
- **Blocked by:** READY. Wants a reachable test tenant, which is **F6**.

## S5 · Move the remaining service-role reads back behind RLS
- **What:** the read paths that use the service-role client — and therefore bypass RLS entirely — re-expressed as the caller's own session so the database enforces the boundary instead of the route.
- **Why:** today RLS protects direct clients and application code protects the service-role paths. That is legitimate defence in depth, but the second half is enforced by convention. Reads carried under the user's JWT are enforced by the engine, and a forgotten filter stops being a breach.
- **Not a rewrite:** `/api/db` is explicitly frozen (`docs/DB_PROXY_SECURITY.md`, no new callers). This is about new domain routes preferring the session client for reads, and migrating existing ones opportunistically as their screens are restyled — not a big-bang migration.
- **Caveat:** some reads genuinely need service role (cron, webhooks, cross-tenant admin). Those stay, and the point is to shrink the set that does not need it, not to reach zero.
- **Touches:** auth.
- **Blocked by:** READY, but do **S4 first** — the tests are what make this safe to attempt.

**Neither S4 nor S5 is urgent this week. Together they are the difference between convention and enforcement**, which is the honest summary of where tenant isolation stands.

---

# §6 · FOUNDATIONS DEBT — what the redesign left behind

Logged from the token layer (#209). None of it blocks a restyle; all of it makes one cleaner.

## F5 · `admin_users.custom_permissions` is dead and pending a drop
- **What:** the jsonb column that used to hold admin-portal permission grants.
- **Superseded:** 30 July 2026. `public.permissions` is canonical — it carries `enabled` and `created_at`, so a grant records who was given what and when, and a revoked grant is flipped to `enabled = false` rather than deleted. `custom_permissions` is a blob with no history. Eyad's decision, 29 July.
- **State:** nothing reads it, nothing writes it. `customPermissionsToKeys` was deleted rather than deprecated in place — an un-called normaliser for a dead column is how a dead column gets re-adopted. Both stores were empty at the switch, so nothing was lost.
- ⚠ **The `custom_permissions` name survives on the wire**, as the request and response field on `/api/admin/team`, so the client did not have to change in the same PR. That is a field name, not a store. Do not read it as evidence the column is still live.
- **Drop it:** `ALTER TABLE public.admin_users DROP COLUMN custom_permissions;` — **Eyad's call, deliberately not done yet.**
- ⚠ **If centre-staff grants ever move onto this table, the shape is NOT `admin_user_id`.** `permissions.user_id` is already `NOT NULL`, FK'd to `admin_users(id)` — it is spoken for. A 30 July proposal to add a nullable `admin_user_id` (reasoning: "`user_id` points at `users`, admin identity needs its own column") was wrong on the current schema and caught before it was built — `user_id` already points at `admin_users`, and adding `admin_user_id` would have put two columns on the same row pointing at the same table. The correct future shape, **if and when centre-staff grants actually need to live here** (not now — `users.can_*` already holds centre staff permissions and works, and nothing in `Center-Setup` §07 asks for this table): make `user_id` nullable, add a new nullable `staff_user_id` FK to `users(id)`, and an `exactly one of user_id / staff_user_id` check constraint. Not built now — speculative schema against a need that has not arrived, logged only so the next person reaches for `staff_user_id`, not `admin_user_id`.
- **Blocked by:** nothing technical, on either the drop or the future shape. Waiting on Eyad's call to drop `custom_permissions`, and on `Center-Setup` §07 actually needing centre-staff grants on this table before the mirrored migration is worth building.

## F1 · 1,341 off-scale spacing utilities
- **What:** `p-5`, `py-2.5`, `gap-1.5`, `px-2.5`, `mt-0.5` and friends — 1,341 uses that are not on the §1 scale of 4 / 8 / 12 / 16 / 24 / 32 / 48.
- **Why they survived:** Tailwind v4's spacing namespace backs `w-*`, `h-*`, `inset-*` and `translate-*` as well as padding. Restricting it to seven values takes `w-64` and `h-96` with it. The seven steps are pinned as named tokens instead.
- **Fix:** screen by screen during the restyle, using §1's role-based rounding — **padding rounds up, gap and margin round down**. Then a `check:spacing` build gate, once the count is near zero. Adding the gate now would fail on day one.
- **Blocked by:** READY, but only as part of each screen's PR.

## F2 · `text-4xl` / `text-5xl` / `text-7xl` are off-scale
- **What:** 16 sites — 8 marketing heroes at `md:text-5xl`, the 404 numeral at `text-7xl`, 7 assorted `text-4xl`. Held at 36 / 48 / 72 and marked LEGACY in `tokens.css`.
- **Fix:** they come off as Public-Marketing and the error screens are restyled, then the three lines are deleted from `tokens.css`.

## F3 · `text-2xl` and `text-3xl` are both 30px
- **What:** a consequence of the §2 correction, recorded not acted on. The ~20 `text-2xl md:text-3xl` pairs no longer change at the `md` breakpoint. Nothing breaks; the responsive step flattens.
- **Fix:** whether the two names collapse into one is a restyle decision, not a token one. Decide it when a screen actually needs a step between 22 and 30.

## F4 · Four colours have no §4 slot
- **What:** `--color-success` `#1a6d4d`, `--color-success-muted`, `--color-info` `#2563eb`, `--color-info-muted`, `--color-danger-muted`, the four `--color-scanner-*`, `--color-primary-light`, `--grad-live`, `--ceo-chart-grid`.
- **Why they survived:** §4 says drift maps to its nearest token, but the nearest token to a green "paid / present" and a blue "info" is the teal accent. Collapsing them deletes the difference between a confirmed payment and a primary button. **That is a design decision, not a drift cleanup.**
- **Needs:** Eyad. Either extend §4 with a status family, or accept that status colour lives outside the token table.

## F5 · Tailwind scans `docs/` and `design/`
- **What:** Tailwind's source detection reads every tracked file, not just `src/`. A pipe-abbreviated class name in `docs/TOKEN_ADOPTION_2026-07-05.md` compiled to `color: var(--a|b)`, which Lightning CSS rejects. `next build` demoted it to a warning; **`next dev` returned 500 on every page.** Fixed in #209 by rewriting the doc line.
- **Why it matters now:** the 26 `design/Merged-*.html` files are full of class-shaped strings and are about to be read section by section. The next malformed candidate breaks local dev again.
- **Fix:** scope the scanner with `@import "tailwindcss" source("../../src")` in `globals.css`, then verify no in-use class disappears from the compiled output. Small, and it also shrinks the CSS.
- **Blocked by:** READY.

## F6 · The audit seed is unreachable, and the migration history says otherwise
- **What:** `scripts/audit/seed-prod.sh` runs `supabase db push`, but the seed lives in `supabase/migrations_archive/`, not `supabase/migrations/`, so `db push` never sees it. Every file that *is* in `migrations/` is already applied. **The script is a no-op.**
- **Worse:** `20260507120000 seed_audit_accounts` is recorded as applied in the production migration history, but the rows are gone — `auth.users` has zero `aaaaaaaa-…` ids. Bookkeeping says done, the catalog says otherwise. Even moving the file back would not re-run it; the version is already in the history.
- **Why it matters:** without a reachable test tenant, **no restyle PR can be screenshotted against a real dashboard.** #209 shipped without a Center Home screenshot for exactly this reason.
- **Needs:** Eyad. The seed also inserts a `super_admin` on `+201111111111` with PIN `111111` and an internal admin on `222222`, both documented in a checked-in README — a plausible reason the rows were torn down deliberately. If it is re-seeded, seed the **owner half only**.
- **Also needs:** `SUPABASE_SERVICE_ROLE_KEY` in whatever environment takes the screenshots. Center Home makes 8 `dbSelect` calls through `/api/db`, which is service-role only.

## F7 · Pre-existing contrast bug on the teacher landing money card
- **What:** `text-white/80` and `text-white/70` on the teal gradient card in `TeacherLandingClient.tsx` (lines 205, 209, 213). The global rule `html:not(.dark) .text-white\/70 { color: var(--color-text-secondary) }` maps them to `mid` `#5d635c`, so the labels are dark-on-dark and effectively invisible.
- **Verified pre-existing:** identical on master. Not caused by the token layer.
- **Fix:** either add the card to the `.money-hero` exemption or stop using `text-white/N` on gradient surfaces. Belongs in the Teacher-Home restyle.

## F8 · `src/lib/tokens.ts` is a stale dark-theme mirror
- **What:** its `surface[0]` is `#080f1a` and `text.primary` is `#f8fafc` — the pre-cream dark palette. Its header says "keep in sync manually" and it was not.
- **Fix:** repoint it at the §4 tokens, or delete it if nothing depends on it. Check `chartColors` consumers first; charts are their own pass.

## F10 · No ticking elapsed-time timer on a live class session
- **What:** `Merged-Teacher-Groups` §04 draws a live session banner with a counting duration ("24:18"). Neither `SlotActionSheet.tsx` nor the orphaned session-detail page (see D20) has one — no `sessions.started_at`-equivalent timestamp is even selected by the schedule API today.
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`.
- **Why it's here and not in §1/§2:** purely cosmetic, no money/auth/account-state involved, blocks nothing — just real, un-plumbed new surface area (a timestamp through the API, a client interval). Low priority; build opportunistically if the live-session UI gets more attention.

## F9 · `student_groups.teacher_split_pct` and RPC `assign_teacher_to_group` are dead
- **What:** a percentage-split column and its assignment RPC, apparently the abandoned predecessor or successor to the flat-cut model actually in use (`fee_per_class − center_cut_egp`, see D16).
- **Confirmed 29 July 2026, live:** `select count(*) from student_groups where teacher_split_pct is not null` → **0** rows, ever. `grep -rn "assign_teacher_to_group" src/` → zero `.rpc()` call sites anywhere in the app.
- **Why it likely exists:** `transactions.teacher_net` / `snap_teacher_pct` (read by `/api/teacher/center-cuts` and `/api/teacher/center-attendance`, see D16) look built for exactly this percentage model, and neither the field that would drive it nor the RPC that would set it was ever wired to anything.
- **Drop it:** Eyad's call, deliberately not done yet, same as F5 (`custom_permissions`).
- **Blocked by:** nothing technical. Waiting on the decision to drop.

## F11 · `Merged-Center-Groups` — dead controls and orphaned data, not fixed in the 30 July pass
- **Found:** 30 July 2026, building `Merged-Center-Groups` §01/§03/§04. Logged rather than fixed — each needs either a UI decision (what should the control actually do) or is a bigger build than a display fix, out of scope for this pass.
- **`handleDeleteGroup` in `groups/page.tsx` is fully implemented — audit-logged, deletes members, updates state — and has zero call sites.** A group cannot be deleted from this UI today. Needs a kebab/more-menu entry point and a confirm step, not just a wire-up.
- **The room "More" (three-dot) button in `rooms/page.tsx` has no `onClick`** — present, inert. Needs real edit/delete actions built, not just a handler.
- **`groups/page.tsx` fetches `teacher_name` per group (a real join) and never renders it anywhere** — dead query. Showing it (the design's "Mr. Sherif · center 30%" chip) also needs `center_cut_egp` added to the list query (only selected on create today) and computed as a percentage of `fee_per_class`, since it's stored as an absolute EGP amount, not a percent.
- **`student_groups.capacity_cap` is a second, live, constrained column (`CHECK (>0)`) with zero references anywhere in `src/`** — same shape as F9's `teacher_split_pct`, a second dead field on the same table. Logged for the same "drop or document" decision.
- **`student_groups.kind` ('center' vs 'private') is never selected or filtered on** in the centre-side Groups list query — outside-teacher-run groups are indistinguishable from centre-run ones in this view, compounding the missing teacher chip above.

## F12 · `pending_enrollments` cannot say whether a request came from an invite link or self-serve sign-up — the design shows both as distinct badges
- **What:** `Merged-Center-Students` §04's Pending screen draws two distinct origin badges ("Invite link" vs "Sign-up") on every request row, plus a "Came via" field in the request-detail view. Live, `pending_enrollments` has no column for this — confirmed both live insert call sites (`src/app/api/join/[center_code]/[group_id]/route.ts` and `src/app/api/join/pending-enrollment/route.ts`) write the identical column set (`center_id, group_id, student_id, student_name, student_phone, parent_phone, notes, status`), and the list query in `src/app/api/students/pending/route.ts` selects no origin-like field because none exists.
- **Why it's not a display fix:** the two live endpoints are already two genuinely different entry paths — the gap is that neither writes down which one a given row came through, so the fact is lost at insert time, not just unrendered. Recovering it needs a new column and a value written by both call sites.
- **Do not reach for `students.origin` as a shortcut — checked, it doesn't cover this.** The column exists (`text`, nullable) and does have real writers, live values `'walk_in'` and `'self_link'` — but every writer (`teacher/private/groups/[groupId]/roster`, `teacher/private/schedule/sessions/*`, `join/g/[groupId]/verify-otp`) belongs to the teacher-private subsystem (centre-less teacher groups), not the centre's own join flow. Neither `join/[center_code]/[group_id]/route.ts` nor `join/pending-enrollment/route.ts` (the two routes this finding is actually about) ever sets it — confirmed both leave it at its `NULL` default. A genuinely new column (or a new value vocabulary added to this one, stamped by the two routes that don't touch it today) is still what's needed.
- **Found:** 30 July 2026, building `Merged-Center-Students` §04.
- **Build:** add an origin/source column to `pending_enrollments`, stamp it at both insert sites, surface it as the badge/detail-row the design already draws.
- **Blocked by:** nothing technical; out of scope for a display-only pass (needs a migration).

## F13 · `students.grade_level` has zero writers — the display added this pass will stay blank until something writes it
- **What:** the roster and student-detail screens now show a "Grade {n}" line when `grade_level` is set (this pass). Live, no code path (add-student, edit-student, `/students/import`) ever writes it — confirmed 0 of 4 live students have a non-null value, and grepping every students-table insert/update site for `grade_level` returns none.
- **Why it was still wired up:** harmless and forward-compatible — the column and the design both already exist, this only stops silently dropping the value the day something starts writing it. Same "surface already-fetched-but-dropped data" pattern used elsewhere this pass.
- **Found:** 30 July 2026, building `Merged-Center-Students` §01/§02.
- **Build:** add `grade_level` to the add-student and edit-student forms (and optionally the import column mapper) if grade is wanted as real data going forward; otherwise it stays display-only and blank.

## F14 · `/students/import` treats parent phone as fully optional; the design's copy says it's required
- **What:** `Merged-Center-Students` §04's upload screen states "Only student name and parent phone are required" and explains why: "payment links and receipts go there by WhatsApp, so a wrong number means a student who cannot be billed." Live, `students/import/page.tsx` never validates `parent_phone` — a row with a name and nothing else imports cleanly (`previewRows`/`importPayloadAndMembers` only skip rows with a blank name).
- **Why it's not a mechanical fix:** enforcing it would start rejecting/flagging rows that import cleanly today, for centers that may import students tracked for attendance before a parent phone is on file. A behaviour change on an existing, working import path, not a bug with one correct answer.
- **Found:** 30 July 2026, building `Merged-Center-Students` §04.
- **Build:** decide whether missing parent phone should join the "needs a fix" skip list (§04 already has one, for blank names) alongside a copy check, or stay optional and the design copy is what's wrong.
- **Blocked by:** Eyad's call on which one is correct.

## F15 · Two independent status axes (lifecycle vs payment standing) exist per student and are never shown together as one badge
- **What:** a student carries two separately-computed status concepts: a lifecycle/attendance status (`active`/`at_risk`/`inactive`/`enrolled`/`churned`, driven by scan recency — the roster's `LifecycleBadge`) and a payment standing (paid/unpaid, now `getStudentBalances`-driven after this pass's fixes). Neither `Merged-Center-Students` nor live code fuses them into one badge — the roster shows a `LifecycleBadge` and a balance figure as two separate elements.
- **Why it's logged, not built:** no screen this pass asked for a fused badge, and inventing a combined taxonomy (does "at-risk AND unpaid" render as one badge or two?) is a design decision, not a bug fix.
- **Found:** 30 July 2026, building `Merged-Center-Students` §01/§02.
- **For whoever designs this next:** both axes are already independently correct and already available (`lifecycle_status` column, `getStudentBalances`) — this is purely a "how do we show both at once" question, no new data needed.

## F16 · One session, six places where "one number" had two sources — the shape, not six separate bugs
- **The pattern:** every instance below has the identical shape. A database column is written once, usually at insert, and never updated again. The real, current value is only ever obtainable by summing live rows elsewhere — here, always `attendance_scans` (charges) and `payments` (collections). Some screen or job reads the frozen column instead, because it's a single flat field rather than a join-and-sum, and it silently drifts from reality the moment anything happens after that first write. Nothing errors. Every query succeeds. It just answers a question about the moment of insert while presenting itself as the answer right now.
- **All six tonight were `students.payment_status`, or its sibling `students.fee`, versus the real-time balance `getStudentBalances` computes** (`src/lib/studentBalance.ts` — already the one place that arithmetic lives, precisely so it can't drift between callers):
  1. Roster (`students/page.tsx`).
  2. Student detail (`students/[id]/page.tsx`).
  3. `/dashboard`'s paid/unpaid KPI tile and payment-status donut chart.
  4. `excel-export.ts`'s `buildDashboardExcelBuffer` (the dashboard's Excel export).
  5. `parent-balance-alerts` cron — who gets messaged (`payment_status = 'unpaid'`).
  6. The same cron — what the message says they owe (`students.fee`, documented in `studentBalance.ts` itself as a "NULL-in-practice fallback," never the authoritative `student_groups.fee_per_class`).

  All six are now fixed onto `getStudentBalances`.
- **Why one entry, not six:** every fix was the same operation — stop reading the frozen column, call the helper instead. Logging six separate bug entries would hide that this is one architectural failure mode, not six unrelated mistakes, and it will keep producing new instances wherever the next screen or cron reaches for `payment_status`/`fee` out of habit instead of the helper.
- **What actually closes this, versus just patching tonight's six:** `payment_status` and the misleading half of `fee` are still live, `NOT NULL`, defaulted columns on `students` — nothing stops a seventh reader from being written next week. D3 already proposes dropping or backfilling `payment_status`; doing that (once the sign-off D3 is waiting on happens) is the only version of this fix that makes an eighth instance *impossible* rather than merely *found*. Until then, this entry exists so the next dead-column-vs-live-helper discovery gets logged as "instance seven of F16," not written up as if it were new.
- **Found:** 30 July 2026, across the `Center-Students` pass and the same-night `parent-balance-alerts` follow-up.

---

# Appendix · Tenant-isolation route audit, 29 July 2026

**Scope:** every API route touching `students`, `student_groups`, `student_group_members`,
`attendance_scans`, `payments`, `paid_parents`, `enrollments`, `parent_portal_tokens`, `families`,
`student_notes`. **Question:** does it scope by centre, and is that centre derived from the session
or from something the client supplies?

**Result: no gaps found.** Every route that accepts a centre identifier from the request validates it
against the session first. No route was found that takes a centre from a request parameter and trusts it.

| Family | Scoping predicate | Verdict |
|---|---|---|
| Centre routes | `requireCenterAuth` / `requireOwnerAdminCenter` → session `centerId` | ✅ |
| `benchmarks` | `center_id` param honoured **only** if the caller's `organization_id` owns it, or it equals their own centre | ✅ |
| `center-users` | `requestedCenterId !== auth.centerId && !isSuperAdmin` → 403. Carries a comment recording that it was fixed from exactly this bug | ✅ |
| `analytics/revenue` | param honoured only `if (isSuperAdmin && qp)`; super-admin from `admin_users` + `SUPER_ADMIN_PHONES`, never `users.role` | ✅ |
| `groups/[groupId]/attendance-heatmap` | loads the group, then `group.center_id !== userCenterId` → 403 | ✅ IDOR closed |
| `teacher/private/*` (20 routes) | centre-less by design; `requireOwnedPrivateGroup` / `requireOwnedSession` chain on `teacher_id`, foreign ids 404, writes re-apply the predicate | ✅ |
| `teacher/*` centre routes | `requireTeacherAuth` + link check | ✅ |
| `admin/*`, `ceo/*` | `getAdminContext` + `requireAdminRole` / `requireSuperAdmin`; cross-tenant is intentional and gated | ✅ |
| `cron/*` (42 routes) | all 42 import `requireCronSecret` — timing-safe compare, fails closed when the env var is unset | ✅ |
| `/api/db` proxy | `dbProxyScope.ts`: unlisted table denies, teachers deny, forced `.eq()` applied after client filters | ✅ |
| `join/pending-enrollment` | public by design; validates the group belongs to the supplied centre, returns `{success:true}` only | ✅ |
| `parent/portal` | token looked up by **hash**, revoked + expiry checked, scoped to one `student_id` | ✅ |

**Two false alarms worth recording, so the next audit does not re-raise them.** A grep for
`CRON_SECRET` reports all 42 crons as unguarded — the literal lives in `requireCronSecret`, not in the
routes. A grep for `.eq('center_id')` reports `teacher/private/*` as unscoped — those routes are
centre-less by design and scope by `teacher_id`. **Both are artefacts of the wrong predicate, not
findings.** Check the helper before believing the grep.

**What this audit cannot prove.** It is a point-in-time read of the routes that exist today. It is
convention, not a constraint: a new route that forgets the filter is caught by no policy, no test and
no type error. The durable fix is a test that asserts cross-tenant denial per route family, or moving
the remaining service-role reads behind RLS. Neither exists today. Logged, not built.
