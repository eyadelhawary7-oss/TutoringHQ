# Re-diff — `design/Merged-Design-Patterns.html` vs the live app

**Date:** 8 August 2026 · **Session:** OWNER of "Test Center 333" (`/tmp/state333.json`)
**File state:** last edited `0b265cec design(protected): Design-Patterns teacher-money empty state, both locales (#373)`
**Captures:** `/tmp/rediff/design-patterns/` (24 route screenshots + 12 interaction screenshots)

This is a **cross-cutting vocabulary file**, not a route. It was diffed by hunting live instances of each
pattern across 24 reachable routes and by driving the live UI (swipe, tap-to-expand, kebab → sheet,
throttled loads) rather than by comparing one screen to one drawing.

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Design-Patterns.html | wc -l
44
```

Per section (command run over the section line-ranges in the same file):

```
sec 01 lines 346,733  -> 22
sec 02 lines 735,881  ->  8
sec 03 lines 883,1021 ->  4
sec 04 lines 1023,1153 -> 4
sec 05 lines 1155,1288 -> 3
sec 06 lines 1290,1396 -> 3
TOTAL: 44
```

22 + 8 + 4 + 4 + 3 + 3 = **44**.

---

## 2. All 6 screens, frames per section

| # | Name | Frames | Sub-groups (counted, sum to the section total) |
|---|---|---|---|
| 01 | Empty States | **22** | The pattern 2 · Center · the first hour 10 · Teacher · where it differs 6 · The quiet kind 4 |
| 02 | Loading States | **8** | A list arriving 2 · A record opening 2 · When it is taking too long 2 · An action in flight 2 |
| 03 | Row action patterns | **4** | Swipe 1 · Tap to expand 1 · Press-and-hold floating menu 1 · Always-on icons 1 |
| 04 | Quick menu rows | **4** | EN student row 1 · EN session row 1 · EN teacher row 1 · AR student row 1 |
| 05 | Group actions | **3** | EN row quick menu 1 · EN group page + action bar 1 · AR group page + action bar 1 |
| 06 | Expand sheet merge | **3** | EN expanded row 1 · EN More → full sheet 1 · AR expanded row 1 |
| | **Total** | **44** | |

---

## 3. Ledger

```
Drawn: 44 | Exercisable: 27 | Exercised: 15 | Blocked: 29
```

*Exercisable* = frames whose pattern is built **and** reachable from an owner session
(44 − credential 8 − not-built 7 − by-design 2 = 27). Of those 27, 15 were rendered live and
12 were blocked by `no-data` (9) or `tooling` (3).

### Exercised (15) — a live instance was rendered

| § | Frame | Where it was rendered |
|---|---|---|
| 01 | EN · home, before anything exists | `/en/dashboard` — mint tile + "Nothing scheduled today" + description + primary button |
| 01 | AR · الرئيسية قبل أي حاجة | `/ar/dashboard` — "لا يوجد جدول لهذا اليوم" + button, RTL mirrored |
| 01 | EN · attendance, nothing running | `/en/attendance` — "No scans yet / Start scanning student cards" |
| 01 | EN · money | `/en/payments` — "No payments yet / Payments will appear here after scanning students" |
| 01 | AR · المال | `/ar/payments` — "لا توجد مدفوعات حتى الآن / ستظهر المدفوعات هنا بعد مسح الطلاب" |
| 02 | EN · list, rows still arriving | `/en/notifications` under CDP throttle (latency 4000ms) — `aria-busy=1`, 15 `.chq-skeleton` nodes, 5 placeholder rows. Also reproduced on `/en/students/pending` (12 `.chq-skeleton`) |
| 02 | AR · قائمة بتحمّل | `/ar/notifications` under the same throttle — 15 `.chq-skeleton` |
| 03 | Swipe actions | `/en/students` — CDP touch-drag on Adam Sherif's row revealed **Collect Payment / Message / Edit** |
| 03 | Tap to expand in place | `/en/whatsapp` — `ExpandableRow` opened to the accent-bordered card |
| 04→ | *(see §4 note — the shared sheet is live, but not on the three row types §04 draws)* | |
| 05 | EN · row quick menu | `/en/groups` — group-card kebab → shared `ActionSheet` ("Biology A / Edit group / …") |
| 05 | EN · group page · action bar | `/en/groups` detail — tiles, segmented control, member rows, `RecordActionBar` ("Add member" + `…`) |
| 05 | AR · group page · action bar | `/ar/groups` detail — same, RTL mirrored, Eastern Arabic numerals |
| 06 | EN · tap · top actions inline | `/en/whatsapp` — expanded card with Preview + More chips |
| 06 | EN · More · full sheet | `/en/whatsapp` — `[role=dialog][aria-modal]` sheet: grab handle, "Card Order Cancelled" / `chq_card_order_cancelled`, Preview / Copy template name |
| 06 | AR · RTL · expanded row | `/ar/whatsapp` — expanded card, chips "معاينة" / "المزيد" |

*(15 rows of substance; the §04 line is a pointer, not a frame.)*

### Blocked (29) — every frame named, with reason

**`no-data` (9)** — the pattern is built and reachable, the tenant is too full to trigger it.

| § | Frame | Route tried | Why |
|---|---|---|---|
| 01 | EN · anatomy (students) | `/en/students` | 14 students on the roster |
| 01 | AR · anatomy (students) | `/ar/students` | same roster |
| 01 | EN · groups | `/en/groups` | 7 groups |
| 01 | AR · المجموعات | `/ar/groups` | 7 groups |
| 01 | EN · WhatsApp | `/en/whatsapp` | full approved-template library |
| 01 | AR · واتساب | `/ar/whatsapp` | same |
| 01 | EN · center insight (quiet) | `/en/analytics` | populated: 15,400 EGP monthly revenue, 100% collection |
| 01 | AR · تحليلات السنتر (quiet) | — | same tenant data drives it; **`/ar/analytics` was not captured this pass** |
| 04 | EN · session row | `/en/schedule` | selected day renders "No sessions on this day" — no session row to open a menu on |

**`tooling` (3)** — NOT MEASURED, not "missing".

| § | Frame | Reason |
|---|---|---|
| 01 | AR · الحضور | `/ar/attendance` captured with `[STILL-SKELETON: NOT MEASURED]` (so did `/en/attendance`; the EN screenshot happened to also carry the scan-history empty state, the AR one did not) |
| 02 | EN · slow, not an error | `StillWorking` is built and wired inside `ChartCard` behind `SLOW_AFTER_MS = 6000`. 24s of CDP throttling (latency 6000ms, 10 KB/s) on `/en/analytics` produced **0** `[role="status"]` nodes. Could not force it. |
| 02 | AR · بطيء، مش خطأ | same |

**`credential` (8)** — the owner session cannot reach the surface.

| § | Frames | Reason |
|---|---|---|
| 01 | EN + AR teacher home, EN + AR teacher money, EN + AR teacher insight (6) | `/tmp/state333.json` is a center **owner**. The teacher portal (`/[locale]/teacher/(portal)/…`) needs a teacher account. |
| 02 | EN + AR "a record opening" (2) | `RecordSkeleton`'s **only** render site is `src/app/[locale]/teacher/AnalyticsView.tsx` — teacher portal. |

**`by-design` (2)**

| § | Frames | Reason |
|---|---|---|
| 01 | EN + AR card orders (quiet) | `/en/orders` and `/ar/orders` render a parked **"Coming soon · Student ID cards"** panel. `NEW-MODEL.md` → Revenue streams: "Card orders — **Parked.** Coming soon." |

**`not-built` (7)** — the drawn pattern has no implementation anywhere in `src/`.

| § | Frame | Evidence |
|---|---|---|
| 02 | EN + AR · action in flight (2) | `ActionSpinner` — the named §02 primitive — has **0** render sites (`grep -rlP "<ActionSpinner\b" src --include=*.tsx` → 0). `src/components/ui/LoadingButton.tsx` exists in 3 files and covers the behaviour, but it is not the §02 primitive and was not rendered. |
| 03 | Press and hold · floating menu (1) | `grep -rn -i -E "liftrow\|floatg\|floating menu\|lifted row" src --include=*.tsx` → **no matches**. The app's long-press (`SwipeRow.onLongPress`) opens **multi-select** instead. |
| 03 | Always-on icons (1) | `grep -rn -i "minibtn" src` → **no matches**. No per-row icon strip anywhere; rows carry one kebab. |
| 04 | EN student row (1) | `/en/students` kebab opens a **local `role="menu"` dropdown** (`src/app/[locale]/students/page.tsx:1707`), not the shared sheet. Clicking it produced **0** `[role=dialog][aria-modal]` panels. |
| 04 | AR student row (1) | `/ar/students` — same local dropdown. |
| 04 | EN teacher row (1) | `src/components/teachers/MyTeachersPanel.tsx` imports `ListSkeleton` and `EmptyState` only; it renders **no** `ActionSheet` and **no** kebab. `/en/my-teachers` shows a chevron-down expander card. |

9 + 3 + 8 + 2 + 7 = **29**. 15 + 29 = **44**.

---

## 4. Which shared patterns the live app implements, vs. which are drawn-only

**The primitive layer exists and is real.** `src/components/patterns/` holds five components whose
doc-comments cite this file by section number, plus `EmptyState` under `src/components/shared/`.
Its `index.ts` states the rule outright: *"MANDATORY, not optional… Rolling a local one is not allowed."*

| Design pattern | Live primitive | Render sites (files / JSX sites, counted this session) | Verdict |
|---|---|---|---|
| §01 Empty state | `shared/EmptyState.tsx` | **37 files / 46 JSX sites** | **Built + widely adopted** |
| §02 list skeleton | `patterns/LoadingStates → ListSkeleton` | **10 files / 12 sites** | **Built + adopted** |
| §02 record skeleton | `RecordSkeleton` | **1 file / 1 site** (teacher AnalyticsView) | Built, 1 adopter |
| §02 slow line | `StillWorking` | **1 file / 1 site** (`ChartCard`, internal `slow` timer) | Built, never observed firing |
| §02 action in flight | `ActionSpinner` | **0 files / 0 sites** | **Built and orphaned** |
| §03 list row | `patterns/ListRow.tsx` | **7 files / 10 sites** | Built + adopted |
| §03 swipe | `components/students/SwipeRow.tsx` | **1 file** (`students/page.tsx`) | **Built as a screen-local fork, not a shared primitive** |
| §03 long-press floating menu | — | 0 | **Drawn only** |
| §03 always-on icons | — | 0 | **Drawn only** |
| §04 bottom action sheet | `patterns/ActionSheet.tsx` | **10 files / 10 sites** | **Built + adopted** — but not on any of the three row types §04 draws |
| §05 record action bar | `patterns/RecordActionBar.tsx` | **1 file / 1 site** (`groups/page.tsx`) | Built, 1 adopter |
| §06 expandable row | `patterns/ExpandableRow.tsx` | **4 files / 4 sites** | Built + adopted |

### The three that matter

1. **§03's press-and-hold floating menu and always-on icon rows are drawn and nowhere else.**
   Two of §03's four gestures have no implementation. §03's masthead frames them as four
   alternatives to compare; the app shipped two and repurposed a third (long-press → multi-select).
   That is a decision, but it is recorded in `Merged-Center-Students` §01, not here, so this file
   still presents four live options.

2. **§04's sheet is adopted everywhere except the rows §04 actually draws.**
   The shared `ActionSheet` renders live on a **room card**, a **WhatsApp template row**, and a
   **group card** — all verified by screenshot. It does **not** render on the student row, the
   session row, or the teacher row, which are the only three rows §04 draws. The biggest list in
   the product (`/en/students`, 14 rows × a kebab each) runs a local `role="menu"` dropdown styled
   with legacy tokens (`--color-surface-1`, `--color-border-default`, `--color-text-primary`)
   instead. This is the single largest vocabulary gap: the pattern is built, the flagship consumer
   improvises.

3. **`ActionSpinner` is orphaned and `StillWorking` never fires.**
   §02's four states are meant to be four distinguishable messages. Two of them
   ("slow, not an error", "action in flight") do not reach a user on any route I could reach.
   `ChartCard`'s three other hosts are `/ceo`, `/admin`, `/admin/analytics` — and `ceo/page.tsx`
   passes `loading={false}` on 5 of its `ChartCard`s, so `slow` can never fire there at all.

**Token layer:** `src/app/tokens.css` implements the §4 palette — **19** of the spec's 20 colour
tokens, plus the full 7-step spacing, 8-step type and 6-step radius scales, and it re-points
Tailwind's `teal-*` and `brand-*` families at the accent. `--color-good` (`#1A6D4D`) is the one
missing token; it is hardcoded in `StandingBadge.tsx`, `rooms/page.tsx` and `students/[id]/page.tsx`.

