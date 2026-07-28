# Skipped screens — what was passed over, and why

**Standing instruction, 28 July:** *"When you next hit a screen blocked on one of my
three open decisions, do not queue behind it. Skip it, note it, and keep going. I
would rather have a list of skipped screens than a stalled build."*

This is that list. One row per screen that was reached in build order and not built.
Every reason here is **verified**, not assumed — against `information_schema.columns`
for storage claims, against the code for behaviour claims.

A screen leaves this list when the blocking fact changes, not when someone feels
differently about it.

---

## Why a screen gets skipped

| Reason | Meaning |
|---|---|
| **No storage** | The design's control has no column. Building it means a migration, which is Eyad's call |
| **Money** | Renders or changes a money figure. Eyad's line is behaviour, not file — money comes to him |
| **Write** | Introduces a write, or changes what gets written |
| **Entitlement** | Gates on a plan, seat or verification state |
| **Ruled out** | A settled decision says the design is wrong here |
| **Verification** | Blocked on Valify / Adsero |

---

## Phase D

### `Merged-Center-Setup`

| § | Screen | Reason | Detail |
|---|---|---|---|
| 05 | Notifications | **No storage** — *decided 28 July: do not build* | The whole preference model is absent. No column anywhere for the six "notify me about" categories, the Push/Email channel split, or the quiet-hours window. The only `notify_*` columns are `students.notify_on_absence`, `notify_on_balance`, `notify_on_scan` — those are **per-student parent** toggles controlling what a *parent* receives, not what the owner does. Different feature, not a partial one. Eyad: *"Do not build a preference model to satisfy a restyle."* Logged as **B15**; live screen untouched |
| 06 | Scanner | **No storage** + **Write** — *decided 28 July: do not build* | `centers` carries exactly one scanner column, `scanner_default_mode` (`'camera'` default), which live already exposes. Nothing exists for camera facing, sound, vibrate, or the "ignore repeat scans within 5 min" window. Separately, **"Mark attendance automatically" changes what gets written** to `attendance_scans`, so it is Eyad's regardless of storage. Logged as **B16**; live screen untouched |
| 07 | Team seats | **No storage** + **Entitlement** | No column matching `%seat%` in any table. `pricing_plans` has no seat allowance. The design itself says the price is *"still to be set"* |
| 08 | Team Verified | **Verification** | Verified state end to end |

#### §04 Center details & Subjects — center half is FAITHFUL, grades half is blocked

Surveyed 28 July. **The Center details half needs no work.** The design asks for logo, centre name,
area/city, contact phone; live `/{locale}/settings/center` already has logo, name, phone, **governorate
and district** — the last two together being the design's "Area / city". It reads and writes
`centers.district`, so the Benchmarks screen's *"set your district in settings"* prompt does lead
somewhere real.

Two design elements do not land, neither worth building:

- **Street address.** The only address column is `centers.delivery_address`, and it is **`jsonb` for
  card-order shipping**, not a display address for families. Repurposing it would be the same class of
  mistake as reusing the parent `notify_*` toggles for owner preferences. `centers.city` exists as
  plain text and is unexposed, but city is already covered by governorate + district.
- **"Manage branches · 3"** — a link to `Center-Groups` §04, which is **money**: `POST /api/branches`
  creates a billable centre.

**The Subjects half is blocked.** Subjects CRUD exists and matches. **Grades do not.** The design says
*"Only the grades you turn on show up in student sign-up"*, which needs a per-centre enabled-grades
list. Verified: `grade_level` exists only as **free text on `students` and `group_proposals`**, plus an
array on `teacher_profiles.grade_levels`. There is **no per-centre grades configuration anywhere** —
nothing to turn on or off. Same shape as §05 and §06: a restyle that quietly requires a new model.

#### §02 Settings — FAITHFUL, no work needed

Surveyed 28 July. The hub is live at `/{locale}/settings/general` — `/settings` is a redirect shim
into it and the sidebar links straight there. Eight rows carry the design's ten:

