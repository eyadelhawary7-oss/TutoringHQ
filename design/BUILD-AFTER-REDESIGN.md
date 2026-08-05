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
- ✅ **Built 31 July 2026, Public-Marketing survey — mostly.** `/talk-to-us` ships: the five fields (Area as a `<select>` over `EGYPT_GOVERNORATES`, not free text — see the note below on why), `demoRequestSchema` and the insert now carry `area`/`student_count`, the submitted state echoes the area back and keeps "Start free trial now" on screen, and `/admin/demo-requests` now renders both new columns (it already `select('*')`ed them, just never displayed them). **Not built: the area→territory→rep routing itself.** The migration's own column comment says "the form offers a fixed list" — read as instruction, not description, so the form's Area field is a governorate `<select>`, matching the codebase's existing `EGYPT_GOVERNORATES` convention (`centers.governorate`, checkout's delivery governorate) rather than the design's free-text-looking input. But `center_assignments.territory_city` — the join target — is itself a **plain free-text `<input>`** on the admin staff/assignment screens (confirmed by reading both forms), with no shared vocabulary against the governorate list at all. Matching a fixed list on one side against ungoverned free text on the other is the same failure shape as **F19**: it would look wired and silently match nothing the moment the two sides disagree on spelling ("Giza" vs "6th of October" vs "giza"). Not attempted — flagged instead of guessed. **Also not decided:** what `/demo-request` becomes. Left untouched beyond fixing an unrelated bug (its hardcoded WhatsApp number didn't match the site-wide one) — the "two doors" decision this entry calls for is still Eyad's, not assumed.
- **Follow-up needed to finish this properly:** either constrain `territory_city` to the same `EGYPT_GOVERNORATES` list (a data-cleanup + form change on the staff/assignment screens, not attempted here) or accept manual triage of the `assigned_to` field in `/admin/demo-requests` (which already supports it) instead of automatic routing.

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
- **Built, 29 July 2026 (#220):** all six primitives shipped in `src/components/patterns/` plus the
  corrected `shared/EmptyState.tsx`. #220's own note was explicit that adoption was a separate, per-file
  effort: *"Adoption is NOT in this PR — it is per-file."*
- **Corrected 31 July 2026 — a full-codebase adoption audit, not an assumption.** Nothing had gone back to
  actually measure that per-file adoption until now. Three independent read-only sweeps (every candidate
  file opened and read, none trusted from documentation) found real adoption is low, uneven across the six
  primitives, and in three cases zero:
  - **`EmptyState`:** 7 real adopters / 73 candidate files ≈ **9.6%** at audit time. A second, different,
    non-conforming component also named `EmptyState` (`src/components/empty-states/EmptyState.tsx`,
    predates #220, never migrated) accounted for 4 more files that looked like adoption but weren't — a
    naming collision, not a partial adoption. This also explains #220's own "11 adopters" claim: 7 real +
    4 wrong-component = 11, the same number — the original count almost certainly grepped the bare name
    without checking which component was actually imported. **Migrated and closed, 31 July 2026 (#292,
    #294).** `students`, `groups`, and `schedule` were migrated in #292. A 5th wrong-component file the
    original audit had missed — `(dashboard)/orders/OrdersPageClient.tsx`, independently miscategorized as
    "ad hoc" despite the audit claiming to have read it in full — surfaced during a follow-up check and was
    migrated in #294, alongside `payments/page.tsx`'s dead, unrendered import (removed, never a live
    wrong-component instance) and the resulting deletion of `src/components/empty-states/EmptyState.tsx`
    once a clean grep confirmed zero remaining importers anywhere. **Final state: 11 real adopters / 72
    candidates ≈ 15.3%.** The remaining 61 are fully ad hoc. The old component no longer exists.
  - **Loading states** (`ListSkeleton`/`RecordSkeleton`/`StillWorking`/`ActionSpinner`): 1 real adopter
    (`ListSkeleton`, one file) / 137 candidates ≈ **0.7%**. `RecordSkeleton`, `StillWorking`, and
    `ActionSpinner` have **zero adopters anywhere**, confirmed by grepping the exact identifiers. Every
    ad hoc convention #220 was built to replace (9 `chq-skeleton` files, 11 route `loading.tsx` files,
    `LoadingButton` for in-flight actions) is still fully intact today, alongside a previously-uncatalogued
    37-file teacher-portal-only convention and a second competing CSS shimmer class (`.skeleton`) nobody
    had named before.
  - **`ListRow`:** 5/14 ≈ **35.7%** — the only primitive with meaningful uptake, and every adopter landed
    incidentally as part of some other file's own sweep this session (e.g. `dashboard.tsx`'s schedule rows
    via #247), not a dedicated adoption pass.
  - **`ActionSheet`, `RecordActionBar`, `ExpandableRow`: zero adopters anywhere in the app** (0/3, 0/4,
    0/1). All three known non-adopters flagged in `PER-FILE-PROMPT.md` at #220 time (`admin/centers`,
    `rooms`, `dashboard`) were re-verified directly: `dashboard`'s row-level menu is genuinely gone
    (replaced by `ListRow` navigation), but `admin/centers` and `rooms` are both still fully ad hoc —
    `rooms`' kebab menu was made *functional* by #248 this session, which is not the same fact as
    *converted*.
  - One high-leverage fix identified: `src/components/charts/ChartCard.tsx`'s loading spinner is shared by
    6 screens (`ceo`, `dashboard`, `branches`, `admin`, `admin/analytics`, `analytics`) — converting this
    one file moves 6 screens at once, unlike almost everything else on this list.
  - Full per-file breakdown — every adopter and every non-adopter named individually, none folded into a
    summary — is `design/PATTERN-ADOPTION-LEDGER.md`.
- **This is a live, continuous gap, not a one-shot close.** Each file on the ledger is logged as its own
  gap, the same standard as a missing structural element elsewhere in this table. "The primitive shipped,
  so adoption is happening" is disproved as a general claim by this audit — it happened, incidentally, for
  a handful of `ListRow` sites; it has not happened at all for three of the other five primitives.
- **Touches:** none.
- **Blocked by:** nothing external. Every remaining file is buildable today, the same as before — the gap
  is that adoption was never actually tracked as a number until this audit, not that anything stands in
  its way.

## R5 · Admin teacher ↔ center linking, on a new route
- **What:** An internal view of which teachers are linked to which centers, with an assign form.
- **Drawn in:** `Merged-Admin-Accounts` §03. The design is titled "Admin Center Assignments" but is **not** the live route of that name.
- **Exists:** nothing at this shape. ⚠ **`/admin/center-assignments` is do-not-touch commission machinery** — a different feature that happens to share the name. Confirmed 26 July.
- **Build:** a new route. Do not extend the existing one.
- **Touches:** account state.
- **Blocked by:** READY.