---

## 5. Empty-state copy: the design's, or its own?

**Its own. The app shares the design's *anatomy* and almost none of its *words*.**

The app keeps a parallel `emptyStates` block in `messages/{en,ar}.json` plus a scatter of
per-namespace strings. Titles occasionally collide by accident; every description and action differs.

| Screen | Design (§01) | Live app |
|---|---|---|
| Students, EN | **"No students yet"** · "Add them and attendance, fees and parent messages all start working. **Nothing is billed until a session runs.**" · `Import from a file` + `Add one by hand` · alt "A spreadsheet with names and parent numbers is enough." | **"No students yet"** · "**Your roster is empty.** Add a student by hand, or bring the whole list over from a spreadsheet." · `Add Student` + `Import from file` · **no alt** |
| Home/Today, EN | "Nothing runs today yet" · "Once students and groups exist, this shows the sessions, who is expected, and what has been collected." · `Add your students` · alt "About ten minutes with a file." | "Nothing scheduled today" · "Set up a recurring weekly schedule so today's sessions show up here" · `Set up schedule` · **no alt** |
| Money, EN | "Nothing collected yet" · "Every fee you take, cash or online, lands here with who paid and when. InstaPay collection switches on once you add your InstaPay account." · `Add your InstaPay account` + `Record a cash payment` | "No payments yet" · "Payments will appear here after scanning students" · **no action rendered** |
| Notifications | *(not drawn)* | "No notifications yet." — **title only**, quiet tile, no description, no action |
| Students, AR | **"لسه مفيش طلاب"** · "ضيفهم والحضور والمصروفات ورسايل ولي الأمر هتشتغل كلها. **ومفيش أي فلوس قبل ما تبدأ أول حصة.**" · `استورد من ملف` + `ضيف واحد بإيدك` | **"لا يوجد طلاب بعد"** · "أضف أول طالب لبدء الاستخدام" |
| Money, AR | "لسه مفيش تحصيل" · "كل مصروف بتاخده، كاش أو أونلاين، بيظهر هنا بمين دفع وإمتى…" | "لا توجد مدفوعات حتى الآن" · "ستظهر المدفوعات هنا بعد مسح الطلاب" |
| Notifications, AR | *(not drawn)* | "لا توجد إشعارات بعد." |