| Design row | Live |
|---|---|
| Center details · Subjects & grades · Team · Scanner | present |
| Account · Notifications · Billing & plan · Support | present |
| **Identity verification** | **Verification**-blocked |
| **Referrals** | reachable, from the **sidebar** (`/referrals`, owner-only) rather than the hub |

The design also opens the hub with a **centre identity card** — logo, centre name, area, plan. That is
**already in the chrome**: `BranchSwitcher` in the sidebar renders the logo, the centre name and the
branch count under a "Center name" label on every screen, and it switches branches as well. Building
the card would put a second copy of the same three facts two inches to its right. Not built.

**The design's General sub-page is B17-shaped, not a restyle.** Five of its seven controls have no
storage. Verified against `information_schema.columns`, whole `public` schema: no `week_start*`, no
`time_format`, no `date_format`, no `%numeral%`, no `%text_size%`/`%font_size%` column on any table.
What does exist is `users.preferred_locale` (`text`, default `'ar'`) and it is **fully wired** — read
at login, written by `POST /api/user/locale`, returned by `/api/me` — and already surfaced as a
persistent locale toggle in the chrome (`AppShell`, `MobileTopBar`, `AdminHeader`, `AdminSidebar`,
`TeacherNav`), which beats a settings row you have to go and find. Currency is a static `EGP` label.

**The design's Account sub-page** adds Name / Phone / Email rows with edit chevrons and a **two-factor
toggle** to live's Change PIN and Sign out. No 2FA storage exists — `%two_factor%`, `%2fa%`, `%mfa%`
and `%totp%` return zero columns. And editing the phone is editing the **login identity**, so that half
is auth and comes to Eyad wherever it lives.

#### §01 Onboarding — a different product, not a restyle

Live `/{locale}/onboarding` is a four-step **activation** wizard — Student → Group → Scan → Results —
driven by `centers.onboarding_step` (`integer`, default `0`) alongside `onboarding_started_at`,
`onboarding_step_updated_at`, `onboarding_completed`, `onboarding_completed_at` and
`onboarding_nudge_sent_at`, all live. The design is a **setup** wizard: welcome and language, centre
details, subjects and grades, payment methods, done.

Its content is already collected, just not in a wizard:

| Design step | Where it lives today |
|---|---|
| Welcome + language | locale toggle in the chrome, and `/signup` has its own |
| Centre details (name, area) | `/signup` step 1 — `centerName`, `ownerName`, `phone`, `email`, `city` |
| Logo, district | `/settings/center`, which reads and writes both |
| Subjects | `/settings/subjects` |
| **Grades** | **nowhere** — same missing per-centre enabled-grades list as §04 |
| **Payment methods** | **Money** + a Valify **verification** gate |

So what is actually unbuilt is one blocked step and one money step. Swapping a live activation wizard
for a setup wizard is a product decision, not a layout job.

#### §09 My Teachers — live, and richer than the design

`/{locale}/my-teachers` exists with the design's four tabs in the design's order — Teachers, Requests,
Slots, Add (`MyTeachersPanel`, `GroupProposalsTab`, `GroupSlotsTab`, `AddTeacherPanel`). The Teachers
tab shows **more** than the design: fees collected, centre cut earned, teacher earnings and fees
outstanding per teacher, plus per-group fee-per-lesson and cut on expand.

Everything that differs is **money**. The design shows the centre's cut as a **percentage chip**
("center 30%") where live shows it in EGP, and a **this-month** window where live is to-date. Two money
figures, so both are Eyad's, not a diff to file. (`/teachers` is a redirect into the teacher portal —
a different screen entirely.)

**All nine sections of this file are now surveyed.** §03 Settings Billing is **money**.

### `Merged-Center-Insight`

| § | Screen | Reason | Detail |
|---|---|---|---|
| 01 | Analytics | **Money** | MRR, month-end forecast, projected revenue, collection rate, P&L, aging |
| 03 | Referrals | **Not a restyle — reclassified as a feature, 28 July** | See below |

§02 Benchmarks was **built** — #189.

#### §03 Referrals — out of the layout queue entirely

**Eyad's ruling, 28 July:** *"With the 25/10/5 ladder stripped per D2, what remains is money plus a
verification gate. It is not a restyle, it is a feature, and it goes to me."*