**Built and closed, 29 July 2026 — see PR #221.** `src/app/[locale]/(admin)/admin/teacher-links/page.tsx`
confirmed live (this entry never got a closing note when the PR merged — housekeeping fix, 31 July,
found while checking this table's own staleness before starting the next file).

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
- **Re-confirmed independently, 31 July 2026 (Center-Insight survey).** Read `/api/referral/route.ts` and `/api/referrals/payout/route.ts` fresh, without re-reading this entry first: both still read/deduct exclusively against `referral_reward_records`. Same table, same finding, arrived at cold — still blocked, still correct. Also found in the same pass: the payout route has no CSRF check (**S6**-class gap, logged separately as **S7**), currently low-blast-radius only because this table's balance is always 0 in production. **The CSRF half is since closed — S7, PR #308, `d728da75`. D22 itself is not:** re-read on master 4 August 2026, `/api/referrals/payout/route.ts:59` still reads `.from('referral_reward_records')`. Wrong table, unchanged.

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

## R10 · `/students/import` sends `notes` AND `group_id` — neither is a real column on `students` — every import fails at insert, unconditionally
- **What:** `src/app/[locale]/students/import/page.tsx`'s `importPayloadAndMembers` unconditionally includes a `notes` key (real value or `null`) and a `group_id` key (a real group UUID, or `null`) on every row it posts to `dbInsert({table: 'students', ...})`. **Neither column exists on `students`** — confirmed live via `information_schema.columns` (the live table has `waitlist_group_id`, not `group_id`; the only `notes` column anywhere in the schema is on `pending_enrollments`, a different table). `studentInsertSchema` in `src/lib/validations.ts:136` explicitly declares `notes` as a valid field and passes it straight through its `.transform()` (which only strips `fee`/`monthly_fee`), and `group_id` isn't stripped either — nothing upstream of the database catches either one, so the row reaches `supabaseAdmin.from('students').insert(...)` in `src/app/api/db/route.ts:497` carrying two keys with no matching column.
- **Independently corroborated twice more, not just this one check.** The `D24` verification workflow below (two blind auditors + a reconciler, tasked with a completely different question) hit this same fact from a different angle while mapping every `students` insert site, and flagged both columns unprompted. Three independent passes, same conclusion — about as verified as a finding gets.
- **Why it matters:** PostgREST rejects an insert referencing an unknown column outright (`PGRST204: Could not find the column in the schema cache`) — it does not silently drop it. Because both keys are present on every row regardless of value, this is not a conditional edge case: **every batch of every import fails at the insert step**, whether or not any row has notes content or a matched group. Found while investigating the cron fix below, not exercised in the live 4-student dataset — this project has no evidence anyone has run an import since whatever schema change removed/never-added these columns. The regular "Add Student" modal (`students/page.tsx:979`) is unaffected — its own insert payload never included either field.
- **Also affected, same root cause:** `src/app/api/students/[id]/route.ts`'s general PATCH endpoint lists both `notes` and `group_id` in its allowed-fields set — either would 500 if a real caller ever sent it. That endpoint currently has zero confirmed UI callers (see D24), so this is latent rather than active, but it's the same dead-column mistake in a second file.
- **Build:** stop sending `notes` and `group_id` on the students insert — drop both fields from `importPayloadAndMembers`'s row objects, and from the insert's own `.select('id, student_number, name, phone, parent_phone, group_id, notes, is_active, created_at')` string (a `.select()` naming a nonexistent column fails the same way an insert payload does, so trimming only the payload is not the whole fix). Also drop both from `studentInsertSchema`'s pass-through and the PATCH allow-list (nothing valid can use either there either). The actual group assignment already works correctly through a separate, already-existing `student_group_members` insert right after — it never depended on the `students.group_id` key, so removing that key loses nothing. If import notes are wanted as a real, working feature, a real destination already exists — **correction, found while building the D24 migration**: `student_notes` (`student_id, center_id, author_user_id, note, is_private, created_at`) is a real, live table, already used by `admin/privacy-requests/anonymize/route.ts`. An earlier version of this entry said no such table existed; that was wrong, not re-checked hard enough the first time. Routing import notes through `student_notes` instead of dropping them is a real, buildable option — still a separate decision (one note-per-row vs. a single field, who can see it), not folded into this bug fix.
- **Touches:** none (bug fix, no design judgment — matches CLAUDE.md's own "confirm it physically exists in the live schema before adding it to a query" rule, applied backwards: these are columns that stopped existing, or never did, out from under two live write paths).
- **Blocked by:** READY. Not built yet — found during tonight's cron work and flagged rather than folded into an unrelated PR; surfaced to Eyad directly.

**Built and closed, 30 July 2026 — see PR #243.** Both fields dropped from the insert (payload and
`.select()` string), `studentInsertSchema`, and the PATCH allow-list. The notes-mapping UI (dropdown
option, preview column, CSV template column) was removed rather than left silently discarding
whatever a user mapped to it — routing import notes through `student_notes` instead stays a separate,
not-yet-made decision.

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

**Resolved — stale by the time this entry was even written, confirmed 31 July 2026.** Commit
`ae352f94` ("fix: both day_of_week readers now use the writer's convention (#194)") landed 28 July
2026, one day *before* this entry was added to the doc (29 July, commit `d5551d3`) — the entry was
never struck through despite the fix already being live. The convention is JS weekday as text (Sat =
`"6"`), decoded in exactly one place, `scheduleSlotsDayOfWeek()` in `src/lib/cairo/day.ts`, whose own
doc comment names the two readers that used to disagree (the daily-summary cron's `(jsDay+1)%7`
Egypt-index bug, and the parent-absence-alert's day-name string comparison) and states "Both now call
this." Confirmed directly: `src/app/api/cron/daily-summary/route.ts` and
`src/app/api/cron/parent-absence-alerts/route.ts` both call the shared helper; `Center-Home`'s own new
Schedule section and `Center-Groups` §05 itself both use it too. No outstanding disagreement to
resolve — this entry describes a bug that was already fixed before it was logged.

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
- **Re-confirmed, 31 July 2026 (Center-WhatsApp survey).** `center_message_templates` still has zero application-code references anywhere in `src` — grepped fresh, not assumed. The live `/whatsapp` route reads `wa_meta_templates` instead (a different table entirely — Meta's own approval mirror, `status` CHECK-constrained to PENDING/APPROVED/REJECTED/IN_REVIEW, no `enabled`/`auto_send` column at all). Still stuck exactly as described; nothing to build until this decision lands.
- **Re-confirmed again, 4 August 2026 (Center-WhatsApp parity pass, live catalog query not repo grep this time).** `select count(*) from center_message_templates` → 0 rows, live, right now. `information_schema.columns` for `wa_meta_templates` confirms exactly `id, template_name, category, status, variables_count, created_at, updated_at` — still no `enabled`/`auto_send` anywhere on the table the screen actually reads. Nothing changed since 31 July; nothing built here this pass either.
- **Re-confirmed a third time, 4 August 2026 (Center-WhatsApp §01 structure build, PR #347).** Same two live queries, same two answers — `center_message_templates` at 0 rows, `wa_meta_templates` at those seven columns and no others. **What changed is what D4 now blocks, precisely:** §01 was otherwise built out this pass, so D4 is no longer "the whole screen is stuck", it is exactly three drawn affordances — the topbar **`+` add-template** button, the row's **Edit** chip, and the preview sheet's **Send automatically** toggle. All three need a per-center, center-writable template row carrying `message_body` + `auto_send`; the table this screen reads has neither column. Everything else §01 draws is now on screen. The remaining decision is unchanged and still Eyad's: adopt the orphan table, or design the auto-send feature properly first.
- **A related finding, not part of the decision but worth recording because it looks like free data.** `wa_meta_templates.variables_count` is a real column and is already selected by `whatsapp/page.tsx`, so it reads as a rendering opportunity. It is unreliable: live, `chq_parent_welcome` and `chq_parent_absence` both report `variables_count = 0` while their stored bodies each carry two `{{…}}` placeholders. It is deliberately still not rendered anywhere. If D4 ever lands, do not trust this column as the variable count — derive tokens from the body, which is what the preview sheet already does.

## D5 · WhatsApp Pack as a one-time top-up
- **What:** Replace the per-parent monthly pack with a one-time credit that never expires.
- **Drawn in:** `Merged-Center-WhatsApp` §02, §03. `LOOKS LIKE A RESTYLE`.
- **Exists:** a per-parent monthly pack. A different model, not a partial one.
- **Touches:** money. **This changes what an existing customer is charged.**
- **Blocks:** D6.
- **Re-confirmed, 31 July 2026 (Center-WhatsApp survey), with the exact live numbers.** Subscription side: `PACK_PRICE_PER_PARENT = 12` EGP/parent/month (`src/lib/parentPack.ts:8`). Blast side: `BLAST_PRICE_PER_PARENT_INCLUSIVE = 9.8` EGP/parent per announcement, capped at 2/month (hardcoded independently in three places), gated by a plan-tiered monthly allowance (`ANNOUNCEMENT_CAPS`, nano 700 through top_centers 99999). None of it maps to the design's per-message credit tiers (200 msgs/200 EGP, 1,000/750, 5,000/2,500, custom by volume) or its "never expires, carries over" balance framing. §03 (Custom Flow) is the same model's custom-amount extension and is confirmed absent from live code by exhaustive grep — building it first would mean building the custom-amount UI for a pricing model (§02) that doesn't exist yet. Also found, independent of this decision: the announcement route's own stored audit breakdown (`base_amount` 6.72 × `service_fee` 6% × `vat` 14% ≈ 8.10) does not sum to the 9.8 actually charged — a pre-existing internal inconsistency in the current model, worth a look whenever D5 is decided either way.
- **Re-confirmed, 4 August 2026 (Center-WhatsApp parity pass).** Re-read `WhatsAppPackClient.tsx` and `parentPack.ts` fresh rather than trusting the 31 July note: same two constants, same shape, still a monthly per-parent subscription plus a capped announcement blast with a single running `announcement_balance` column — nothing resembling the design's fixed-tier one-time top-up (§02) or its tap-to-custom-amount flow (§03) exists anywhere in `src`. Not built this pass, same reason as before.
- **Re-confirmed against the live catalog, 4 August 2026 (Center-WhatsApp §01 structure build, PR #347) — this time by column list rather than by reading the client.** Every pack-adjacent column on `centers`, pulled live: `announcement_balance`, `announcement_balance_updated_at`, `announcement_cap`, `announcement_price_per_blast`, `credit_balance`, `credit_reserved`, `pack_approved_at`, `pack_custom_invoice_minimum`, `pack_disabled_at`, `pack_months_without_invoice`, `pack_pending_balance`, `pack_price_per_parent`, `pack_rejection_reason`, `pack_request_status`, `pack_requested_at`, `parent_pack_activated_at`, `parent_pack_active_parents`, `parent_pack_enabled`, `whatsapp_opted_in`. **There is no per-message credit balance column, in any flavour.** That is the specific thing §02 cannot be built without: its hero draws a *message count* remaining, and its segmented control draws **two** such counts that cannot be spent on each other. Neither exists, and neither does a per-message price — `announcement_price_per_blast` is per blast, `pack_price_per_parent` is per parent per month. Building §02's hero, its Notifications/Promotions split or its 200/1,000/5,000 tier list would mean inventing both a balance and a price, so §02 stayed at 0/5 and §03 (the same model's custom-amount extension) at 0/4 while §01 was built out around them. Unchanged decision: this is a change to what an existing customer is charged, and it is Eyad's.

## D6 · Teacher WhatsApp screen and message allowance
- **What:** Balance, what used it, the template list, and a 3-tier pack purchase (200/1,000/5,000
  messages).
- **Surveyed for the first time, 31 July 2026.** Route coverage is genuinely 0/1 — no `/teacher/whatsapp`
  page exists — but the design's own lede claims teachers "already get bundled credit" and "buy the
  same packs at the same rate" as centers. Checked each claim live rather than assume it's all unbuilt.
- **The credit balance is real and live, not a display gap — it's just never spent.**
  `teacher_profiles.blast_credits_subscription` / `blast_credits_purchased` both exist in production
  (confirmed via `information_schema.columns`), default 0, granted 100/month to `teacher_pro`/
  `teacher_scale` by RPC `upgrade_teacher_to_pro`, reset monthly by a real cron
  (`/api/cron/reset-teacher-blast-credits`). It is marketed today, in-product, on the plan comparison
  table (`rowWhatsappCredit` → "100 EGP WhatsApp credit monthly", shown as available on Pro/Scale). But
  the spend side, RPC `deduct_blast_credits`, has **zero callers anywhere in `src/`** — confirmed by
  grep across the whole app. So the number can only ever go up (monthly reset) and never down, no
  matter how many WhatsApp messages a teacher's account actually triggers. **Correction, batch-4 sweep,
  31 July 2026 — the claim that "there is nowhere in the teacher portal that even shows this balance to
  the teacher" was checked fresh and is wrong.** `TeacherPlanSection.tsx:157-172` already renders both
  `blast_credits_subscription` and `blast_credits_purchased` live on `/teacher/billing` for Pro/Scale
  teachers (confirmed by reading the component and its one usage site). It also still surfaces
  separately in the CEO admin view (`ceoTeachers.ts`) — that part was correct, just not exclusive. This
  raises the severity of the underlying gap rather than lowering it: it is not a latent number sitting
  in an admin-only view, it is a balance a paying teacher already sees on their own billing page today,
  going up every month and never down no matter how many messages they actually send. A marketed
  monetary benefit that structurally cannot deplete is a product-integrity gap, not a missing screen —
  flagging alongside the schema finding rather than as a separate item, since building the design's
  Balance screen on top of this as-is would mean displaying the same permanently-disconnected number in
  a second place.
- **Addendum, batch-4 sweep, 31 July 2026 — even a scaled-back read-only usage report needs a schema
  change, not just a spend-wiring decision.** `wa_message_queue` (the send log a "what used it" screen
  would have to read) has no `teacher_id` column at all — confirmed against
  `information_schema.columns` — and its only foreign key is `center_id → centers(id)` (confirmed
  against the live FK constraints). It has no way today to attribute a queued or sent message to the
  teacher whose credit it should have drawn from. Wiring `deduct_blast_credits` to real sends is
  necessary but not sufficient — the log table itself needs a teacher-attributable column before any
  per-teacher usage history can be shown at all.
- **None of the 5 templates the design draws are actually delivering to a teacher's parents today,**
  each for a different, independently-verified reason (checked `wa_meta_templates` live, not assumed):
  - **Welcome** — doesn't exist for teachers at all. `chq_parent_welcome` is hard-keyed to `center_id`
    in `studentParentPackWelcome.ts`; a teacher's center-less private students can never reach it.
  - **Fee reminder** — the code path is real and live (`/api/cron/fee-reminders` already covers
    teacher-billed private lessons via `transactions.teacher_id`), but `chq_fee_reminder`'s live
    `wa_meta_templates` row is `status = 'PENDING'`, not `APPROVED`. `sendTemplateMessage()` gates on
    `isTemplateApproved()` before every send, so this currently no-ops for centers and teachers alike —
    a platform-wide state, not a teacher-specific gap, worth knowing before any other file's fee-reminder
    claims are taken at face value.
  - **Session changed** — `teacherScheduleNotifications.ts` sends `chq_schedule_changed`, plus
    `chq_class_cancelled`/`chq_class_rescheduled`/`chq_class_reminder`, all real code — but **none of
    the four have a `wa_meta_templates` row at all**, not even a pending one. They were never submitted
    to Meta, one step earlier than the fee-reminder gap above.
  - **Payment link / Receipt ("sent by us, we pay")** — this pair doesn't exist **for anyone**, center
    or teacher. Grepped every `chq_*` template name in the codebase (54 total): the closest matches are
    `chq_payment_confirmed`/`chq_payment_failed` (both `APPROVED` live), which confirm a **center's own
    subscription payment** to TutoringHQ, not a parent-facing "your session was paid, here's the
    receipt" message. The specific parent-facing payment-link-then-receipt pair the design assumes is
    industry-standard here is unbuilt platform-wide.
- **The pack/purchase side is unbuilt, confirmed, not just for teachers.** The only prepaid-tier
  purchase concept in the codebase is `whatsapp-pack` (`/api/whatsapp-pack/*`), and it's center-only
  (`requireCenterAuth`) — and it isn't even the same shape as the design's fixed 200/1,000/5,000 tiers;
  it's an invoiced rolling balance with monthly minimums (`parentPack.ts`'s `PLAN_INVOICE_MINIMUMS`).
  There is no fixed-tier prepaid pack anywhere to extend to teachers, for either audience.
- **Structure coverage: 0/1**, correctly matching the table — nothing here is a display fix. Building
  this screen means deciding, together: whether `deduct_blast_credits` gets wired to real sends (and
  which sends count against it), whether teachers get the center's rolling-invoice pack model or a new
  fixed-tier one, and separately, submitting the 4 unsubmitted templates and chasing the pending one
  through Meta review (external, Meta's timeline, not a code blocker).
- **Drawn in:** `Merged-Teacher-WhatsApp` §01.
- **Touches:** money.
- **Blocked by:** D5, the allowance/spend-wiring decision, the pack-model decision, and Meta template
  approval (external) for the messaging half.
- **Re-verified live, 4 August 2026 (Teacher-WhatsApp parity pass, `claude/parity-teacher-whatsapp-w2`).**
  Every claim above re-checked against today's production catalog and today's `src/`, not re-stated
  from the ledger. Nothing has moved since 31 July:
  - `git log --since=2026-07-31` on `parentPack.ts`, `invoiceTemplates.ts`, `whatsapp-pack/*`,
    `teacherScheduleNotifications.ts`, `teacherFeeReminder.ts` and the migrations directory shows two
    unrelated commits (sessions-consolidation migration, Teacher-Students parity) and nothing touching
    this area.
  - `information_schema.columns`: `teacher_profiles.blast_credits_subscription` /
    `blast_credits_purchased` still both `numeric default 0`, still present.
  - `grep -rn "deduct_blast_credits" src/ supabase/` still returns only the two migration definitions
    (`baseline.sql`, `migrations_archive/20260612000005_teacher_pro_rpcs.sql`) — zero call sites in
    application code.
  - `wa_meta_templates` live rows, checked by name: `chq_fee_reminder` is still `PENDING`.
    `chq_schedule_changed` / `chq_class_cancelled` / `chq_class_rescheduled` / `chq_class_reminder`
    still have **no row at all** (query returns nothing for all four, not a status value). Also
    confirmed while in there: `chq_parent_welcome`, `chq_payment_confirmed` and `chq_payment_failed`
    are all `APPROVED` at Meta — approval is not what blocks Welcome or the payment pair; see below.
  - `studentParentPackWelcome.ts` re-read in full: every exported function takes `centerId`, not
    `teacherId`, and every DB read/write in the file (`sendTemplateMessage`, `syncParentPackActive...`)
    is keyed off it. A teacher's private (center-less) student has no `centerId` to key this on — the
    "doesn't exist for teachers" finding holds structurally, not just by absence of a route.
  - `wa_message_queue` columns re-dumped: `id, center_id, to_phone, template_name, variables, body,
    status, waba_message_id, error_message, created_at, updated_at` — still no `teacher_id`, still no
    other FK to attribute a send to a teacher.
  - Nav check, not in the prior survey: `src/app/[locale]/teacher/TeacherNav.tsx`'s `NAV_ITEMS` /
    `MOBILE_KEYS` / `MORE_KEYS` have no WhatsApp entry in either the desktop rail, the mobile tab bar,
    or the "More" sheet. This is not a dead link or a 404 waiting to happen — there is no partial nav
    wiring to clean up. The screen is absent in the one place a teacher would look for it, cleanly.
  - **Precise per-template answer, so the decision is answerable without re-deriving it:**

    | Design template | What it needs, precisely | Owner of that need |
    |---|---|---|
    | Welcome | A teacher-keyed send path. `studentParentPackWelcome.ts` is `centerId`-shaped end to end; a teacher's private students have no center to key off. This is a code/schema change (a teacher variant of the welcome sender, or a schema path that lets private students route through it), not a config flip. | Eyad — new send path or schema |
    | Fee reminder | Nothing to build — the cron (`/api/cron/fee-reminders`) already covers teacher-billed private lessons via `transactions.teacher_id`. Blocked purely on `chq_fee_reminder` moving from `PENDING` to `APPROVED` at Meta. Same block a center's fee reminder has today. | Meta (external, platform-wide) |
    | Session changed | Code is real and already firing sends (`teacherScheduleNotifications.ts` → `chq_schedule_changed`/`chq_class_cancelled`/`chq_class_rescheduled`/`chq_class_reminder`), but none of the four templates were ever submitted to Meta — no row in `wa_meta_templates` at all. Needs submission first, then approval. One step earlier than fee reminder. | Meta (external) + whoever owns template submission |
    | Payment link ("sent by us") | Does not exist for anyone, center or teacher. The only approved payment-adjacent templates (`chq_payment_confirmed`/`chq_payment_failed`) confirm a center's own subscription payment *to* TutoringHQ, not a parent-facing "your session was paid" link. This is a net-new template plus a net-new send trigger. | Eyad — new feature, platform-wide |
    | Receipt ("sent by us") | Same gap as Payment link — no parent-facing receipt template or trigger exists anywhere in the codebase today. | Eyad — new feature, platform-wide |

    Two of five (fee reminder, session changed) need nothing from Eyad — they need Meta, and are
    already platform-wide blocks other files' fee-reminder claims should account for too. Three of
    five (Welcome, Payment link, Receipt) need a product/engineering decision before Meta submission
    is even the next step.
  - **Nothing was built this pass.** The screen has no live route, nothing links to it, and every
    frame the design draws (balance, templates, pack) sits directly on the unresolved credit-spend
    and pack-model decisions above. Building any part of it — even a read-only balance display — would
    mean shipping the same permanently-one-directional number `Teacher-Money`'s `TeacherPlanSection`
    already shows today, in a second place, which is the exact anti-pattern this pass is told to avoid.
    `Teacher-Money` itself is one of the six protected files and out of scope for this branch regardless.

### PARTIALLY CLOSED, 5 August 2026 — the screen is built; the pack and the usage history are not

The instruction was reversed for this pass: build every section whose backing columns exist, and
omit only where a named column genuinely does not. Re-checked the whole file against the live
catalog before writing anything, and the answer split cleanly in three — two thirds of it was
buildable and the previous pass had been wrong to hold all of it.

**Built** (`/{locale}/teacher/whatsapp`, new route, plus a nav entry in the desktop rail and the
More sheet — there had been none):

- **Balance.** `teacher_profiles.blast_credits_subscription` / `blast_credits_purchased` are real
  live `numeric NOT NULL default 0` columns and are already served, teacher-authenticated, by
  `GET /api/teacher/subscription/status`. No new endpoint and no new money math: the screen renders
  the two buckets and their sum through `formatCurrency`, with the plan's included monthly amount
  from `TEACHER_PLANS[*].blastCreditsMonthly` (Standard 0, Pro/Scale 100) — the same figure the
  reset RPC tops the bucket up to. Deliberately NOT drawn in messages: teachers hold an EGP credit,
  not a message allowance, and there is no per-teacher message price anywhere to convert it with.
  Converting it would have been an invented number.
- **The one disclosure that makes the balance honest.** `deduct_blast_credits` is still real in the
  database with zero callers in `src/` (re-grepped this pass: only `baseline.sql` and
  `migrations_archive/20260612000005_teacher_pro_rpcs.sql`). So the screen says so, in both locales,
  in a line under the card: nothing draws on this credit yet, messages sent today are not deducted.
  This is the answer to the previous pass's objection. The objection was right that displaying a
  permanently-one-directional number is an integrity problem — but the fix is to state the
  direction, not to withhold the screen. `Teacher-Money`'s `TeacherPlanSection` shows the same two
  numbers today with no such line; that file is protected and was not touched.
- **Templates.** Five real teacher send paths exist in code and now have a screen:
  `chq_fee_reminder` (nightly `/api/cron/fee-reminders` plus the manual send-reminder route),
  `chq_class_reminder` (`/api/cron/class-reminders`), and `chq_schedule_changed` /
  `chq_class_cancelled` / `chq_class_rescheduled` (`teacherScheduleNotifications.ts`). Each row
  carries its live `wa_meta_templates.status`, resolved by the same 'APPROVED'-only rule
  `isTemplateApproved` gates every send with. Confirmed live this pass across all 45 rows:
  `chq_fee_reminder` is `PENDING`; the other four have **no row at all**. Those are reported as two
  different states — "awaiting WhatsApp approval" vs "not submitted to WhatsApp yet" — because they
  are one step apart and collapsing them would overstate progress. The "when it sends" line on each
  row is read off the sender, not invented: the fee reminder's >24h-then-~3-days, max-two cadence
  and the class reminder's same-Cairo-day window are both quoted from the crons.
- One source of truth for the names: `src/lib/teacherWhatsappTemplates.ts` (new, pure, unit-tested).
  `teacherScheduleNotifications.ts` and `teacherFeeReminder.ts` now import their template names from
  it, so the screen cannot list a template the code does not send.

**Not built, each for a named missing column or an open decision:**

- **"Where yours went" (per-template usage this month) and "Sent by us, at our cost."** Missing
  column: **`wa_message_queue.teacher_id`**. Verified two ways this pass rather than re-stated:
  `wa_message_queue` is `(id, center_id, to_phone, template_name, variables, body, status,
  waba_message_id, error_message, created_at, updated_at)` with `center_id uuid NOT NULL`; and a
  schema-wide query for `column_name in ('teacher_id','teacher_user_id')` returns exactly 16 tables
  — `ar_by_student, ar_by_teacher, bookings, chargebacks, commissions, group_proposals, invoices,
  schedule_slots, student_credits, student_group_notes, student_groups, teacher_assignments,
  teacher_center, teacher_center_requests, teacher_subscriptions, transactions` — **not one of which
  is a WhatsApp log**. `whatsapp_usage`, `wa_messages` and `whatsapp_messages` are all `center_id`-
  keyed too, so there is no second table to fall back to. A new column is a migration → stops here,
  comes to Eyad. No count was estimated from anything else.
- **The pack purchase state** (fixed 200 / 1,000 / 5,000-message tiers, "Buy a pack", the
  "Includes VAT · 20 EGP processing fee" footer). Held on **D5**, still open. Live billing is a
  per-parent monthly pack; the design is a one-time never-expiring top-up. Putting the design's
  tiers on screen would be fabricated pricing, and a CTA with nothing behind it would be a dead
  button, so the footer CTA is absent too. Both omissions are written into the page's own header
  comment so the next reader does not re-litigate them.
- **The "Sent by us" pair (Payment link, Receipt).** Not a missing column — a missing template and a
  missing sender, platform-wide. Re-confirmed against all 45 live `wa_meta_templates` rows: there is
  no parent-facing payment-link or receipt template for anyone, centre or teacher, and no sender in
  `src/`. `chq_payment_confirmed` / `chq_payment_failed` are `APPROVED` but confirm a centre's own
  subscription payment *to* TutoringHQ, which is a different message to a different recipient.
  Drawing the pair would claim a capability that does not exist.

**Structure coverage: 0/3 → 2/3** (balance, templates built; pack held on D5). Screen-level, the
route now exists and is reachable, so the file's 0/1 becomes 1/1 *drawn* with one of three states
still held. Still open on this entry: D5, wiring `deduct_blast_credits` to real sends, and the
teacher-attribution column above. Meta approval for the five templates stays external and unchanged.

## D7 · Card-order notify-me — a write with no destination
- **The decision:** where does a notify-me registration go?
- **Why it is stuck:** the only waitlist table is `waitlist_notifications (student_id, group_id, …)`, which is about group waitlists, not card orders.
- **Blocks:** the notify-me control in R8 only. The screen itself can ship without it.
- **Re-confirmed, 31 July 2026 (Center-Orders survey).** `CardOrdersTeaser.tsx`'s own JSDoc documents the omission explicitly: the design's "Notify me when it launches" CTA was left out on purpose because it has no backing table, and the component's `action` prop instead carries a real "enable in Settings" link. Intentional, documented, not dead code — still waiting on this decision, nothing new to add.

## D8 · Team seats as a paid add-on
- **The decision:** the seat model, and the price.
- **Why it is stuck:** **no column matching `%seat%` in any table**, `pricing_plans` has no seat allowance, and the design itself says the price is *"still to be set"*.
- **Touches:** money.
- ⚠ **Amended, 31 July 2026 (Center-Setup survey) — this decision is premature; the free tier it would sit on top of is itself broken.** `/settings/team` renders a real "X of Y seats" bar and gates the "Invite +" button on it, backed by `GET /api/settings/limits` reading `centers.max_teachers`/`centers.max_students`. **Neither column exists in the live production schema** (confirmed directly against `information_schema.columns` — `select max_teachers, max_students, plan from centers` raises Postgres `42703`). Both `/api/settings/limits` and `/api/invite-user`'s own limit check hit the same non-existent columns, fail silently, and fall back to a hardcoded default of `{ maxTeachers: 2 }`. **Effect: every center in production is invisibly hard-capped at 2 team members regardless of plan** — a Growth-plan center the design says gets 5 seats is actually capped at 2, with no error surfaced anywhere. Deciding an *extra-seat add-on price* is moot while the *included* seat count itself is dead code reading columns that were never created. See **F19** for the full team-settings breakage this was found alongside.

## D9 · Owner notification preferences
- **Decided 28 July: do not build.** Kept here so it is not re-raised.
- **Why:** the whole preference model is absent. The only `notify_*` columns are `students.notify_on_absence` / `notify_on_balance` / `notify_on_scan`, which are **per-student parent** toggles — a different feature, not a partial one. *"Do not build a preference model to satisfy a restyle."*
- **Effect:** `Center-Setup` §05 is skipped, live screen untouched.
- **Re-confirmed, 31 July 2026 (Center-Setup survey).** Grepped fresh for any owner/user-level notification-preference table or column — zero matches beyond the three per-student parent toggles already named. `/settings/notifications` is not empty, though: it already exposes two real center-wide operational toggles (`daily_summary_enabled`, `summer_mode`) unrelated to this decision. A third sibling boolean, `centers.individual_alerts_enabled`, sits on the same table but is only editable from the admin/CEO console, never from this owner-facing page — an existing asymmetry, not part of D9's scope.

## D10 · Scanner behaviour preferences
- **Decided 28 July: do not build.** Kept here so it is not re-raised.
- **Why:** `centers` carries exactly one scanner column, `scanner_default_mode`, which live already exposes. Separately, "Mark attendance automatically" **changes what gets written** to `attendance_scans`, so it is Eyad's regardless of storage.
- **Re-confirmed, 31 July 2026 (Center-Setup survey).** Full live `centers` column dump (128 columns) has exactly one column with "scanner" in its name. `/settings/scanner` already reads/writes it. Holds exactly as decided.

## D11 · Region and display preferences
- **What:** app language, currency, week start, time format, date format.
- **Drawn in:** `Merged-Center-Setup` §02, the General frame.
- **Touches:** **every formatted number and date in the product.** No money figure changes, but every money figure is re-rendered.
- **Why it is stuck:** needs a storage decision and a formatting-layer decision together.
- **Re-confirmed, 31 July 2026 (Center-Setup survey), with a route-identity gap the original entry didn't call out.** Live schema check: `centers` and `users` have no `currency`/`week_start`/`time_format`/`date_format` column anywhere. App language is the one real exception — `users.preferred_locale` (CHECK'd to `ar`/`en`) — but it's written only from a locale switcher in the app shell/nav chrome (`AppShell.tsx`, `AdminHeader.tsx`, etc.), never reachable from any Settings page. **The bigger gap: `/settings/general` is not a General/Region/Display screen at all** — it's `SettingsMenuPage`, the settings hub/menu (a different screen than the design draws under that name, confirmed by reading both). There is currently no live route anywhere matching the design's General frame's shape — this isn't a partially-filled screen, the screen itself doesn't exist under this or any other URL. D11 still holds; it understated how much is missing.

## D12 · Group billing basis
- **Deferred 26 July.** Live keeps `fee_per_class` only. Build the `fee_per_class` equivalent and record the difference. Deferred, not rejected.
- **Touches:** money.

**Re-verified live 5 August 2026, and it is now clear this is a MIGRATION stop, not only a deferral.**
`select column_name from information_schema.columns where table_name='student_groups'` on
`lczmjpnbuhnsislcvzar` returns exactly sixteen columns: `approval_mode, capacity_cap, center_cut_egp,
center_id, created_at, fee_per_class, id, is_self_enroll_open, kind, max_capacity, name, status,
subject, teacher_id, teacher_split_pct, whatsapp_group_id`. A targeted check for
`billing_basis | monthly_fee | bundle_sessions | price_per_session | bundle_size | fee_basis`
returns **nothing**. So §02's billing sheet — the three-way Per session / Monthly / Bundle radio and
the bundle's size — has **no column to read or write**, and stops under the standing rule that a new
column comes to Eyad rather than being written here. That is separate from, and additional to, the
second reason it stops: the sheet's price breakdown ("Platform markup +18.75 · Your price to parents
168.75 · You receive 90% of your fee") is a platform-markup money model, which is protected-file
behaviour wherever it lives.

What §02 *can* carry without either of those was built on 5 Aug: the header's **Verified** badge (from
the existing `useVerificationState`, using the one shared `verification.badge.verified` string) and
the "N groups · all collecting digitally" subtitle, both behind the same two-half gate that already
guarded the §02 note — `platform_config['digital_student_fee_collection.enabled']` **AND**
`verification.isVerified`. The platform key exists live and is the only `digital`-matching row in
`platform_config`; it is `false`, so none of this renders for any centre today. The design's per-group
chip row (`Per session · 150 EGP · Parents pay 168.75`) was **not** built: two of its three chips are
the blocked halves above, and a one-chip row is not the design.

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
- **Re-verified live, 5 August 2026, `Center-Insight` BUILD pass — unchanged, and §03 was therefore built nothing.** Two independent checks, both run this pass rather than trusted from above: (a) `src/app/api/referral/route.ts` still selects `.from('referral_reward_records')` — the read that feeds every figure on `/{locale}/referrals`; (b) live row counts against project `lczmjpnbuhnsislcvzar`: `referrals` **0**, `referral_commissions` **0**, `referral_reward_records` **0**, `payout_requests` **0** — the same all-zero picture as 31 July, so nothing has started flowing that would force the decision. §01 and §02 were built out substantially in this pass; §03 was left exactly as it stands, because every remaining design element on it (the recurring-income hero, the per-referral rate/countdown cards, the referral-detail rate schedule) hangs off this table. R6's own note — "adding a rate/countdown display on top of a permanently-empty table would dress up a broken pipe as a working feature" — is the reason, and it was re-read before deciding, not after.

## D23 · Adding a branch silently clones the parent's full plan price — there is no "extra branch" add-on
- **What:** `Merged-Center-Groups` §04 draws "Extra branch · 199 EGP/mo · billed via Paymob" as a flat add-on charge.
- **Found:** 30 July 2026, building `Merged-Center-Groups`.
- **Evidence:** `POST /api/branches` clones the parent centre's entire `billing_amount`/`all_in_price` onto the new branch's own `centers` row — a full second subscription at the org's existing plan price, not a 199 EGP add-on. Grepped `199` and "branch add-on" across `src/lib/pricing*` and `docs/PRICING_SPEC.md` — zero hits anywhere; no such price exists in the model today.
- **Why it matters:** if the design's copy shipped verbatim it would misstate what the centre is actually billed — today a second branch is free to add but silently doubles the org's billed plan cost, the opposite problem from what the design describes.
- **Build:** decide the real model — a flat per-branch add-on fee (matching the design), a percentage, or intentionally free — before any "extra branch" pricing copy ships.
- **Touches:** money.
- **Blocked by:** Eyad's decision on the add-on model and price.

**Re-confirmed live, 31 July 2026, independently of this entry.** Re-read `POST /api/branches` from
scratch while surveying `Center-Groups` §04 for the redo pass — same finding, unchanged: the route
still clones `billing_amount`/`all_in_price` onto every new branch wholesale. Not touched this pass;
§04's other structural gaps (no "Current" branch indicator, no per-branch action chips, no address
field, wrong KPI-tile count) were deliberately left alone too rather than partially rebuild a screen
whose core Add-branch flow sits on top of this unresolved billing question.

## D13 · Advanced Analytics / Benchmarks as paid add-ons
- **Closed 26 July, parked.** Both stay as they are — Analytics keeps `canViewRevenue`, Benchmarks stays free. No purchase flow. Parked until AI features ship.
- Kept here only so a designer reading `Merged-Center-Insight` §01/§02 does not re-open it.
- **Re-confirmed, 31 July 2026 (Center-Insight survey).** Read both routes in full: `/analytics` still gates purely on `canViewRevenue` (role/permission), `/benchmarks` still has no gate beyond normal center auth plus the data-sufficiency check (`insufficient_data`, 10-center district threshold). Neither has a paywall, an "Enable" sheet, or a Paymob purchase call anywhere in the route or its API. Matches this entry exactly, nothing to reopen.

## D14 · Teacher referral model
- **The decision:** which reward model ships — extend, replace, or leave alone.
- **Corrected 31 July 2026 (Teacher-Insight survey) — the original premise was wrong, not stale.**
  The entry's own text said "every referral table is center-to-center only, confirmed absent, not
  merely unfound." Live-checked fresh: that is false. `teacher_profiles.referral_code` (unique) and
  `teacher_profiles.referred_by_teacher_id`, plus `teacher_subscriptions.free_months_credit` and
  `referral_rewarded_at`, all exist in production today — confirmed directly against
  `information_schema.columns`, not a migration file. `src/lib/teacherReferral.ts`'s
  `grantReferralReward` is genuinely wired into `combinedPaymentFinalize.ts` on both the
  `teacher_resubscribe` and `teacher_upgrade` paths, idempotent (`referral_rewarded_at IS NULL` guard),
  and blocks self-referral. It is live-but-thin: 3 teachers have an issued code, 0 have
  `referred_by_teacher_id` set, so the loop has never actually paid out — same shape as several other
  findings this session (D25, D22): correct because nothing has exercised it yet, not because it's
  broken.
- **Why it's still a decision, just not this one.** What exists is a **flat, one-time +1 free month
  to both sides on the referee's first cleared charge** — explicitly not a percentage
  (`src/lib/referralProgram.ts`'s own comment: "Teachers do not earn commission... a teacher referrer
  has free months earned, never an EGP balance owed"). `Merged-Teacher-Insight` §02 draws a full copy
  of the **center** program instead: a 25%/10%/5% time-decaying recurring commission on the referred
  teacher's own subscription fee, a monthly aggregate income figure with a next-month projection, a
  per-referral earnings/countdown list, and bank-withdrawal gated on the teacher's identity-verification
  status. Building that means either replacing the working free-month loop or running a second reward
  system alongside it — a product and money decision, not a schema gap to fill in.
- **Also found, fixed in this pass (no decision needed):** `ReferralCard`'s share link points to
  `/teacher/landing?ref={code}`, but `TeacherLandingClient.tsx` never read the query string — every
  "Sign up" button on that page was a static `href="/teacher/signup"` with no `ref` forwarded, so a
  referred teacher who clicked through from the landing page (rather than typing the code by hand)
  would silently lose attribution. Fixed by having `teacher/landing/page.tsx` read `searchParams.ref`
  server-side and thread it into the client component's 5 signup CTAs as `?ref=` — no client-side
  `useSearchParams()`, since that would need a Suspense boundary this page doesn't have and risks
  breaking static rendering.
- **Re-confirmed 4 August 2026 (Teacher-Insight parity pass, `claude/parity-teacher-insight-w2`).**
  Read `Merged-Teacher-Insight.html` section by section against the live screen fresh, no code
  changed. §01 Analytics holds at ~0.9/1: `AnalyticsView.tsx`'s `PileBPlaceholders` renders all 5 of
  the design's "what you'll unlock" cards (`dropoutTitle`/`trendingTitle`/`missingTitle`/
  `avgSessionTitle`/`missedIncomeTitle`) with real, non-placeholder Arabic copy, for both the Pro and
  Standard (locked) states — the #259 fix holds. §02 Referrals is still the flat +1-free-month loop,
  not the design's 25/10/5% program; `ReferralCard.tsx` now points at `/teachers?ref=` (moved off the
  old `/teacher/landing` redirect hop since PR #314's Public-Marketing rewrite) and `TeachersClient.tsx`
  still threads `?ref=` into its signup CTAs, carried via `signupHref` — the hero primary CTA directly,
  plus two more via `MarketingFooter`'s `createAccountHref` prop (the CTA-band button and the footer
  "create account" link), 3 referral-aware CTAs total on the page, not the "5" an earlier note in this
  same entry claimed for the pre-rewrite page. The attribution fix from this same entry survived PR
  #314's rewrite intact, re-verified by reading both files. Every column `teacherAnalytics.ts`
  and `buildTeacherAnalytics` read — `student_groups.{fee_per_class,kind,status,teacher_id}`,
  `enrollments.{group_id,student_id,status}`, `students.{id,name,is_guest}`,
  `group_schedule.{group_id,day_of_week}`, `schedule_exceptions.{group_id,exception_date,kind,new_date}`,
  `transactions.{group_id,teacher_net,paid_at,teacher_id,kind,status,is_test}`,
  `sessions.{id,group_id,scheduled_at,status}`, `attendance_scans.{session_id,student_id,scanned_at}`,
  `ar_by_student.{student_id,outstanding_amount,unpaid_amount,unpaid_count,teacher_id}`,
  `teacher_subscriptions.{plan_key,teacher_id}` — was checked directly against
  `information_schema.columns` on project `lczmjpnbuhnsislcvzar`; all present, no F26-class drift.
  D14 itself is unchanged: still Eyad's call, still the file's only real gap.
- **Drawn in:** `Merged-Teacher-Insight` §02.
- **Touches:** money.

## D15 · "Mark collected" and "Send reminder" on the teacher's student-detail balance card
> ### ✅ CLOSED — built 3 Aug 2026, PR #310 (commit `4435369`)
> Both buttons shipped. **`Mark collected`** opens the same four-method picker (`cash | instapay |
> vodafone_cash | other`) the two existing callers use, then fires one `POST
> /api/teacher/private/transactions/[id]/mark-paid` per pending charge (the balance is an aggregate,
> the endpoint settles one charge at a time) and reports how many failed without zeroing the card
> optimistically. **`Send reminder`** is new — `POST
> /api/teacher/private/students/[studentId]/send-reminder`, gated by `requireTeacherPrivateAccess`
> and the same tenant check as the GET, reusing the nightly cron's exact template and body-parameter
> construction (moved into `src/lib/teacherFeeReminder.ts` so the two paths cannot drift) and the same
> `fee_reminder_count` / `fee_reminder_last_at` cadence columns so the two paths cannot double-send.
> It ships **fail-visible, not fake-visible**: `chq_fee_reminder` is still PENDING at Meta and the
> `platform_config` row `teacher.fee_reminder.manual_enabled` does not exist — re-confirmed live on
> this pass (`select count(*) from platform_config where key =
> 'teacher.fee_reminder.manual_enabled'` → 0) — so a missing row reads as off, the button ships
> disabled, and a one-line reason prints underneath. There is no code path that reports a send that
> did not happen.
> **Re-verified this pass (4 Aug 2026), independent of the PR's own account:** read
> `students/[studentId]/page.tsx`, the `mark-paid` and `send-reminder` routes, and
> `students/[studentId]/route.ts` directly; confirmed live against `information_schema.columns` on
> project `lczmjpnbuhnsislcvzar` that every column the new code reads or writes actually exists —
> `transactions.{fee_reminder_count,fee_reminder_last_at,payer_phone,session_id,paid_at,method,
> amount_billed,is_test}`, `teacher_profiles.{instapay_address,wallet_phone,payment_phone,
> accepted_methods,default_payment_method}`, `group_schedule.day_of_week`, `students.parent_phone`,
> `sessions.{scheduled_at,status}`, `attendance_scans.*` — all present. `npm run typecheck`, `lint`,
> `verify:stabilization` and `test:unit` (1597 tests) all pass on `origin/master` unmodified.
> **This entry, `FILE-COMPLETION-TABLE.md` row 5, and the row's `no — D15` status column were all
> one day stale** — the table still listed D15 as the file's sole open item after the PR that closed
> it had already merged. `git log --oneline origin/master` shows `4435369` predates this pass by a
> day. Table corrected below (see `FILE-COMPLETION-TABLE.md`).
- **What:** the design's Balance card carries two buttons: `Mark collected` (the teacher confirms a parent paid them directly) and `Send reminder` (nudge the parent about an outstanding balance).
- **Drawn in:** `Merged-Teacher-Students` §02.
- **Touches:** money (write), WhatsApp cost (for the reminder, currently blocked external — see above).

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
- **Reconfirmed 4 August 2026 (Teacher-Setup structural build, PR #344), with the hero now rebuilt around it.** `select count(*) from transactions where kind='center_fee'` → **0**, against **3** transaction rows in the whole table; `centers` has **2** rows, both `is_test = true`, **0** non-test. Unchanged since 29 July. The §02 hero was rebuilt this pass to the design's shape — the shared `.money-hero` surface plus the design's This month / All time footer — because the *shape* was a real structural gap and the *arithmetic* is not this entry's blocker to resolve. The all-time stat is fed from the already-live `earnedAllTime` on `/api/teacher/center-attendance`, and is **omitted entirely rather than defaulted to 0** while unknown, precisely so it cannot be confused with the genuine zero this entry describes. Net effect for Eyad: the hero is now correctly shaped and still correctly empty. Nothing here narrows the decision — it is still flat-cut vs percentage-split.
- **One extra consequence, surfaced by this pass and worth naming before the decision is made:** the same open question blocks a purely cosmetic-looking fix elsewhere. `Merged-Teacher-Setup` §02's counter sheet states the teacher's counter as **"you earn per student" in EGP**; `Merged-Center-Setup`'s Requests tab states the same control as **"Your counter · center's cut" in percent**. Both are rendered by one shared component (`src/components/group-proposals/CounterOfferForm.tsx`, two consumers, confirmed by grep), which today uses EGP-cut for both. Whichever commission model wins here also decides which of those two framings the shared control should carry — so the counter-sheet redesign is not an independent restyle and was deliberately not forked locally.

## D17 · `JoinCenterCard`'s "Share your profile" tab links to a page that does not exist
- **What:** the "Share your profile" tab renders a link and QR code at `https://tutoringhq.app/teacher/profile/<teacherId>` for a center owner to open and add the teacher directly.
- **Drawn in:** `Merged-Teacher-Setup` §02, "Join a center" → the second tile.
- **Found:** 29 July 2026, building `Merged-Teacher-Setup`.
- **Evidence:** no route matches `/teacher/profile/[id]` anywhere under `src/app/[locale]/` (checked by glob across the whole app router tree). `src/app/api/teacher/profile/route.ts` is the authenticated teacher's own profile API, not a public page. The shared link and QR both lead to a 404 today.
- **Build:** a public, unauthenticated teacher-profile page a center owner can open from the link or QR. A new page, not a restyle — same class of hole as R9 (Teacher Link Rejection).
- **Touches:** none to build the page itself; once it exists, whatever "add this teacher" action it offers touches account state and comes back to Eyad then.
- **Blocked by:** Eyad's decision on whether/when to build the page. Left as-is in the meantime — it matches the design, and hiding a designed feature is itself a decision beyond restyle scope.
- **Reconfirmed 4 August 2026 (Teacher-Setup structural build, PR #344).** Re-read `JoinCenterCard.tsx` directly: `PROFILE_BASE` is still the literal `'https://tutoringhq.app/teacher/profile'` and the share tab still renders both a copyable link and a QR at `${PROFILE_BASE}/${teacherId}`. Re-globbed the whole app-router tree: still no `teacher/profile/[…]` page anywhere under `src/app/[locale]/`. Unchanged, still a 404, still Eyad's call.

## D36 · The verified-state Payout details section needs three columns `teacher_profiles` does not have
- **What:** `Merged-Teacher-Setup` §01's verified frame replaces "Payment details" (where parents pay the teacher directly) with **"Payout details"** — Account holder ("Matches your verified ID"), Bank, and IBAN, plus the Thursday-cycle explainer. This is the file's one remaining structural hole, and the only reason its coverage is 15/16 rather than 16/16.
- **Drawn in:** `Merged-Teacher-Setup` §01, verified frame (EN and AR).
- **Found:** 29–31 July 2026 as the un-itemised half of the "0/2" V1 gap; **promoted to its own entry 4 August 2026** (PR #344) because its sibling half — the collect-payments toggle — has since shipped (`e7f5dd20`, PR #322) and the two no longer share a blocker. The toggle needed Valify state; this needs schema.
- **Evidence, live:** `select column_name from information_schema.columns where table_schema='public' and table_name='teacher_profiles'` returns **24 columns**, listed in full in the PR. There is **no `iban`, no `bank_name`, no `account_holder`, no `payout_name_matches`**. The nearest thing is `payout_destination` (jsonb) — which is entirely dormant (V4: zero readers, zero writers, `grep -rl "payout_destination" src/` returns nothing) and is a *destination channel*, not the three labelled fields the design draws.
- **Exactly what is needed:** three columns on `teacher_profiles` — an account-holder name, a bank identifier, and an IBAN — or a decision to model them inside the existing `payout_destination` jsonb instead. **Not written, not applied**, per the standing rule that anything needing a new column stops here.
- **Why it is not just a schema question:** these are payout rails. `Merged-Teacher-Money` and `Merged-Verification-Payouts` are both **protected files**, and an IBAN is regulated personal data that wants the same column-level-REVOKE treatment `verification_records` already got for the national ID (see `DECISION-national-id-2026-07-26.md`) rather than sitting on a table four `select('*')` call sites already read.
- **Touches:** money, account state, personal data.
- **Blocked by:** Eyad — the migration, and the decision on where the IBAN is allowed to live.

## D35 · The proposal card's proposed-schedule line has no backing column anywhere
- **What:** `Merged-Teacher-Setup` §02 draws a schedule line on the group-proposal card itself — *"Proposed: Saturdays, 2:00–3:30 PM, weekly"* — so a teacher can judge an offer on its time as well as its money before accepting.
- **Drawn in:** `Merged-Teacher-Setup` §02, the proposal card (EN and AR).
- **Found:** 4 August 2026, structural build of `Merged-Teacher-Setup` (PR #344). Not previously itemised: the coarse 16-item frame scored "group proposals" as one present section, which hid this.
- **Evidence, live:** `group_proposals` has exactly **17 columns** (`id, teacher_id, center_id, subject, grade_level, fee_per_class, status, accepted_offer_id, expires_at, opening_message, responded_by, responded_at, created_at, updated_at, initiated_by, target_group_id, carries_link`). None is a day, a start time, an end time, a recurrence or a schedule blob. `group_proposal_offers` (6 columns) has none either.
- **The near-miss that is not a fix:** `group_slot_proposals` **does** carry `day_of_week` / `start_time` / `end_time` / `note` / `status`, and it is what the live "Class times" section reads. But it hangs off **`group_id`** — an already-existing, already-attached group — with no relation to a `group_proposals` row. A proposal for a group that does not exist yet cannot have a row in it. Reading it here would attach some *other* group's booked time to an unrelated offer, which is worse than omitting the line.
- **Exactly what is needed:** either schedule columns on `group_proposals` (day / start / end / recurrence), or a nullable `proposal_id` on `group_slot_proposals` so a time can be proposed alongside an offer and promoted on accept. Both are migrations. **Not written, not applied.**
- **Also a product question, not only a schema one:** if a time rides along with the offer, "Accept" starts meaning "accept the money *and* the slot", and the slot has to survive the accept into a real `schedule_slots` row — which touches the center-side confirmation loop that currently owns booking.
- **Touches:** account state (what accepting an offer commits the teacher to).
- **Blocked by:** Eyad — the migration, and whether a proposal should carry a time at all.

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
- **Reconfirmed 4 Aug 2026** (structural-parity survey pass, `claude/parity-teacher-groups-w2`): still live and unchanged. `information_schema.columns` for `enrollments` (project `lczmjpnbuhnsislcvzar`) confirms the exact column set from the original finding, no `note` column anywhere on it; `students` has no `school`/`school_name` column either. Read `verify-otp/route.ts` directly again — the `apply_enrollment_transition(..., 'active', ...)` auto-activate call after `create_enrollment` is still there, still unconditional, still commented as intentional ("a verified self-enroll should not wait for the teacher's manual approval"). The live roster UI (`groups/[groupId]/page.tsx`) does have a working Approve/Decline pair for whatever rarely stays `pending`, and now also surfaces `grade_level` per D18's own note — neither changes the core finding that the design's "approval is always manual" premise is false for the self-link path. No action taken; still Eyad's call.
- **Reconfirmed 4 Aug 2026** (build pass, PR #346, `claude/teacher-groups-build-w3`). Re-queried `information_schema.columns` live on project `lczmjpnbuhnsislcvzar`: `students` has **39** columns and **0** matching `school` / `school_name` / `school_id`; `enrollments` has **9** and **0** matching `note` / `notes` / `message` / `request_note`. Both request-detail fields therefore stay unbuilt, and the exact missing columns are named in a comment at the queue in `groups/[groupId]/page.tsx` — adding them is a migration, and migrations come to Eyad. **What was built this pass is everything else §03 draws off columns that do exist**: the queue's two explanatory notes, `Joined <date>` from `enrollments.joined_at` (already returned by the roster API, discarded by the UI until now), the group summary line, and the requests themselves moved onto the shared `ExpandableRow` — oldest open, Approve/Decline inline, More chip — with one shared `ActionSheet` behind both the pending and the enrolled rows. The gate's *behaviour* is untouched and still auto-activates; the queue is drawn honestly for the rows that do stay pending, and no copy claims review is protecting the roster.

## D19 · Private-lesson commission columns are never populated — Teacher Analytics revenue reads 0.00 EGP, live, today
- **What:** `finish_class_and_bill` (the ACTIVE, correctly-called function for finishing a teacher's own private-group session — not to be confused with `finish_center_class_and_bill` in D16) inserts every `kind = 'lesson'` charge without `teacher_commission_amt`, `teacher_net`, `platform_gross` or `platform_net` — all four stay at their `NOT NULL DEFAULT 0`.
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`, confirmed independently via `pg_get_functiondef('finish_class_and_bill')` and `pg_get_functiondef('compute_lesson_money')`.
- **Evidence:** `compute_lesson_money(p_lesson_fee, p_method)` is a live SQL function clearly built to populate exactly these four columns (`teacher_net := lesson_fee` for cash-class methods) — but it is called by **zero** code anywhere (`grep -rn "compute_lesson_money" src/` finds nothing; it's independently listed as a "ghost" function in `docs/SCHEMA_GHOST_INVENTORY.md`). `src/lib/teacherAnalytics.ts:702-710` sums exactly `teacher_net` for `kind='lesson', status='paid'` to drive the Teacher Analytics revenue figure.
- **Why it matters:** the Teacher Analytics page reads **EGP 0 revenue for every teacher's private-group income, always**, regardless of real collected money — a live, wrong number today, independent of this redesign. (The separate teacher Income page is correct — it reads `amount_billed`, not `teacher_net`.)
- **Build:** wire `finish_class_and_bill` to call `compute_lesson_money` and populate the four columns, or repoint Teacher Analytics at `amount_billed` like Income already does — a money-correctness decision, not a restyle.
- **Touches:** money (a live, wrong number).
- **Blocked by:** Eyad's decision on which fix is correct.
- **Reconfirmed 4 Aug 2026** (structural-parity survey pass, `claude/parity-teacher-groups-w2`): re-pulled `pg_get_functiondef('finish_class_and_bill')` live — the `insert into transactions (...)` still omits all four columns, unchanged since 29 July. Also checked `information_schema.columns` for `transactions.teacher_commission_amt` / `teacher_net` / `platform_gross` / `platform_net`: all four are `NOT NULL DEFAULT 0`, confirming every private-lesson charge silently writes zero into them rather than erroring — this is why the wrong number is invisible in normal use. No action taken; still Eyad's call.
- **Now also blocks three `Merged-CEO` §01/§02 tiles, 5 August 2026 (CEO build pass, `claude/parity-ceo-w17`).** The CEO board was built this pass, and D19 + D16 between them are what keep three of its designed figures unbuilt — worth naming here so the cost of leaving this decision open is visible in one place:
  - **§02 hero, "Teacher fee revenue this month."** The platform's cut of a teacher's classes *is* `transactions.teacher_net` / `teacher_commission_amt`. Both are permanently 0.
  - **§02 "Top earners," ranked by net earned.** Same two columns. Ranking by them today orders every teacher at 0; ranking by `amount_billed` instead is not a display choice, it *is* D19's decision ("wire `compute_lesson_money`" vs "repoint at `amount_billed`") made silently by a restyle pass. Left for Eyad.
  - **§01 KPI quad tile 2 and the teachers-segment third row, both "Fee revenue."** Same source, same 0.
  The other five §01 blocks and the rest of §02 were built, because they are arithmetic over columns that are real and populated (`invoices`, `centers`, `teacher_subscriptions`, `mrr_snapshots`) rather than over the dormant ledger. That line — build pure arithmetic on live columns, hold anything resting on a ledger nothing writes — is the one D16 itself drew when it shipped the proposal-card "You earn" figure while holding the "Owed" hero.

## D20 · Two divergent "run a class" builds exist; only one is reachable
- **What:** `src/app/[locale]/teacher/(portal)/groups/[groupId]/sessions/[sessionId]/page.tsx` is the route `INVENTORY.md` maps §04/§05 to. It is fully built and correct, but **zero live navigation reaches it** — confirmed by grepping every `href`/`router.push`/`Link` in the teacher app for that route pattern. The actual live surface for running a class is `SlotActionSheet.tsx`, opened from `/teacher/schedule`.
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`.
- **Why it matters:** the two implementations are not identical, and each has something the other lacks. The orphaned page has mark-collected on the session record (all four payment methods: `cash | instapay | vodafone_cash | other`) and a simpler single confirm-and-finish flow. `SlotActionSheet.tsx` has Start/Reschedule/Cancel/live-attendance/guest-attendees — materially more of the design — but its recorded-session view is **read-only**: no mark-collected button exists there at all, and its sibling `GroupClassesTab`'s inline collect only offers `cash`/`instapay` (Vodafone Cash is silently unreachable from it, despite the API/DB supporting it).
- **Build:** decide whether to retire the orphaned page, link it in as-is, or move its mark-collected capability into `SlotActionSheet`'s recorded phase (reusing the existing, already-audited `mark-paid` endpoint — the same "mostly plumbing" shape as D15, and held for the same reason: it is a money-state write on a screen that doesn't have one yet, and behaviour decides regardless of file). Also decide whether to add Vodafone Cash to `GroupClassesTab`'s collect dropdown, which is the same category of decision for the same reason.
- **Touches:** money (write, once either fix is chosen), and account state (which page teachers actually use to run a class).
- **Blocked by:** Eyad's decision on which surface is canonical and whether to wire the missing collect paths.
- **Reconfirmed 4 Aug 2026** (structural-parity survey pass, `claude/parity-teacher-groups-w2`): re-read `SlotActionSheet.tsx` PHASE 3 top to bottom — still strictly read-only, no mark-collected control anywhere in it. Re-read `mark-paid/route.ts` — `MANUAL_METHODS` is still `{cash, instapay, vodafone_cash, other}`, live and already audited, exactly as the original finding says. To size the decision for Eyad: the fix is mechanically small — call the existing `mark-paid` endpoint from `SlotActionSheet`'s recorded phase the same way `GroupClassesTab` already does, and add a third `vodafone_cash` button to `GroupClassesTab`'s existing collect popover. A working version of both was prototyped this pass to confirm feasibility, then **reverted and not shipped** — this entry's own "Blocked by" line, written by an earlier, more careful pass on this exact file, already named this a money-state-write decision analogous to D15's, and it is not this pass's call to override that. Left exactly as found; the two candidate diffs are small enough that either resolution is a same-day build once the surface/wiring decision is made.
- **Reconfirmed 4 Aug 2026** (build pass, PR #346, `claude/teacher-groups-build-w3`). This pass was told to build every gap it could and still did not touch §04, for one reason worth writing down: **extending either surface is answering D20 by stealth.** Adding the design's summary block, "View in group" link, select-all or live timer to the orphaned session page makes a page nothing navigates to slightly better; adding them to `SlotActionSheet` asserts that `SlotActionSheet` won. Neither is a restyle. Everything §04 draws stays unbuilt until the surface question has an answer. One factual correction to a neighbouring entry while here: **F10 says "no `sessions.started_at`-equivalent timestamp" exists — the column does exist.** `information_schema.columns` for `sessions` (live, this pass) lists `started_at timestamptz NULL`. F10's real content is unchanged (nothing selects it and no UI counts on it), but the schema claim in its wording was wrong.

## D21 · The self-enroll join link uses the full group UUID, not the design's 6-character code
- **What:** the design draws `tutoringhq.app/j/7K2M9P`, a short code. Live, `GroupJoinLinkCard.tsx` builds `https://tutoringhq.app/ar/join/g/<full-UUID>`.
- **Found:** 29 July 2026, building `Merged-Teacher-Groups`.
- **Why it matters:** shortening it is a URL-scheme change (a new short-code table or column, a lookup, and a decision on collision/rotation), not a copy change — the same class of decision as the admin teacher-link short codes elsewhere in this codebase.
- **Touches:** none directly; a URL scheme change on an already-live, already-shared link is worth flagging before touching regardless.
- **Blocked by:** Eyad's decision on whether the short code is worth building, given the full-UUID link already works and is already shared via QR/WhatsApp.
- **Reconfirmed 4 Aug 2026** (structural-parity survey pass, `claude/parity-teacher-groups-w2`), with one new piece of live evidence: a `group_join_links` table already exists in the live catalog (`id, group_id, token, max_uses, expires_at, active, created_at` — a `token` short-code column is right there). But it has **zero rows** and `grep -rn "group_join_links" src/` returns nothing — no code anywhere reads or writes it. It looks like scaffolding for exactly this feature that was never wired up, not a ready-made fix: there's still no generator, no collision handling, no rotation policy, and no decision on whether the live full-UUID links already shared via QR/WhatsApp should keep resolving. Surfacing this for Eyad's decision, not building against it.
- **Reconfirmed 4 Aug 2026** (build pass, PR #346). `select count(*) from group_join_links` → **0**, live, unchanged. Still zero readers in `src/`. The link card was left on the full UUID; nothing in this pass's §03 work depends on the short form.

## D24 · `students.is_active` is both the pending-signup gate and a directly-editable "paused" toggle — the roster leak can't be silently filtered
- **What:** `Merged-Center-Students` §01 (roster) draws only active, already-approved students; the design's Pending queue (§04) is a separate screen. Live, `students/page.tsx`'s roster query has no `is_active` filter at all, so students still awaiting sign-up approval (`is_active=false`, inserted by the public join flow, e.g. `src/app/api/join/[center_code]/[group_id]/route.ts`) show up mixed into the main roster before anyone has approved them.
- **Why it's not a mechanical fix:** `is_active` is not a pure "pending" flag. `PATCH /api/students/[id]` (`src/app/api/students/[id]/route.ts:37`) has `is_active` in its allowed-fields set alongside `name`/`phone`/`notes` — center staff can toggle it directly on any existing, already-approved student, presumably to "pause" someone without losing their history. Adding a hard `is_active=true` filter to the roster query would also hide these deliberately-paused students, with no visible trace of why they disappeared.
- **Found:** 30 July 2026, building `Merged-Center-Students` §01.
- **Build:** needs a decision on what `is_active=false` should mean when it is not a pending signup — a distinct "paused" state the roster surfaces with its own filter/badge, or something the roster should keep hiding. Either way it's a UI/semantics decision, not a query filter.
- **Touches:** account state (changes which students are visible where).
- **Blocked by:** Eyad's call on the two meanings of `is_active=false`.

### Addendum, 30 July 2026 — verified before proposing anything, and the premise was narrower than stated

Asked to propose a schema fix so "paused" and "pending" are distinguishable on the roster row rather
than both hidden. Before proposing, checked whether the existing `pending_enrollments` table already
carries enough signal to tell them apart with a query-time join and no new column — the same
discipline that caught the `admin_user_id` premise error earlier tonight, applied again. Two
independent auditors plus a reconciler (blind to each other, then cross-checked against the live
catalog directly, not against each other's summaries) ran this down. It is not two meanings. It is
at least **four**, and one of the two named here may not be a live feature at all yet.

**The four real meanings of `is_active=false`, all confirmed live:**

| meaning | where it's set | confirmed by |
|---|---|---|
| pending signup, awaiting approval | `join/[center_code]/[group_id]/route.ts:166`, `join/pending-enrollment/route.ts:86` (INSERT) | both routes read directly |
| rejected signup | *(nothing sets it — see below)* | `pending/[id]/reject/route.ts`, full 29-line file read |
| staff-paused | `PATCH /api/students/[id]` (`is_active` in the allow-list) | file read, allow-list confirmed |
| privacy-erased (GDPR/PDPL) | `admin/privacy-requests/anonymize/route.ts:99`, unconditional | full update block read |

**The rejection path is the sharpest problem, and it is not hypothetical.** `pending/[id]/reject/route.ts`'s
entire body is one statement: `UPDATE pending_enrollments SET status='rejected' ... ` — the string
`students` does not appear in the file. Rejecting a request never touches the student row. The
student stays `is_active=false` forever, with a `pending_enrollments` row that exists but now reads
`'rejected'`. A query-time rule of "`pending_enrollments` row at `status='pending'` ⇒ still pending,
else ⇒ paused" reads this student as **paused** — indistinguishable from a real staff pause — the
instant the first reject button is ever clicked. Symmetrically, `approve_student_rpc`'s live body
(read via `pg_get_functiondef`, not a migration file) sets `is_active=true` and **never touches
`pending_enrollments` either** — so an approved student's enrollment row stays at `'pending'`
forever too, meaning a student paused or erased *after* approval would misread as "still awaiting
approval." Both directions are wrong, for the same reason: approval and rejection each mutate
exactly one of the two tables and never the other, so the tables are not lifecycle-synchronized past
the initial signup moment. `pending_enrollments_status_check` even allows `'approved'` as a value —
nothing has ever written it.

**"Staff-paused" itself has no confirmed live UI trigger today.** `PATCH /api/students/[id]` accepts
`is_active` with no role gate (contrast the reject route's explicit `owner`/`admin` check) — but
grepping every `/api/students/${...}` fetch call site in `src/` returns zero matches, and no test
targets it either. The generic `/api/db` proxy is a second, equally live, equally unrestricted path
(`students` has no `STUDENTS_PROTECTED_COLUMNS` entry, unlike `users`/`card_orders`/`centers`), also
with zero confirmed callers setting `is_active` today. Both routes work if called. Neither is
wired to a button anywhere in this codebase right now. So the premise that centres can *currently*
pause a student is unconfirmed — the capability is live and reachable, not exercised.

**Every staff "add student" path already defaults to `is_active=true` and stays there** — the roster
modal, onboarding, and CSV import (once R10 is fixed) all rely on the column default; none sets
`false` explicitly. The two signup routes are the only inserts that ever set it `false`.

**Live population, for completeness:** all four buckets are 0 today (4 total students, all
`is_active=true`, 0 `pending_enrollments` rows of any status) — this project has too little usage
history to have hit any of this yet. Zero live rows is not evidence the gap is safe; it is evidence
this has never been exercised, and the very first reject click produces it.

**Minimal proposed schema:**

```sql
ALTER TABLE students
  ADD COLUMN inactive_reason text NULL DEFAULT NULL
  CONSTRAINT students_inactive_reason_check
    CHECK (inactive_reason IS NULL OR inactive_reason IN
      ('pending_signup', 'rejected', 'paused', 'anonymized'));
```

One nullable `text` + `CHECK` column, matching the same convention `pending_enrollments.status`
already uses rather than inventing a new enum type. `NULL` whenever `is_active=true`. No companion
timestamp — `pending_enrollments.created_at` and `guardian_consent_confirmed_at` already cover the
auditability angle, so a second date column would be scope beyond the verified gap.

**Five write sites need the reason stamped alongside `is_active`, four of them one-line additions to
statements that already run:**
1. Both signup INSERTs — `inactive_reason: 'pending_signup'` next to the existing `is_active: false`.
2. `approve_student_rpc` — `inactive_reason = NULL` added to the existing `UPDATE ... SET is_active = true`. This is the line that actually closes the gap: once approval clears the reason directly on `students`, the discriminator lives entirely on one table and stops depending on `pending_enrollments` staying in sync at all.
3. The reject route — the one genuinely new write, since this route previously never touched `students`: looks up `student_id` from the `pending_enrollments` row it just updated, then sets that student's `inactive_reason = 'rejected'`.
4. The anonymize route — `inactive_reason: 'anonymized'` added to the existing update.
5. `'paused'` stays in the `CHECK` for completeness, with **no writer, on Eyad's explicit instruction**: "do NOT wire a button for it... If a pause feature is ever wanted it comes to me as a decision." Nothing calls this today, nothing is built to call it here. Read the constraint value as *the shape to use if that decision is ever made*, not as evidence the feature exists.

**One adjacent, minimal-consequence recommendation, not scope creep:** add a `STUDENTS_PROTECTED_COLUMNS`
entry to `src/lib/dbProxyProtectedColumns.ts` (the pattern already used for `users`/`card_orders`/`centers`)
covering `is_active` and the new `inactive_reason`, so a future pause can only happen through a
reviewed route rather than the currently-unrestricted `/api/db` proxy. Not done here — a recommendation, not part of this fix.

With this, `pending_enrollments` keeps its existing job (group/consent metadata for the initial
review) but stops being load-bearing for active/inactive semantics — that split becomes fully
self-contained and correct on `students` alone.

**Approved and built, 30 July 2026 — see PR #242.** Migration applied to production, confirmed live;
`join/[center_code]/[group_id]`, `join/pending-enrollment`, `pending/[id]/reject` (the actual bug fix
— it previously never touched the student row at all) and `admin/privacy-requests/anonymize` all
stamp the reason now. `'paused'` has zero writers, exactly as instructed above — this is not a gap
left for later, it is the deliberate final state unless a pause feature is separately decided on.

## D25 · `parent-balance-alerts` cron reads the dead `payment_status` column to decide who gets messaged, and a stale fee field to decide what the message says they owe
- **What:** `src/app/api/cron/parent-balance-alerts/route.ts:63` filters candidates with `.eq('payment_status', 'unpaid')` — the same write-once-at-insert column D3 condemns. The quoted amount (lines 70, 97) reads `students.fee`, which `studentBalance.ts`'s own header documents as a "NULL-in-practice fallback for a group-less scan," not the authoritative price (`student_groups.fee_per_class` is).
- **Why it matters:** this is a live, running, WhatsApp-cost-bearing cron, not a display bug. Today it under-targets (any student whose `payment_status` wasn't left at `'unpaid'` from creation never gets a reminder no matter how much they actually owe) and the amount it quotes to a real parent is very likely wrong whenever `students.fee` doesn't match the group's real per-class fee.
- **Why it's not a mechanical fix:** correcting the filter to real balances (`getStudentBalances`, same helper as the D3 fixes elsewhere this pass) changes who gets a paid WhatsApp message sent to them and what EGP figure they're told they owe — a messaging-cost and customer-communication change, not a pure read-path correction.
- **Found:** 30 July 2026, building `Merged-Center-Students` (D3's other live wrong consumers).
- **Build:** swap the filter to `balance > 0` from `getStudentBalances`, and the quoted amount to that same `balance` (rounded), scoped to `parent_pack_opted_in` centers as today.
- **Touches:** money, messaging cost.
- **Blocked by:** Eyad's decision to proceed with the corrected targeting/amount.

## D26 · Center-Home Notifications feed — the design draws ~11 event types, two have a real writer
- **What:** `Merged-Center-Home` §02 draws a rich notification feed: payment received, payment failed, an unpaid-links alert, payout sent (two different icons), identity verified, fee collected (auto), fee overdue, student absent, new student, order shipped, payout requested, add-on enabled. Live, `in_app_notifications.kind` is unconstrained free text — no Postgres enum, no `CHECK` — and the table is empty in production. A repo-wide search for every INSERT into it found exactly two real writers: `card_order_status_update` (`src/lib/cardOrderNotifications.ts`, center-scoped) and `privacy_request` (`src/app/api/privacy-request/route.ts`, admin-scoped only — `user_id` is always an `admin_users.id`, so this kind never reaches a center's own `/notifications` screen at all). `NotificationsPageClient.tsx`'s own `decorate()` already documents part of this gap in a comment ("against the seven the design names" — the live count of two is even narrower than that).
- **Which drawn types map to an already-blocked system, not a new gap:** payout sent, payout requested and identity verified are the V1 (verification)/V3/V4 (online collection, payout) systems already logged elsewhere as not existing. No writer for these can be built until those land — this just confirms the notification-feed is a third place those same blockers show up, not a new finding.
- **Which drawn types are plausibly wireable, and what wiring them actually means:** payment received/failed, fee collected/overdue, student absent, new student are each an echo of an event that already happens elsewhere in the app today — a payment gets confirmed, an attendance scan gets marked absent, a student gets created, a billing job marks an invoice overdue. The event is real; only the "also write a notification row" step is missing. But each lives in a different subsystem — payment confirmation alone has several call sites (manual recording, the Paymob webhook, auto-collection) — so wiring all of them is a multi-subsystem change, not a one-file fix, and it raises a shared-primitive question of its own: `cardOrderNotifications.ts` already has a batched-insert helper; should every future writer go through one shared `notifyCenter()` rather than five independently-invented `.insert()` call sites.
- **Not built here:** no new write-triggers. A notification type that fires from only one of its real call sites would look broken (e.g. a "New student" notification for the first-ever enrollment, then silence for the next nine because only one creation path got wired) rather than honestly sparse. Inventing partial coverage is worse than the current honest gap.
- **What was fixed instead, in the same PR, since it doesn't require this decision:** the feed's own accurate unread count. The API already computes it correctly via a dedicated `count('exact')` query with no row cap; the client silently discarded that field and recomputed from its own capped 50-row page instead, which undercounts any center with more than 50 unread notifications. Wired the client to use the server's number.
- **Found:** 30 July 2026, surveying `Merged-Center-Home` §02 against the live `in_app_notifications` writers.
- **Touches:** none yet — this is the decision point. Building any of the plausibly-wireable types touches the payment-confirmation, attendance, enrollment, or billing-cron code paths respectively.
- **Blocked by:** Eyad's call on which event types, if any, are worth wiring, and whether through one shared helper or per-writer.

## D27 · The one real notification writer hardcodes English regardless of the recipient's locale
- **What:** `cardOrderNotifications.ts`'s `insertInAppForCenterStaff` — the only one of D26's two real writers that actually reaches a center's own `/notifications` screen (`privacy_request` is admin-only) — inserts the same `title: "Order #${shortRef}"` / `body: labelForStatus(normTo)` (e.g. "Shipped") for every staff row, in English only. `users.preferred_locale` is a real, live, wired column elsewhere (`/api/me`, `/api/user/locale`, signup flows) but is never read here.
- **Why it matters:** this is the one notification kind design §02 has a live analogue for today, and it always renders in English regardless of whether the Arabic-preferring owner or assistant reading it has `preferred_locale = 'ar'`.
- **Why it's not a mechanical fix:** two different implementation shapes exist and nothing in the codebase already picks one — compose the string per-recipient at write time via `getTranslations` in a background/webhook context (a pattern used nowhere else today), or store an i18n key + params in the already-present `metadata jsonb` column and translate client-side at render. Picking wrong means redoing every future writer D26 eventually wires the same way.
- **Found:** 31 July 2026, Center-Home re-verification (PR #280) — surfaces from `Center-Home`'s side since it reads the feed, but the fix lives in `Center-Orders`' `cardOrderNotifications.ts`.
- **Touches:** `cardOrderNotifications.ts`, messaging copy, no schema.
- **Blocked by:** Eyad's call on which composition pattern to standardize on before any writer (this one or a future D26 one) uses it.

## D28 · Center-Setup Onboarding (§01) is a structural product divergence, not an unbuilt design
- **What:** `Merged-Center-Setup` §01 draws a center-configuration wizard (name/area → subjects/grades → payment methods → done). Live's onboarding is a value-demo wizard (add first student → create first group → simulate a scan → ROI summary) — a genuinely different flow with a different purpose, not a partial or outdated build of the drawn one.
- **Why this needs its own entry:** `CHANGE-LOG.md` already carries a narrative note calling this "not scored — different flow," but until now `BUILD-AFTER-REDESIGN.md` had nothing under a code, so a future re-verification pass could easily mistake this for "not yet gotten to" and either try to force a fraction onto it or attempt to rebuild it into the design's shape by default.
- **Blocked by:** a product-scope decision, not a display fix — is the config wizard the direction to build toward, is the value-demo flow staying as the real onboarding with the design corrected to match it, or do both need to coexist for different moments (e.g. first-run vs. re-entering setup later)?
- **Found:** narratively, 31 July 2026 (Center-Setup survey); formally logged with a code, 31 July 2026, PR #282.
- **Touches:** none yet — this is the decision point.

## D29 · `Merged-Public-Marketing` §03's add-ons section is mostly fabricated pricing — PARTIALLY CLOSED, PR #314; re-verified live 4 August 2026
- **What:** the design draws 6 add-on line items on `/pricing` (extra branch 299/mo, team seat 99/mo, a standalone "Advanced analytics" purchase at 149/mo, "Instant payout" per use, and two WhatsApp-pack tiers). Grepped `src/lib/pricing*.ts` and `docs/PRICING_SPEC.md`: only **"Parent WhatsApp pack" (12 EGP/parent/mo)** has a real, matching config value (`pricingConfig.ts`'s `whatsappParentPack: 12`). The other five have zero backing pricing config or billing logic anywhere in the codebase.
- **Built, PR #314 (`f74d71c4`, "Fix five adjudicator blockers"):** `PricingPageClient.tsx`'s Add-ons section now renders exactly one row — the parent WhatsApp pack — priced live from `platform_config.pack_price_per_parent` via `/api/pricing/public-config` → `usePublicWhatsappPackPrice()`. **Re-verified live against the catalog this pass (4 Aug 2026, project `lczmjpnbuhnsislcvzar`):** `platform_config` row `{"key":"pack_price_per_parent","value":12}` exists and matches the rendered `12`. The other five drawn rows are not rendered at all — no fabricated price ships. The component's own header comment states the same "What changes with size" rows (Branches/seats/notification quota) were also dropped for the identical reason: confirmed live, `pricing_plans` and `centers` carry no branch-limit, seat-limit or notification-quota column of any kind (full column list pulled this pass).
- **Still open — Eyad's call, not a display fix:** whether the other five add-ons (extra branch, team seat, standalone analytics, blast packs, instant payout) become real, chargeable SKUs, and at what price. "WhatsApp packs — from 200, bought when needed, don't expire" also still directly conflicts with the live billing model (`pack_price_per_parent` is a monthly per-parent subscription, not a purchasable non-expiring credit block) if it were ever built literally — same root cause as **D5** (Center-WhatsApp).
- **Found:** 31 July 2026, Public-Marketing re-verification (PR #286). **Narrowed from "mostly fabricated" to "1 of 6 real, 5 of 6 correctly withheld," PR #314, same day; re-confirmed against the live catalog 4 August 2026 (no code changed, verification only).**
- **Touches:** `src/app/[locale]/pricing/PricingPageClient.tsx`, `src/app/api/pricing/public-config/route.ts`, `src/hooks/usePublicWhatsappPackPrice.ts` — all built. The 5 remaining rows touch nothing yet.
- **Blocked by:** Eyad's call on which of the remaining 5 add-ons ship as real, chargeable products.

**Amended 5 August 2026 — the sibling half of this entry (the "What changes with size" rows) is now
BUILT, partially, and this entry's own claim about it needed narrowing.** The prior wording said the
diff rows "were also dropped for the identical reason." That was true of three of the five drawn rows
and wrong about two. Re-checked live before touching anything, project `lczmjpnbuhnsislcvzar`:

| drawn row | live source | this pass |
|---|---|---|
| Students a week (center) | `pricing_plans.weekly_student_limit` | **built** |
| Active students a month (teacher) | `platform_config.teacher_subscription_plan*.student_limit` | **built** (relabelled from the design's "a week" — the live cap is a monthly active-student count, the same correction `capLabelTeacher` already carried) |
| Advanced analytics (teacher) | `TeacherPlanDef.proFeatures`, enforced by `isProOrAbove()` in 14 files | **built** |
| Branches (center) | none | withheld |
| Team seats (center) | none | withheld |
| WhatsApp notifications a month | none that is honoured | withheld |

- **The two withheld center rows, verified live 5 Aug 2026 rather than inherited:** `pricing_plans`
  has exactly nine columns (`id, plan_key, arabic_name, english_name, weekly_student_limit,
  cost_per_student, setup_fee, is_active, all_in_price`), and a schema-wide
  `information_schema.columns` search for `%seat%`, `%max_branch%`, `%branch_limit%`,
  `%max_teacher%`, `%max_staff%`, `%notification_quota%`, `%message_limit%` and `%wa_limit%` returns
  **zero rows** across all of `public`. **D8** independently confirms the seat side from the other
  direction (`centers.max_teachers` does not exist; every center is invisibly capped at 2).
- **The withheld WhatsApp row is the interesting one, because the data DOES exist and is still not
  publishable.** `platform_config.teacher_subscription_plan_pro` and `_scale` both carry
  `blast_credits_monthly: 100` (read live this pass), mirrored onto
  `TeacherPlanDef.blastCreditsMonthly`. But `grep -rn "blastCreditsMonthly\|blast_credits_monthly"
  src/` returns **four hits, all four inside `src/lib/teacherPlans.ts`'s own definition** — zero
  readers, zero meters, zero enforcement. Printing "100 WhatsApp notifications a month" would
  advertise an allowance nothing grants: the same class of claim as **D34**, not a display gap. This
  is the one row where "the column exists" and "the section can honestly ship" come apart.
- **One word changed from the design, deliberately:** the design's negative label for Advanced
  analytics is `no: 'Add-on'` / `'إضافة'`, which asserts it is purchasable. It is not — **D13** is
  closed "no purchase flow, parked until AI features ship" — so the negative reading renders as "Not
  included" / "مش داخلة". Same single-word truthfulness correction already adjudicated for **F30**.
- **Add-ons unchanged: still 1 of 6.** No new backing config appeared. Confirmed live 5 Aug:
  `platform_config` holds no `branch_addon.monthly_price_egp` (the key `D31`'s add-branch notice
  reads), no team-seat price, no standalone-analytics price and no instant-payout price; there is no
  `pricing_addons` table. Extra branch stays blocked on **D23**, team seat on **D8**, standalone
  analytics on **D13**, "WhatsApp packs from 200" on **D5**, instant payout on **V4**.

## D30 · A marketing claim the design's own header calls "banned by your own rules" is still live — CLOSED, PR #314; re-verified live 4 August 2026
- **What:** `ComparisonTable`'s row8 (the default 8-row set rendered on `/center`) showed an unsourced "8–12 hours saved" admin-time claim. `Merged-Public-Marketing.html`'s own header copy for this section explicitly states this class of claim was removed as "banned by your own rules."
- **Closed:** PR #314 deleted the old `ComparisonTable`/`LandingFAQ` components wholesale (`src/components/landing/ComparisonTable.tsx`, -217 lines) and replaced them with `landing.compare` (6 rows, `CentersClient.tsx`) and `teacherLanding.compare` (6 rows, `TeachersClient.tsx`), neither of which carries a time-savings row of any kind. **Re-verified live this pass, 4 August 2026:** read both compare objects in full from `messages/en.json` — 6 rows each (attendance, telling the parent, sending a way to pay, concurrent staff, backup, receipts) — and grepped `messages/en.json`/`ar.json` and every file under `src/app/[locale]/{page,SplashClient,centers,teachers,pricing,talk-to-us}*` and `src/components/marketing/` for "hour"/"ساعة" in a savings context: the only surviving "hours saved" string anywhere in the repo is `onboarding/page.tsx`'s `roiHoursSaved` — a different screen entirely (Center-Setup's Onboarding, `D28` territory, not a Public-Marketing file).
- **Found:** 31 July 2026, Public-Marketing re-verification (PR #286). **Closed, PR #314, same day.**
- **Touches:** `messages/en.json`/`messages/ar.json`'s old `landing.compare.row8` key (deleted), `src/components/landing/ComparisonTable.tsx` (deleted).

## D31 · `Merged-Center-Groups` §04 Branches — the live screen is a different layout paradigm, not a design with missing chips
- **What:** the existing record (row 11, `D23`/`F11`) described §04 as carrying a pricing decision (`D23`) plus two findings from the 31 July pass (a fake "Switch to this"/"Dashboard" pair, no address schema). Re-read `Merged-Center-Groups.html` §04 fresh against the live `(dashboard)/branches/page.tsx` (all 335 lines) for tonight's Center-Groups pass and found the gap is bigger and different in kind: the design draws a mobile card list (`.brow` cards, one expanded to show four action chips — Switch to this / Dashboard / Edit / More) with a Current badge, three inline mini-stats (students / EGP-month / attendance%), and an Add-branch sheet collecting name **and address**. Live is a desktop admin table (columns: name+Current badge / students / monthly revenue / outstanding / staff count — two of which, outstanding and staff count, have no design equivalent at all) plus two bar charts with no design equivalent. There is no kebab, menu, or row action of any kind anywhere in the file — confirmed by grep, the only `onClick` in the whole component is the "Add branch" button. Edit and "More" were never previously logged as missing; they simply don't exist, the same as the already-known Switch-to-this/Dashboard pair. The Add-branch form collects only a name — no address field exists in the form, the API payload, or the `centers` table.
- **Why this needs a decision, not a mechanical fix:** table vs. card list is a real layout choice for a data-dense, owner-facing multi-branch view, not an oversight — it's plausible the live table is the better fit for this audience and the design's mobile-card treatment was never meant to be applied verbatim here, the same kind of divergence as Center-Setup's Onboarding (`D28`) or Public-Marketing's landing-page rearchitecture (§01). Rebuilding it as a card list with an Edit action would also force the address-field question (add it to the `centers` schema, or leave Edit as name-only) before any code is written.
- **Found:** 1 August 2026, Center-Groups full re-survey.
- **Touches:** layout paradigm, no schema change required to just rename this finding correctly; a schema change (new `centers` address column) would be required to actually build the design's Edit/Add-branch address fields.
- **Blocked by:** Eyad's call on whether Branches should move toward the design's card+actions layout at all, and if so, whether address becomes a real field. Not built this pass — `D23`'s pricing question is unchanged and still separately blocking regardless of this layout question.

**CLOSED, 4 August 2026 (PR #313, merged to master before this session started).** Independently
re-read `branches/page.tsx` fresh for this session's Center-Groups re-verification, before trusting
this entry — it now uses the shared `ExpandableRow` (title, three-stat meta row, `Current` badge,
inline Switch-to-this/Dashboard/Edit chips, a `More` sheet), exactly the card+action-chips paradigm
this entry said was entirely missing. The address field is answered too, not ignored: it maps to
the live `centers.district` column (confirmed in `information_schema.columns`, 3 Aug per the PR,
re-confirmed 4 Aug) rather than inventing a `centers.address` the schema does not have — labelled
"Area / address" in the UI, which is an honest field-mapping choice, not a silent renaming. `D23`'s
pricing decision is correctly still open and untouched by this: the add-branch sheet now shows an
add-on notice only when `platform_config['branch_addon.monthly_price_egp']` is set (absent live, so
nothing renders today), which stops the screen from asserting a 199 EGP charge the billing engine
does not make, but does not decide what that charge should be. Closing this line item; kept here
rather than deleted so nobody re-opens a layout question that already shipped.

## D32 · Waitlist promotion has no working path end to end — the WhatsApp opt-in fires into a void, and there was never a manual alternative
- **What:** `Merged-Center-Groups` §01's Waitlist tab draws a per-row "Add" button that promotes a waitlisted student straight into full membership. Reading `groups/page.tsx`'s actual waitlist tab fresh, live never offered that action — only a read-only waitlist list plus a separate "add someone new to the waitlist" picker. Looking for how promotion happens today led to `notify-waitlist/route.ts`: when a seat opens (a member is removed under capacity), it WhatsApp-messages the first waitlisted parent asking them to reply "yes" or "no", and logs a `waitlist_notifications` row with `response: 'pending'`. Grepped every reference to `waitlist_notifications` in `src/` (one file, insert-only) and the WhatsApp inbound webhook (`api/whatsapp/inbound/route.ts`, a keyword-matched FAQ auto-responder with no waitlist branch at all) — **nothing anywhere ever reads that reply or completes the promotion.** A parent who replies "yes" gets nothing back; the row sits at `pending` forever; the student is never enrolled by this flow, regardless of how the parent answers.
- **A second, compounding bug this pass fixes:** even bypassing the broken WhatsApp loop and adding a waitlisted student as a full member through the ordinary Add-member flow left their waitlist entry in place forever — nothing in the codebase ever cleared `students.waitlist_group_id`/`waitlist_position`. Fixed this pass (safe, no decision needed): `handleAddMember` now clears both fields via a new `DELETE /api/groups/[groupId]/waitlist` route when the student being added was on that group's own waitlist, and the waitlist POST route's position assignment was changed from a `COUNT`-based formula (which would start colliding once removals became possible) to `MAX(position)+1`.
- **What's still open, and needs Eyad's call, not a build:** whether promotion should be automatic on a parent's WhatsApp "yes" (matching the apparent intent of the existing notify flow — requires parsing the reply, a race-safety check that the seat is still open, and a decision on what "no" does), a manual center-side action (matching the design's simple "Add" button, decoupled from the WhatsApp message entirely), or both. Building either without deciding which risks the same kind of rework as the EmptyState duplicate earlier tonight.
- **Found:** 1 August 2026, Center-Groups full re-survey.
- **Touches:** `WhatsApp` (an existing, currently-dead-end automated message parents already receive in production), `students.waitlist_group_id`/`waitlist_position` (no schema change, existing columns).
- **Blocked by:** Eyad's call on which promotion model is correct. No `waitlist_requested_at`/similar timestamp column exists either (checked live: `students`'s only waitlist columns are `waitlist_group_id` uuid and `waitlist_position` integer) — the design's "Requested 09/07" per-row date has no backing field and would need a migration; flagged, not added, since backfilling a real join-date for existing rows isn't possible (no historical data to backfill from).

## F30 · `/teachers`' comparison table carried the same fabricated "card or wallet" payment claim that `/centers`' twin table was already adjudicated and fixed for — CLOSED this pass
- **What:** `messages/*.json`'s `landing.compare.row3.centerhq` ("A link with every invoice, card or wallet" / "بطاقة أو محفظة") was the exact wording PR #314's post-adjudication fix (`190f8216`, "drop the wallet-payment claim the branch introduced") already replaced on the **center** audience page, because no wallet payment path exists — payment links are single-integration Paymob card only (`PAYMOB_INTEGRATION_ID` is one global env var, not per-tenant; `src/lib/paymob.ts` has no wallet branch). That fix was applied to `landing.compare` (`/centers`) but never mirrored to `teacherLanding.compare` (`/teachers`) — same row, same claim, same underlying fact, left uncorrected on the sibling page.
- **Verified live, 4 August 2026:** `messages/en.json` line 9579 / `messages/ar.json` line 9579, `teacherLanding.compare.row3.centerhq`, carried the identical uncorrected string. Teacher invoices go through the same single Paymob integration as center invoices (`src/app/api/teacher/paymob/invoice-status/route.ts`, `src/lib/midnightBillingAdapter.ts`) — no wallet path for teachers either.
- **Fixed this pass, no decision needed** (same mechanical correction already adjudicated for the center page): EN → "A link with every invoice, paid by card"; AR → "رابط مع كل فاتورة، تُدفع بالبطاقة". i18n parity holds (key unchanged, value only).
- **Found:** 4 August 2026, Public-Marketing re-survey (this pass).
- **Touches:** `messages/en.json`, `messages/ar.json` (`teacherLanding.compare.row3.centerhq`). No schema, no protected file.

## D34 · `/pricing`'s "same either way" list claims "Withdrawals to your own account" as a feature every tier includes — no live withdrawal mechanism exists for anyone
- **What:** `PricingPageClient.tsx`'s `pricingPage.same.items[6]` renders "Withdrawals to your own account" (design line 1613, `Merged-Public-Marketing.html` §03) as one of eight bullets under "There is no cheaper version of the software" — presented as a universal, already-working capability at every price tier, for both centers and teachers.
- **Verified live, 4 August 2026 (project `lczmjpnbuhnsislcvzar`):** this is the exact capability the existing ledger entry **V4** ("Provider balance, clearing and withdrawal") already documents as **entirely dormant** — `transactions.settlement_status`/`expected_settlement_at`/`settled_at`/`settlement_retry_count` and `teacher_profiles.payout_destination` are schema scaffolding with zero live rows and zero readers/writers in `src/`. Re-confirmed this pass: `grep -rn "payout_destination\|settlement_status" src/ --include=*.ts --include=*.tsx` returns nothing outside migrations; `grep -rln "withdraw" src/app/api/teacher/` returns only group-proposal "withdraw request" routes (an unrelated feature, withdrawing a *proposal*, not money). All Paymob collection — center and teacher alike — runs through one global `PAYMOB_INTEGRATION_ID` (not per-tenant), so a card payment settles into a single platform-held Paymob balance; there is no code path, live or dormant-but-partial, that moves money from that balance into any center's or teacher's own bank account.
- **Why this is a decision, not a mechanical fix (unlike F30's wallet-claim wording, which had one obvious accurate substitute):** there is no narrower true replacement claim to substitute — the capability the bullet describes does not exist for anyone today, in any form, so correcting the wording (rather than deciding whether/how to phrase what money-movement *does* happen, e.g. the live flat-cut teacher-payout arrangement in `D16`/`F9`, or leaving a placeholder pending V4) is itself the product call. It also sits squarely on **V4**'s territory — money movement for verified/unverified accounts is explicitly reserved for the protected `Center-Money`/`Teacher-Money`/`Verification-Payouts` files, not this one.
- **Found:** 4 August 2026, Public-Marketing re-survey (this pass).
- **Touches:** `messages/en.json`/`messages/ar.json`'s `pricingPage.same.items[6]`. No schema. Overlaps the already-protected `Center-Money`/`Teacher-Money`/`Verification-Payouts` files and the already-logged **V4**.
- **Blocked by:** V1, V3 (same blockers as V4) plus Eyad's call on what, if anything, truthfully replaces the claim in the meantime.

**Amended 5 August 2026 — one supporting detail in this entry was wrong, and the claim reaches two
more surfaces than it recorded. The conclusion survives both corrections; the reasoning does not.**

- **Correction 1 — "zero readers/writers in `src/`" is false.** Re-ran the grep this entry cites
  rather than trusting it: `payout_destination` has **10 hits across four files** in
  `src/lib/collectionPayout/` (`enableCollection.ts` reads it from `teacher_profiles` at
  `enableCollection.ts:152`; `requestPayout.ts` and `verificationGate.ts` carry it as a named refusal
  cause). There is a whole built payout engine — `src/lib/collectionPayout/` (10 modules:
  `payoutEngine`, `payoutStates`, `payoutCaps`, `payoutAging`, `collectionMath`, `money`, …), plus
  `POST /api/payouts/request`, `/api/admin/payouts`, `/api/admin/center-payouts/[id]/approve` and
  `/release`, `/api/webhooks/payout-provider` and a `payout-reconciliation` cron. The right
  description is **built but switched off at one config point**, not **nonexistent**.
- **Why the marketing claim is still untrue today, on evidence rather than on the old wording:** the
  engine refuses at gate 1 before verification is even consulted.
  `src/lib/collectionPayout/config.ts` — which its own header declares "THE ONE CONFIG POINT" and
  which is the only module allowed to read these values — resolves six
  `COLLECTION_PAYOUT_RAIL_*` credentials that ship as placeholders because Paymob Payouts onboarding
  has not started, and the platform switch `digital_student_fee_collection.enabled`, **read live this
  pass and holding `false`**. Gate 2 is verification (V1, dormant); gate 3 is a payout destination
  (`teacher_profiles.payout_destination`, 0 rows populated). So no center and no teacher can withdraw
  today, and the bullet still may not ship — but for a reason that is checkable, and that changes the
  moment the credentials land rather than requiring a build.
- **Correction 2 — the same claim is live on two further surfaces this entry never named**, both
  outside `/pricing`:
  - `landing.centerOnly.rows[3]` on **`/centers`** — "Teacher payouts · *Split to each teacher's own
    account, or land in yours. Your call.*" This is a stronger claim than `/pricing`'s: it describes
    a specific split-destination mechanism. That mechanism is **X1** (Center → teacher split payouts,
    deferred), sitting on top of the same dormant rail, and on top of **D16**'s dormant center-class
    commission engine — so even the *amount* to split is not computed today.
  - `splash.pair.center.pills[2]` on **`/`** — a bare "Teacher payouts" pill. Weakest of the three
    (it names a feature area rather than asserting a mechanism), but the same root.
- **Not rewritten this pass, and the reason is the same one this entry already gives:** there is no
  narrower true replacement to substitute, the wording that replaces it *is* the product call, and
  all three surfaces describe money movement reserved to the protected `Center-Money` /
  `Teacher-Money` / `Verification-Payouts` files. Three strings, one decision.
- **Touches, amended:** `pricingPage.same.items[6]`, `landing.centerOnly.rows[3]`,
  `splash.pair.center.pills[2]` in both `messages/en.json` and `messages/ar.json`.
## D33 · Analytics month-end forecast tile and projection bar have no decided extrapolation method
- **What:** `Merged-Center-Insight` §01's EN-overview frame draws a `ktile.fc` "Projected · month-end" KPI (21,500 EGP, badged "forecast") and a dashed sixth bar on the revenue chart ("Jul*", "* projected from current pace") alongside the five actual months. Both are a month-end estimate derived from partial-month data, not a stored or historical figure.
- **Found:** 4 August 2026, `Center-Insight` parity pass. Read `/api/analytics/revenue/route.ts` in full (all fields it returns: `mrr`, `outstanding_total`, `collection_rate`, `avg_payment_per_student`, `revenue_by_group`, `mrr_trend`, `payment_method_distribution`, `attendance_heatmap`, `aging_report`, `income_by_month`, `expenses_by_month`, `pnl_months`) and grepped the whole `analytics` route tree plus `(dashboard)/analytics/page.tsx` and every chart component it imports for `forecast`/`project` — zero matches anywhere. This is not a partially-built feature; no code path computes a projection today.
- **Why it's a decision, not a display fix:** a month-end projection needs a chosen method before it can be built at all — naive linear scale-up from day-of-month elapsed (`mrr_trend`'s current-month figure ÷ days elapsed × days in month), a trailing-average pace, or something that accounts for known non-linearity in the business (e.g. tuition due-dates clustering early in the month, so linear scaling overstates months that front-load collection). Each produces a materially different number for the same underlying data, and whichever ships becomes a number owners act on. Building one silently forecloses the others.
- **Touches:** money (a projected, not actual, figure — the kind of thing this codebase has previously been burned by inferring, e.g. the "Paid" clock-comparison state and the invented-date findings called out in this pass's brief).
- **Blocked by:** Eyad's call on the extrapolation method. Not attempted this pass — the KPI grid and revenue chart ship without the forecast tile/dashed bar, same as before, rather than picking a method unilaterally.
- **Re-verified 5 August 2026, `Center-Insight` BUILD pass, before deciding to leave it alone again.** Re-read `/api/analytics/revenue/route.ts` end to end and re-grepped the analytics route tree and `(dashboard)/analytics/page.tsx` for `forecast`/`project*` — still zero matches, no code path computes a projection. The rest of §01's chart was rebuilt this pass (area chart → the design's monthly bars with the current month emphasised) and the projection bar was **deliberately left out of that rebuild**: the bar is trivial to draw and the number behind it is not, so drawing it would have shipped a method by accident. The chart is now one bar short of the design, on purpose, and stays that way until this is decided.
**Re-verified 4 August 2026, independently, before trusting this entry's own wording.** The phrase
"there was never a manual alternative" in this entry's own title reads as stronger than what the
body actually says — re-reading `groups/page.tsx` fresh (PR #313 is already on master), the design's
simple per-row "Add" button is live today: `handleAddMember`, wired to the waitlist row's `Add`
control, inserts the student into `student_group_members` and then clears
`waitlist_group_id`/`waitlist_position` via `DELETE /api/groups/[groupId]/waitlist` (the stale-entry
fix this entry already describes). That is a complete, working, manual promotion path matching the
design's button — not a gap. What is still unbuilt, and still Eyad's call exactly as this entry
already says, is only the automatic half: nothing reads a parent's WhatsApp "yes" reply to the
`notify-waitlist` message, so that path remains a dead end. Not re-closing this entry (the
automatic-path decision is real and unmade) but correcting the framing so a future reader does not
re-build the manual button that already exists.

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
- **Re-confirmed live, 1 August 2026 (Center-Home balance-card re-check, before deciding not to build it).**
  `transactions` has exactly 3 rows total; `settled_at` is null on all 3 (0 populated, unchanged from
  29 July). One more precision this pass adds: `settlement_status` is in fact non-null on all 3 —
  every one reads the literal value `'not_applicable'`, not a pending/in-progress state. Doesn't change
  the "entirely dormant" conclusion, just confirms it more exactly than "0 populated rows" alone did.

## V5 · CEO centers benchmark, verified vs unverified
- **What:** An internal comparison of verified against unverified centers.
- **Drawn in:** `Merged-CEO` §03.
- **Touches:** money (read only).
- **Blocked by:** V1 — technically buildable today, but **every row reads 0 / 100% until verification ships**, which is worse than not having it.
- **Re-confirmed, 31 July 2026 (CEO survey).** Fresh `grep -i verified` across `/ceo`, `/ceo/teachers`, and both translation namespaces: zero matches, independently reproducing this entry's own claim rather than trusting it. Still holds exactly as written.
- **Re-confirmed against the live catalog, 5 August 2026 (CEO build pass, `claude/parity-ceo-w17`).** Previous re-confirmations were greps over the repo; this one queried the database. `select table_name, column_name from information_schema.columns where table_schema='public' and (column_name ilike '%verif%' or ilike '%national_id%' or ilike '%kyc%' or ilike '%valify%')` on project `lczmjpnbuhnsislcvzar` returns **six rows, none of them a verification state**: `backup_log.last_verified_at`, `enrollment_otps.verified_at`, `phone_verifications.verified_at`, `students.parent_phone_verified`, `students.phone_verified`, `teacher_signup_otps.verified_at`. All six are phone/OTP or backup bookkeeping on unrelated tables.
  **The exact missing columns, named:** `centers.verification_status` (and any `centers.verified_at`) for §03's benchmark split; `teacher_profiles.verification_status` / `teacher_profiles.national_id` for §02's "Verified" KPI and its unverified-count banner. Neither table has any such column — `centers` has 128 columns and `teacher_profiles` has 24, and none of them carry verification state.
  §03 stays at **0/2 states built**. Both §02 tiles stay omitted. Nothing was rendered as 0, greyed or "coming soon".

## V6 · `Center-Setup` §08 Team Verified · `Center-Home` §01 verified dashboard · `Center-Attendance` §01–§02 · `Center-Students` §03
- Verified state end to end. `Center-Attendance` is blocked **wholesale** — worth knowing before it comes up in the restyle order.
- **Blocked by:** V1.
- **Re-confirmed, 31 July 2026 (Center-Attendance survey), independently on both sides.** Design side: both of `Merged-Center-Attendance.html`'s sections draw the **"Verified"** badge unconditionally in every single frame (5 of 5 in §01, plain "Active · verified" subtitle text in §02) — there is no unverified/locked/pending frame anywhere in the file for either section; a grep for "unverified"/"pending verification" across the whole mock returns zero hits. Live side: re-derived Valify's status from scratch (repo grep, live-schema check, live-catalog table-name search) without re-reading this entry first — same conclusion, nothing new: no `national_id`/`verification_status`/`kyc` column anywhere, no Valify SDK or route, `/attendance`'s own code has zero verification-aware branches (it renders identically for every center, gated only on subscription/billing status, a different axis entirely). Still blocked, still wholesale, still V1.
- **Added, 31 July 2026 (Center-Students survey, PR #277).** `Merged-Center-Students` §03 (Center Students Verified) draws the identical unconditional "Verified"/"موثّق" badge in every one of its frames (roster header, both detail frames, recipient sheet) with zero unverified-state frames anywhere — the same diagnostic test as the other three files above, and it hadn't been named here yet even though it was already logged as blocked in `FILE-COMPLETION-TABLE.md`/`CHANGE-LOG.md`. Same root cause, same V1 dependency, folded in rather than left as an undocumented fourth instance.
- **Re-confirmed, 4 August 2026 (Center-Students parity pass).** Fresh grep for `Verified`/`موثّق`/`verification_status`/`national_id` across `src/app/[locale]/students/**` returns zero matches — §03 remains entirely unbuilt (not a false "Verified" badge shipped, simply the verified-state screens don't exist yet), which is the correct, honest outcome given V1. Nothing to fix; noted so a future pass doesn't re-discover this from scratch.

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
- **Re-measured, 5 August 2026 (Public-Legal second parity pass).** "Only the text is missing" is
  still right, but it was being read as *all* the text, which stopped being true when **#311**
  (`81639a14`) landed. The accurate size is **10 of 23 sections**, not 23:

  | Document | Contents entries | Drafted | Pending |
  |---|---|---|---|
  | Privacy Policy | 6 | 1, 3, 5 | **2** How we use it · **4** How long we keep it · **6** Contact our DPO |
  | Terms and Conditions | 6 | 1, 2, 3, 4 | **5** Acceptable use · **6** Liability |
  | Cookie Policy | 5 | 2, 3, 4 | **1** What cookies are · **5** How to control them |
  | Data Processing Agreement | 6 | 1, 3, 5 | **2** What we process · **4** Sub-processors · **6** Deletion |

  The 13 drafted sections are live in both languages. The 10 pending ones keep their contents
  entry and their `#sN` anchor and render one explicit "Pending Adsero draft." line — deliberately,
  so a reader who clicks "4 · How long we keep it" lands somewhere instead of on a dead anchor.
  This is a **known deviation from the design**, which simply omits the undrafted sections from the
  reader body while still listing them in the contents; the design can afford a dead anchor because
  its contents entries are not links. Do not "restore parity" by deleting the pending sections.

  **Why the remaining 10 stay unbuilt, stated once so it is not re-litigated:** these are PDPL
  (Law 151/2020) commitments — retention periods, the sub-processor list, the DPO contact point,
  the erasure procedure. Unlike a wrong figure, a wrong sentence here is *binding on the company*.
  Drafting them from the surrounding text would be fabrication in the most expensive place it
  could happen. They become real copy with an edit to `legalContent.ts` and nothing else.

  **Now guarded.** `tests/unit/legalCorpusParity.test.ts` derives the contents lists and the
  drafted/pending split from `design/Merged-Public-Legal.html` at test time and asserts
  `legalContent.ts` matches, in both languages and in order. It fails in both directions: on
  invented copy appearing under a pending heading, and on a pending section being deleted to make
  the file look finished. When Adsero's text lands, update the design file and `legalContent.ts`
  together and it goes green — that is the intended workflow, not a test to edit around.

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

## S6 · No CSRF on any WhatsApp-Pack mutation
- **What:** all five mutation routes behind `/whatsapp-pack` — `POST /api/parent-pack/announcement`, `POST /api/parent-pack/request`, `PATCH /api/settings/parent-pack`, `PATCH /api/parent-pack/student/[id]`, `PATCH /api/parent-pack/toggle` — authenticate via `requireOwnerAdminCenter`/`requireCenterAuth` (bearer session + role + tenant gate) but none of them call `validateCSRFRequest`. Confirmed by grep across all five route files plus both auth helpers themselves (`requireOwnerAdminCenter.ts`, `centerAuth.ts` — neither calls it on the routes' behalf).
- **Why it matters now:** found during the Center-WhatsApp survey (31 July 2026), not the redesign work itself. `/api/parent-pack/announcement` debits `centers.announcement_balance` and can issue a real `invoices` row — a same-origin form or fetch from a malicious page, riding an owner/admin's existing session cookie, could trigger it. `src/lib/csrf.ts`'s own doc comment claims this exact protection is already applied "the same...rule the Paymob/WhatsApp/Bosta webhooks already apply" — that claim does not hold for these five routes.
- **Touches:** auth, and money (the announcement route moves balance and can create invoices).
- **Fix shape:** the same `if (!validateCSRFRequest(...)) return 403` pattern already used by every other mutation-bearing domain route — mechanical, no schema change, no behavior change for a legitimate same-origin caller carrying the token. Not done in this pass — flagged per the standing stop condition on anything touching money or auth, and because it is a 5-file change under active review discipline, not a single-file design-fidelity fix.
- **Blocked by:** nothing technical. Waiting on Eyad's go-ahead to land it as its own PR, separate from the design-restructure chain.

## S7 · No CSRF on the referral payout route
> ### ✅ CLOSED — PR #308, merged as `d728da75`, 3 August 2026
> No migration involved; this one is code-only and is live on master.
>
> Verified by reading the route on master on 4 August 2026, not from the PR description
> (rule 2 — an AI-written PR body is not evidence). `src/app/api/referrals/payout/route.ts`
> imports `validateCSRFRequest` from `@/lib/csrf` and calls it immediately after
> `requireCenterAuth`, ahead of the permission gate and ahead of any body parsing:
>
> ```ts
> if (!validateCSRFRequest(request, auth.userId)) {
>   return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
> }
> ```
>
> The client half is there too, so this is not a route that now 403s its own caller:
> `src/components/referrals/ReferralWithdrawalPanel.tsx` attaches
> `await getCsrfHeaders(session.access_token)` to the POST. End-to-end.
>
> **S6 is NOT closed with it, and do not read this as a general CSRF sweep.** Re-checked the
> same day: none of the five WhatsApp-Pack mutation routes (`parent-pack/announcement`,
> `parent-pack/request`, `settings/parent-pack`, `parent-pack/student/[id]`,
> `parent-pack/toggle`) calls `validateCSRFRequest`. **S6 stays open.** S9's four routes
> (`ceo/leads`, `ceo/actions/[id]`, `ceo/platform-config`, `admin/centers/[id]`) also still
> have none — **S9 stays open**. **S8 is now partial, not open-as-written:** the same PR added
> `validateCSRFRequest` to `/api/billing/withdrawal` (and to `/api/admin/withdrawals/[id]`),
> which S8 names, so whoever picks S8 up must re-enumerate its route list against master
> rather than trusting the original entry. Not re-scoped here.
>
> The entry below is kept as written — it is the record of how the gap was found and why the
> D22 interaction mattered, and that reasoning stays true after the fix. Only its **Blocked by**
> line is struck through, since leaving that one reading "waiting on Eyad" is the thing that
> would send someone to do work that is already done.
>
> **D22 is untouched by this.** The payout route still reads its balance from
> `referral_reward_records`. Closing S7 closed the CSRF gap, not the wrong-table one.

> ### ✅ CLOSED — fixed on `master`, PR #308 ("Fix three PAYOUT-SYSTEM-SPEC §2 defects that need no migration"), confirmed live 4 August 2026.
> `src/app/api/referrals/payout/route.ts` now calls `validateCSRFRequest(request, auth.userId)` immediately after `requireCenterAuth`, with an inline comment naming this exact entry ("PAYOUT-SYSTEM-SPEC.md §2.6 / S7: this route creates a money-movement request and had no CSRF check at all."). Read the full route fresh during the `Center-Insight` parity pass, without re-reading this entry first — the check is real, correctly placed before the permission gate and the body parse, and returns 403 on failure. Re-confirmed against `git log origin/master` per the standing PR-state rule: PR #308 is merged, not just branch-present. Nothing left to build here.
- **What:** `POST /api/referrals/payout` (`ReferralWithdrawalPanel.tsx`, `Merged-Center-Insight` §03) has no `validateCSRFRequest` call — confirmed by direct read of the full route plus a repo-wide grep. Gating today is `requireCenterAuth` (bearer token) + `requirePermission(auth, 'can_request_referral_payouts')` + `src/proxy.ts`'s CORS-origin check — none of which is CSRF-token validation.
- **Why it matters, with the caveat that matters more:** this creates a real `payout_requests` row against a center's referral commission balance — the same class of gap as **S6**. The blast radius today is small because of **D22** below: the balance it checks is always read from `referral_reward_records`, a table with zero live writers, so `available` is always 0 in production and the route 400s before anything is created. If D22 is ever resolved by repointing reads at `referral_commissions` (the table the real cron writes), this route inherits real money exposure the moment that happens — so the CSRF fix and D22 are worth landing together, not treating this one as low-priority because of the other.
- **Contrast case, found the same pass:** `POST /api/whatsapp/send-balance-reminder` (used one screen over, on Analytics' Aging report) does call `validateCSRFRequest` correctly, and its client caller (`AgingReport.tsx`) correctly attaches `X-CSRF-Token`/`X-Session-ID` via `getCsrfHeaders()`. Whatever pattern protects that route was not extended to this one.
- **Touches:** auth, and money.
- **Blocked by:** ~~nothing technical. Waiting on Eyad's go-ahead, same as S6.~~ **Nothing — closed by PR #308, see the header above.** S6 is the one still waiting.

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

**Partially built, 31 July 2026 — see the Center-Groups rebuild PR.** `handleDeleteGroup` now has a
kebab entry point with an inline confirm; the room "More" button now opens a real edit/delete menu
(delete warns about the `ON DELETE CASCADE` onto `schedule_slots`/`bookings`, since that was checked
live and confirmed, not assumed). `teacher_name` and `center_cut_egp` are both rendered now — the
latter as the absolute EGP figure it's actually stored as (`groups.detail`'s stat grid), not converted
to a percentage of `fee_per_class` as this entry originally speculated the design wants; that
conversion is a display-formatting choice, not a data gap, and was left alone rather than guessed at.
`capacity_cap` and `kind` remain unbuilt — re-confirmed still zero references in `src/` outside this
doc and `db/schema.snapshot`, same "drop or document" decision as before, not resolved here.

**Re-confirmed live a third time, 4 August 2026.** `select column_name, data_type from
information_schema.columns where table_name='student_groups' and column_name in
('capacity_cap','kind')` on project `lczmjpnbuhnsislcvzar` still returns both (`integer`, `text`) —
they were not dropped and nothing started writing or reading either since 31 July. Grepped `src/`
again for both names: still zero hits outside this document. Unchanged, still Eyad's drop-or-document
call, not touched.

## F31 · `branches`/`groups`/`rooms` i18n — eight live Arabic strings were English leftovers or
grammatically backwards translations, fixed (no decision needed)
- **What:** re-reading every EN/AR pair actually resolved by `useTranslations('groups')`,
  `useTranslations('rooms')` and `useTranslations('branches')` (the three real top-level namespaces
  `groups/page.tsx`, `rooms/page.tsx` and `branches/page.tsx` read from — there are decoy copies of
  several of these same key names sitting unread in `common` and `heatmap`, confirmed by checking
  which `useTranslations()` call each screen actually uses before touching anything) turned up eight
  live, user-facing bugs, not display gaps:
  - `groups.pleaseWait` — Arabic value was the literal English string `"Please Wait"`, verbatim.
  - `groups.validFeeRequired` — half-translated: `"Valid رسوم مطلوب"` (the English word "Valid"
    left in place ahead of the Arabic).
  - `groups.groupNameRequired` — `"مجموعة الاسم مطلوب"`, word-for-word substitution in the wrong
    Arabic word order (reads "Group the-name required" instead of "اسم المجموعة مطلوب", "the
    group's name is required").
  - `groups.subjectRequired` — `"مادة مطلوب"`, missing the feminine agreement Arabic grammar
    requires (`مطلوب` → `مطلوبة` since `مادة` is feminine).
  - `groups.noWaitlist` — `"لا قائمة الانتظار"`, a sentence fragment with no verb (reads "no the
    waiting-list" rather than "لا توجد قائمة انتظار", "there is no waiting list").
  - `rooms.roomNameRequired` — the same backwards-word-order bug as `groupNameRequired`:
    `"قاعة الاسم مطلوب"` instead of `"اسم القاعة مطلوب"`.
  - `branches.totalMrr` — `"الإجمالي بالرنين المغناطيسي"`, which does not mean "Total MRR": `رنين
    مغناطيسي` is the Arabic medical term for magnetic resonance (as in `التصوير بالرنين
    المغناطيسي`, MRI). The string literally read "Total by Magnetic Resonance."
  - `branches.outstanding` — `"المستحق غير المسدد / المبلغ المتبقي المستحق"`, two draft phrasings
    left joined by a slash instead of one being chosen.
- **Why fixed, not logged:** pure translation-text corrections, no schema, no product decision, no
  behaviour change — exactly the class of fix the standing rule on Arabic quality asks for.
- **Live-vs-dead, checked before fixing, not assumed:** `groups.pleaseWait`/`validFeeRequired`/
  `groupNameRequired`/`subjectRequired`/`noWaitlist` and `rooms.roomNameRequired` are all in active
  use today (`groups/page.tsx`'s add/edit-group validation toasts and the waitlist-empty line;
  `rooms/page.tsx`'s add/edit-room validation). `branches.totalMrr`/`outstanding` are currently
  **dead** — PR #313 (4 Aug, already on master) moved Branches from a 3-KPI table to the design's
  2-KPI layout and neither string is read by anything in `src/` today (grepped `t('totalMrr')` /
  `t('outstanding')` scoped to the `branches` namespace specifically, since both key names are
  reused with different, correct copy in unrelated namespaces like `teacherPortal.centerCuts` and
  `adminWaPack`). Fixed anyway since the wrong text still ships in the translation bundle and would
  silently resurface correct-looking but wrong if a third KPI is ever restored.
- **Found:** 4 August 2026, Center-Groups re-verification pass (this session).
- **Verified:** `npx tsx scripts/check-i18n.ts` (key parity), `npm run verify:stabilization`,
  `npm run typecheck`, `npm run lint`, `npm run test:unit` all green after the fix.
- **ID history (read this before assigning the next F-number):** this entry was first filed as a
  duplicate `F26`, renumbered to `F28`, and renumbered again to `F31` on 4 August 2026. Reason:
  several parity branches were open against `master` at once, each picking "the next free ID" by
  grepping only `master` plus its own branch — so they all picked the same ones. Checked against
  every open branch, not just `master`: **`F28` is claimed by three branches** (this one, PR #324
  Center-Setup, PR #325 Center-Orders), **`F29` by two** (PR #324, PR #325), and **`F30` by one**
  (PR #327 Public-Marketing). `F31` is the lowest ID free across `master` and all open branches as
  of 4 Aug. The `F28`/`F29` double-claims between PR #324 and PR #325 are still unresolved and are
  not this branch's to fix — whoever merges those two second must renumber. **Grep the open
  branches, not just `master`, before taking an F-number.**

## F12 · `pending_enrollments` cannot say whether a request came from an invite link or self-serve sign-up — the design shows both as distinct badges
- **What:** `Merged-Center-Students` §04's Pending screen draws two distinct origin badges ("Invite link" vs "Sign-up") on every request row, plus a "Came via" field in the request-detail view. Live, `pending_enrollments` has no column for this — confirmed both live insert call sites (`src/app/api/join/[center_code]/[group_id]/route.ts` and `src/app/api/join/pending-enrollment/route.ts`) write the identical column set (`center_id, group_id, student_id, student_name, student_phone, parent_phone, notes, status`), and the list query in `src/app/api/students/pending/route.ts` selects no origin-like field because none exists.
- **Why it's not a display fix:** the two live endpoints are already two genuinely different entry paths — the gap is that neither writes down which one a given row came through, so the fact is lost at insert time, not just unrendered. Recovering it needs a new column and a value written by both call sites.
- **Do not reach for `students.origin` as a shortcut — checked, it doesn't cover this.** The column exists (`text`, nullable) and does have real writers, live values `'walk_in'` and `'self_link'` — but every writer (`teacher/private/groups/[groupId]/roster`, `teacher/private/schedule/sessions/*`, `join/g/[groupId]/verify-otp`) belongs to the teacher-private subsystem (centre-less teacher groups), not the centre's own join flow. Neither `join/[center_code]/[group_id]/route.ts` nor `join/pending-enrollment/route.ts` (the two routes this finding is actually about) ever sets it — confirmed both leave it at its `NULL` default. A genuinely new column (or a new value vocabulary added to this one, stamped by the two routes that don't touch it today) is still what's needed.
- **Found:** 30 July 2026, building `Merged-Center-Students` §04.
- **Build:** add an origin/source column to `pending_enrollments`, stamp it at both insert sites, surface it as the badge/detail-row the design already draws.
- **Blocked by:** nothing technical; out of scope for a display-only pass (needs a migration).
- **Re-confirmed live, 4 August 2026, Center-Students parity pass.** Fresh `information_schema.columns` read against project `lczmjpnbuhnsislcvzar`: `pending_enrollments` still has exactly `id, center_id, group_id, student_name, student_phone, parent_phone, notes, status, created_at, student_id` — no origin-like column, unchanged from the original finding. Also checked the request-detail sub-screen's other two fields the design draws with no live source ("Grade", "School" in §04's expanded request-detail frame) — `students/pending/page.tsx` correctly renders neither; it only surfaces `student_name`, `student_phone`, `parent_phone`, `notes` and a relative "asked" timestamp, the fields that actually exist. No fabricated Grade/School/origin data found anywhere on this screen — the honest-state rule is being followed here, not violated.
- **Re-confirmed live again, 5 August 2026, and widened by one column.** `pending_enrollments` is still exactly `id, center_id, group_id, student_name, student_phone, parent_phone, notes, status, created_at, student_id` — ten columns, no origin. This pass also checked the design's other two request-detail fields against the **whole schema**, not just this table: a `column_name ilike '%school%'` sweep across every table in `public` returns **zero rows**, so "School" has no source anywhere in the database, not merely no source on this table; and `grade_level` exists on `students`, `group_proposals` and `teacher_profiles` but **not** on `pending_enrollments`, so a request's grade is unavailable until the row becomes a student. `/students/pending` was rebuilt onto `ExpandableRow`/`ActionSheet` this pass and the origin badge slot the design draws on every row was deliberately left empty — the omission is now carried as a comment on the list itself, next to the code that would render it, rather than only in this ledger.

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
- **Sharpened, not closed, 4 August 2026, Center-Students parity pass.** This entry was framed as "the copy vs. the validation disagree — establish which is wrong," on the theory that one side might be a plain bug rather than a real decision. Checked both sides directly rather than guessing:
  - The design's own Review-step worked example (§04, the "NEEDS A FIX" list) draws **two** flagged rows, not one: "Row 12 · Missing parent phone" *and* "Row 27 · Grade not recognised." The prose hint above it and this worked example agree with each other — the design is internally consistent that missing parent phone is meant to be caught and flagged exactly like a missing name, not just mentioned in passing copy.
  - Live's own copy was checked too, specifically for the self-contradiction this framing implied might exist (the app claiming a requirement it doesn't enforce): `parentPhoneHint` (`messages/en.json`/`ar.json`, rendered at `import/page.tsx:490`) is a soft encouragement ("Add it now and every reminder, receipt and absence alert has somewhere to go"), not a "required" claim. There is no live copy anywhere on this screen asserting parent phone is required while the validation lets it slide — no in-code self-contradiction to fix as a bug.
  - **Conclusion: neither side is "simply wrong."** This is design-vs-live, not live-vs-live, and the live behaviour (accept rows with no parent phone) is a real, working, unremarked-on path for centers importing attendance-only rosters today. Flipping it to match the design would change what those centers can import — the original entry's product-decision framing holds up under scrutiny; it is not a bug hiding behind confusing docs. Left as Eyad's call, now with the stronger evidence that the design's copy and its own worked example both point the same way, so whichever way he decides, at least the design side isn't internally conflicted.
- **Not touched:** `students/import/page.tsx` — still fully optional parent phone, no `reasonMissingParentPhone` skip added.

## F15 · Two independent status axes (lifecycle vs payment standing) exist per student and are never shown together as one badge
- **What:** a student carries two separately-computed status concepts: a lifecycle/attendance status (`active`/`at_risk`/`inactive`/`enrolled`/`churned`, driven by scan recency — the roster's `LifecycleBadge`) and a payment standing (paid/unpaid, now `getStudentBalances`-driven after this pass's fixes). Neither `Merged-Center-Students` nor live code fuses them into one badge — the roster shows a `LifecycleBadge` and a balance figure as two separate elements.
- **Why it's logged, not built:** no screen this pass asked for a fused badge, and inventing a combined taxonomy (does "at-risk AND unpaid" render as one badge or two?) is a design decision, not a bug fix.
- **Found:** 30 July 2026, building `Merged-Center-Students` §01/§02.
- **For whoever designs this next:** both axes are already independently correct and already available (`lifecycle_status` column, `getStudentBalances`) — this is purely a "how do we show both at once" question, no new data needed.
- **Re-confirmed unchanged, 4 August 2026 (Center-Students parity pass).** Still two separate elements on the roster row (`StandingBadge` + a balance figure), still no fused taxonomy anywhere in `students/page.tsx`. No screen in this pass's territory asked for a fused badge; left as a design decision, not built.

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

## F17 · `sessions` is the teacher-private billing engine's table, not a center class-occurrence log
- **What:** `FILE-COMPLETION-TABLE.md` listed Center-Home's Schedule section as buildable from `sessions` (13 columns including `scheduled_at`, `room`, `status`, `billed` — a plausible-looking match for "today's classes with a status"). Checked live before building, per standing practice: every row in `sessions` has `kind='private'`, including the two rows whose `group_id` points at a `kind='center'` group. `sessions` is written exclusively by the teacher-private billing engine (`src/app/api/teacher/private/schedule/sessions/*`); nothing anywhere in the codebase inserts a `kind='center'` row. The earlier claim was wrong — it matched the table's column list without checking what actually populates it.
- **What actually backs a center's class schedule:** `schedule_slots` — `center_id` direct, plus `room_id`, `teacher_id`, `group_id`, `day_of_week` (JS weekday as text, see `scheduleSlotsDayOfWeek()` in `cairo/day.ts`), `start_time`/`end_time`. It is a **recurring weekly template**, not a per-occurrence log — there is no status/billed/completed column at all. The live `/schedule` page (`Merged-Center-Groups` §05) already reads it exactly this way: it renders the week grid straight from the template, with no completion state anywhere in that file either.
- **Consequence for what was built:** Center-Home's Schedule section is built from `schedule_slots` (today's Cairo day-of-week only), joined to room/teacher names and `student_group_members` counts the same way `/schedule`'s own `groupToTeacher` already does. The design's Billed/Next/Later status chip has no stored equivalent to read, so it's derived at render time — end_time already passed = billed, the single soonest not-yet-ended slot = next, everything else = later — documented as an interpretation in `src/lib/todayScheduleStatus.ts`'s own comment, not a claim that money was specifically confirmed collected for that slot.
- **Found:** 30 July 2026, building Center-Home's Schedule section.
- **Touches:** none — read-only display, no schema change, no new table.
- **Addendum, 1 August 2026 — the right table was never checked for how much real data is in it.**
  Three separate passes (29–31 July, #245/#247/#280) each confirmed `schedule_slots` is the correct
  source and re-read the live code against the design, but none of them queried the table's own row
  count — they verified *which* table, never *how populated* it is. `select count(*) from schedule_slots`
  returns **1**, for the entire production database, across every center and every day of the week.
  The Schedule section was genuinely built correctly and genuinely matches the design, and was also
  invisible for virtually every real center on virtually every day, silently, with no indication why —
  found only when Eyad compared the live `/dashboard` against the design directly and asked whether the
  balance card and Schedule list were "genuinely absent... confirmed directly against the live DOM, not
  against your prior report." Fixed in #296: the section header now always renders, and an
  `EmptyState` (the canonical primitive) shows instead of the section silently vanishing, with a CTA
  into `/schedule` — the honest fix (configure a recurring slot), not an invented figure. Whether the
  near-total absence of `schedule_slots` adoption is itself a bigger problem (onboarding, discoverability
  of `/schedule`) is a separate, unopened question — flagging it here rather than assuming this ledger
  entry closes it.

## F18 · Card-order Customize step has no per-field print toggle
- **What:** `Merged-Center-Orders` §03 (Customize step) draws four on/off toggles for what prints on the card — Student name (on), QR code (on), Student photo (**off**, deliberately, in the reference frame), ID number (on). Live's `checkout/customize/page.tsx` only offers a card-**style** toggle (dark/light) plus a freeform `vendor_notes` text field — there is no per-field print control anywhere in the cart/order model.
- **Why not built this pass:** `card_orders`/`card_order_cart` carry `card_style` and `vendor_notes`, nothing resembling `print_name`/`print_qr`/`print_photo`/`print_id_number`. Adding the toggles means adding new columns (or a jsonb field) to persist the choice through cart → order → the print vendor's actual production instructions — a schema change, not a display fix.
- **Touches:** none live (nothing reads a photo/name/QR toggle today), but the build is a new-column item.
- **Found:** 31 July 2026, Center-Orders survey.
- **Blocked by:** nothing technical — needs Eyad's call on whether per-field print control ships, since `vendor_notes` (freeform text to the print vendor) is arguably already an escape hatch for the one case this would matter (omitting a student photo), just not a structured one.

## F19 · Team management is broken in three independent ways in production — not a design gap, a live outage on a paid feature
- **What, found together, 31 July 2026, Center-Setup §07/§08 survey — each verified directly against the live production schema, not migration history:**
  1. **Inviting a team member fails end-to-end, every time.** `settings/team/page.tsx` selects `phone, role, status` from `center_invites` to render pending invites; live `public.center_invites` has no `status` column (confirmed: `select status from center_invites` → Postgres `42703`). The read silently no-ops (pending-invite rows just never render, no error shown). The **write** is worse: `POST /api/invite-user` upserts `{..., status: 'pending', ...}` with `onConflict: 'center_id,phone'` — the table has neither a `status` column nor a unique constraint on `(center_id, phone)` (`pg_constraint` shows only the PK, two FKs, a role CHECK, and a token unique key). **Every invite request in production returns a 500.** The primary CTA on the Team settings page does not work.
  2. **Activating or deactivating a team member always fails.** `handleToggleActive` posts `{is_active}` to `PUT /api/permissions` with **no password field**. The route unconditionally calls `verifyPasswordForSensitiveAction`, which rejects any empty password — with no carve-out for an `is_active`-only change. The sibling granular-permission-edit path works correctly because it *does* collect a PIN first via `PasswordConfirmModal`; the activate/deactivate button was never wired to that same modal.
  3. **The seat-limit mechanism is dead code — see the amended D8 above.** `centers.max_teachers`/`max_students` don't exist live; both `/api/settings/limits` and `/api/invite-user`'s own limit check fail silently and fall back to a hardcoded cap of 2 seats for every center, regardless of plan.
- **Why one entry, not three:** all three were found in the same pass, on the same screen, and share the same root cause class — code written against columns/fields that were never created (or a request payload that was never wired up), invisible to CI because CI has no live database and every query "succeeds" by PostgREST's own error-swallowed-by-the-page convention. This is the exact failure mode CLAUDE.md's rule 2 names by name.
- **Why not fixed in this pass:** (1) and (3) need a schema migration (`center_invites` needs `status`/`invited_name` + a unique constraint on `(center_id, phone)`; `centers` needs `max_teachers`/`max_students` or equivalent) — manual-apply-to-production per CLAUDE.md's migration rule, not something to merge-and-assume. (2) is a client-side fix with no schema change, but it changes account state (activating/deactivating a person's access) — a standing stop condition, flagged rather than silently patched.
- **Touches:** auth, account state, and indirectly money (a center paying for 5 seats is capped at 2).
- **Blocked by:** nothing technical for any of the three. All three need Eyad's go-ahead — the schema fixes because they're production migrations, the activate/deactivate fix because it's an account-state change.

## S8 · No CSRF on any subscription-billing mutation, plus two misleading money figures on the same screen
- ⚠ **CSRF PARTLY closed — 5 of the 7 mutations this entry named now check it; `/api/parent-pack/request` and `/api/invoices/[id]/pay` still have none. 4 August 2026, Center-Setup parity pass.** Fixed this pass: `/api/billing/upgrade`, `downgrade`, `reactivate` and `cancel` each gained the `validateCSRFRequest(request, auth.userId)` check they were missing, and the client (`settings/billing/page.tsx`) now sends `getCsrfHeaders(token)` on those four fetches — the same helper the page already imported and used for `withdrawal`. **Still open, untouched by this pass and still exploitable:** `/api/parent-pack/request` (the pack-request button, `page.tsx:1001`) and `/api/invoices/[id]/pay` (the pay-invoice button, `page.tsx:1029`) contain **zero** `validateCSRFRequest` calls — re-grepped across all of `src/app/api` on this branch, neither file appears among the 64 routes that call it. Both are `POST` mutations reachable from this same screen and both are still owner-gated only (`requireOwnerAdminCenter` and `requireCenterAuth` respectively), which is exactly the shape S8 flagged as insufficient on its own. So do not read this as "S8's CSRF half is done": it is 5/7, and the two that remain are a pack purchase and an invoice payment. Nothing blocks them — they were simply out of this pass's scope. No schema, no decision. The three misleading-money-figure findings below are also **not** touched by this fix and remain open.
- ⚠ **Correction to this entry's own original text, same date — the original entry was wrong about `withdrawal`.** The "What" bullet below states that every money-moving action on this screen, **explicitly including withdrawal**, calls no `validateCSRFRequest`. That is false and appears to have been false when it was written: `/api/billing/withdrawal` has carried two `validateCSRFRequest` calls on `master` all along, and the billing page has always sent `getCsrfHeaders` on that one fetch (verified with `git grep validateCSRFRequest origin/master -- src/app/api/billing/withdrawal/route.ts`, not inferred from this ledger). The original count was 6 of 7 unprotected, not 7 of 7. **An earlier draft of the banner above compounded this** by asserting that withdrawal's existing CSRF was found "exactly as this entry originally found" — it was not; that reading of history is retracted here rather than quietly deleted. (`/api/billing/initiate-payment`, also cited by that draft, does have CSRF, but it is not one of the seven and this screen never calls it, so it was never evidence either way.) The original text is left verbatim below so this correction can be read against it.
- **What (original text, preserved verbatim — it is WRONG about `withdrawal`, see the correction above; the money-figure findings still stand):** every money-moving action on `/settings/billing` — upgrade, downgrade, reactivate, withdrawal, cancel subscription, pack request, invoice pay — is `requireCenterAuth` + owner-role gated, and **none of them call `validateCSRFRequest`**. The one CSRF-checked mutation near this page (`/api/settings/billing`'s PUT/POST) is dead code from this page's own perspective — the billing page never calls it. Same class of gap as **S6**/**S7**, now on the highest-value money surface surveyed yet (subscription upgrade/downgrade/cancel, not just an add-on).
- **Two more findings on the same screen, not CSRF but both materially misleading to the owner about money:**
  - **Downgrade's "credits earned" figure is entirely fictitious.** The UI computes and prominently displays a client-side credit amount (`(currentDaily − newDaily) × remainingDays`); the server (`/api/billing/downgrade`) explicitly charges, refunds, or credits nothing — it schedules the plan change for next renewal and returns `creditEarned: 0` by design (its own comment: "no charge, no refund, and NO credit... which was the worst bypass"). The frontend never even reads that field back — it just shows its own invented number regardless of what the server did.
  - **The reactivation modal still branches on a retired tiered-penalty model** (`tier1`/`tier2`/`tier3`, "Fine" vs. "Reactivation fee" rows) even though `getReactivationAmount` was reduced to always return `fine: 0, reactivationFee: 0` under the current single-day-lock model — the tier inputs are kept "for callers" only. The UI still shows whichever of two always-zero rows the tier happens to pick.
  - Smaller, same screen: the upgrade cost preview shown before confirmation excludes the flat 20 EGP processing fee the server adds before charging Paymob, so the pre-confirmation number is systematically lower than what's actually billed; and "Apply credits to invoice" is a toast-only stub with no backend call at all.
- **Touches:** money, and auth (CSRF).
- **Blocked by:** nothing technical. The CSRF gap and the fictitious-credit/dead-tier UI are independent problems that happen to share a screen — flagging together since they were found together, not because one depends on the other.

## F20 · Two of six payment methods on the scanner's payment screen silently fail to record — the core attendance→billing pipeline, not an edge screen
- **What, found together, 31 July 2026, Center-Attendance survey — each verified directly against the live production schema (`information_schema`/`pg_constraint`), not migration files:**
  1. **Vodafone Cash and Bank Transfer never write a `payments` row, with no error shown anywhere.** `ScanResultScreen.tsx`'s method buttons sent `'vodafone_cash'`/`'bank_transfer'`; the live `payments_method_check` CHECK constraint (and the app's own `paymentSchema` Zod enum, which already agrees with the constraint) only accepts `'vodacash'`/`'bank'`. `sync.ts`'s main payment-recording branch calls `dbInsert` for the `payments` row and **never checks the returned error** — unlike every other `dbInsert` call in the same function, which all check and throw. So the `attendance_scans` row (the student marked present, billed) succeeds, a "pending payment" WhatsApp message still fires, the queue item is marked synced and removed — and the `payments` row is simply never created. Staff and parent both see success; the student's real balance stays fully outstanding. **Fixed in this pass**: `ScanResultScreen.tsx`'s `PAYMENT_METHODS` values changed to `'vodacash'`/`'bank'`, matching the schema exactly — this also fixes a second, independent bug at the same file's line 197, where the last-payment-method label lookup used the same wrong strings and silently fell through to a default label for the same two methods.
  2. **The main path's silent error-swallow was deliberately NOT also fixed, and here is why it matters:** simply adding an error-check-and-throw there, on its own, converts a "payment silently missing" failure into a "payment retries forever" failure — because `attendance_scans` has no way to dedupe a retried scan (`attendance_scans_session_student_unique` requires `session_id`, which the scanner never sets, and Postgres treats NULLs as distinct in a unique constraint anyway — confirmed live). A thrown error re-queues the *whole* scan, and the already-succeeded `attendance_scans` insert runs again on every retry, each time adding `charged_fee` again. This is not hypothetical — it is the **exact** failure already live for late entry, item 3 below. Error-checking and retry-safe deduplication need to land together, not one without the other; landing only the error-check would trade one billing bug for a worse one.
  3. **"Allow late entry" already has this exact failure, live, today, with no schema fix pending.** `sync.ts`'s late-entry branch inserts an `attendance_scans` row with the real session fee charged, then a `payments` row with `method: 'late_entry', status: 'late'` — a deliberate design (the code's own comment: "an assessment, not a collection," meant to be excluded from `PAID_PAYMENT_STATUSES` so it doesn't look collected). `'late_entry'` is not, and was seemingly never, in the `payments_method_check` constraint or the Zod enum. The `payments` insert always fails, the error **is** checked and thrown (correctly, unlike item 1), so the item is **not** dead-lettered — it retries every ~30 seconds for as long as the tab stays open, and **each retry re-inserts a fresh, fully-charged `attendance_scans` row**, since there is no dedup. A late-entry grant left open in a busy front-desk tab can inflate a student's computed balance by the session fee, repeatedly, for as long as the tab is left open online. This needs the constraint/enum decision made deliberately (add `'late_entry'` as an allowed method, or model an "assessment" differently), not guessed at.
  4. **A fourth, adjacent constraint gap: fee-exempt admissions may not be recording attendance at all.** The exempt path sets `payment_status_at_scan: 'admitted'` — a real, load-bearing, intentional value (`EXEMPT_SCAN_STATUS = 'admitted'` in `studentBalance.ts`, with its own doc comment: exempt rows are excluded from the balance sum by this exact value, separately from `charged_fee` already being snapshotted at 0 for the same rows as a second safeguard). The live `attendance_scans_payment_status_at_scan_check` constraint only allows `'paid'`/`'unpaid'` — `'admitted'` is not in it, so this insert should fail at the database layer, meaning an exempt/free-session student may not be marked present at all. Not fixed here: unlike the vodacash/bank strings, `'admitted'` is real application vocabulary with its own dedicated exclusion logic elsewhere, not a typo — substituting a different string risks silently changing balance-computation semantics for every exempt session without full visibility into every reader.
  5. **Even the four methods that do pass validation lose most of their intended payload.** `dbInsertSchemas.payments` only declares `student_id, amount, method, payment_date` — Zod 4 strips every other key by default, so `recorded_by`, `paid_at`, `status`, `confirmed`, `confirmed_at`, and `group_id`, all explicitly set by `sync.ts`, never reach Postgres; the row falls back to column defaults instead. Concretely: `group_id` is always `NULL` (breaks per-group "already paid today" attribution for multi-group students), `paid_at` is always the sync instant rather than the actual scan instant (misdates offline-queued payments synced after a Cairo-day rollover), `recorded_by` is always `NULL` (loses the audit trail of which staff member logged it), and non-cash methods land as `status='paid', confirmed=false` — a combination the app doesn't intend and the "pending until reconciled" UI doesn't match. A live `BEFORE INSERT` trigger correctly forces `confirmed=true` for cash, so cash is the one method that ends up fully correct.
  6. **`payments` inserts have no role/permission gate on this path at all.** `dbProxyScope.ts`'s role check (`ATTENDANCE_WRITER_ROLES`) applies only to `attendance_scans`; any authenticated user tied to a center — regardless of `can_record_payments`/`can_view_payments`/`can_scan` — can record a `payments` row through this route. `src/app/api/payments/collect/route.ts` was already built specifically to close this exact class of gap for the `/payments` page (its own comment names the risk outright); the scanner/checklist payment path predates that fix and was never moved onto it. **This compounds with item 5**: fixing the Zod-stripping in isolation, on a route with no permission gate, would let an under-privileged account set `confirmed`/`status`/`recorded_by` directly — the two need a coordinated fix, not sequential unrelated ones.
- **Also found, lower severity, not fixed:** `ScanResultScreen.tsx` formats every money figure with a hand-rolled `${amount} ${egp}` string instead of `formatCurrency` — no thousands separator, no locale-aware digit shaping, a real departure from CLAUDE.md's stated convention even though it doesn't trip `check:tolocale`. Also a latent stale-state bug: a "already paid" scan's auto-dismiss timer never resets the balance-due figure left over from the *previous* student's late-entry/pending-payment screen, so it can render on a fully-paid-up student's success screen if the operator lets the previous one auto-close instead of clicking "Next student."
- **Why this is one entry, not six:** every item traces back to the same two root causes — a payment-method vocabulary that the schema, the validator, and the UI don't all agree on, and a retry pipeline with no dedup for anything billing-relevant once a retry actually happens. Numbering them as unrelated bugs would hide that a coordinated fix (schema + validator + retry-dedup, decided together) closes all of them; patching any one in isolation risks exactly the trade described in item 2.
- **Touches:** money, and auth (item 6).
- **Blocked by:** nothing technical for the schema/enum decisions (items 3, 4) or the permission-gate fix (item 6) — all need Eyad's go-ahead given the standing stop condition on money and auth. Item 1 (the method-string typo) is fixed in this pass since it required no decision — it's a straight match to values the schema, the Zod enum, and other read-side code already agree are correct.

## S9 · No CSRF on four CEO/admin mutation routes, one of them a platform-wide kill switch
- **What:** `POST /api/ceo/leads`, `PATCH /api/ceo/actions/[id]`, `PATCH /api/ceo/platform-config`, and `PATCH /api/admin/centers/[id]` have no `validateCSRFRequest` call at all — confirmed by reading each route in full, contrasted directly against sibling admin routes that do call it (`src/app/api/admin/centers/route.ts`, `.../[id]/subscription/suspend/route.ts`). Same class of gap as S6/S7/S8, the fourth instance found this pass alone.
- **Why this one is worse than the others:** `getAdminContext` (the auth these routes share) accepts a cookie-session fallback, not just a Bearer token — exactly the scenario CSRF protection exists for. `/api/ceo/platform-config` flips `maintenance_mode`/`wa_sending_enabled`/`read_only_mode`/`cron_paused` platform-wide; `/api/admin/centers/[id]` handles invoices, blacklisting, plan overrides, and cancellations. Mitigated somewhat by `proxy.ts`'s cross-origin `Origin` allowlist on mutating verbs — not a wide-open hole, but a real deviation from the project's own stated defense-in-depth rule.
- **Not a trivial add:** the CEO page's own client helper (`getAuthJsonHeaders()`) never sends `X-CSRF-Token`/`X-Session-ID` today — adding server-side validation without a matching client change would break the UI outright. Needs both sides landed together.
- **Touches:** auth, and money/account-state (the platform-config and center-mutation routes).
- **Blocked by:** nothing technical. Waiting on Eyad's go-ahead, same as S6–S8.

## F21 · Teacher-tier price fallback duplicates the documented single source of truth — CLOSED, PR #288
- **What:** `src/lib/ceoTeachers.ts`'s `TIER_MONTHLY_GROSS` (499/999/2499, used only when a subscription row has no `price_gross`) hardcodes the exact same figures `src/lib/teacherPlans.ts` — itself explicitly commented "single source of truth for the teacher subscription ladder" — already exports. Values agree today; nothing enforces they stay in sync, so a real price change in `teacherPlans.ts` would silently desync the CEO dashboard's own MRR figure with no type or test catching it. Same shape as F16 ("one number, two sources"), lower stakes since it's a read-only display fallback, not a charge computation.
- **Fixed, 31 July 2026, PR #288:** `TIER_MONTHLY_GROSS` now sources all three values from `TEACHER_PLANS` directly (`TEACHER_PLANS.teacher_standard.priceGross`, etc.) instead of duplicating them. Identical runtime behavior today (values already agreed); the silent-drift risk is closed. 45 relevant unit tests (`ceoTeachers.test.ts`, `ceo-time-range.test.ts`, `ceoTeachersView.test.ts`) re-ran green.
- **Touches:** money (read-only, display).
- **Found:** 31 July 2026, CEO survey (#256). Closed: 31 July 2026, PR #288.

## F22 · Center-Students re-verification — four small, previously-unlogged display gaps
- **What, found together, 31 July 2026, re-verifying `Merged-Center-Students.html` against live code
  fresh (post-#239/#249), not from memory:**
  1. **§01 Roster — still open, corrected 4 August 2026 (see F22 addendum below — the original
     "no cross-center rollup query anywhere" / "zero matches" claim below was wrong; do not treat it
     as a finding).** The design's header/KPI assume a multi-branch rollup — subtitle "128
     active · **3 branches**", KPI sub "across 3 branches". Live's `branchCount`
     (`src/stores/branchStore.ts`, hydrated by `BranchSwitcher` from `GET /api/branches`) is a real
     cross-center count for organizations that have `organization_id` set: `src/app/api/branches/route.ts`'s
     GET handler queries `centers` filtered by `organization_id` — every sibling center in the org,
     optionally narrowed by `branch_user_assignments` — not just the caller's own row; the
     single-own-center-array fallback only fires when the user has no `organization_id`. What is
     genuinely NOT rolled up is the *paired* `active` count: `students/page.tsx` fetches `students`
     filtered to `center_id = meData.user.center_id` only, so a real 3-branch org's KPI would read
     e.g. "42 active · 3 branches" where 42 is one branch's own active count against a correct org-wide
     branch count of 3 — a scope mismatch between the two clauses, not an absent rollup. Fixing the
     `active` half needs the same RLS-scope decision (should one roster view ever sum students across
     sibling `center_id`s) already named below — a bigger question than this file's redesign pass.
  2. **§02 Student Detail — still open.** No aging/next-due sub-line under the balance figure at all.
     The design shows "12 days overdue · since 01/07/2026" (owes state) or "Next due 01/08/2026 · 400
     EGP" (paid state). **Confirmed why, 31 July (PR #277):** `getStudentBalances()` is a running
     aggregate (Σ charges − Σ payments), not a per-invoice/per-session ledger — there is no single
     "oldest unpaid session" or "next due date" fact to read. Needs a product decision on what those
     mean under an aggregate-balance model, not a display fix.
  3. **§02 Student Detail — closed, PR #277.** "ID card" quick-action tile built (view/print this
     student's own QR via the existing `QRCard` component + the roster page's own
     `QRCode.toDataURL`/`students.qr_code` pattern), alongside the existing Collect payment tile.
  4. **§04 Import — closed, PR #277.** Flagged rows now get an inline "Fix" text input for the one skip
     reason live can actually produce (missing name); typing a name reclassifies the row from "needs a
     fix" to "ready to add" without re-uploading the file. (The design's other example, "Grade not
     recognised," has no live equivalent — grade isn't an import field — and was correctly not
     invented.)
- **Why one entry, not four:** all four were the same shape when first found — real, low-severity,
  purely-display gaps surfaced while re-verifying already-shipped work, none touching a write path or a
  money computation. Kept as one entry with per-item status rather than splitting, so the "found
  together" context isn't lost.
- **Touches:** none — display/UX only, no schema, no protected file.
- **Found:** 31 July 2026, Center-Students re-verification (#257). Items 3–4 built, item 1's reasoning
  sharpened, item 2 confirmed correctly blocked: 31 July 2026, PR #277.
- **Re-confirmed 4 August 2026, Center-Students parity pass — CORRECTION, not a re-confirmation, on
  item 1.** A first pass re-read both items and wrote "item 1 (branch rollup) — `grep -n 'branch'
  src/app/[locale]/students/page.tsx` still returns zero matches" — that grep claim is false. Running
  it for real returns 14 matches (the `useBranchStore` import, the `branches`/`branchCount`
  declarations, and both render sites), and none of them were new to this pass — the same lines exist
  verbatim on `origin/master`. A second, actual read of `src/app/api/branches/route.ts`'s GET handler
  (not assumed from the `students/page.tsx` comment alone) shows it queries `centers` by
  `organization_id` across every sibling center when the user has one set — a genuine cross-center
  query exists. The real, narrower gap (see the corrected item 1 write-up above): `branchCount` can be
  a true org-wide figure, but the KPI's `active` half is fetched scoped to the caller's own
  `center_id` only, so the two clauses of "N active · M branches" don't share a scope for any org with
  more than one center. Still needs the RLS-scope decision on whether one roster view should ever sum
  students across sibling centers — that part of the original conclusion holds; the evidence offered
  for it did not, and is corrected here rather than left standing. Item 2 (aging/next-due sub-line) —
  `getStudentBalances()` (`src/lib/studentBalance.ts`) is still a running Σcharges−Σpayments aggregate
  with no per-invoice "next due" fact; still needs a product decision on what "next due" means under
  that model — unaffected by the item-1 correction. Items 3–4 (ID card tile, import inline Fix)
  re-verified still present and working, see the code citations under F22 above.
- **Item 1 — half of it removed rather than decided, 5 August 2026 (Center-Students build pass).**
  The mismatch was never that either number was wrong; it was that "N active · M branches" put a
  center-scoped count next to an org-scoped one in the same sentence. §03 (design line 846) pairs
  the headcount with **who is behind** instead of with a branch count, and §03 is the later frame of
  this same screen — so the roster's title meta now reads `{active} active · {behind} behind`, both
  clauses derived from the same center-scoped `studentsList`/`standingRows` fold, and the mixed-scope
  sentence is gone. The behind clause is dropped, never zeroed, while `behindSummary` is null (before
  the fold resolves and when it fails). **This does not close item 1.** The KPI tile below still
  renders "across {branchCount} branches" beside a center-scoped "Active students" value — same
  mismatch, one element lower — and that one is left alone deliberately, because removing the branch
  figure from the screen entirely is the RLS-scope question (should one roster view ever sum students
  across sibling `center_id`s) that item 1 says is Eyad's. What changed is that the mismatch no longer
  sits in the page's title.
- **Item 2 — the ledger was stale; both sub-lines are BUILT at `master`, 5 August 2026.** The
  4 August note above says item 2 is "still open" and needs a product decision. Read the component
  instead of the ledger and it is already there, in `students/[id]/page.tsx`: the owing state renders
  `tDetail('overdueSince', { days, date })` from `standing.oldestUnpaidDays` / `standing.oldestUnpaidAt`
  (the FIFO fold in `getStudentStandings`, not the running aggregate the old note assumed was the only
  source), and the settled state renders `nextDue` / `nextDueWithAmount` from the earliest future
  `sessions` row for a group this student belongs to, priced at that group's
  `student_groups.fee_per_class`. Both clauses drop out entirely when their source is absent — no
  placeholder date, no invented amount. The old note's reasoning ("`getStudentBalances()` is a running
  aggregate, so there is no oldest-unpaid fact") was correct about `getStudentBalances` and wrong about
  the screen, which uses a different helper for exactly this.
  **One real caveat, verified live rather than assumed:** the Next-due half depends on `sessions`, and
  `select kind, status, count(*) from sessions group by 1,2` returns 4 rows total, **all**
  `kind='private'` (3 finished, 1 scheduled) — F17's finding, still true. So the mechanism is built and
  correct, and for a center student it will render nothing until something writes center session rows.
  Built-and-empty, not built-and-wrong; recorded here so the next pass does not "re-open" item 2 after
  looking at a screen where the line is legitimately absent.
- **Item 5 (new, this pass) — closed.** §03's Attendance card draws two facts, "This term 22 of 24"
  **and** "Last attended 20/07". Only the ratio existed. The last-attended date now renders on the
  same tile, taken from the first non-absent row of `scans` (already fetched, already ordered
  `scanned_at DESC`, so the first such row *is* the last attendance — no second query and no
  client-side re-sort to get wrong). Absent, with no placeholder, for a student never scanned present.

## F23 · Two dashboard CTAs link to `/students` query params the page never reads — CLOSED, 4 August 2026
- **What:** `Merged-Center-Home` §01's unpaid-alert banner "Review" button links to `/students?filter=unpaid`, and the dashboard's "Add student" quick action links to `/students?action=add`. `src/app/[locale]/students/page.tsx` has zero `useSearchParams`/`searchParams` handling anywhere — both links silently land on the plain, unfiltered/unprompted roster instead of doing what they promise.
- **Contrast, so this isn't guessed at:** `/payments?action=collect` (the dashboard's "Collect payment" quick action) *is* correctly wired via `useSearchParams` in `payments/page.tsx` — this exact pattern already works elsewhere in the app, it's just missing on `students/page.tsx`.
- **Why not fixed where found:** the actual fix lives entirely in `students/page.tsx`, which is `Center-Students`' claimed file territory (its own sweep pass landed the same day, PR #277) — logging for whoever next has `Center-Students` open rather than a `Center-Home` agent colliding on another file's claimed lock.
- **Found:** 31 July 2026, Center-Home re-verification (PR #280).
- **Touches:** `src/app/[locale]/students/page.tsx` only. No schema, no protected file, no decision needed — reading `filter`/`action` and opening the matching filter/modal on load is mechanical once someone is in that file.
- **Closed, 4 August 2026, Center-Students parity pass (`claude/parity-center-students-w2`).** `students/page.tsx` now reads `useSearchParams()` once on mount: `?filter=unpaid` sets the existing `segment` state to `'behind'` (the same state the roster's own "Overdue"/"At risk" segmented control already drives, matching the semantics `isBehind()` uses elsewhere in the file), and `?action=add` opens the existing `showAddModal` state — the same state a manual "Add student" click sets. No new state, no new modal, no schema: both query params now drive state the component already had. Verified against the live component (`grep -n segment` / `showAddModal` in the file) before wiring, not assumed from the design or from `payments/page.tsx`'s pattern alone.

## F24 · My Teachers §09 Slots tab is a different feature than the design draws
- **What:** Live (`/api/center/group-slots`, `/api/teacher/group-slots`) is: a teacher who already has a negotiated, attached group proposes a specific weekly meeting time; the center confirms it and optionally assigns a room ("the slot step sits after cut-agreed," per the route's own comment). `Merged-Center-Setup` §09 draws a marketplace: the center posts an open, teacher-less time slot; multiple teachers propose to fill it; the center picks a winner and sets the cut.
- **Why this is structural, not a display gap:** no open-slot/multi-proposal-per-slot mechanism exists anywhere live — there is no table or endpoint for an unattached slot that multiple teachers can bid on. Building it means a new table, a notification fan-out to eligible teachers, and a winner-selection UI, not a restyle of the existing confirm-a-proposed-time flow.
- **Found:** 31 July 2026, Center-Setup re-verification (PR #282).
- **Touches:** none yet — this is a scope decision (does the marketplace model replace or sit alongside the attached-group model?), not a mechanical build.

## F25 · Two parallel WhatsApp support-number config sources, used inconsistently — CLOSED, PR #314; re-verified live 4 August 2026
- **What:** `SITE.supportWhatsAppIntl` (`src/config/site.ts`) and `NEXT_PUBLIC_SUPPORT_WHATSAPP` (a separate env var) were both read as "the" support WhatsApp number, by different call sites across the public marketing pages, with no single source of truth. Whichever page read the one that was unset silently disabled its WhatsApp CTA.
- **Closed:** PR #314 rewrote `src/lib/supportWhatsApp.ts` so every PUBLIC call site (`getSupportWhatsAppWaMeBase`, `getSupportWhatsAppWaMeWithText`, `getSupportWhatsAppDisplayLabel`) reads only the `SITE` constant (`src/config/site.ts`); `NEXT_PUBLIC_SUPPORT_WHATSAPP` no longer feeds any public link, only the SERVER alert path (`getAdminOrSupportWhatsAppDigits`, cron/vendor-failure alerts) which is a deliberately separate, unchanged channel. **Re-read the file live this pass, 4 August 2026** — the module's own header comment states the split explicitly and the code matches it exactly; `talk-to-us/page.tsx` calls `supportWhatsAppLink()` from the same `SITE` constant.
- **Found:** 31 July 2026, Public-Marketing re-verification (PR #286). **Closed, PR #314, same day.**
- **Touches:** `src/config/site.ts`, `src/lib/supportWhatsApp.ts`, `src/app/[locale]/talk-to-us/page.tsx`, and other public call sites — all repointed.

## R11 · Center-Home dashboard — four live sections removed because the design does not draw them (Eyad, 3 Aug: "Design wins. Identical means identical.")
Removed from `src/app/[locale]/dashboard/page.tsx`. **Nothing here is a placement decision** — per Eyad's Q2 answer, they are recorded where they lived and no new location is invented. Whether any of them returns, and where, is his call against a design that specifies it.

| Removed | Lived at (pre-removal lines) | What it was | Data source | Still reachable elsewhere? |
|---|---|---|---|---|
| **Quick Actions** | 1361–1397, directly under the header | 4 nav tiles: Add student → `/students?action=add`, Record attendance → `/attendance`, Collect payment → `/payments?action=collect`, Send report → `POST /api/dashboard/send-daily-summary` | none (3 links) + 1 mutation | **3 of 4 yes** — all three links are ordinary nav to pages reachable from the sidebar. **"Send report" is the exception: this tile was its only trigger in the entire app** (`onSendReport`, removed with it). The cron `daily-summary` still runs; only the manual "send it now" button is gone. |
| **At a glance** | 1589–1672, below Schedule | 4 `KpiCommandCard`s with sparklines + growth: Active students, Today's attendance, Monthly revenue, Pending payments | `statsData`, `safeData` | Partly — the same figures exist on `/students` and `/payments`; the sparkline+growth presentation does not exist anywhere else. |
| **At risk students** | 1674–1745 | Up to 6 students with attendance % and a bar, "View all" → `/students?filter=atrisk` | `GET /api/students/at-risk` | **Yes, fully.** `src/components/students/AtRiskPanel.tsx` still calls the same route, so the feature survives; only the dashboard copy is gone. The route is **not** orphaned. |
| **Trends** | 1747–1826 | Attendance area chart (7-day, vs-last-week growth) + payment-status donut (paid/pending/overdue, "Collected" centre value) | `safeData.trendData`, `paidCount`/`pendingCount`/`latePaymentCount` | **No.** These two charts existed only here. `/analytics` is a different, admin-scoped surface. |

**Cascade removed with them** (all verified dead by lint after the fact, `0 errors`): the `at-risk` fetch effect and its realtime refetch, `onSendReport`, `KpiCommandCard`, `atRiskAttendanceIndicator`, `formatMonthLabel` + `AR_MONTHS`/`EN_MONTHS`, `formatAttendanceChartDayLabel`, six sparkline/chart memos, `canViewRevenue`, and 13 imports. The loading skeleton was rewritten to mirror the new (shorter) page rather than keep promising two charts that no longer render. Two `react-hooks/exhaustive-deps` warnings remain and are **pre-existing** — present in the same two places before this change.

**Two things deliberately left alone, flagged rather than removed.** Both are live-only (the design draws neither) but removing them destroys function with no design replacement, which is a different decision than Q1/Q2:
- **`PlanUsageCard`** (still at the top) — the only warning a center gets before hitting its student cap.
- **The `MoreVertical` actions menu** — the only entry point to Excel/CSV export, a plan-gated **paid** feature.
- Also left: the plan pill, the greeting in the H1 (design shows the bare center name), the enrollment-surge alert, and the payment-overdue banner. The last one is a suspension warning; removing it to match a design that never modelled billing state would be a safety regression, not fidelity.

**Orphaned i18n keys, left in place on purpose.** ~15 `dashboard.*` keys now have zero call sites (`atRiskDesc`, `allGood`, `atRiskNoStudentsYet`, `atRiskStable`, `attendanceChart`, `paymentStatus`, `chartLastUpdated`, `noDataForChart`, `sendReport`, `todayAttendance`, `pendingPayments`, the four `dailySummary*` toasts, …). `check-i18n` enforces ar/en **parity**, not usage, so they do not fail the gate. Deleting them is a separate two-file change and would be premature while the sections' return is undecided. **`common.sectionAtAGlance` must not be deleted** — `/admin/billing`, `/admin/analytics`, `/students` and `/payments` all still render it.

**Pre-existing finding surfaced by the cleanup, not caused by it:** removing the At-a-glance monthly-revenue card removed the last consumer of `canViewRevenue` on this page — but the "Today · Collected" KPI shows a money figure and **was never gated by it**. That was true before this change too. It is now the only money figure on the dashboard, and it is ungated. Not fixed here (the design draws it unconditionally); flagged for a call.

> **SUPERSEDED, 3 August 2026 — the code half of this entry was not merged.** A parallel session
> (`pipeline/center-home-dashboard`, commits `5dd6d747` + `e242bb84`) did the same §01 rebuild and did
> it better. Its work is kept; mine was withdrawn from PR #305, which is now docs-only. What theirs has
> that mine did not:
> - **`src/app/[locale]/dashboard/loading.tsx` — I missed this file entirely.** It still painted the
>   *deleted* screen (`max-w-7xl mx-auto`, 4-up KPI grid, two chart panels, `rounded-xl`), so with my
>   version merged every navigation to `/dashboard` would have flashed the design I had just removed.
>   A real defect in my work, not a difference of opinion.
> - **Two Cairo-day money bugs I did not find.** The digital-share meter bucketed payments by
>   `new Date(p.paid_at).toISOString().slice(0,10)` — a **UTC** date — against Cairo day keys, so every
>   payment taken between Cairo midnight and 02:00/03:00 bucketed a day early and Saturday's fell out of
>   the week entirely; both the percentage and the EGP total under-reported. And the Collected KPI used
>   the **device's** midnight (`setHours(0,0,0,0)`) rather than Cairo's.
> - **The orphaned i18n keys cleaned up**, which I had deliberately left.
> The `AlertCircle` glyph I added is already present in theirs, identically.
>
> **One difference that is a genuine decision, not a defect — it needs Eyad.** Their rebuild removes the
> three live-only elements I deliberately kept and flagged above: the **payment-overdue / suspension
> banner**, **`PlanUsageCard`**, and the **actions menu** (the only entry point to plan-gated Excel/CSV
> export). Theirs is the stricter reading of "identical means identical" and may well be what was wanted.
> But it means a centre about to be suspended for non-payment gets no warning on its home screen, and a
> centre approaching its student cap gets none either. Recorded here rather than resolved either way.

**Found/done:** 3 August 2026, Center-Home §01 restructure. Gates green: `tsc --noEmit` clean, `eslint` 0 errors, `i18n:check` / `check:bidi` / `check:tolocale` all OK.

## R12 · STOPPED — the "Verified" badge has no Valify credentials config point to build against, because no Valify integration exists at all
**Instruction, Eyad, 3 Aug:** *"Verified badge: build it against the Valify credentials config point, placeholder credentials, fails visibly."* **Stopped and reported.** The named config point does not exist — not as a placeholder, not as an unset env var, not as a `platform_config` key.

**Verified, three ways, 3 August 2026:**
1. **Live schema.** `information_schema.columns` for `public.centers`, matching `%verif%`, `%valify%`, `%kyc%`, `%ident%` → **zero rows**. There is nowhere to store a per-center verification state.
2. **Live config.** `platform_config` matching the same four patterns → **zero rows**. There is no credentials slot to populate, placeholder or otherwise.
3. **Whole repo.** `valify` (case-insensitive) across `src/`, `scripts/`, `supabase/`, `messages/` → **3 hits, all of them comments saying it is not built**: `src/components/admin/AccountDetailHeader.tsx:15`, `src/components/admin/PlatformOverviewHeader.tsx:14`, `src/lib/centerAccountMetrics.ts:23`. No client, no env var, no route, no call site.

**Why this is a stop and not a judgement call.** The instruction's own escape hatch — placeholder credentials that *fail visibly* — presumes a code path that attempts verification and can fail. There is no such path. The only things buildable today are (a) a badge hardcoded to "unverified", which is a lie dressed as a feature since it asserts a checked state that was never checked, or (b) a badge wired to a new `centers` column, which is exactly the *"anything needing a new column, table, or migration stops and reports to me"* rule. Both are stops. It also fails the same test as the blocked balance card: a "Verified" chip that no verification produced is the fake this instruction set out to prevent.

**What unblocking actually needs, smallest first:** a Valify vendor agreement and sandbox credentials (nobody is named for this — see `STATE-OF-THE-BUILD.md` §5 item 3) → an env/`platform_config` credentials slot → a verification column or table on `centers` **(migration, needs Eyad)** → the client and the badge. The badge is the last 5% of that chain, not the first.

**Left in the code as an explicit absence,** with the evidence inline, rather than silently omitted: see the block comment above the alert row in `src/app/[locale]/dashboard/page.tsx`.

**Found:** 3 August 2026, Center-Home §01 feature-gap pass.
## F26 · Four live routes read columns that do not exist — two are unconditional 404s on paid features, and CI cannot catch any of them
Surfaced by the 19-file design-parity sweep, 3 August 2026, then **re-verified by hand** — every column checked in `information_schema` and every call site read in full, because this is exactly the shape of the 8 July student-detail outage and an agent's word is not evidence.

**This is not a design gap. It is live breakage on production today.** All four pass `tsc`, `eslint` and every CI gate, because **CI has no live database** — precisely the failure mode CLAUDE.md rule 2 exists to prevent.

**Live catalog, verified 3 Aug:** `card_orders.card_style` **0**, `centers.max_teachers` **0**, `centers.max_students` **0**, `card_order_status_transitions.created_at` **0** (the real column is `transitioned_at`, **1**), `public.bosta_shipments` **0**.

| # | Site | Missing column | Verified behaviour |
|---|---|---|---|
| **1** | `src/app/api/admin/card-orders/[orderId]/pdf/route.ts:33` | `card_orders.card_style` | `.select('id, quantity, notes, students, card_style, …')` → PostgREST **42703** → `fetchError` truthy → `:37` returns **404 `not_found`**. **Unconditional. Every vendor print PDF for every card order is dead.** |
| **2** | `src/app/api/settings/limits/route.ts:18` | `centers.max_teachers`, `centers.max_students` | Same 42703 → `centerError` truthy → `:22` returns **404 "Center not found"** for **every center, always**. The endpoint cannot succeed. |
| **3** | `src/app/api/invite-user/route.ts:70` | `centers.max_teachers` | **Fails open, silently, and wrongly.** The error is **not destructured** (`const { data: centerPlanRow } = …`), so `centerPlanRow` is null and `maxTeam = Number(undefined ?? 2)` = **2**. Every plan is capped at 2 team members regardless of entitlement. Worse, `:80` reads the plan name from the same null object, so a Business center is told *"You've reached your team member limit for the **Starter** plan."* |
| **4** | `src/lib/loadCardOrderDetail.ts:64` and `src/lib/cardOrderState.ts:215` | `card_order_status_transitions.created_at` | `.order('created_at')` on a non-existent column errors. In `loadCardOrderDetail` the error is not checked (`{ data: transitions }`), so `transitions` is null and **the order timeline renders empty**. In `cardOrderState` `if (error || !data) return` fires, so the transition enrichment (`transitioned_by`, `transitioned_by_role`, `reason`, `metadata`) **silently never writes** — an audit trail that looks implemented and records nothing. |

**`card_style` is the worst of the four** because it is not merely unread — the checkout path **writes** it (`src/app/api/card-order-cart/checkout/route.ts`) and five sites read it (`src/types/admin-card-orders.ts:26`, `AdminOrdersClient.tsx:573`, `orders/checkout/review/page.tsx:167`, `api/admin/card-orders/route.ts:145,178`, and the PDF route). A whole feature was built against a column that was never added.

**Explicitly NOT a defect, corrected from the sweep's own claim:** `bosta_shipments` does not exist either, but `src/lib/loadCardOrderDetail.ts:73-74` guards it — `const attempt = await …; if (!attempt.error && attempt.data)`. It degrades cleanly to no shipment row. The sweep called it a blocker; it isn't. Recorded so nobody "fixes" a working guard.

**Likely a fourth strand of F19** ("team management broken in three independent ways in production"): #2 and #3 are both the seat-limit path, and #3 explains the hardcoded-2 behaviour F19 observed without identifying its cause.

**Two possible fixes, and they are not equivalent — needs Eyad.** Either **add the columns** (migration, manual apply to production per rule 5) or **remove the reads** and accept the features they back. `card_style` cannot simply be dropped: checkout already writes it and the vendor PDF renders from it, so removing the read means deciding the dark/light card option does not exist. `max_teachers`/`max_students` is the cleaner call — plan limits arguably belong in `pricing_plans`/`plans.ts`, not on `centers`. #4 is unambiguous and needs no decision: rename the three `created_at` references to `transitioned_at`.

**A guard worth adding regardless:** nothing in CI compares the columns named in `.select()` calls against the live catalog. That gap is why four of these shipped, and it is the same gap that caused 8 July. A catalog-diff check would have caught all four.

**Found:** 3 August 2026, design-parity sweep (19 files, 38 agents), hand-verified the same day.
**Blocked by:** Eyad's call on add-columns vs remove-reads for #1–#3. #4 is a free fix.
## S10 · A super-admin can exist with no database row at all, and the "row" check doesn't require a row
- **What:** `SUPER_ADMIN_PHONES` (an env var) grants full super-admin authority on its own, with no corresponding `admin_users` record. `src/lib/admin-auth.ts` returns a session on `if (!adminRow && !adminByPhone) return null;` — the phone alone suffices — and then unconditionally assigns `internalRole = 'super_admin'` for `adminByPhone`, the top of the ladder. Verified live 3 August 2026: `admin_users` holds exactly **1** `super_admin` row (plus 1 `sales_manager`), so anyone else holding this authority today holds it entirely off-catalog.
- **The second gate is not a second gate.** `requireSuperAdminRow` (`src/lib/admin-access.ts:136`) — the function whose name promises a database row — computes `adminUser?.role === 'super_admin' || isSuperAdminPhone(sessionPhone)`. It reads the *same env var* as the first check. Routes that call it believing they've added an independent DB-backed verification have added nothing. The name actively misleads; that's the part most likely to cause a future mistake.
- **Why it's a hole regardless of the payout decision:** an env-phone super-admin is **forensically anonymous**. Every audit trail keyed to an approver id would record a uuid matching no row in `admin_users`, so "who did this" has no answer from the database — only from whoever can read the Vercel env at that moment, which is not a historical record and is not versioned. Editing one env var is a lower bar than any database write, produces no `audit_log` entry, and is invisible to every in-app admin listing (`/api/admin/team` explicitly excludes these — see its own comments at lines 64 and 231).
- **Nothing warns when it changes.** `SUPER_ADMIN_PHONES` does not appear anywhere in `scripts/check-env.ts` (89 lines, verified by grep) — the script that exists precisely to catch missing or misconfigured env. Set, unset, typo'd, or extended by one extra number, no gate fires.
- **Partly mitigated, don't over-read it:** `src/lib/dbProxyProtectedColumns.ts` already blocks writing `users.phone` through the `/api/db` proxy specifically to stop self-elevation into a `SUPER_ADMIN_PHONES` match, and `admin-auth.ts` derives the phone from the auth email local-part rather than the mutable `public.users.phone`. Those close the *privilege-escalation-from-below* path. They do nothing about the *no-forensic-row* problem, which is the finding here.
- **The fix:** every super-admin must have a real `admin_users.role='super_admin'` row. Env-phone alone must stop conferring authority — at minimum for money movement, and the honest version is everywhere. Concretely: (a) create the row for each current env-phone holder before changing the gate, or the change locks them out; (b) rename `requireSuperAdminRow` to match what it actually does, or make it do what it says; (c) add `SUPER_ADMIN_PHONES` to `scripts/check-env.ts`; (d) record an authority-source column (`db_row` | `env_phone`) as NOT NULL on any authority-bearing log so the distinction is provable after the fact rather than inferred.
- **Ordering matters:** (a) before the gate change, always. Flipping the gate first with no row in place removes the only super-admin's access to the surface needed to create the row.
- **Touches:** auth, and money — payout approval (`PAYOUT-SYSTEM-SPEC.md` §7.5) is the immediate reason it surfaced, but the exposure is every super-admin-gated route in the app.
- **Found:** 3 August 2026, while recording the CEO-unavailability decision for the payout spec. Logged as a defect at Eyad's explicit instruction: *"a CEO with no database row and no forensic trail is a hole regardless of this decision."*
- **Blocked by:** nothing technical. Needs Eyad's go-ahead and the (a)-first sequencing, same as S6–S9.

## F27 · A second way to materialise a class-day exists in the schema, and it defeats the double-charge guard from a direction the guard cannot see
- **What:** `schedule_slots.parent_slot_id` — a self-FK (`REFERENCES schedule_slots(id) ON DELETE SET NULL`) added by the archived `025_schedule_group_recurring.sql` alongside `recurring` / `recurring_until`, under the heading "recurring slot support". It exists to expand one recurring slot into **child slot rows**, one per occurrence. Verified live 4 August 2026: **1 slot row, 0 with a parent, zero readers and zero writers** across `src/` and `supabase/`. It appears only in `baseline.sql` and the archived migration that created it.
- **Not a live bug. A latent one, and the mechanism is the point.** Recurrence today is expanded at *read* time by matching `day_of_week` — `src/app/[locale]/schedule/page.tsx:113` says so in its own comment: *"schedule_slots is a recurring weekly template with no per-occurrence…"*. Nothing populates `parent_slot_id`, so a generator that ignores it cannot double-count anything today. That is the direct answer to the question the warnings doc left open, and it is the whole reason this is F-logged rather than fixed as an outage.
- **How it bites.** Migration proposal 01 makes `sessions` the single occurrence log, guarded by `sessions_generated_occurrence_uniq` — unique on `(schedule_id, Cairo occurrence day)`. That index assumes **one slot row per recurring class**. If slot-expansion is ever implemented the way `parent_slot_id` intends — child `schedule_slots` rows, one per occurrence, linked by a parent pointer — then each child is a **distinct `schedule_id`**, the index sees them as different slots, and the same class-day gets two `sessions` rows → two `session_id`s → two `lesson:<session_id>:<student_id>` idempotency keys → `fee_per_class` and `center_cut_egp` **charged twice**. That is the §5.1 double-charge arriving through a door the index does not watch. The index cannot defend against it; only not having two mechanisms can.
- **Decision, Eyad, 4 August 2026:** drop the column, in migration proposal 01. *"Drop `parent_slot_id`, and log the latent second-materialisation mechanism explicitly. A generator built later must not resurrect it."* This entry is that log.
- **The standing rule for whoever builds the generator.** Occurrences live in `sessions`. Slots stay templates. **Do not re-add `parent_slot_id`, or any equivalent parent/child pointer on `schedule_slots`, as part of building a sessions generator.** If a future requirement appears to need per-occurrence *slot* rows, that is a deliberate schema decision that must reconcile with `sessions_generated_occurrence_uniq` first — it is not an implementation detail of a generator. The rule is also carried in-database as `COMMENT ON TABLE public.schedule_slots`, so it survives anyone who never reads this file.
- **Two adjacent facts a generator author will need anyway** (from `SESSIONS-MIGRATION-WARNINGS.md` §5.3, both outside the migration): `schedule_exceptions.schedule_id` FKs to **`group_schedule`, not `schedule_slots`**, so a generator iterating slots holds the wrong id class and exception lookups match zero rows forever — meaning centre-side generation has **no cancellation mechanism at all** today; and the one live slot is `recurring = true` with `recurring_until = NULL`, an **unbounded** recurrence with no natural horizon.
- **Found:** 4 August 2026, closing the item the warnings doc marked "examined by nobody" after its reviewer died mid-run.
- **Status — APPLIED, 4 August 2026.** The column drop shipped as part of `supabase/migrations/20260804120000_sessions_tenant_key_and_occurrence_uniqueness.sql`, applied by hand to production and recorded in the migration history as version **`20260804094631`** (`sessions_tenant_key_and_occurrence_uniqueness`) — the last entry in that history. Re-verified live against the catalog on 4 August: `schedule_slots.parent_slot_id` returns **0** rows from `information_schema.columns`, `sessions.center_id` and `sessions.started_at` are both present, `sessions_generated_occurrence_uniq` and `sessions_center_id_fkey` both exist, 2 rows backfilled, `trg_sessions_derive_center_id` present. This entry previously said "proposed and awaiting Eyad's manual apply", which was true when written and false by the time anyone read it. The standing rule above outlives the migration.
- **Version-string drift — the migration history is not an index of which files have run.** The FILE is named `20260804120000`; `apply_migration` stamped it **`20260804094631`**. The same drift exists on the two migrations before it: `20260730090000_permissions_canonical_admin_store.sql` is recorded as `20260729184405`, and `20260730110000_students_inactive_reason.sql` as `20260730122204`. So a filename cannot be looked up in `supabase_migrations.schema_migrations`, and absence from that table is **not** evidence a file has not been applied — match on the migration *name*, or better, check the catalog for the objects the file creates.

## F28 · F26 undercounted its own finding — the card-order checkout INSERT itself is broken, not just downstream reads, and the blast radius is bigger than documented
- **What F26 said (3 Aug):** `card_orders.card_style` doesn't exist; the one confirmed unconditional break was `src/app/api/admin/card-orders/[orderId]/pdf/route.ts` (admin vendor-print PDF, 404 on every call).
- **What's actually true, re-verified live 4 August 2026, Center-Orders survey, `information_schema.columns` + full read of every call site:**
  1. **`card_orders` has no `card_style` column at all — confirmed again** (`card_order_carts` has it, at 17 columns; `card_orders` does not: a full `information_schema.columns` dump of `public.card_orders` returns **35** columns, no `card_style` among them). *Corrected in place, 4 August 2026:* this entry's first draft said "32-column dump". The count was wrong — live is 35. The conclusion it supports is unchanged, but the figure is fixed here, in the committed record, rather than only in the pull request's description; a PR body is not evidence and does not survive the merge.
  2. **The checkout INSERT writes it anyway.** `src/app/api/card-order-cart/checkout/route.ts:189` builds `insertOrder` with `card_style: cart.card_style` and inserts straight into `card_orders` (`:192-194`). An insert naming a column the table doesn't have is a PostgREST error (`insErr` truthy), so `:198-201` returns `500 insert_failed` — **every single checkout attempt, for every center, unconditionally.** This is not a read-path bug, it is the write path, and it is upstream of everything else F26 listed.
  3. **Confirmed against live data (all re-verified read-only, 4 August 2026):** `select count(*) from card_orders` → **0**. `select count(*) from card_order_carts` → **0**. `select count(*) filter (where card_orders_enabled) from centers` → **0 of 2** centers currently have the feature flag on, so the broken insert has not yet been hit by a real customer. The bug is 100%-reproducing and would fire on the first center anyone flips the flag for.
     - *Second correction in place, same date.* This item's first draft read those two zeroes as *"no center has ever completed checkout, and no center has even started a cart"* and labelled the pair **"not inferred"**. The counts are verified; the word **"ever"** was not — it was inferred from a present-tense `count(*)`, which is exactly the move rule 2 exists to stop, made inside the finding that complains about it. The lifetime evidence, such as it is: `pg_stat_user_tables` (database stats last reset **2025-12-08**, so a ~239-day window) gives `card_order_carts` `n_tup_ins` **0** — the cart half of the claim holds — but `card_orders` `n_tup_ins` **6**, `n_tup_del` **6**. Six rows were inserted into `card_orders` and deleted again inside that window. The only insert path into that table other than checkout is the E2E seed (`tests/e2e/setup/seed.ts:154`), whose `CLEANUP_TEST_DATA=1` teardown deletes exactly what it wrote — an insert/delete cycle matching the counters. So the load-bearing claim survives (**no customer order has ever existed**, and the flag has never been on for anyone), but "0 rows, ever" is not what the catalog says, and should not be repeated as though it were.
  4. **The read-path breakage is also wider than "the PDF route."** `loadCardOrderDetail.ts`'s `CARD_ORDER_DETAIL_COLUMNS` (shared by both `loadCardOrderDetailForCenter` and `loadCardOrderDetailForAdmin`) also selects `card_style` from `card_orders`. That means **the centre's own order-detail page** (`(dashboard)/orders/[orderId]/page.tsx`) and **its API route** (`/api/orders/[orderId]/route.ts`) — squarely inside `Merged-Center-Orders` §02, not an admin screen — 42703 and 404 unconditionally too, the same failure F26 attributed only to the admin PDF route.
  5. **A second `card_style` *write* site, found while re-checking the counts above:** `tests/e2e/setup/seed.ts:151` puts `card_style: 'dark'` into the paid `card_orders` row it seeds. It takes the same 42703 as checkout, but it **fails soft** — `if (oErr) console.warn(…)` and carry on — so the seed logs a warning nobody reads, skips the dependent `card_order_items` insert (consistent with that table's `n_tup_ins` of **0**), and reports success. No E2E spec asserts against `ORDER_PAID_ID` today, so nothing goes red; the seeded order simply is not there. Fix it in the same change as the column decision, or the E2E fixture stays quietly broken until someone writes the first card-orders spec and cannot work out why it sees no order.
- **Why not fixed this pass:** identical decision to F26's own — add `card_style` to `card_orders` (a migration; checkout already writes intent to a cart-level column and the design's whole Customize step depends on the value surviving into the order) vs. stop persisting/reading it (which quietly deletes the "choose a card colour" feature). Same two-way fork, same "needs Eyad" — this entry doesn't reopen that decision, it corrects the record on how much of the product is actually gated behind it: not one admin PDF button, but checkout completion itself plus the centre's own order-detail page.
- **Nothing built here for #1/#2/#4/#5** (all schema-decision-gated, per F26). **#4's downstream symptom that *is* schema-free was fixed this pass** — see F26 item #4 (`card_order_status_transitions.created_at` → `transitioned_at`) — done below.
- **Found:** 4 August 2026, Center-Orders survey (this pass).
- **Corrected:** 4 August 2026, adversarial re-verification of this entry against the live catalog. Two figures in the first draft were wrong and are fixed above — the column count (32 → **35**) and the unverifiable "0 rows, ever" (see #3). Everything else the entry asserts was re-checked and held: no `card_style` on `card_orders`, `card_style` present on `card_order_carts`, `transitioned_at` present and `created_at` absent on `card_order_status_transitions`, both row counts **0**, **0 of 2** centers flagged, and every code line number cited (`checkout/route.ts:189/192-194/198-201`, `loadCardOrderDetail.ts:29`). One new site was found in the process and logged as #5. Corrections live here rather than in the pull request that carried them.
- **Blocked by:** the same fork as F26 — add-column vs remove-read, Eyad's call. Not urgent today (0 centers enabled) but a silent time bomb: the first center flipped to `card_orders_enabled = true` gets a checkout flow that fails on step 4 every time, with no code-side signal other than a generic "Insert failed" toast.

## F26 item #4 · Fixed this pass — `card_order_status_transitions.created_at` renamed to `transitioned_at` everywhere it was read
- **What was wrong:** the table has `transitioned_at`, not `created_at` (confirmed live). Three read sites and one component ordered/sorted/rendered by the nonexistent column: `loadCardOrderDetail.ts` (`buildHydratedPayload`'s transitions query, and `derivePaidAtIso`), `cardOrderState.ts` (`enrichLatestTransitionRow`), and `CardOrderStatusTimeline.tsx` (`TransitionLite.created_at`, `latestTimeForStage`) — the last one is the exact component `Merged-Center-Orders` §02 draws as the per-stage timestamp under each timeline stage ("02/07/2026 · 4:12 PM"). Live, every per-stage timestamp in the design would have rendered blank forever, and `enrichLatestTransitionRow`'s audit enrichment (`transitioned_by`, `reason`, `metadata`) silently never wrote.
- **Fix:** renamed `created_at` → `transitioned_at` in all four sites, no schema change, no behavior decision — exactly the "free fix" the original F26 called out. `derivePaidAtIso`'s sort/lookup and `CardOrderStatusTimeline`'s `TransitionLite` type were both updated to match.
- **Caveat, stated plainly:** this fix is currently unreachable in production — the outer `card_orders` select in `loadCardOrderDetailFor{Center,Admin}` already 42703s on `card_style` (F28) before `buildHydratedPayload` is ever called, and zero orders exist to display regardless. It is still correct to land now: once F28's column decision resolves, this piece won't need revisiting. **Not included in this fix:** `src/app/[locale]/(admin)/admin/card-orders/[orderId]/AdminCardOrderDetailClient.tsx` (Admin-Platform territory, excluded from this wave) has the identical `created_at`/`to_status` pattern and will need the same rename whenever Admin-Platform's own pass touches it.
- **Files:** `src/lib/loadCardOrderDetail.ts`, `src/lib/cardOrderState.ts`, `src/components/orders/CardOrderStatusTimeline.tsx`, `src/app/[locale]/(dashboard)/orders/[orderId]/OrderDetailClient.tsx` (local type annotation only).
- **Verified:** `tsc --noEmit` clean, `eslint` 0 errors, `i18n:check`/`check:bidi`/`check:tolocale` all OK, `vitest run` 1597/1597 passing (no existing test coverage on this path — none broken, none added, since there's no live data path to exercise it against yet per the caveat above).

## F29 · A literal comma (`,`) is used as the "missing value" fallback in well over 100 call sites across the codebase, instead of a real placeholder
- **What:** a huge number of `?? ','` / `|| ','` expressions render a bare comma character in place of missing data — e.g. `orders/[orderId]/OrderDetailClient.tsx` (pre-fix): `{t('orderedAt')}: {order.created_at ? formatDateTime(...) : ','}` renders literally **"Ordered: ,"** if the date is ever missing; `checkout/success/[orderId]/CheckoutSuccessClient.tsx` (pre-fix): `{t('delivery')}: {order?.delivery_governorate ?? ','}, {order?.delivery_address?.trim() || ','}` would double up to **"Delivery: ,, "** if both are empty. A repo-wide grep for the two exact patterns returns **over 100 matches across 30+ files** — `centerNotify.ts` alone (WhatsApp message bodies sent to real parents and centre owners) has more than 25 instances, plus `invoiceTemplates.ts`, `generateInvoicePdf.ts`, admin billing/referrals routes, several cron jobs, and `billing/BillingPageClient.tsx`. There is a real, existing convention for this (`common.notAvailable` = "N/A" / "غير متاح"), so this isn't a missing-key problem — something (most likely a mechanical batch edit, possibly a bad find/replace targeting an empty-string fallback) silently substituted a stray comma in its place, repo-wide, at some point before this pass.
- **Why this is worth a dedicated line item rather than a silent fix:** the pattern is systemic and spans money-adjacent code (invoices, WhatsApp payment reminders, billing) that is out of `Center-Orders`' territory and, per this wave's rules, not this pass's to touch. Fixing it broadly risks colliding with the parallel agents currently working those same files.
- **Fixed this pass, in-territory only** (files that are unambiguously `Merged-Center-Orders`' own screens, not shared with any other design file): `orders/[orderId]/OrderDetailClient.tsx`, `orders/checkout/review/page.tsx`, `orders/checkout/payment/page.tsx`, `orders/checkout/success/[orderId]/CheckoutSuccessClient.tsx`, `components/orders/CardOrderCartItemRow.tsx` — all `,` fallbacks replaced with the existing `common.notAvailable` i18n key. No new translation keys added; i18n parity gate still green.
- **Not fixed, logged instead:** every instance outside those 5 files, including the identical pattern in the admin card-order detail client (`AdminCardOrderDetailClient.tsx`, Admin-Platform territory, excluded this wave) and the ~25 instances in `centerNotify.ts`/`invoiceTemplates.ts`/`generateInvoicePdf.ts` (Center-Money/Admin-Money/Teacher-Money territory, several of them protected files). Worth the same dedicated cross-file pass as the i18n data-quality audit below — arguably higher priority, since some of these render in real outbound WhatsApp messages to parents, not just internal admin screens.
- **Found:** 4 August 2026, Center-Orders survey (this pass).
- **Blocked by:** nothing technical for the in-territory fix (done). The repo-wide cleanup needs a single owner sweeping all 30+ files at once rather than N separate agents each patching their own corner — recommend treating it like the i18n audit note below.
## F32 · `Merged-Center-Setup` §05 Support — three of four "HELP" rows and "App version" have no live destination
- **What:** the design's Support screen draws four rows under HELP (Help center, Report a problem, Request a feature) plus an ABOUT group (App version, Terms & privacy). Live's `/settings/support` (re-read fresh, 4 August 2026) has WhatsApp support, email support, and Terms/Privacy links — a real, working subset — but **no route, page, or destination of any kind exists anywhere in `src/` for "Help center," "Report a problem," or "Request a feature"** (grepped case-insensitively for all three phrases and their obvious slugs; zero hits beyond the design file itself). `package.json`'s `version` field (`0.1.0`) is never surfaced to the client anywhere — there is no `NEXT_PUBLIC_APP_VERSION`/equivalent, so an "App version" row has nothing real to read either.
- **Why not built this pass:** the honest options are equally bad without a decision — a "Help center" row is either a fabricated dead end (rule: never fake a destination) or repoints to WhatsApp/email, which already have their own rows two lines up and would just duplicate them; "Report a problem"/"Request a feature" have the same choice. None of the three has content of its own (no FAQ articles, no ticket queue, no feature-request backlog) to justify existing as separate rows. Exposing `package.json`'s version is mechanical but purely cosmetic and was left alone rather than bundled into an otherwise-blocked section.
- **Found:** 4 August 2026, Center-Setup parity survey.
- **Touches:** none — no schema. This is a product-scope call (build real destinations for the three HELP rows, collapse them into the two real channels that already exist, or drop them from the design), not a display fix.
- **Blocked by:** Eyad's call on what, if anything, "Help center" / "Report a problem" / "Request a feature" should actually do.

## F33 · `Merged-Center-Setup` §04 Subjects & grades — the design's on/off toggle and the entire Grades concept have no backing schema
- **What:** the design's Subjects & grades screen draws subject chips that toggle on/off (deactivate without deleting) plus a separate GRADES group (G7–G12, independently toggled) with its own helper copy ("Only the grades you turn on show up in student sign-up"). Live's `/settings/subjects` (re-read fresh, 4 August 2026) only supports add/rename/delete of a flat subject list — confirmed live: `public.subjects` has exactly `id, center_id, name, monthly_fee, created_at`, no `is_active`/`enabled` column. **No grades table of any kind exists in the live catalog** (`information_schema.tables` search for `%grade%` returns only the unrelated `upgrade_log`).
- **Why not built this pass:** an on/off toggle needs a new boolean column (and a decision on what "off" means for students already assigned that subject — the existing `subjectInUse` delete-guard has no equivalent for deactivation); Grades needs an entirely new table plus a decision on how it interacts with `students`' existing free-text/enum grade field, if any. Both are schema changes, not display fixes.
- **Found:** 4 August 2026, Center-Setup parity survey.
- **Touches:** `subjects` table (new column) for the toggle; a new table for Grades. No protected file.
- **Blocked by:** Eyad's call on whether either concept ships, and if so, its exact shape — this is not a naming exercise, `is_active` alone doesn't answer what happens to students already on a deactivated subject.

## Found, not yet formally logged — cross-file i18n data-quality audit
- **Dozens of `ar.json` values across many top-level namespaces are literal English placeholders or half machine-translated** ("Confirmed", "Last30Days", "Sparkline عنوان", "Trend صعود Suffix", etc.) — found while surveying `Center-Setup` (PR #282), where several of the worst examples turned out to be **mis-homed under the `settings` namespace but actually rendered by `Center-Home`'s dashboard widgets** (`PlanUsageCard`, `/dashboard`), not any Center-Setup screen. Left untouched by that pass (out of `Center-Setup`'s file territory, and touching them risked colliding with `Center-Home`'s own concurrent PR). Not yet scoped to a single file or given a code — worth a dedicated cross-file i18n audit rather than folding piecemeal into whichever file's sweep happens to trip over the next instance.
- **Addendum, 4 August 2026, Center-Orders survey:** the same mis-homing shows up under the `cardOrders` namespace too — roughly 30 keys (`cardOrders.assignGroups`, `.bluetooth`, `.camera`, `.billingDesc`, `.manageTeam`, `.resetPassword`, etc.) are English/half-translated and semantically belong to Center-Setup/scanner-permissions screens, not card orders. Checked every one against its real render site (`grep` for the key name across `src/`): **none of them are ever read by a `cardOrders`-namespaced `useTranslations()` call in any live component** — they're dead, orphaned JSON, not a live Arabic-in-production bug on any Center-Orders screen. The two keys that looked at first like real card-order copy — `cardOrders.orderSummary` ("Order Summary", English) and `cardOrders.paymentNote` (full English sentence) — are dead too; neither string appears anywhere in `src/`. Left untouched (touching `messages/*.json` risks colliding with whichever other agent owns the namespaces these keys actually belong to); logged here as further evidence for the audit above.

## Found, not yet formally logged — CEO survey findings needing a closer look
- **A second CEO dashboard exists — resolved, 31 July 2026, PR #288: it's dead code, not a live duplicate.** `/ceo` (surveyed here) and a separate `/ceo-dashboard` (`src/app/[locale]/(admin)/ceo-dashboard/CeoDashboardClient.tsx`, backed by its own `/api/ceo/financials`, `/api/ceo/growth-panel`, `/api/ceo/health-panel`, `/api/ceo/mrr`, `/api/ceo/command-strip` routes) were flagged as a possible `DUPLICATE-ROUTES.md`-style pair since `/ceo-dashboard`'s own client hadn't been read in full yet. It has been now: `(admin)/ceo-dashboard/page.tsx` is a hard `redirect()` to `/ceo` that never renders `CeoDashboardClient.tsx` — the whole cluster (4 components + 5 API routes) is confirmed unreachable, not a live pair needing a decision. Left in place (9 files, outside `Merged-CEO.html`'s 3 design sections) rather than deleted in this pass — a cleanup candidate, not a decision point.
- **Section H of `/ceo` is dead weight, not a security control.** A hardcoded client-side string (`'CENTERHQ-ADMIN'`, visible in the shipped JS) gates 4 "danger" buttons that set the exact same `platform_config` keys already exposed as plain checkboxes in Section G — the real protection, `requireSuperAdminApi`, is server-side and identical either way. Section H adds confusion (a fake sense of an extra security layer) without adding any actual one. Likely worth deleting outright rather than "fixing" — a product call on whether Section H should exist at all, not made here.
- **`legacyPayload` in `/api/ceo/dashboard` — CLOSED, PR #288.** Built a full extra response object (`mrr, arr, netNew30d, monthlyChurnRate, ...`) that nothing in `page.tsx` read — confirmed by a fresh full grep of the only reachable caller before removing — yet drove 7 real extra Supabase queries every 30-second poll, plus unused `from`/`to` range-param parsing that only fed them. Removed; the route now returns exactly `CeoDashboardData`, the type it already claimed to satisfy.
- **The sales-lead form hardcodes `governorate: 'cairo'`** with no field to change it — every lead entered through the CEO dashboard is tagged Cairo regardless of where the center actually is. Needs a real governorate selector, not a one-line fix.

### Two missing columns found while building `Merged-CEO` §01/§02 — 5 August 2026, `claude/parity-ceo-w17`

Both stop a designed figure, both need schema, so under the standing migration rule neither was
written. Named here precisely so the decision can be made without re-deriving them.

- **No teacher payout record exists anywhere — blocks `Merged-CEO` §02's "Paid out" KPI.** The design
  draws money paid out to teachers alongside fee revenue. There is no table that records it. Checked
  every candidate live: `payout_requests` is **`center_id`**-scoped (`id, center_id, amount_requested,
  status, payment_method, payment_details, requested_at, processed_at` — no `teacher_id`), and
  `commission_payouts` is **`staff_id`**-scoped, i.e. internal sales-staff commission, not teachers.
  A `%teacher%|%payout%` sweep of `information_schema.tables` returns ten tables and none of them is a
  teacher payout ledger. **Needs:** a new `teacher_payouts` table (or a `teacher_id` path on
  `payout_requests`). Not written — new schema, comes to Eyad. Related: X1 (Paymob split payouts) and
  `design/PAYOUT-SYSTEM-SPEC.md` cover the same ground from the payments side.

- **Teacher cancellations have no date, so platform churn cannot be computed — narrows `Merged-CEO`
  §01's churn and net-new tiles to centers only.** `centers.cancellation_approved_at` exists and dates
  a center cancellation cleanly. `teacher_subscriptions` has **no cancellation timestamp at all** — its
  30 columns include `created_at` and a `status` that can read `'cancelled'`, but nothing records
  *when* it became cancelled, and a `%cancel%|%churn%|%ended_at%|%deactivat%` sweep across the whole
  public schema returns only `card_orders.cancelled_at` and the three `centers.cancellation_*` columns.
  A status with no timestamp cannot be bucketed into a month. **Built as center-scoped and labelled
  that way in the UI** (`ceoBoard.basis` says so in both locales) rather than counting center churn and
  presenting it as platform churn, which would have been a fabricated figure of exactly the kind rule 1
  exists to prevent. **Needs:** `teacher_subscriptions.cancelled_at timestamptz`. Not written.

## F35 · The schema-drift gate cannot verify a REVOKE at all, and goes green on the exact class of change it exists to catch

- **What:** `.github/workflows/schema-drift.yml` runs `scripts/schema/rebuild.sh` — apply `test-shim.sql`, then every `supabase/migrations/*.sql` in lexical order against an **empty** database — and diffs the introspected result against the committed `db/schema.snapshot`. **Neither side is production.** The gate proves *migrations produce snapshot*. It proves nothing about the live catalog, and for grant changes it cannot even prove that much.
- **Why a REVOKE specifically is invisible.** Supabase issues default `EXECUTE` privileges to `anon` and `authenticated` on functions in `public`. **Those grants do not exist in a local rebuild** — nothing creates them. So a migration whose entire purpose is `REVOKE ... FROM anon` removes something that was never there, produces **zero** diff, and the gate reports success. The statement is a no-op locally and load-bearing in production, and the gate reads the no-op.
- **This is not hypothetical — it is how the defect below shipped.** `20260804120000` (applied as `20260804094631`) contained `REVOKE ALL ON FUNCTION public.sessions_derive_center_id() FROM PUBLIC` under a comment claiming it satisfied the standing *revoke anonymous EXECUTE on SECURITY DEFINER helpers* rule. `REVOKE ... FROM PUBLIC` removes only the implicit `PUBLIC` grant; the explicit `anon` and `authenticated` entries are separate ACL rows and survived it. Live `proacl` after that migration ran: `{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}`. **schema-drift was green throughout.** It could not have been anything else.
- **The asymmetry that makes this worse than a plain blind spot.** A `GRANT` *does* show up — it creates a `ROUTINE_GRANT` line in the rebuild, so the gate fails if the snapshot is stale. A `REVOKE` of a Supabase default does not. **So the gate is green when a privilege is wrongly retained, and red when one is correctly added.** It fails in the safe direction and passes in the dangerous one. Confirmed on 4 August by rebuilding the follow-up migration three times on a clean Postgres 17.10: the revoke-only draft produced a byte-identical snapshot (6242 objects); the archive-idiom version, which adds `GRANT EXECUTE ... TO authenticated, service_role`, produced exactly two added lines (6244) and turned the gate red until the snapshot was regenerated.
- **`schema-drift-live.yml` is the workflow that would catch it, and it has never run.** It compares the LIVE catalog against the snapshot. It has failed on every scheduled run from 28 July through 4 August — eight consecutive days, zero successes — every one on its own missing-secret guard: `SCHEMA_DRIFT_DATABASE_URL is not set, so the live schema-drift gate CANNOT run`. That guard is correct behaviour (it was deliberately built to fail loudly rather than skip green), but the consequence is that **production has not been machine-compared to the snapshot on any day in this window.**

### The rule, which is the point of this entry

> **A grant or revoke change is not verified by CI. `schema-drift` green is not evidence for it.**
> Any migration containing `GRANT`, `REVOKE`, `ALTER DEFAULT PRIVILEGES`, or an `OWNER TO` change must be confirmed by querying the **live** catalog after applying — `pg_proc.proacl`, `aclexplode()`, `information_schema.role_routine_grants`, `pg_class.relacl` — and the result recorded. Not inferred from the statement succeeding, and not inferred from a green gate.

The same applies to any post-apply verification query written into a migration: the §6 block in `20260804120000` checked `grantee='PUBLIC'` and returned a reassuring `0` while the real gap sat one grantee over. **A verification query that only checks the thing you already believed is not a verification query.**

### What would actually close it

1. Wire `SCHEMA_DRIFT_DATABASE_URL` (a read-only prod DSN — `USAGE` + `SELECT` on catalogs is enough) so `schema-drift-live.yml` runs. This is the single highest-value fix and needs no code.
2. Extend `scripts/schema/test-shim.sql` to create the `anon` / `authenticated` / `service_role` roles **and** Supabase's default `EXECUTE` grants, so a local rebuild has something for a `REVOKE` to remove and the diff becomes meaningful. Without this, item 1 is the only real defence.
3. Treat a grant-touching migration as requiring a recorded live-catalog check before its PR merges, the same way rule 5 already treats the apply itself.

- **Found:** 4 August 2026, while correcting the `sessions_derive_center_id` grant. Found by querying the live catalog, not by any gate — which is the entry's own evidence for itself.
- **Related:** F26 (code reading columns that do not exist — same root cause, CI has no live database), and the `20260804210000` follow-up migration, whose header carries a short form of this note.
- **Blocked by:** nothing technical for items 2 and 3. Item 1 needs Eyad to add the repo secret.

---

## F39 · Two of the three per-student notification flags are written by the UI and read by nothing — a paid-WhatsApp opt-out that only works for one channel

*(F-number picked by grepping `^## F[0-9]+` across `refs/remotes/origin` — all 206 refs, not just
`master`, per F31's warning. Claimed across every branch as of 5 August: F1–F37 with no gaps above
F25. F39 is the lowest free number: master ends at F35, #348 claimed F36 and F37, and #349 claimed F38 while this branch was in flight.)*

- **What:** `students` carries three per-student notification booleans — `notify_on_scan`,
  `notify_on_absence`, `notify_on_balance` — all confirmed present in
  `information_schema.columns` for project `lczmjpnbuhnsislcvzar` this pass, all `boolean`,
  all nullable. Two of the three gate nothing.
  - **The only send-path reader in the codebase** is `src/lib/whatsapp/flows/parentNotifications.ts`
    line 82: `if (!s.parent_phone || !s.parent_consent_given || s.notify_on_scan === false)`.
    That is `notify_on_scan`, and only `notify_on_scan`.
  - `src/app/api/cron/parent-absence-alerts/route.ts` selects
    `students(id, name, parent_phone, parent_pack_opted_in, is_active)` and gates with
    `if (!s.parent_pack_opted_in) continue;` — it never selects `notify_on_absence` and never
    tests it.
  - `src/app/api/cron/parent-balance-alerts/route.ts` selects `id, name, parent_phone, center_id`
    filtered `.eq('parent_pack_opted_in', true)` — it never selects `notify_on_balance` and never
    tests it.
  - The only other read anywhere is `src/app/api/ceo/financials/route.ts` line 174, an
    `.or('notify_on_scan.eq.true,notify_on_absence.eq.true,notify_on_balance.eq.true')` used for a
    CEO-side count. A reporting filter, not a send gate.
  - Writers, by contrast, are plural and live: `PATCH /api/students/[id]` allow-lists all three,
    `PATCH /api/whatsapp-pack/student/[studentId]` writes all three, and both
    `api/teacher/private/schedule/sessions/route.ts` and its
    `[sessionId]/attendance/route.ts` sibling insert all three as `false` on student creation.
- **Why this is not cosmetic:** these flags sit on a **paid** WhatsApp surface. Turning
  `notify_on_absence` or `notify_on_balance` off is a request to stop paying for those messages,
  and the request is stored and then ignored — the parent still gets the message and the center is
  still charged. Nothing errors; the write succeeds and the column is faithfully wrong.
- **Instance eight of the F16 shape**, on the write side rather than the read side: a column that
  looks authoritative to every caller, is maintained by three separate writers, and is consulted by
  none of the jobs it names. F16 catalogues readers preferring a frozen column over the live helper;
  this is the mirror — writers maintaining a column no reader consults.
- **Why it is NOT fixed here:** wiring the two flags into their crons changes **who receives a paid
  WhatsApp message**. That is the identical axis **D25** is already open on for
  `parent-balance-alerts` targeting, and it is money behaviour under the standing stop rule. Logged,
  not touched. Note also that flipping them on today would *reduce* sends, never increase them, so
  the fix direction is safe — but "safe direction" is not the same as "mine to decide".
- **What it cost this pass, concretely.** `Merged-Center-Students` §03 draws a **"Who receives
  what"** section — two rows plus a bottom sheet — and it is the one whole block of that section
  left unbuilt. Both halves are blocked, each for its own named reason:
  1. **The WHO has no column.** `students` is 39 columns live (read in full this pass); none of them
     is a per-channel recipient. `phone` and `parent_phone` are contact fields, not a selector —
     nothing records *which* of them a payment link goes to. The design's "Payment links · One
     person only → Parent" needs a new column (e.g. `students.payment_link_recipient`), and its
     sheet's third option, "Another number · Add a different contact", needs somewhere to store
     that number as well. **New column ⇒ stops here under the migration rule.**
  2. **The WHAT could not be substituted honestly.** The obvious near-miss was to back the
     "Reminders and updates · Session, absence, receipts" row with the three `notify_on_*` flags,
     whose names line up almost exactly with that sub-label. This entry is why that was rejected:
     a three-way control where two switches do nothing is a fabricated control, and a fabricated
     control on a screen about who gets charged for messages is worse than an absent section.
- **Found:** 5 August 2026, `Merged-Center-Students` build pass, while checking whether §03's
  "Who receives what" had any live backing. Found by reading the two crons, not by trusting the
  column names.
- **Build:** decide (D25) what the balance/absence targeting model is, then either honour the two
  flags in their crons or drop the columns and their writers. Until one of those happens, do not
  put a UI on them.
- **Blocked by:** D25, and the standing money-behaviour stop.

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

---

## F36 · `Merged-Center-Insight` §01's collection-rate month-over-month delta has no backing column anywhere

- **What:** §01's EN-overview frame badges the Collection-rate KPI tile `+4%` and repeats it under the
  gauge as "Up 4% on May". Both are a comparison against the PREVIOUS month's collection rate.
- **Found:** 5 August 2026, `Center-Insight` build pass, while wiring everything else on §01 that was buildable.
- **Evidence, live, not inferred:** `select table_name, column_name from information_schema.columns
  where table_schema='public' and column_name ilike '%collection%rate%'` returns **zero rows** —
  project `lczmjpnbuhnsislcvzar`, run this pass. No table stores a collection rate, historical or
  current. The figure the screen shows is computed per request in `/api/analytics/revenue`
  (`collectedThisMonth / expectedThisMonth`), and `expectedThisMonth` is built from
  `getStudentBalances(...)`, a **running** balance across active students with no as-of-date variant.
  There is therefore nothing to reconstruct last month's denominator from.
- **Why it is not "just add a delta":** the MRR tile's delta is honest because `mrr_trend` stores six
  months of actual collected totals. Collection rate has no equivalent series. Any month-over-month
  figure would have to invent a second, different denominator methodology for the prior month and
  present the difference between two incompatible bases as a trend — the same class of error as D33,
  arrived at from the other direction.
- **Built this pass:** nothing. The tile and the gauge card ship without the delta.
- **Blocked by:** needs a stored monthly collection-rate series (a snapshot table or a
  `month_end_expected` column), i.e. **a migration** — so it stops here under the standing rule rather
  than being written.

## F37 · §01's P&L "Teacher cuts" line has no backing column — only the centre's half of the split is stored

- **What:** §01's P&L card breaks expenses into two named lines, "Teacher cuts" (−6,900) and
  "Rent + costs" (−3,200). The live `PnLCard` has the second (`center_expenses.rent/salaries/
  utilities/other`) and not the first.
- **Found:** 5 August 2026, same pass, checked before assuming it was unbuildable.
- **Evidence, live:** a catalog scan for `%teacher_cut%`, `%teacher_share%`, `%commission%` and
  `%center_cut%` across `information_schema.columns` returns, for the centre-class side, exactly one
  relevant column: **`student_groups.center_cut_egp`** — the CENTRE's flat cut, not the teacher's.
  `transactions.teacher_commission_amt` exists but belongs to the payment-provider ledger, not the
  centre's own P&L. There is no stored teacher-cut amount per group, per session or per payment.
- **Why the obvious derivation is refused:** teacher cut *could* be inferred as (group fee −
  `center_cut_egp`) × students. That inference IS the open flat-cut-versus-percentage-split question,
  **D16**, and D16's own entry records the centre-class commission engine as dormant — every teacher's
  "Owed" figure reads 0.00 today. Deriving a P&L expense line from a dormant engine would put a
  confident money figure on screen that no other surface in the product agrees with.
- **Built this pass:** nothing. P&L keeps its existing income / expenses / net shape.
- **Blocked by:** **D16**, plus a stored per-group teacher-cut amount, i.e. a migration.

## F45 · A real aging report needs per-invoice allocation, which does not exist — the bands are a FEATURE, not a gap — proposed 5 August 2026

- **What the design asks for.** `Merged-Center-Insight` §01's "Aging · outstanding" card (L326-331) draws three age bands — `0–30`, `31–60` (`watch`), `60+` (`overdue`) — each with that band's outstanding total. That is a genuine aging distribution: **one student's balance splits ACROSS bands** according to when each unpaid charge fell due.
- **Why it cannot be built on today's data.** Two independent reasons, both read in the code rather than inferred:
  - `amount` is `balances.get(id).balance` from `getStudentBalances(...)` (`src/app/api/analytics/revenue/route.ts:159-168`) — **one running total per student**. It carries no internal structure, so there is nothing to split.
  - `days_overdue` is **one proxy age per student**: `Math.max(0, (now − (lastConfirmedPayment + 30d)) / day)`, falling back to the first of the current Cairo month when the student has never paid (`route.ts:272-283`). One age per student cannot describe a balance that accumulated over several months.
- **It was built once, and that was the defect.** An earlier version of this pass grouped the API rows on `days_overdue` and summed `amount` per band. The result asserted a distribution the data cannot produce: **a student five months in arrears who paid anything 20 days ago had their entire balance rendered under `0–30`.** It was also degenerate in production, not merely imprecise — `select count(*) from payments` returns **0**, so every student takes the first-of-month fallback, every balance lands in `0–30`, and `31–60` and `60+` printed **EGP 0 unconditionally, for every centre**. Caught in adversarial re-verification of PR #348 and reversed.
- **Eyad's call, 5 August 2026, verbatim:** *"Aging card: empty state. Not a relabel, not the current chart. A relabel keeps a distribution the data can't produce."* And: *"Zero rendering unconditionally in two bands is worse than nothing, because zero reads as a fact."*
- **Built this pass:** an honest empty state in the card's position — the section title and one line saying age bands are not available and why, **with no figure of any kind**. A zero here would be a claim about the world ("nothing is that old"), not about the data. The per-student table below is untouched: it predates the pass and is real per-student data.
- **What would unblock it — this is the migration to approve.** Aging needs a per-charge ledger with a due date and a remaining amount, so a payment can be allocated against specific charges oldest-first and the residue aged by charge. The minimum shape:

```sql
-- PROPOSED, NOT APPLIED. Rule 5: Eyad applies by hand, then the code deploys.
create table public.student_charges (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references public.centers(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  due_on       date not null,                    -- the date the band is measured from
  paid_amount  numeric(12,2) not null default 0 check (paid_amount >= 0),
  source       text not null,                    -- 'group_fee' | 'manual' | ...
  created_at   timestamptz not null default now(),
  constraint student_charges_not_overpaid check (paid_amount <= amount)
);
create index student_charges_aging_idx
  on public.student_charges (center_id, due_on)
  where paid_amount < amount;

alter table public.student_charges enable row level security;
-- RLS ships in the same migration, per the tenancy rule: scope by center_id
-- derived from the caller's users row, never from a caller-supplied value.
```

  Plus an allocation path (a payment consumes open charges oldest-first) and a backfill decision for the balances that already exist. **None of that is written.** This entry exists so the card is understood as an unbuilt feature with a known cost, not as a parity hole someone can close with a client-side `groupBy`.
- **Blocked by:** the migration above, plus a decision on how existing running balances are apportioned into charges at cutover.

## F46 · The analytics revenue window was the SERVER's calendar month while its header said Cairo — FIXED, 5 August 2026

- **What:** `/api/analytics/revenue` built every window from `new Date()` — `new Date(now.getFullYear(), now.getMonth(), 1)` for the month start, the same for the six trend buckets (`route.ts:210-213`) and for the aging fallback (`route.ts:267`). That is the **server's** calendar month, and the server is **UTC on Vercel**. Meanwhile `analytics/page.tsx` labelled that same window with `formatCalendarMonthYyyyMmInCairo()`.
- **Why it is a defect and not a naming quibble:** Cairo is UTC+2/+3, so it enters a new month two or three hours before UTC does. **From 22:00/23:00 UTC on the last day of a Cairo month until 00:00 UTC, the header read the NEW month while `mrr`, the trend's emphasised final bar and the aging fallback were all still computing the OLD one.** A payment taken at 00:30 Cairo on the 1st was excluded from the month the header claimed to be showing.
- **The comment asserted the opposite of the code.** `analytics/page.tsx` carried "Cairo month, per the standing rule — the API windows on the server's calendar month and this label must not disagree with it by a timezone", which describes the bug as though it were the rule. Corrected in place.
- **Fix:** new Cairo month helpers in `src/lib/cairo/day.ts` — `cairoMonthKey`, `cairoMonthKeyPlusMonths`, `startOfUtcInstantForCairoMonth`, `cairoMonthUtcBounds` — sitting alongside the existing day helpers and reusing their binary search, so a **DST transition inside a boundary stays correct** rather than assuming a fixed offset. `/api/analytics/revenue` now takes its month start, its six trend keys, its per-payment bucketing and its aging fallback from those. Bounds are half-open `[start, endExclusive)`; the old `monthEnd` was the last day at `23:59:59`, which silently dropped anything in that final second.
- **Pinned by a test that would have failed before:** `tests/unit/cairoMonthWindow.test.ts`, 12 assertions, all **absolute values rather than re-derivations**. The suite runs `TZ=UTC` — the exact environment where this bug is invisible to a naive test — and it asserts that `2026-07-31T22:30:00Z` is Cairo **August**, that a 23:30-Cairo payment on the 31st stays in that month, that adjacent months meet exactly with no gap or overlap, and that Cairo October spans `31 × 24 + 1` hours because the autumn DST shift falls inside it. A fixed-offset reimplementation returns 744 and fails that last one.
- **Found:** 5 August 2026, adversarial re-verification of PR #348.

## F47 · `referral_reward_records` and its only writer retired — code removed 5 August 2026, table dropped by hand

- **Why this exists as its own entry.** D22 established `referral_commissions` as the canonical referral ledger and moved the three read sites onto it. That left a dead table with a live writer still able to fill it, which is worse than either state alone: a second ledger that nothing reads but something can still write is exactly how two sources of truth for the same money diverge in the first place. Eyad's instruction, 5 August: *"Retire calculate-rewards and referral_reward_records once the three read sites move."*
- **Order matters, and this is the order.** The writer goes first, the table second. Dropping a table while a route can still `upsert` into it turns a dead feature into a 500 on a money path.
  1. **`POST /api/referrals/calculate-rewards` — DELETED** (`src/app/api/referrals/calculate-rewards/route.ts`, 172 lines). Verified before removal, not assumed: `grep -c calculate-rewards vercel.json` returns **0**, so it had no cron registration, and the only references anywhere in `src/` were comments describing it as dead. Its auth test (`tests/unit/api/referrals-calculate-rewards-auth.test.ts`) goes with it — a test for a route that does not exist is not coverage.
  2. **Backup set entry removed** (`src/lib/googleDriveBackup.ts`). `referral_reward_records` was in `FULL_EXPORT_TABLES`; a backup job listing a dropped table fails the export. **Nothing is lost:** `referral_commissions` was already in the same array (it appears further down the list), so the canonical ledger continues to be backed up. Checked for a duplicate entry after the edit rather than assuming — an earlier attempt at this change replaced the line instead of deleting it and would have listed `referral_commissions` twice.
  3. **The DROP is Eyad's to apply by hand** — `supabase/migrations_proposed/PROPOSED_drop_referral_reward_records.sql`. Rule 5: merging the file does not apply it.
- **Five comments moved from present to past tense.** `admin/referral-rewards/route.ts`, `referrals/payout/route.ts`, `referral/route.ts`, `lib/referralCommissionStatus.ts` and `tests/unit/referralCommissionStatus.test.ts` all described the writer as something that *has* no cron and *is* uncalled. Once the route is deleted those sentences are false in a way that would mislead the next reader into looking for a file that is not there.
- **The fee arithmetic is untouched and stays pinned.** `computeReferralPayout`'s 1000 EGP minimum gross, flat 20 EGP fee and 5% rate are unchanged by this removal, and `tests/unit/referralPayoutFeeInvariance.test.ts` continues to fail if they move.
- **Blocked by:** nothing. The drop migration is the last step and is Eyad's to run.
## F38 · Schedule flags a false "room clash" between two slots that have no room at all
- **Found:** 5 August 2026, `Merged-Center-Groups` §05 build pass, while changing how a clash renders
  in the by-room board.
- **What:** `getConflictingSlotIds` and `conflictPartnerName` in `src/app/[locale]/schedule/page.tsx`
  both paired slots with `if (s1.room_id !== s2.room_id) continue;` and nothing else.
  `schedule_slots.room_id` is **NULLABLE** — verified in `information_schema.columns` on
  `lczmjpnbuhnsislcvzar`, `is_nullable = YES`, not inferred from the TypeScript type, which declares
  it `string` and is wrong. `null !== null` is `false`, so two room-less slots overlapping in time
  fell straight through the guard and were both marked a **room** clash, red stripe and all, naming
  each other as the double-booked partner.
- **Why it is a real defect and not a hypothetical:** the by-time day list turns the whole meta line
  into "· clash · overlaps ·", so the centre loses the room and headcount line and gains a warning
  about a room neither session is in. Nothing about it looks like a bug from the screen.
- **Why it is not a live wrong number today, stated precisely:**
  `select count(*) filter (where room_id is null) as null_room, count(*) as total from schedule_slots`
  returns `null_room = 0, total = 1`. Zero rows can trigger it right now. `handleAddSlot` requires a
  room, so the UI cannot create one — but the column permits it and the UI is not the only writer the
  table could ever have.
- **Fixed, no decision needed:** both loops now skip a slot with no `room_id`. Two room-less sessions
  are simply not a room clash. The two functions were changed together deliberately — if only the id
  set were guarded, a row could be striped red with no partner name to show.
- **Touches:** none (display + a derived set; no write, no money, no entitlement).
- **ID note:** `F38` is the lowest free number across `master` **and** the eleven open parity branches
  checked by `git grep -oE '^## F[0-9]+'` against each remote head
  (`center-insight-parity-20260804`, `center-whatsapp-s01-build`, `teacher-groups-build-w3`,
  `center-orders-build-gaps`, `teacher-setup-structural-build`, `teacher-students-tag-tone-w5`,
  `teacher-home-100`, `admin-platform-build-gaps`, `patterns-adoption-2026-08-04`,
  `admin-accounts-branches-last-active`, `parity-ceo-w2`). `master` ends at `F35`; **`F36` and `F37`
  are both claimed by PR #348** (`design/center-insight-parity-20260804`). Following F31's standing
  instruction to grep the open branches, not just `master`.

## Center-Groups · 5 August 2026 build pass — what was built, and the two things that stopped on a column

**Position going in, re-derived rather than trusted:** the recorded `~4.4/5` in
`FILE-COMPLETION-TABLE.md` was checked by reading all 1,316 lines of `Merged-Center-Groups.html`
against all four live route files fresh. Counted as **distinct drawn states** (Arabic frames are the
same state in the other language, not a separate one) the design draws **16**: §01 six (list,
detail·Members, detail·Waitlist, loading, empty, new-group), §02 two (verified list, billing sheet),
§03 three (grid, add-room, empty), §04 two (overview-with-one-expanded, add-branch), §05 three
(day·by-time, day·by-room, week grid). Live rendered **14.5 of 16** going in — everything except §02's
billing sheet, and only half of §02's verified list. That is **≈4.25/5** by section, close enough to
the recorded 4.4 to confirm the ledger rather than correct it.

**Built this pass.**
- **§05 by-room, the end-time tail.** Design lines 1169-1170 put "· to 6:00" on a *clashing* by-room
  row, not the by-time clash sentence — because the room is already the section header and the header
  already wears "▲ overlap", so the row spends its line on the fact the header cannot give you: how
  far each session runs. `schedule_slots.end_time` verified present (`time without time zone`).
  The red stripe stays, and the clash sentence moves to `aria-label`/`title` so the meaning is never
  colour-only.
- **§05 by-room ordering.** Rooms now sort by earliest session, free rooms last, ties by name — the
  design's own order (Room 2 at 3:00, Room 1 at 5:00, free Room 3). It was sorting by room name, which
  could open the board on a room with nothing in it all day.
- **§05 false-clash guard.** See **F38**.
- **§01 waitlist head of queue.** Design lines 522-524 give row 1 the filled primary Add and everyone
  behind it the quiet mint one. The list is ordered by `students.waitlist_position` in
  `GET /api/groups/[groupId]/waitlist` (read, not assumed), so "first" is the real next in line.
- **§02 verified chrome.** See the D12 note above.
- **Restyle to the design's tokens (step 4).** The token layer re-pointed the radius scale in
  `src/app/tokens.css` (`@theme static`: `sm 4→8, md 8→12, lg 12→16, xl 16→24`), so every
  `rounded-xl` written expecting Tailwind's stock 12px now renders **24px**. These four screens were
  full of them: the 34px group tile, the 42px add button on all four screens, the session row, both
  segmented controls, the week grid and its blocks. All moved onto the radius the design actually
  states (`.gdot` 12, `.gcard` 16, `.sess` 12, `.seg` 12 outer / 8 inner, `.wblk` 8, `.wg` 12,
  `.kpi` 12, `.rcard` 16, `.ricon` 12). Same pass: `bg-teal-100` on the Rooms icon tile resolves to
  `--color-mint-deep` (#bfe3dd, the accent *border*) where the design wants `--color-mint` (#dfeeeb,
  the accent *fill*); and `--color-border-subtle` (rgba(20,24,26,.06), a cool near-invisible hairline)
  gave way to `--color-line` (#e2ddd1) on the Rooms card, the session rows and the week grid, which is
  the warm rule the design draws and the rest of these screens already use.

**Stopped on a column — named, not hand-waved.**
- **§02 billing sheet + the basis chip** — `student_groups` has no `billing_basis`, no `monthly_fee`,
  no `bundle_sessions`. Full column list in the D12 note above. Migration ask, Eyad's.
- **§01 waitlist "Requested 09/07"** — `students` carries `waitlist_group_id` and `waitlist_position`
  and nothing else about the waitlist; there is no `waitlist_requested_at`. The only other waitlist
  table is `waitlist_notifications (id, student_id, group_id, notified_at, response)`, and
  `notified_at` is when the **centre messaged the parent**, not when the parent asked — using it would
  be a different fact wearing the design's label. `students.created_at` is when the student record was
  made, not when they joined a queue. Migration ask: a `students.waitlist_requested_at timestamptz`
  written by both waitlist-insert paths.
- **§03 the Lab flask glyph** — design line 872 gives "Lab 1" a different icon from "Room A/B/C".
  `rooms` is `(id, center_id, name, capacity, created_at)` — there is no room *type* or *kind* column
  to switch the glyph on, and switching on the room's **name** would be a guess dressed as data.
  Migration ask, or drop the glyph variation from the design.

**Unchanged and still blocking, re-verified not re-assumed.**
- **D23** — `select key from platform_config where key ilike '%branch%'` returns **no rows**;
  `branch_addon.monthly_price_egp` does not exist, so #313's config-gated add-on notice correctly
  renders nothing. The design's "199 EGP / mo" is still an unpriced model, still Eyad's.
- **D32** — the design's per-row promote is live and working; only the automatic WhatsApp-reply path
  is open.
- **F11** — `student_groups.capacity_cap` (integer) and `kind` (text NOT NULL) both still present in
  `information_schema.columns` on 5 Aug. Live distribution, checked directly: 4 groups, `kind` split
  2 `private` / 2 `center`, `capacity_cap` set on **0** of 4, `max_capacity` set on 1 of 4. Still zero
  references in `src/`. Not built: the teacher chip is derived from `student_groups.teacher_id` today
  and re-deriving it from `kind` would change which groups show the chip — a behaviour change needing
  the same drop-or-document decision, not a display fix.
## R13 · DECLINED, twice — `Merged-Teacher-Students` §01's brass group tag has no rule to key it off, and §02 has no brass tag at all

**Status: not built, and the reason is durable — this is not a backlog item waiting for effort.** `#310`
declined it (3 Aug) as *"no stated rule and no live column distinguishes them."* `#343` overrode that
refusal (4 Aug), built it as a hash, and was **rejected by Eyad for breaking the never-fabricate rule.**
This entry exists so a third pass does not re-litigate it from the design file alone.

### The two defects in `#343`, each re-verified from source this pass, not taken from the rejection note

**1. It painted an element into §02 that the design never draws there.** The `.tag.b` rule exists in
exactly one place in the whole file — line 99, under `.mgd1` (§01). `grep -c 'mgd2 .tag.b'` returns
**0**. §02's only tag rule is line 131, `.mgd2 .tag{…color:#0A514A;background:#DFEEEB;border-radius:999px}`,
and both of §02's tag instances — line 248 (EN), line 283 (AR) — are plain `class="tag"`. `#343` still
routed `students/[studentId]/page.tsx:274` (§02's `.ptags` pill) through the tint helper. **The brass
pill it shipped to §02 is an element with no design source of any kind.** Its PR body justified this by
asserting *"the design shows `Physics` mint in both sections"* — true but empty: §02 draws one tag total,
so it is evidence of nothing about a second tone.

**2. The tint encoded nothing, and its doc comment claimed otherwise.** `groupTagTone` was
`TONES[fnv1a(groupId) % 2]`. The comment shipped with it claimed *"one tone per group"* and *"it encodes
group identity and nothing else."* A two-element array indexed by a hash mod 2 delivers neither:

- **At two groups**, two distinct ids land on the *same* tone — measured **50.02%** over 200,000 random
  UUID pairs (FNV-1a/32 mod 2 is a fair coin on the low bit; this is the expected 1/2, not a tuning
  problem). One group in two renders a roster where both groups are the same colour.
- **At three or more groups**, at least two *always* collide. Pigeonhole: two tones cannot carry three
  identities. Nothing caps a teacher at two private groups.

A property that fails half the time at N=2 and always at N≥3 is not a property. **The doc comment was the
fabrication, not the colour** — it asserted a guarantee the code could not make.

### Why the hash looked like it worked, which is the trap worth recording

There is exactly **one** teacher with private groups live (`68718be7-059f-4fc9-b822-346de7651aab`), and
exactly two of them. Run the shipped hash over their real ids:

| Group | `student_groups.id` | Shipped hash sends it to |
|---|---|---|
| `Physics` | `267a63f9-e249-4210-8a8d-1306bd0c16e0` | **mint** `.tag` |
| `Physics Sun 4PM` | `990b9d87-e922-4203-a2bb-1b24df6c7177` | **brass** `.tag.b` |

That reproduces the design mock exactly — mock and live even share the two group names. **It is a coin
flip that landed right on the only case anybody could look at.** A 50% coincidence on a sample of one
read as confirmation. Anyone re-checking this against the live app will see the "correct" colours and
conclude the hash works; it does not, and the next group created flips a colour for no reason a teacher
can perceive.

> **Correction to the rejection note itself, since it must not propagate:** the note cited the live group
> as *"Physics 1" = `99e8ff21-b619-4b0d-a368-e38d081cc24c` → BRASS.* That row is real and does hash to
> brass, but its `kind` is **`center`**, not `private` — and `GET /api/teacher/private/students` filters
> `.eq('kind','private')`, so **"Physics 1" never renders in §01 at all.** The two rows above are the
> ones §01 actually draws. Separately, `public.groups` is a *different table* and is **empty (0 rows)**;
> the teacher portal reads `public.student_groups`. Verified live, `lczmjpnbuhnsislcvzar`, 5 Aug 2026.

### Why no honest version exists today

`information_schema.columns` for `public.student_groups`, live, 5 Aug 2026 — all 16 columns: `id`,
`center_id`, `name`, `subject`, `whatsapp_group_id`, `created_at`, `max_capacity`, `kind`, `teacher_id`,
`teacher_split_pct`, `fee_per_class`, `approval_mode`, `is_self_enroll_open`, `status`, `capacity_cap`,
`center_cut_egp`. **There is no `tone`, `colour`, `color`, `rank`, `priority`, `sort_order` or
`display_order` column.** Nothing in the schema says which group is brass.

Nor does the data. The two live private groups are **identical on every column that could carry a rule** —
both `status='active'`, both `subject=NULL`, both `approval_mode='manual'`, both
`is_self_enroll_open=false`, both `kind='private'`. They differ only in `id`, `name`, `created_at`
(13 Jun vs 20 Jul) and enrolled count (1 vs 0). None of those is tied to a tone by anything in the design.

Nor does the design. §01's masthead describes *"search plus a group filter, then each student with the
group they belong to and their contact number"* — no tone semantics anywhere. The brass appears on one of
three static sample rows, in a mock holding exactly two groups, in a palette holding exactly two tones.
**The mock is consistent with "one tone per group" only because 2 fits in 2.** It states no rule for which
of the two, and cannot state one for a third.

Every candidate rule and why it fails:

| Candidate | Verdict |
|---|---|
| Brass = group identity (one tone per group) | Needs N tones for N groups; design supplies 2, schema supplies no colour column. Not expressible. |
| Brass = a status (overdue / full / pending) | Design states no such rule, and live both groups are `active` — structurally zero signal. This is the reading `#310` correctly rejected. |
| Brass = second by `created_at` | No design rule, and position carries no meaning to a teacher. Inventing semantics. |
| Brass = name contains a schedule (`"… Sun 4PM"`) | Parsing free text for meaning the schema does not assert. A mock naming coincidence, not a rule. |

**This is R13's whole point: a second tint is an affirmative visual claim.** A teacher who sees one chip
brass and one mint will read it as *status* — overdue, full, needs action — because that is what a colour
break means in every other screen in this product. Shipping a tint with nothing behind it makes that claim
falsely, and a disclaimer buried in a doc comment does not reach the teacher looking at the phone. **A
colour that means nothing is not neutral; it means whatever the user infers.**

### What is live today, and is correct

Both sections already render the one tag rule their section actually draws, and match it:

- §01 `AllStudentsList.tsx` — `rounded-[var(--radius-xs)] bg-[var(--color-mint)] px-2 py-1 text-[11px] font-semibold text-[var(--color-teal-deep)]` ↔ `.mgd1 .tag` (4px radius, `#DFEEEB`/`#0A514A`, 4px/8px padding, 600).
- §02 `students/[studentId]/page.tsx` — `rounded-[var(--radius-pill)] bg-[var(--color-mint)] px-3 py-1 …` ↔ `.mgd2 .tag` (999px radius, 4px/12px padding).

Nothing was changed in either file this pass. **The correct diff for this element is empty.**

### Unblocking it needs a decision from Eyad, not a build

Either would make it buildable; both are Eyad's call, neither is written here:

1. **A stated design rule** for which group gets brass — e.g. "the group whose next session is today." Cheapest, needs no migration, but it is a product decision about what the colour *means*.
2. **A per-group colour/tone column** on `student_groups` — **a migration, so it stops here per the standing rule.** This is the only option that makes the design's literal "one tone per group" reading true, and it would need more than two tones to survive a third group.

- **Found:** `#310`, 3 August 2026. **Re-litigated and rejected:** `#343`, 4 August 2026. **Re-verified and logged durably:** 5 August 2026.
- **Related:** R11 (*"Design wins. Identical means identical."* — the converse case: the design not drawing something is itself the instruction). The §02 half of this entry is that same rule applied straight.
## F40 · `formatTime` shifted every bare `HH:MM` wall-clock time by the device's timezone offset — FIXED, 5 August 2026
- **What:** `formatTime()` (`src/lib/formatNumber.ts`) has three input branches. The `Date` and ISO-string branches carry a real instant and correctly render it in Cairo. The third branch — a bare `"HH:MM"` / `"HH:MM:SS"` string — built its anchor with `new Date(2000, 0, 1, hour24, mm, ss)`, which interprets those digits in the **device's** timezone, and then rendered the result with `timeZone: CAIRO_TZ`. That applies a device→Cairo offset to a value that never had an offset in the first place.
- **Why it hid for so long:** on a device set to `Africa/Cairo` the two cancel exactly, so every real Egyptian phone showed the right time. It was only wrong somewhere else — and Vercel's runtime is UTC, so it was also a server/client hydration hazard on these client components.
- **Measured, not inferred (5 Aug 2026).** Same input, same build, only `TZ` changed: `formatTime('14:00','en')` → **`"4:00 PM"`** under `TZ=UTC`, **`"2:00 PM"`** under `TZ=Africa/Cairo`. A 2:00 PM class was being announced as 4:00 PM. After the fix both read `"2:00 PM"`.
- **How it surfaced:** writing the first unit test this helper has ever had, for `Merged-Center-Home` §01's schedule row. The suite runs `TZ=UTC` specifically to expose this class of bug (CLAUDE.md's Cairo-time rule) and it did so on the first run. No test anywhere had pinned the wrong behaviour, so nothing had to be edited to land the fix — the full suite went 1921 → 1931 passing with zero failures.
- **Fix:** the wall-clock branch now anchors in `Date.UTC(...)` and renders with `timeZone: 'UTC'`, so no offset exists in either direction and only the LOCALE formatting applies (12-hour clock, `AM`/`PM` vs `ص`/`م`, Arabic-Indic numerals). **Output on a Cairo device is byte-identical to before** — verified, not assumed — so the visible change for real users today is zero and only the off-Cairo/SSR cases move. The ISO and `Date` branches are deliberately untouched.
- **Blast radius — every caller identified by hand, and the per-file counts re-derived by `grep -c` on 5 August after an adversarial pass found two of them wrong.** Now correct off-Cairo (all pass wall-clock strings): `schedule/page.tsx` (**9** call sites, `Merged-Center-Groups` §05), `groups/page.tsx` (2), `teacher/GroupSlotsSection.tsx` (**4**), `teachers/GroupSlotsTab.tsx` (2), `teacher/(portal)/groups/[groupId]/GroupClassesTab.tsx` (1), `teacher/schedule/SlotActionSheet.tsx` (1), and `Center-Home` §01's own schedule row. Unaffected because they pass an instant, not a wall clock: `attendance/ScanTab.tsx` (a `Date`), `invoiceTemplates.ts` (`created_at`), `whatsapp/flows/parentNotifications.ts` (a `Date`). Also unaffected: `src/lib/timeFormat.ts` exports a **different, unrelated** `formatTime` and was never involved.
  - **Correction:** the first version of this line gave `schedule/page.tsx` as 8 and `GroupSlotsSection.tsx` as 5, under the wording "every caller checked by hand". The FILE LIST was right and complete — the counts were asserted, not counted. Actual: 9 and 4 (`grep -c 'formatTime(' <file>`). The conclusion is unchanged, since every listed file is a wall-clock caller and all are now correct off-Cairo, but "checked by hand" was a stronger claim than what had been done and is corrected here rather than quietly repaired.
- **Touches:** `src/lib/formatNumber.ts` only, plus the new `tests/unit/splitFormattedTime.test.ts` regression guard which asserts absolute values under `TZ=UTC` on purpose.
- **Found/fixed:** 5 August 2026, `Merged-Center-Home` §01 parity pass.

## F41 · Every notification without an `href` sent the owner to the card-orders page — FIXED, 5 August 2026
- **What:** `NotificationsPageClient.tsx`'s row handler read `const href = (n.href ?? '/orders').trim() || '/orders'`. `/orders` was a safe-looking default only while the single live centre-facing writer was the card-order one. `in_app_notifications.kind` is unconstrained free text (no enum, no `CHECK` — re-verified live this pass), so the moment **D26** wires any other writer, an href-less "Fee overdue" or "Student absent" row would have opened a shipping list.
- **Fix:** mark-read still happens on every tap — that is what the tap means — but navigation happens only when there is a real destination; otherwise the list reloads in place so the row and the unread count settle together. No schema, no new key.
- **Found/fixed:** 5 August 2026, `Merged-Center-Home` §02 parity pass.

## F42 · The dashboard's Attendance tile rendered a fabricated `0%` whenever today had no expected headcount — FIXED, 5 August 2026
- **What:** §01's Attendance tile is scanned-today over **expected**-today, where expected is the sum of today's `schedule_slots` member counts. When that denominator was `0` the code fell back to a literal `0`, so the tile printed **`0%`** — a number nobody would question, asserting that nobody turned up.
- **Why it was near-universal, not an edge case:** `select count(*) from schedule_slots` returns **1** for the entire production database (F17's addendum, re-verified live this pass, 5 Aug 2026). Virtually every centre has no slots for today, so virtually every centre saw `0%`. A centre that scanned fifty students was being told its attendance was zero.
- **Fix:** an uncomputable rate is now `null`, not `0`. The tile renders an em dash with the real scan count beneath it (`dashboard.attendanceScannedSuffix`, en+ar) and an `aria-label` explaining why (`dashboard.attendanceUnknown`), so no invented percentage ships and no real figure is lost.
- **Deliberately NOT given the same treatment — Digital share.** Its `0%` prints its own denominator right beside it (`0 EGP total`), so that zero reads as "nothing was collected", which is exactly what happened. The Attendance tile had no denominator on screen, which is what made its zero a lie rather than a fact.
- **Found/fixed:** 5 August 2026, `Merged-Center-Home` §01 parity pass.

## V4 addendum, 5 August 2026 — the balance card's blockers now have exact names, and there is honest plumbing already waiting for them
Re-verified live against project `lczmjpnbuhnsislcvzar` before deciding anything, per the standing rule. Previous passes recorded this as "`payouts`/`center_balances`/`wallets` don't exist", which is true but not actionable. The precise artifacts the card needs and does not have:
- **RPC `public.payout_available_minor` — DOES NOT EXIST.** The only `%payout%` routine in `pg_proc` is `enforce_payout_status_transition`.
- **Table `public.center_payouts` — DOES NOT EXIST**, nor does any ledger table the engine posts into.
- `transactions`: **3** rows, `settled_at` populated on **0** of them (unchanged since 29 July). `payout_requests`: **0** rows.

**What is new and worth knowing:** `src/lib/collectionPayout/` (Territory C, ~2,600 lines across 10 modules) and `GET /api/collection/status` are already built. `getAvailableBalanceMinor` calls the missing RPC, takes its own `isNotMigrated` branch, and returns `UNSOURCED_ZERO` — so that route answers `balance.sourced: false` for every centre, today, always. Its own contract states that a false `sourced` means the zero is UNKNOWN, not EMPTY, and that "a surface that renders the number without the reason is fabricating a balance." **Nothing in `src/` fetches that route** — honest plumbing waiting on the ledger, not a source `Center-Home` §01 is ignoring.

> **Correction, 5 August 2026 (adversarial re-verify of #351).** An earlier wording of the sentence above conjoined the library and the route under a single "zero consumers", and that half was false. `grep -rn "collectionPayout" src/` (excluding the directory itself) returns **eight** consuming API routes: `api/collection/enable`, `api/collection/status`, `api/admin/center-payouts`, `api/admin/center-payouts/[id]/release`, `api/admin/center-payouts/[id]/approve`, `api/cron/payout-reconciliation`, `api/webhooks/payout-provider`, `api/payouts/request`. Only the narrow claim survives and it is the one that matters here: `GET /api/collection/status` has **0 fetch callers** in `src/`. The module count (10) and the line count (2,623 ≈ "~2,600") were both correct.

**Still not built, for three independent reasons, any one of which is sufficient:** the headline ("Available now") has no source; two of the other three figures ("Pending", "Processed") have none either, leaving only "Unpaid" derivable, and one real figure inside a card whose headline cannot exist is precisely the fake this omission prevents; redefining "Available now" from other data was raised with Eyad on 1 Aug and **explicitly declined**. Unblocking needs a migration (standing rule 3) and is protected `Verification-Payouts` / V3 / V4 territory. The evidence above is also mirrored in a block comment in `dashboard/page.tsx` so the next reader finds it without this file.

## D26 addendum, 5 August 2026 — re-verified, still open; the display side is now finished ahead of it
`in_app_notifications` is **still empty (0 rows)** and its `kind` is still unconstrained `text` — both re-checked live this pass, not carried forward from the 30 July entry. The decision is unchanged and **was not pre-empted**: no new write-triggers were added, because a type firing from only one of its several real call sites looks broken rather than honestly sparse, which is this entry's own "do not improve away" note.

What *was* done is display-side only, so that whenever Eyad's call lands the feed renders correctly on arrival rather than needing a second pass: the design's fourth icon tint `.i-danger` (`#F0ECE2` / `#9C3322` — exact `--color-hairline` / `--color-danger` matches, nothing minted) was **entirely missing** and is now a real tone, with `overdue`/`past_due` mapped to it and `unpaid`/`failed`/`declined` left on brass, matching what §02 actually draws row by row; `verif`/`identity` now renders `.i-ok` as the design tints it, closing the file's own deferred note ("stays for the feature pass" — this was that pass), with `privacy` split off since `privacy_request` is written only against an `admin_users.id` and never reaches a centre's feed. Also `.num` on the body line, per §02's `.ns num`. Substring matching and the neutral fallback are unchanged and still deliberate: the design draws no unknown kind, so it draws no neutral tint, and inventing one would assert a meaning the row does not carry.

## D27 addendum, 5 August 2026 — premise re-tested from scratch and it holds; the render side is one column short
Not taken on trust — and re-counted properly on 5 August after an adversarial pass caught the first count being bucketed. `grep -rn "preferred_locale" src/` returns **17 occurrences across 8 files**: `login/page.tsx`, `api/me`, `api/user/locale`, `api/admin/centers`, `api/auth/teacher/signup`, `api/signup/complete`, `api/accept-invite/complete`, `lib/centerOwnerProvision.ts`. Of those, `api/user/locale` is a **write** (`.update({ preferred_locale })`), not a read, and five are provisioning writes. An earlier wording gave this as "exactly four places", which collapsed the five writers into one and counted a write as a read; the precise figures are above.

The **load-bearing half is unaffected and does hold**: no outbound composition path reads the column anywhere — no WhatsApp send, no notification writer. So D27's claim that per-recipient locale composition is "a pattern used nowhere else today" is correct, independently reproduced.

One concrete addition for whoever takes the decision: **option (b) — store an i18n key + params in `metadata` and translate client-side — is one line short on the read path too.** `in_app_notifications.metadata jsonb` exists (confirmed in `information_schema.columns` this pass), but `GET /api/notifications` does **not** select it: the projection is `id, kind, title, body, href, read_at, created_at, center_id`. Option (b) therefore costs a projection change plus a client render branch, not just a writer change. Recorded so the two shapes get compared at their real cost. Still blocked on Eyad's call — building half of a composition standard is worse than neither half.

## F43 · `Merged-Center-Home` §02's `.topbtn` is global chrome, not a missing element — resolved, 5 August 2026
- **What:** the 1 August audit recorded §02's header as "structurally missing the design's icon-button element", never previously assessed. Checked properly this pass rather than built on faith: the design's `.topbtn` is a 42×42 hamburger, and `MobileTopBar` (mounted once by `AppShell`, which also carries a `PAGE_TITLE_MAP` entry for `/notifications`) already renders exactly that hamburger on every authenticated mobile screen. `/notifications` is in `AUTHENTICATED_ROUTE_PREFIXES`, so it always gets that chrome.
- **Resolution:** nothing to build. Adding an in-page hamburger would put a second one on the same screen, three lines below the real one. This matches the same audit's own conclusion that the global nav is out-of-frame chrome no merged `design/*.html` file draws — the `.topbtn` is that chrome appearing inside a full-phone frame, not a page-level element the page is missing.
- **Recorded so it is not re-raised as a fresh gap a fourth time.**

## F48 · Two branches added a different leading slot to the same shared primitive — resolved 5 August 2026

- **What:** `ListRow` (`src/components/patterns/ListRow.tsx`) has one leading position, the design's `.av` slot. Two Phase-3 branches filled it independently. **#340**, the primitive-adoption pass, added `icon?: LucideIcon` — a glyph for rows that name a place rather than a person, per §03. **#351**, the `Merged-Center-Home` §01 pass, added `leading?: React.ReactNode` — for the drawn `.sess` row, whose lead is a 52px two-line start time ("2:00" over "PM"), not initials on a mint tile. Both readings of the design are correct; they are the same slot.
- **Why it is worth an entry rather than a merge note.** This is the semantic-conflict shape again, and it does not show up where anyone looks for it: **each branch was green against master on its own, and the defect existed only after both landed.** No gate can see it — CI runs each PR against a master that does not yet contain the other.
- **What the naive merge produced.** Git auto-merged the two render changes into a chain for `avatar`/`leading` *plus a separate* `{!avatar && Icon && …}` expression. A caller passing both props therefore got **two leading blocks stacked in one row** — a shape the design has no drawing for, and one that `leading`'s own JSDoc had already forbidden in prose without anything enforcing it.
- **Resolution — both slots coexist, with one precedence order.** Exactly one block renders: **`avatar` > `leading` > `icon`**, as a single ternary chain closed with an explicit `null`. The order is by specificity: the mint initials tile is §03's documented default and wins; a caller-rendered node is a deliberate override and beats the generic glyph. No caller loses anything — checked live, not assumed: `icon` is passed only by `admin/PlatformOverviewHeader.tsx` and `leading` only by `dashboard/page.tsx`, and **no caller passes both**, so no existing row changes.
- **Pinned by `tests/unit/listRowLeadingSlot.test.ts`.** Four assertions: all three props still exist, the leading block comes from a single exclusive expression, `avatar` precedes `leading` precedes `icon`, and the chain terminates in an explicit `null` rather than falling through. Source-derived rather than rendered, because the suite has no DOM (`vitest.config` sets `environment: 'node'`) **and because the bug is two independent JSX expressions rather than a wrong rendered value** — a render test of either prop alone passes on the broken code. Verified against the broken form before landing: reintroducing the separate `{!avatar && Icon && …}` expression fails 3 of the 4.
- **The general lesson, for the next shared primitive.** When two branches extend the same component, the collision is invisible to both PRs' CI. Grep the primitive's prop list across every in-flight branch before adding to it — the same discipline the F-code heading IDs already need.