### Three §01 rules the live copy breaks

1. **"Say what happens once it is filled, not what is absent."**
   The design's own worked example is "*'Add them and attendance, fees and parent messages start
   working' beats 'You have no students'*". The app ships *"Your roster is empty."*

2. **"Where money could be a worry, say it is not."**
   `grep -rn -i "nothing is billed" src messages` returns exactly **1** hit — and it is
   `en.json:3257 notEnrolledYet`, about pending enrolments, not an empty state. The reassurance
   sentence that §01 calls "the actual hesitation" is in **no** empty state in the app.

3. **"Never a dead end. Every empty state either has an action or explains why none is needed."**
   Counted over every `<EmptyState …>` block in `src/`:

   ```
   EmptyState JSX sites: 46 across 37 files
     with alt=        :  6
     with quiet       : 30
     with action=     :  7
     with description=: 19
     neither description nor action: 25
   ```

   **25 of 46 empty states are title-only dead ends.** `alt` — which the component's own doc-comment
   calls a property "every empty state in §01 carries" — is passed on **6** of 46.

### The Arabic register has drifted further than the English

The design's Arabic is Egyptian colloquial throughout — *لسه مفيش طلاب*, *ضيف واحد بإيدك*,
*شوف الحضور بيشتغل إزاي*. Every live Arabic empty state I rendered is Modern Standard Arabic —
*لا يوجد طلاب بعد*, *لا توجد مدفوعات حتى الآن*, *لا توجد إشعارات بعد.* Live titles also carry a
terminal full stop the design's titles never do.