It arrived in build order looking like a restyle — `/{locale}/referrals` is live and the design is a
referrals screen. It is not one. Taking it apart:

| The design shows | Status |
|---|---|
| Rate ladder **25% month 1 / 10% months 2–6 / 5% month 7+** | **Ruled out.** Live is **10% for twelve months**. The 26 July decision: *"People have been told a rate, so live wins and the design is wrong."* Logged as design correction **D2** |
| Recurring this month · next month (est.) · lifetime earned | **Money** |
| Per-referral: current %, monthly pay, days until it drops | **Money**, and the countdown is against a ladder that does not exist |
| **Withdraw to bank vs use as in-app credit** | **Money** + **verification-gated** — *"Identity verified · withdraw to your bank or spend as credit"* vs *"Verify to unlock"* |
| Share link and code | The only layout-shaped element on the screen |

Remove what is ruled out and what is money, and one share button is left. **Building it is designing a
new earnings product, not restyling an existing one.** It belongs with **B8** (referral earnings:
credit versus withdrawal), which already covers the withdraw/credit half.

The verified data does exist for a *display* of the live 10%/12-month arrangement —
`referral_commissions` carries `commission_rate`, `period_month`, `months_since_activation`,
`referred_plan_fee` and `commission_amount`. That is a money screen and Eyad's to specify, not a gap
to fill from the design.

### `Merged-Center-Orders`

| § | Screen | Reason | Detail |
|---|---|---|---|
| 01–03 | Orders, Detail, Checkout | **Money** | Price summary and a four-step checkout |
| 04 | Coming Soon | **No storage** | The notify-me registration has no destination. The only waitlist table is `waitlist_notifications (student_id, group_id, notified_at, response)` — the *group* waitlist, unrelated |

---

## Phase E — the teacher portal, surveyed in one pass

**Result: nothing to build.** 19 screens. Five are the protected `Merged-Teacher-Money`.
Of the other 14, **every one has a live route**, and every gap is money, verification,
a confirmed-absent model, or a routing preference. Same shape as Phase D.

The live portal is `/{locale}/teacher/(portal)` — `page`, `schedule`, `students`,
`groups`, `groups/[groupId]`, `groups/[groupId]/sessions/[sessionId]`, `analytics`,
`settings`, `centers`, `income`, `billing`, `resubscribe`, `subscription/upgrade`.

| § | Screen | Live route | Verdict |
|---|---|---|---|
| `Home` 01 | Teacher Home | `/teacher` | **Faithful.** Below |
| `Home` 02 | Teacher Schedule | `/teacher/schedule` | **Faithful.** Today/week tabs, week paging, enrolled counts, live-class state, rescheduled and cancelled badges, record-attendance CTA |
| `Students` 01 | Teacher Students | `/teacher/students` | **Faithful.** `AllStudentsList` — search, group, contact kept LTR — behind `PrivateUpsellCard` |
| `Students` 02 | Student Detail | *(modal)* | **Routing preference, plus money.** Below |
| `Groups` 01 | Teacher Groups | `/teacher/groups` | **Faithful.** `PrivateGroupsSection` with enrolled count and per-class fee |
| `Groups` 02 | Group Detail | `/teacher/groups/[groupId]` | **Faithful.** 498 lines: roster, add/edit, join link, classes and schedule tabs |
| `Groups` 03 | Invite Pending | same route | **Faithful.** The pending-approval block with approve/reject and payer student-or-parent is already in Group Detail |
| `Groups` 04 | Class Session | `/teacher/groups/[groupId]/sessions/[sessionId]` | **Money + write.** Below |
| `Groups` 05 | Session Verified | — | **Verification** |
| `Insight` 01 | Analytics | `/teacher/analytics` | **Faithful.** The design frame *is* the Pro-gated state, and live is `AnalyticsView` + `LockedAnalyticsPreview` |
| `Insight` 02 | Teacher Referrals | — | **Confirmed absent.** Below |
| `WhatsApp` 01 | Teacher WhatsApp | — | **Confirmed absent.** Below |
| `Setup` 01 | Teacher Settings | `/teacher/settings` | **Faithful.** 807 lines: name, phone, subject, change PIN, payment methods, subscription across all five states |
| `Setup` 02 | Teacher Centers | `/teacher/centers` | **Money + write.** Below |
| `Money` 01–05 | Income, Calculator, Billing, Instant Payout, Collect Opt-in | — | **Protected file.** Never touched |

