# Pattern-primitive adoption ledger

**Produced 31 July 2026.** `Merged-Design-Patterns` (row 1 of `FILE-COMPLETION-TABLE.md`) shipped six
shared primitives in PR #220 (29 July). That PR's own note said "adoption is NOT in this PR — it is
per-file," and until now nothing had gone back to actually count how much of the app had adopted them.
`FILE-COMPLETION-TABLE.md` carried row 1 as "100% today: YES" on the strength of the primitives existing,
not on any measurement of adoption. This document is that measurement.

**Updated 31 July 2026 (#292, #294) — the migration is complete, the old component is deleted.**
`students/page.tsx`, `groups/page.tsx`, and `schedule/page.tsx` were migrated in #292. A 5th
wrong-component file the original audit had missed, `(dashboard)/orders/OrdersPageClient.tsx`, was found
and migrated in #294, alongside `payments/page.tsx`'s dead, unrendered import (removed — it was never a
live wrong-component instance, so it's excluded rather than counted as a migration) and the resulting
deletion of `src/components/empty-states/EmptyState.tsx` once a clean grep confirmed zero remaining
importers anywhere. See `CHANGE-LOG.md`'s `#292`/`#294` entries for how `OrdersPageClient.tsx` was missed
twice (once by the original audit, once by a follow-up check that trusted an empty grep result without a
second look) before being caught a third time — this is a direct, human-directed fix, not a proactive
sweep of the other five primitives, which stay untouched below.

**Updated 3 August 2026 — the primitives changed SHAPE; the fractions below did not move much.**
A visual-parity pass against `Merged-Design-Patterns.html` corrected all six primitives against the
drawn measurements and landed three new ones (`SegmentedControl`, `CapacityBar`, `GroupCard`) plus
`StatusPill` and `EmptyStateAction`. **Read the fractions below as "adopters of the OLD shape" for
anything not re-verified after that pass** — a per-file sweep converting a screen now converts it
against the corrected primitive, which is the whole reason the shape was fixed before the sweeps
rather than during them.

Three deliberate omissions were recorded in that pass and are not gaps to be closed later:

- **§03's swipe row is not, and will not become, a pattern primitive.** `components/students/SwipeRow.tsx`
  stays students-local. §06 is the file's own conclusion (design:1301) and resolves §03 in favour of
  tap-to-expand plus the shared sheet; promoting a competing gesture is how one list ends up with two
  ways to reach the same five actions. Its measurements were brought onto the design (64px buttons,
  192px total) but it is not exported from `components/patterns`.
- **§03's press-and-hold floating menu is not built.** Same reason — design:1034, "one sheet, one
  gesture". A third gesture to reach an identical action set contradicts the file's own conclusion.
- **§03's always-on icon row is not built.** `ListRow` keeps its single trailing affordance. If a
  screen ever genuinely needs it, `.minibtn` is `34×34 rounded-sm bg-[--color-tile] text-[--color-mid]`
  and `.minibtn.pay` is `bg-[--color-mint] text-[--color-accent-deep]`.

Two design defects were logged rather than reproduced: the off-palette `#2563EB` at design:914 (one
occurrence, no token, nothing consumes it — a message action takes `--color-accent`), and `#8A5E16`
as the badge warning text (not a token; `--color-brass` `#9A6B1F` kept instead of adding a 171st hex).
One design inconsistency was logged as a query: §05 draws the capacity bar teal at 80%, brass at 90%
and teal again at 100%; `CapacityBar` applies brass from 90 up, since a full group is not less urgent
than a nearly-full one.

**Method.** Three independent read-only audits, one per primitive family, each opened and read every
candidate file directly — no classification is based on a grep snippet alone, and none trusts
`CHANGE-LOG.md`, `FILE-COMPLETION-TABLE.md`, or `PER-FILE-PROMPT.md`'s claims about what's already
converted, since those are exactly what's being checked for staleness. Every file named below was
opened.

**How to use this.** A file listed here as a non-adopter is a real, individually-logged gap — the same
standard this project applies to a missing structural element — not something to fold silently into
"adoption is ongoing." Converting one is legitimate scope for that file's own next sweep pass, per
`Merged-Design-Patterns`' own "adoption is per-file" rule; this ledger's job is to make sure that work
stays visible instead of assumed. **This ledger is complementary to, not a correction of, each file's own
row in `FILE-COMPLETION-TABLE.md`.** Those rows measure structural/IA completeness against the design; this
ledger measures shared-component hygiene specifically. A screen can be correctly marked structurally
complete in its own row while still appearing here as a non-adopter — e.g. its empty state may show the
right message in the right place, just not through the shared component, with the wrong icon tile or a
missing `.es-alt` line. Nothing here retroactively changes any other row's recorded fraction; revisit a
flagged file when its own row comes up again.

---

## Summary

| Primitive | Real adopters | Denominator | Fraction |
|---|---|---|---|
| `EmptyState` (`shared/EmptyState.tsx`) | 12 files | 72 | **16.7%** |
| `EmptyStateAction` (new, 3 Aug) | 3 | 72 | **4.2%** |
| `ListSkeleton` | 1 | 137 | **0.7%** |
| `RecordSkeleton` | 1 (`settings/billing/loading.tsx`, 3 Aug) | 137 | **0.7%** |
| `StillWorking` | 1 (`students/page.tsx`, 3 Aug) | 137 | **0.7%** |
| `ActionSpinner` | 0 | 137 | **0%** |
| `ListRow` | 5 | 14 | **35.7%** |
| `ActionSheet` | 1 (`groups/page.tsx`, 3 Aug) | 3 | **33.3%** |
| `RecordActionBar` | 0 | 4 | **0%** |
| `ExpandableRow` | 0 | 1 | **0%** |
| `SegmentedControl` (new, 3 Aug) | 2 | 3 | **66.7%** |
| `CapacityBar` (new, 3 Aug) | 1 (`groups/page.tsx`) | — | — |
| `GroupCard` (new, 3 Aug) | 0 | — | — |
| `StatusPill` (new, 3 Aug) | 0 | — | — |

`ActionSpinner`, `RecordActionBar`, `ExpandableRow`, `GroupCard` and `StatusPill` have **zero
adopters**, confirmed by grepping the exact identifiers outside `src/components/patterns/` and
`src/components/shared/`. Their SHAPE is now correct against the design; their reach is not. Those are
two different problems and only the first was in scope for the 3 August pass.

**`ActionSheet`'s one adoption is the groups card quick menu, not the students row §04 draws.** The
groups card's three-dot opened a hand-rolled one-item popover (`role="menu"`, Delete only); it now
opens the shared sheet with the identical single action (Delete group, destructive, with its
consequence line) — a 1:1 conversion on the surface §05's first frame draws, with no function added
or removed. The denominator stays 3 (the three hand-rolled menus below); the other two —
`admin/centers` and `rooms` — stay per-file. Students specifically was not forced — see the next
paragraph.

**`ExpandableRow`/`ActionSheet` on the students list was attempted and deliberately abandoned.** It is
the adoption `Merged-Design-Patterns` §06 draws, and it is not a conversion: the live mobile student
row is ~330 lines inside `SwipeRow` carrying inline parent-phone editing, cart state and per-row
controls, none of which `ExpandableRow`'s `title`/`meta`/`badge` surface can hold. Wedging it in would
fork the primitive, which is the one thing `components/patterns/index.ts` says not to do. It needs the
students file's own sweep, where removing `SwipeRow` and rehoming that row content is the actual job.

**`RecordActionBar` stays at zero deliberately.** The "group page" §05 draws it on does not exist as a
route — the live surface is a slide-over inside `groups/page.tsx`, and the only honest actions there
today are already inline (copy invite link, delete). §05's bar exists to pin a record's real primary
action ("Take attendance"); no such per-group flow exists yet, and a pinned bar with an invented
primary is a fabricated hierarchy, which is worse than an unadopted component. It adopts in the sweep
that builds the group record page.

`SegmentedControl`'s denominator is 3 hand-rolled controls; **2 were converged and the third
deliberately was not.** `teacher/AllStudentsList.tsx` is a horizontally-scrolling filter row of N
group pills, not §05's fixed three-way `.seg` — with ten groups, `flex-1` segments would be 10% wide
each. It is a different control that happens to share `role="tablist"`.

`CapacityBar` and `GroupCard` have no meaningful denominator yet: `student_groups.max_capacity` is
populated on 1 of 4 live rows, so `CapacityBar` renders nothing on most groups by design — see its
sentinel guard. That is correct behaviour, not a gap.

---

## 1. EmptyState

**Two components share the name, and only one is the real primitive.** `src/components/shared/EmptyState.tsx`
is `Merged-Design-Patterns §01`: a 64×64 `rounded-lg` mint tile, 17px/700 heading, 13px body capped
`31ch`, full-width action, and an `.es-alt` secondary-route line capped `32ch`. `src/components/empty-states/EmptyState.tsx`
is a different, older component that predates #220 and was never migrated: a `rounded-full teal-100`
circle, i18n-key props (`titleKey`/`descriptionKey`) instead of literal strings, no `.es-alt` equivalent.
**Importing the second one is not a partial adoption of the primitive — it's a different component that
happens to share a name.**

**The historical "11 adopters" claim (#220's own changelog entry) was not reproducible at the time of the
original audit and was very likely wrong even then.** Total files importing *either* `EmptyState` before
this pass was exactly 11 — 7 real + 4 wrong-component — the same number as the old claim. The strong read
is that #220's count was produced by grepping the bare string `EmptyState` without checking which import
path was used, silently counting the 4 wrong-component files as adopters of the new primitive.

### Real adopters (11 files, 13 call sites — final, #292 + #294)

- `src/components/admin/AnalyticsGrowthHeader.tsx`
- `src/app/[locale]/(admin)/admin/teacher-links/page.tsx` (3 usages — byCenter/byTeacher/unassigned tabs)
- `src/app/[locale]/(admin)/admin/payouts/page.tsx`
- `src/app/[locale]/(admin)/admin/referral-rewards/page.tsx`
- `src/app/[locale]/(admin)/admin/commissions/page.tsx`
- `src/app/[locale]/admin/internal-team/page.tsx`
- `src/app/[locale]/admin/referrals/page.tsx` — **mixed file:** its "top referrers" tab correctly uses
  `EmptyState`; its other three tabs (referrals list, pending payouts, commissions) are ad hoc (see below).
  Counted once in each bucket since it genuinely contains both.
- `src/app/[locale]/students/page.tsx` (Center-Students §01/§03) — migrated 31 Jul, #292
- `src/app/[locale]/groups/page.tsx` (Center-Groups §01/§02) — migrated 31 Jul, #292
- `src/app/[locale]/schedule/page.tsx` (Center-Groups §05) — migrated 31 Jul, #292
- `src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx` (Center-Orders §01) — a 5th wrong-component
  file the original audit missed (see `CHANGE-LOG.md`'s `#292`/`#294` entries); migrated 31 Jul, #294

### Wrong-component (0 files remaining — resolved)

All 5 wrong-component files found across both passes are resolved: `students/page.tsx`,
`groups/page.tsx`, `schedule/page.tsx` (#292), and `OrdersPageClient.tsx` (#294, found after #292's own
audit missed it) are migrated. `payments/page.tsx`'s `EmptyState` import turned out to import
`empty-states/EmptyState` without ever rendering it anywhere in the file — a dead import, not a live
wrong-component instance — and was removed rather than migrated (#294). `src/components/empty-states/EmptyState.tsx`
itself is deleted, confirmed safe by a clean grep across the whole `src` tree showing zero remaining
importers.

### Ad hoc (61 files — hand-rolled, no shared component at all)

**Teacher portal (14):** `teacher/GroupProposalsSection.tsx` (Teacher-Setup §02), `teacher/AllStudentsList.tsx`
(Teacher-Students §01), `teacher/AnalyticsView.tsx` (Teacher-Insight §01, local `EmptyLine()` helper reused
4×+), `teacher/(portal)/groups/[groupId]/page.tsx` (Teacher-Groups §02/§03), `teacher/PrivateGroupsSection.tsx`
(Teacher-Groups §01), `teacher/CenterCutsSection.tsx` (Teacher-Setup §02), `teacher/(portal)/schedule/page.tsx`
(Teacher-Home §02), `teacher/GroupSlotsSection.tsx` (Teacher-Setup §02), `teacher/IncomeView.tsx`
(Teacher-Money §01), `teacher/BillingHistory.tsx` (Teacher-Money §03), `teacher/CenterEarningsSection.tsx`
(Teacher-Setup §02), `teacher/(portal)/groups/[groupId]/sessions/[sessionId]/page.tsx` (Teacher-Groups
§04/§05), `teacher/(portal)/groups/[groupId]/GroupClassesTab.tsx` (Teacher-Groups §02),
`components/teacher/schedule/SlotActionSheet.tsx` (Teacher-Home §02 or Teacher-Groups §04/§05 — ambiguous).

**Center (26):** `dashboard/page.tsx` (Center-Home §01, "At Risk" panel), `rooms/page.tsx` (Center-Groups
§03), `(dashboard)/notifications/NotificationsPageClient.tsx` (Center-Home §02), `students/[id]/page.tsx`
(Center-Students §02, attendance sub-tab), `students/pending/page.tsx` (Center-Students §04),
`students/print/PrintClient.tsx` (no merged file — `NEEDS-DESIGN.md`), `settings/billing/page.tsx`
(Center-Setup §03), `settings/team/page.tsx` (Center-Setup §07/§08), `settings/referrals/page.tsx`
(duplicate route, `DUPLICATE-ROUTES.md` marks "probably delete"), `referrals/page.tsx` (Center-Insight §03,
the canonical route), `whatsapp/WhatsAppTemplatesClient.tsx` (Center-WhatsApp §01),
`(dashboard)/whatsapp-pack/WhatsAppPackClient.tsx` (Center-WhatsApp §02/§03),
`(dashboard)/billing/BillingPageClient.tsx` (Center-Money §03),
`components/notifications/NotificationBell.tsx` (Center-Home §02), `components/teachers/GroupProposalsTab.tsx`
(Center-Setup §09), `components/teachers/GroupSlotsTab.tsx` (Center-Setup §09), `components/teachers/MyTeachersPanel.tsx`
(Center-Setup §09), `components/settings/TeacherJoinRequests.tsx` (Center-Setup §07/§08),
`components/scanner/TodayHistorySheet.tsx` (Center-Attendance §01), `components/scanner/PendingSyncSheet.tsx`
(Center-Attendance §01), `components/orders/CardOrderCartContents.tsx` (Center-Orders §01),
`components/dashboard/InactiveList.tsx` (Center-Home §01), `components/attendance/ScanTab.tsx`
(Center-Attendance §01 — closest ad hoc shape to the real primitive, even has an `.es-alt`-like second line),
`components/attendance/ChecklistTab.tsx` (Center-Attendance §01), `components/analytics/AgingReport.tsx`
(Center-Insight §01), `components/StudentBalanceStatement.tsx` (print/PDF statement — RTL/print-exempt
track, unclear if comparable to the app-UI spec at all), `components/AttendanceHeatmap.tsx` (rendered on
`/groups`, Center-Groups).

**Admin/CEO (21):** `ceo/page.tsx` (CEO §01), `ceo/teachers/page.tsx` (CEO §02, local `EmptyRow()` helper
reused 5×), `admin/demo-requests/page.tsx` (no merged file), `admin/privacy-requests/page.tsx`
(Admin-Platform §06), `admin/promo-codes/page.tsx` (Admin-Platform §05), `admin/renewals/page.tsx` (no
merged file), `admin/vendors/AdminVendorsClient.tsx` (Admin-Platform §03), `admin/withdrawals/page.tsx`
(Admin-Money §05), `admin/centers/page.tsx` (Admin-Platform §01 — confirmed via `INVENTORY.md`, not
Admin-Accounts), `admin/orders/AdminOrdersClient.tsx` (no merged file — a hand-rolled CSS "illustration"
with no icon library at all), `admin/plan-requests/page.tsx` (no merged file), `admin/billing/page.tsx`
(Admin-Money §07), `admin/centers/[id]/centerManagementClient.tsx` (Admin-Accounts §01 — 7+ separate plain
`<p>` fallbacks across sub-sections), `admin/health/page.tsx` (Admin-Money §03), `admin/finance/AdminFinanceClient.tsx`
(Admin-Money §03 — 3 of 5 local fallback components are hardcoded English with no Arabic branch, a
separate i18n bug), `admin/referrals/page.tsx` (Admin-Accounts §04 — see "mixed file" note above),
`(admin)/admin/staff/page.tsx` (Admin-Accounts §02), `(admin)/admin/center-assignments/page.tsx`
(Admin-Accounts §03), `(admin)/admin/whatsapp-pack/AdminWaPackClient.tsx` (Admin-Platform §04),
`(admin)/admin/card-orders/[orderId]/AdminCardOrderDetailClient.tsx` (no merged file).

**Excluded (not counted, named for transparency):** `(admin)/ceo-dashboard/FounderCommandStrip.tsx` /
`FounderGrowthPanel.tsx` / `CenterHealthPanel.tsx` — unreachable dead code (`(admin)/ceo-dashboard/page.tsx`
is a hard `redirect()`, per the CEO row's own finding); `charts/MultiLineChart.tsx` / `AreaChart.tsx` — a
generic "not enough data points" message on a low-level chart primitive, not a page-level empty state;
`charts/DonutChart.tsx` — renders a single `—` glyph by an explicit different convention;
`src/app/[locale]/payments/page.tsx` (Center-Money §01/§02) — had imported `empty-states/EmptyState`
without ever rendering it anywhere in the file (confirmed by direct grep, 31 Jul, during #292's migration
work) — a dead import, not a live wrong-component render, so it was never counted in the
"wrong-component" bucket it originally sat in. **Protected file (`Center-Money`)** — Eyad gave explicit
approval for this specific one-line removal (#294), which is now done; the import no longer exists.

---

## 2. Loading states

Four named primitives ship in `src/components/patterns/LoadingStates.tsx`: `ListSkeleton({rows})`,
`RecordSkeleton()`, `StillWorking({message})` (deliberately no retry button), `ActionSpinner({label})`.

**Two other shared-but-not-these mechanisms exist:** `src/components/ui/LoadingButton.tsx` (a real,
prop-driven `state: 'idle'|'loading'|'success'|'error'` component — a genuine competing primitive to
`ActionSpinner`), and two separate CSS shimmer classes, `chq-skeleton` (`globals.css:1963`) and `.skeleton`
(`globals.css:1130`) — structurally near-identical, used directly on hand-built divs with no shared
component wrapping them. Bare CSS-class usage is counted as ad hoc below (nothing about it is a shared
*component* — every file still hand-builds its own div tree and ARIA wiring); this judgment call does not
change the headline fraction either way.

### Real adopter (1 file)

- `src/app/[locale]/(admin)/admin/teacher-links/page.tsx` — `ListSkeleton rows={5}`

### Other-shared-primitive (1 file)

- `src/app/[locale]/payments/page.tsx` — `LoadingButton` (3 call sites); the same file's main data-load
  skeleton is separately ad hoc (raw `animate-pulse`).

### Ad hoc (135 files)

Full file-by-file detail (135 rows across admin, center, public/auth, teacher portal, shared/cross-cutting
components, and route-level `loading.tsx` fallbacks) is preserved in the audit transcript rather than
repeated in full here — grouped counts:

- **Admin (28)** — includes `admin/page.tsx`, `admin/analytics/page.tsx`, `admin/pricing/page.tsx`,
  `admin/billing/page.tsx`, `admin/finance/AdminFinanceClient.tsx` + `page.tsx` (hardcoded-English
  `Suspense` fallback, bypasses i18n), `admin/centers/page.tsx`, `admin/centers/[id]/centerManagementClient.tsx`,
  `ceo/page.tsx`, `ceo/teachers/page.tsx`, `(admin)/ceo-dashboard/CeoDashboardClient.tsx` (four different
  ad hoc styles in one file), and 18 more admin/platform/money screens — every one plain `{t('loading')}`
  text, a raw `Loader2`/`RefreshCw` spin, or a `chq-skeleton`/`.skeleton` div.
- **Center/owner dashboard (32)** — includes the flagship `students/page.tsx` roster (a hand-rolled row
  skeleton that is structurally a reimplementation of `ListSkeleton`), `dashboard/page.tsx`,
  `(dashboard)/analytics/page.tsx`, `(dashboard)/benchmarks/page.tsx`, `groups/page.tsx`, `rooms/page.tsx`,
  `schedule/page.tsx`, `students/[id]/page.tsx` (a hand-rolled `RecordSkeleton` reimplementation), 8
  `settings/*` screens, and more.
- **Public/auth (10)** — `login/page.tsx`, `teacher/signup/page.tsx`, both `/join/...` flows (two
  differently-shaped URLs, possibly a fifth undocumented duplicate pair beyond `DUPLICATE-ROUTES.md`'s
  four), `refer/[code]/page.tsx`, `set-pin/SetPinClient.tsx` (no spinner or skeleton at all — a bare button
  label swap, the weakest ad hoc case found), `parent/[token]/page.tsx` (hardcoded Arabic loading text, no
  i18n function).
- **Teacher portal (37)** — **100% ad hoc, zero exceptions.** Every screen uses inline `Loader2` +
  `animate-pulse` divs; none use any of the four primitives, `LoadingButton`, or either CSS class. Two
  files (`IncomeView.tsx`, `AnalyticsView.tsx`) independently define an identical, unexported, file-local
  `function Skeleton({className})` — the literal duplication-across-files problem `Merged-Design-Patterns`
  §02 exists to solve, still happening after the primitive shipped.
- **Shared/cross-cutting components (17)** — matters disproportionately since each is imported by multiple
  screens. Highest-leverage: **`src/components/charts/ChartCard.tsx`**'s raw CSS spinner is shared by 6
  screens (`ceo`, `dashboard`, `(dashboard)/branches`, `admin`, `admin/analytics`, `(dashboard)/analytics`)
  — converting this one file moves 6 screens at once, unlike almost every other item on this list. Also:
  `OTPInput.tsx` and `PhoneInput.tsx` (both auth-flow siblings, each with its own differently-styled inline
  spinner — inconsistent with each other), `ScanResultScreen.tsx` (uses `Loader2` in two places and a third,
  different hand-rolled spinner in a third — inconsistent within itself).
- **Route-level `loading.tsx` Suspense fallbacks (11)** — the exact pre-#220 baseline the primitive's own
  doc-comment names ("11 route `loading.tsx` files"). None were migrated; all 11 are raw
  `bg-[var(--color-surface-2)] animate-pulse` divs, a fourth distinct ad hoc convention isolated to just
  these files.

**Headline:** three of the four primitives (`RecordSkeleton`, `StillWorking`, `ActionSpinner`) have never
been imported by any screen since #220 merged. The fourth (`ListSkeleton`) has exactly one adopter. Every
ad hoc convention #220's own changelog named as the reason for building these primitives is still fully
intact, plus a previously-uncatalogued 37-file teacher-portal convention and a second competing CSS class
the changelog never mentioned.

---

## 3. Row/action primitives (ListRow · ActionSheet · RecordActionBar · ExpandableRow)

`ListRow` (§03) is a standard row: avatar/title/meta/badge/chevron/three-dot, chevron glyph-swaps
(`ChevronRight`/`ChevronLeft`) for RTL rather than mirroring by transform. `ActionSheet` (§04) is the sheet
a row's three-dot opens; its `managerOnly` flag is a visual label only, not a permission gate — callers
must still check permissions themselves. `RecordActionBar` (§05) is a pinned bar (e.g. bulk/multi-select)
whose "More" opens the same `ActionSheet`. `ExpandableRow` (§06) expands in place to reveal up to three
inline actions, "More" opening the same sheet for anything beyond three.

### ListRow — 5/14 (35.7%)

**Real adopters:** `components/admin/AnalyticsGrowthHeader.tsx`, `admin/referrals/page.tsx` (top
referrers), `admin/internal-team/page.tsx`, `(admin)/admin/teacher-links/page.tsx` (4 usages),
`dashboard/page.tsx` (today's schedule rows — landed via PR #247 this session, verified true by direct
code inspection, not taken on the change log's word).

**Ad hoc (9):** `students/page.tsx` (Center-Students §01 — mobile roster card literally copy-pastes
ListRow's own Tailwind classes), `teacher/AllStudentsList.tsx`, `teacher/PrivateGroupsSection.tsx`,
`components/admin/PlatformOverviewHeader.tsx` (Admin-Platform §01 — **re-implements ListRow's own
RTL chevron-swap line verbatim**), `settings/general/page.tsx`, `settings/money/page.tsx`,
`components/attendance/ScanTab.tsx`, `rooms/page.tsx` (grid card, not a stacked row — same functional
job), `groups/page.tsx` (same grid-vs-row caveat).

### ActionSheet — 1/3 (33.3%)

**Adopted (3 Aug):** `groups/page.tsx` — the per-card `MoreVertical` → `role="menu"` Delete popover is
now the shared sheet, same single action, plus the §04 consequence line (`groups.deleteGroupConsequence`).

**Ad hoc:** `admin/centers/page.tsx` (per-row `MoreVertical` → hand-built `role="menu"` panel:
viewDetails/suspend/blacklist/reactivate/changePlan/delete), `rooms/page.tsx` (per-card `MoreVertical` →
`role="menu"` Edit/Delete).

### RecordActionBar — 0/4 (0%)

**Ad hoc:** `admin/centers/page.tsx` (inline, not pinned, bulk toolbar), `students/page.tsx` (genuinely
pinned/floating bar — the closest hand-rolled match to the primitive's own contract in the repo),
`(admin)/admin/card-orders/[orderId]/AdminCardOrderDetailClient.tsx`, `(admin)/admin/referral-rewards/page.tsx`
(weaker match — static, not selection-conditional).

### ExpandableRow — 0/1 (0%)

**Ad hoc:** `components/students/SwipeRow.tsx` (used by `students/page.tsx`) — a fully custom
touch-handler component revealing 4 actions via swipe instead of tap-to-expand; same job, different
mechanism, no shared code.

### Re-confirmation of the 3 non-adopters named in `PER-FILE-PROMPT.md` at #220 time

1. **`admin/centers/page.tsx` — still ad hoc**, for both `ActionSheet` and (newly found)
   `RecordActionBar`. No `@/components/patterns` import anywhere in the file.
2. **`rooms/page.tsx` — still ad hoc.** PR #248 (merged 31 July) wired real `onClick` handlers into the
   pre-existing hand-rolled kebab menu ("the 'More' kebab existed with no onClick — now opens working edit
   and delete") — that fix is real, but it made the ad hoc dropdown *functional*, not *converted*. The two
   are different facts; a reader skimming the change log could conflate them.
3. **`dashboard/page.tsx` — the PR #247 claim is true, verified directly, but incomplete.** The schedule
   rows genuinely import and render `ListRow` now (no menu needed — the row navigates straight to
   attendance). The page still has a second, unrelated hand-rolled `role="menu"` dropdown in its header
   ("more actions" → Export Data) that #247 never touched, since it was never a row-level menu.

### Excluded, named explicitly

`components/teacher/schedule/SlotActionSheet.tsx` — name collision with the shared `ActionSheet`, but a
completely different, much richer multi-phase live-class-management drawer; out of scope, not ad hoc.
Several `ExpandableRow`-shaped candidates (`GroupClassesTab.tsx`, `OrdersPageClient.tsx`,
`MyTeachersPanel.tsx`, `admin/privacy-requests/page.tsx`, `AtRiskPanel.tsx`, `OnboardingChecklist.tsx`,
`GroupProposalsSection.tsx`/`GroupProposalsTab.tsx`) were excluded — all are read-only "view more"
disclosures (a log, a JSON viewer, a chart toggle), not action-reveal rows.

---

## Cross-cutting findings

- **The `EmptyState` naming collision is a standing hazard, not just an adoption gap.** Two components
  with the same name means any future grep for "who uses EmptyState" will silently over-count again,
  exactly as #220's "11 adopters" figure appears to have done. Worth a deliberate rename or deletion of
  `empty-states/EmptyState.tsx`, independent of how fast the 4 files using it get migrated.
- **Two competing CSS shimmer classes** (`chq-skeleton`, `.skeleton`) do the same visual job with no shared
  component behind either — a smaller version of the same naming-collision risk.
- **The teacher portal is a wholly separate design-pattern universe.** Zero of its ~37 loading-state files
  and none of its EmptyState files touch any of the primitives audited here — it was apparently never in
  scope for #220's "9 files"/"11 route `loading.tsx` files" baseline count at all.
- **One conversion moves six screens:** `src/components/charts/ChartCard.tsx`'s loading spinner is shared
  by `ceo`, `dashboard`, `(dashboard)/branches`, `admin`, `admin/analytics`, and `(dashboard)/analytics` —
  the single highest-leverage fix on this entire ledger.