### One empty state does not use the component at all

`/en/schedule` and `/ar/schedule` render the empty day as a bare paragraph —
`<p className="py-2 text-sm text-[var(--color-text-secondary)]">{t('noSessionsSelectedDay')}</p>`
at `schedule/page.tsx:1094` and `:1178`. No icon tile, no §01 anatomy, and a legacy token.

---

## 6. Dead-model residue

### In the DRAWING — none found, in either locale

The `#373` commit cleaned it. Verified with **two separate greps, one per script**:

```
EN markers  (platform share|free payout|payouts work|90/10|Thursday settlement|payout ledger|Valify|verified state)  -> (none)
AR markers  (نصيب المنصة|تحويل مجاني|التحويلات بتشتغل|حصة المنصة|نسبة المنصة|التسوية|الدفعات الأسبوعية)              -> (none)
broader     (fawry|vodafone|wallet|verif|payout|settlement|7.5%|1.5%|markup|gateway|checkout|محفظة|فوري|توثيق|تحقق)  -> (none)
```

The teacher-money frames now read, EN: *"What parents transfer to you lands here in full. TutoringHQ
reads each receipt and matches it to the invoice, and you confirm it arrived."* / `See how InstaPay
works` / alt *"You keep every pound of every fee you set."* — and AR: *"اللي أولياء الأمور بيحوّلوه
ليك بيظهر هنا بالكامل… وإنت اللي بتأكد إنه وصل."* / `شوف إنستاباي بيشتغل إزاي`. Both are on-model.

**The known false positive is confirmed as a false positive.** Line 1190 is
`<div class="capbar"><i style="width:90%;background:#9a6b1f"></i></div>` — the brass fill on a
capacity bar for a group at 18 of 20 seats. It is the only `width:90%` in the file. Not the split.

### In the LIVE APP — identity verification is fully alive, in both locales

`NEW-MODEL.md` → *"**Identity verification** — No Valify, no verified and unverified states, no gate…
The two-state account model does not exist."* The app still ships all of it:

- **`src/components/verification/`: 5 components** — `VerificationBadge`, `VerifyIdCta`,
  `CollectPaymentsRow`, `CollectForYouCard`, `AdminVerificationChip` — imported by **5 files**
  (`dashboard/page.tsx`, `attendance/page.tsx`, `admin/AccountDetailHeader.tsx`,
  `teacher/(portal)/page.tsx`, `teacher/(portal)/settings/page.tsx`).
- **Rendered and photographed**: a "Verification unavailable" chip sits in the `/en/dashboard`
  header and the `/en/attendance` tab strip; `/ar/dashboard` shows its twin **"التحقق غير متاح"**.
- The `verification` namespace carries the whole two-state model: `badge.verified` "Verified",
  `badge.unverified` "Not verified", `badge.pending` "Verification in progress",
  `cta.verifyMyId` "Verify my ID", `cta.whatYoullNeed` "About 2 minutes · commercial registration
  or National ID · **secured by Valify**".
- **"Valify" appears 344 times across 34 files** — 338 occurrences in 32 files under `src/`,
  6 occurrences in 2 files under `messages/` (338 + 6 = 344; 32 + 2 = 34).

This belongs to the lifecycle/setup files rather than to Design-Patterns, but it renders on two of
the routes this file's §01 covers, in both locales, so it is reported here.

### Also observed in passing (belongs to `Merged-Center-Insight`, not this file)

`/en/referrals` renders a **"Request Withdrawal"** card with a "Withdrawable · 0 EGP" tile and
"Processing within 3-5 business days". `NEW-MODEL.md` → *"Credit is applied to platform invoices
automatically and **cannot be withdrawn as cash**… State the lock before it bites."* The same page
prints the commission ladder as **"25% Month 1 · 10% Months 2-12 · 5% Month 13+"** where the model
says **"25% the first month, 10% months 2 to 6, then 5%"**. Flagged, not scored here — and note
NEW-MODEL's own "Still open" section leaves cash-out with the tax advisor.

---

## 7. Divergences

### 7a. Against the APP (the app is wrong relative to the drawing)

1. **`/en/students` + `/ar/students` run a local three-dot menu.** `students/page.tsx:1707` renders
   a `role="menu"` popover, not §04's sheet. Verified live: the click produced 0
   `[role=dialog][aria-modal]` panels. It also uses three legacy tokens
   (`--color-surface-1`, `--color-border-default`, `--color-text-primary`) rather than §4 tokens.
2. **`SwipeRow` is a screen-local fork.** §03's swipe lives in `src/components/students/SwipeRow.tsx`
   and is used by one file. `patterns/index.ts` says forking is not allowed; this is a fork that
   predates the rule and was never folded in.
3. **Live swipe buttons do not match `.sbtn`.** Design: full-bleed coloured blocks with white
   labels (`#0E6B61` Pay, `#2563EB` Message, `#5D635C` More). Live: a flat tile strip with dark
   icons and labels **Collect Payment / Message / Edit**.