### Teacher Home §01 — faithful, and the rest is money

Every element of the design's **unverified** half is live on `/teacher`: the greeting,
`outstanding`, `centersTile`/`centersEmpty` ("Centers owe me / All centers settled"),
`groupsTile`, `subscriptionTile` — richer than the design, with five states and their
CTAs — `incomeTile`, and `IncomeCalculator`, which is exactly the design's *"Grow your
private practice · private students × fee per session → estimated monthly income"*.

Two things are not built and neither is a layout job:

- **"Let us collect for you · Verify my ID"** — **verification**.
- The **verified** half — balance, available, pending, next processed, recent bank
  payouts — is verification *and* payouts, which is `Merged-Verification-Payouts`
  territory, a protected file.

Worth stating plainly: most of what remains on this screen is a **money figure**.
"Centers owe me", "Outstanding 900 EGP" and "Estimated monthly income" all are, so even
where a gap appears here it comes to Eyad rather than auto-merging.

### Students §02 — a routing preference, not a data gap

The design draws student detail as a full screen. Live opens it as an **in-place modal**
from the list (`AllStudentsList`, `openStudentId` state and overlay), which is the same
information without losing the teacher's place in the roster.

It is also not purely layout: the design's *"an outstanding balance they can collect
right here"* is a **money figure plus a collect action**. The live modal already loads
billing per student. Turning the modal into a route is a preference; changing what it
collects is Eyad's.

### Groups §04 and Setup §02 — live, and both money-and-write

`/teacher/groups/[groupId]/sessions/[sessionId]` runs the class: attendance toggling,
present count, then **finish**, which calls `finish_class_and_bill` and renders a
**billed total** with paid/pending status. `/teacher/centers` carries join-a-centre, my
code, **group proposals with accept / counter / decline**, group slots, bring-group-to-
centre, **centre cuts** and **centre earnings**.

Both already match the designs. Both are also a **write** and a **money figure**, so any
future change to either comes to Eyad regardless of how layout-shaped it looks.

### Insight §02 and WhatsApp §01 — confirmed absent, and they are new models

Both were verified against the catalog earlier and are recorded in `DATA-GAPS.md`:

- **Teacher Referrals.** All five referral tables are **centre-to-centre only** — every
  referrer/referred column is `*_center_id` (`referrals`, `referral_codes`,
  `referral_commissions`, `referral_rewards`, `referral_reward_records`). No `teacher_id`,
  no polymorphic referrer. A teacher referral model is **a new schema, not a column**.
  The design also shows the **25/10/5 ladder**, which the 26 July decision ruled out
  (**D2**), and credit-versus-withdraw, which is verification-blocked.
- **Teacher WhatsApp.** `pricing_plans` has **no message-allowance column of any kind**,
  so the design's *"Your Pro plan includes 50 a month"* and its platform-paid versus
  teacher-paid split have nothing behind them. There is no `/teacher/whatsapp` route,
  and adding one means designing the allowance model first.

### The `/admin/teachers` decision, 28 July

The two routes were built (**A2**) and then **closed unmerged on Eyad's call**:
*"Two teacher consoles is worse than one imperfect one."* `/{locale}/ceo/teachers`
already covers the data across five tabs, and a second home means every teacher field has
two places to live and they eventually disagree.

**The fault the build avoided was checked against `/ceo/teachers` and it does not have
it.** `getCeoTeacherData` builds the teachers tab as `profiles.map(...)` with the
subscription as a lookup (`ceoTeachers.ts:253`), and `total_teachers` is
`profiles.filter((p) => !p.is_test).length` (`:345`) — both profile-driven, so a teacher
with no `teacher_subscriptions` row still appears and still counts. The subscriptions tab
does iterate subscriptions, which is correct for a subscriptions tab, and its five cards
are each labelled by status rather than as a teacher total. **No live bug.**