4. **`ExpandableRow` has no `.chip.pri` and no `.chip.more`.** §06 draws the first chip as an
   accent-filled primary and More as a dashed `#F2EEE5` chip. The primitive renders all four chips
   identically outlined — no primary variant exists in the component at all. The §06 hairline
   divider between head and chips is also absent.
5. **`ActionSheet` renders `MGR`, hardcoded, untranslated.** The design's `.mgr` tag reads
   **"Manager"** in EN and **"مدير"** in AR. `ActionSheet.tsx:131` emits the literal string `MGR`
   in both locales.
6. **Sheet actions ship without `.al .s` sublabels.** §04 makes the sub-line load-bearing
   ("Record payment / Owes 300 EGP"). The rooms sheet renders "Lab A" → **Edit**, **Delete** with
   no sublabels and no sheet subtitle.
7. **`ListSkeleton` omits the trailing badge placeholder.** §02's list frame puts a 62×22 pill
   placeholder on 3 of its 4 rows because the real rows carry a status pill. The app's rows land
   with a "Paid" badge that had no placeholder — content shifts even though the height does not.
8. **Skeleton gradient is off-token.** `.chq-skeleton` uses `#e7e2d6 / #dcd7c9`; §02 uses
   `#ECE8DF / #E2DDD1` (= `paper` / `line`). Neither app value is in the §4 table.
9. **`--color-good` (`#1A6D4D`) is not a token**, though it is one of §4's 20 and is the PAID
   colour §02/§04/§05 use on every status pill. Hardcoded in 3 files.
10. **The group card is a non-semantic clickable `<div>`.** `groups/page.tsx:917` — no role, no
    keyboard path, while `ListRow` in the same codebase renders a real anchor/button for exactly
    this reason.
11. **`/en/schedule` and `/ar/schedule` bypass `EmptyState`** for the empty day (two call sites).
12. **The support FAB occludes the §05 action bar.** At 390px on the group record, the floating
    WhatsApp button sits directly over the `RecordActionBar`'s `…` control — a forced click on it
    produced 0 dialogs. Reproducible in `X4_en_group_recordbar_sheet.png`.
13. **RTL separator ordering.** `groups.membersCount` is `'الأعضاء · {count}'` — a bare U+00B7
    between an RTL word and a digit. In the rendered AR frame the dot lands *after* the numeral
    ("الأعضاء ٢·"), which at 13px reads as a two-digit number. Visible in `X5_ar_group_detail.png`.
    Worth an isolation mark; flagged as an observation, not a certainty.

### 7b. Against the DRAWING (the drawing is wrong or stale relative to the model / the built app)

1. **§01's card-orders frames contradict `NEW-MODEL`.** Both the EN and AR card-order empty states
   present ordering as available — *"most centers order once the term settles"*, `See what a card
   costs`, *"Delivered by Bosta, usually within a week"*. `NEW-MODEL.md` parks card orders, and the
   app already ships the parked treatment (`/en/orders`, `/ar/orders` → "Coming soon · Student ID
   cards"). Two frames describe a flow that is deliberately switched off.
2. **§01 gives no empty state for Notifications**, which is the one empty state a real owner is
   most likely to meet first (it renders on a fresh tenant with no data of any kind). The app
   invented one; the file has no vocabulary for it, so nothing constrains it — and it shipped as a
   title-only dead end.
3. **§02's "action in flight" is drawn as a footer-pinned dimmed primary button.** The app's real
   in-flight vocabulary is `LoadingButton` (3 files), and the §02 primitive built to match
   (`ActionSpinner`) is an inline text+spinner span with no adopters. The drawing and the build
   describe two different components for the same state.
4. **§04's teacher-row frame carries a center-teacher revenue split** — `center 30%`, `center 25%`,
   sheet subtitle "Chemistry · center's cut 30%", action "Adjust cut · Currently 30%". This is a
   *center's* cut of its own teacher's fee, not the platform's 90/10, so it is **not** dead model —
   and the live app does carry the concept (`/en/my-teachers` renders a "Center cut earned" tile,
   `src/app/[locale]/teacher/CenterCutsSection.tsx` exists). Recorded here so a future English-only
   marker sweep does not flag `30%` as the platform split.
5. **§03's masthead presents four live alternatives** ("Compare against the bottom sheet you
   already saw"). Two of the four are decided against in `Merged-Center-Students` §01 and were never
   built. A cross-cutting vocabulary file that still offers a rejected gesture will get one of them
   built by a screen that reads this file and not that one.
6. **Sample-data asymmetry:** §03/§04/§06's EN frames say `Al-Nahda · 128` while §01 says
   `Nile Prep Academy`. Cosmetic, but the file is the reference every screen copies row furniture
   from, and the two halves were drawn from different fixtures.

---

## Appendix — routes measured

**Batch 1 (14/14 measured, 0 redirects, 0 stuck skeletons):** `/en/students`, `/ar/students`,
`/en/groups`, `/en/payments`, `/en/notifications`, `/en/orders`, `/en/whatsapp`, `/en/referrals`,
`/en/my-teachers`, `/en/rooms`, `/en/branches`, `/en/schedule`, `/ar/groups`, `/ar/payments`.

**Batch 2 (6/6):** `/en/dashboard`, `/en/attendance` *(STILL-SKELETON)*, `/en/analytics`,
`/ar/notifications`, `/ar/referrals`, `/ar/schedule`.

**Batch 3 (4/4):** `/ar/dashboard`, `/ar/attendance` *(STILL-SKELETON)*, `/ar/whatsapp`, `/ar/orders`.

**Interaction passes** (`interact.mjs` … `interact5.mjs`, all in the scratch dir, none written to
the repo): student-row kebab, student-row swipe, WhatsApp expand + More, group card kebab, group
detail + action bar, room card kebab, AR mirrors of each, and CDP-throttled loads of
`/en/notifications`, `/ar/notifications`, `/en/students/pending`, `/en/analytics`.

`/en/branches` reported 1 HTTP ≥400 response; the page rendered its multi-branch upsell gate, so the
drawn `ExpandableRow` branch list is plan-gated on this tenant and was not the frame under test.