The finding it produced is kept in **A2**: an account list must be driven by
`teacher_profiles`, because on the live catalog 2 of 3 teachers have no subscription row
and a subscription-driven list would show a third of the customer base while looking
entirely correct.

---

## Phase B — skipped wholesale

`Merged-Public-App`, `Merged-Lifecycle` and `Merged-Verification-Payouts` are three of
the **six protected money-and-auth files** and are never touched. Phase B is 18 screens
and none of it is available, which is why the build ran A → C/D rather than A → B.

---

## Earlier phases

| File | § | Reason |
|---|---|---|
| `Merged-Center-Home` | 01 Dashboard Verified | **Verification** — the entire screen is the verified state |
| `Merged-Center-Students` | 03 Students Verified | **Verification** |
| `Merged-Center-Attendance` | 01, 02 | **Verification** — the whole file. Digital/cash chip, collection-fee summary, payment links, and the Collect-For-Me opt-in itself |
| `Merged-Center-Groups` | 02 Groups Verified | **Ruled out** — 26 July decision locks the billing basis to `fee_per_class` only. The parent-price column is additionally verification-blocked |
| `Merged-Center-Groups` | 04 Branches | **Money** — `POST /api/branches` creates a **billable center**, copying `plan`, `billing_type`, `billing_amount` and `all_in_price` from the parent |
| `Merged-Center-WhatsApp` | 01 Templates | **No storage, effectively** — `center_message_templates.auto_send` exists but the table is **empty and referenced by no file in `src/`**. The live screen reads `wa_meta_templates` (45 rows), a different concept. Adopting the orphan table is a feature decision |
| `Merged-Center-WhatsApp` | 02, 03 | **Ruled out** — deferred as B5. Live is a per-parent monthly pack; the design is a one-time credit model |

---

## What unblocks what

| Eyad decides | Releases |
|---|---|
| `demo_requests` migration (`area`, `student_count`) | `Public-Marketing` §04 Lead Capture |
| WhatsApp auto-send: adopt the orphan table or drop the toggle | `Center-WhatsApp` §01 |
| Team seats: seat model and price | `Center-Setup` §07 |
| Card-order notify-me: where the write goes | `Center-Orders` §04 |
| Teacher referral model | `Teacher-Insight` §02 |
| A per-centre enabled-grades list | `Center-Setup` §04, subjects half |
| Adsero / Valify | 10 screens across 7 files |

**Answered 28 July — do not build, logged and closed:** a notification-preference model
(`Center-Setup` §05 → **B15**) and scanner behaviour preferences (`Center-Setup` §06 → **B16**). Both
live screens are left exactly as they are.

**Logged the same way, same day, without needing an answer:** region and display preferences
(`Center-Setup` §02's General sub-page → **B17**). It is the identical shape — five controls, no
storage — and the two that do exist are already live in a better place. Recorded so it is not
rediscovered.

## A pattern worth naming

Five Phase D screens — §04 grades, §05, §06, §02's General sub-page, and `Center-Orders` §04 — look
like restyles and are not. Each renders one or two controls whose storage does not exist, so "make it
match the design" silently means "design and build a new model". The tell is always the same: **a
toggle or a chip with nothing behind it.** Checking the catalog before starting is what separates a
restyle from a feature, and it costs one query.

**A second pattern, from the same survey:** three of the design's controls turned out to be live
already, just **somewhere better than the design put them** — the app-language row (a persistent
toggle in the chrome, not a settings row), the centre identity card (the sidebar's `BranchSwitcher`,
on every screen rather than one), and the Referrals row (the sidebar). Design fidelity is about the
control existing and being findable, not about it sitting on the screen the mockup drew it on. Three
diffs avoided by checking where a thing already lives before building a second one.

**Decided 28 July — `/admin/teachers` and `/admin/teachers/[id]` will not be built.** They
were the last "needs no decision, only time" item; Eyad ruled against a second teacher
console. Full reasoning, and the finding worth keeping, in the Phase E section above.

**With Phase D and Phase E both surveyed, the build queue is empty of layout work.**
Everything remaining is money, verification, a decision, or a new model.
