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

**Re-measured live on 4 August 2026 (adoption pass).** The 31 July figures below are kept in the
right-hand columns because the point of this ledger is the trend, not a snapshot. Every number in both
columns comes from a grep of the actual import identifiers across `src/`, run on the day it is dated —
none is carried forward from a changelog claim.

| Primitive | 31 Jul adopters | 4 Aug adopters | Denominator | 31 Jul | 4 Aug |
|---|---|---|---|---|---|
| `EmptyState` (`shared/EmptyState.tsx`) | 11 files | **37 files** | 72 | 15.3% | **51.4%** |
| Loading states (`ListSkeleton`/`RecordSkeleton`/`StillWorking`/`ActionSpinner`) | 1 file | **11 files** | 137 | 0.7% | **8.0%** |
| `ListRow` | 5 | **6** | 14 | 35.7% | **42.9%** |
| `ActionSheet` | 0 | 4 | 5 | 0% | 80% |
| `RecordActionBar` | 0 | 1 | 5 | 0% | 20% |
| `ExpandableRow` | 0 | 1 | 2 | 0% | 50% |
| **Composite** | 23 | **60** | 235 | **9.8%** | **25.5%** |

**Two corrections to the 31 July table, both found by re-running its own greps rather than reading it.**
(a) `ActionSheet`, `RecordActionBar` and `ExpandableRow` were no longer at zero before this pass began —
`rooms/page.tsx`, `groups/page.tsx`, `schedule/page.tsx` and `(dashboard)/branches/page.tsx` had adopted
them in the per-file sweeps that ran after 31 July, and the denominators grew accordingly (a file that
adopts a primitive it was never listed as a candidate for still belongs in the fraction). (b) The
`EmptyState` section below lists `students/page.tsx` as a real adopter "migrated 31 Jul, #292" — it was
not one. The file had no `EmptyState` import at all when this pass opened it; its empty branch was
hand-rolled inline with a note claiming the primitive could not produce the shape. It is a real adopter
now, from this pass.

`ActionSpinner` remains the one primitive with **zero adopters anywhere**, confirmed by grepping the exact
identifier outside `src/components/patterns/`. `LoadingButton` (`ui/LoadingButton.tsx`) is the competing
component that occupies its job; which of the two survives is a real decision and is not made here.

### What this pass built (4 August 2026)

- **26 new `EmptyState` adopters**, all screen- or card-level states, each keeping its existing i18n
  strings — no empty state was given invented copy.
- **10 new loading-state adopters**, including the three primitives that had never been imported:
  `RecordSkeleton` (`teacher/AnalyticsView.tsx`) and `StillWorking` (`charts/ChartCard.tsx`).
- **`charts/ChartCard.tsx`** — the single highest-leverage item on this ledger, called out as such by its
  own cross-cutting findings section. Its centred CSS spinner violated §02's "never a spinner in the
  middle of an empty screen" on six screens at once (`ceo`, `dashboard`, `(dashboard)/branches`, `admin`,
  `admin/analytics`, `(dashboard)/analytics`). It now draws the shape of the chart that is coming and
  escalates to `StillWorking` after six seconds.
- **`globals.css` reduced-motion branch.** §02's rules block says "Respect reduced motion. The sweep
  already switches off under `prefers-reduced-motion` and must stay that way." It did not — neither
  `.chq-skeleton` nor `.skeleton` nor Tailwind's `animate-pulse` carried a reduced-motion branch, so every
  skeleton in the app swept regardless of the OS setting. This is a §02 rule the design believed was
  already honoured; it is honoured now, on every screen at once.
- **Two primitives completed against their own design sheets**: `EmptyState` gained §01's `.es-ic.quiet`
  variant (`#F2EEE5` on `#80827A`, the "empty because it is early gets the muted icon and no button" case,
  which had no expression in the component at all), and `SheetAction` gained §04's `.al .s` sub-label line,
  which every action in §04's frames carries. `ListRow` gained `href` and `icon`.

### Not converted, with the reason (these are blocks, not backlog)

- **`students/page.tsx` bulk bar → `RecordActionBar`.** The primitive requires `onMore`, and §05's whole
  point is that More opens the same sheet the row's three-dot opens. A roster multi-select has exactly one
  action (add the selected students to the card cart), so More would open nothing or a sheet of invented
  bulk actions. This is the shared-primitive rule's own "if the primitive cannot do what the screen needs,
  stop and say so" case.
- **`students/page.tsx` row kebab → `ActionSheet`.** Blocked on behaviour, not shape. The menu carries the
  per-student **parent-pack opt-in**, a paid-WhatsApp entitlement toggle rendered as a `menuitemcheckbox`
  with a checked indicator and two disabled-reason tooltips. `SheetAction` has no checked state, and the
  action itself is an entitlement write — protected-behaviour, so it goes to Eyad rather than being
  restyled around.
- **`admin/centers/page.tsx` → `ActionSheet` + `RecordActionBar`**, the last named `ActionSheet` candidate.
  Its row menu is suspend / blacklist / reactivate / change-plan — `Lifecycle` behaviour wherever it lives,
  so protected. Unchanged, logged.
- **The 11 route-level `loading.tsx` files.** The 31 July entry called these "a fourth distinct ad hoc
  convention". Reading them shows the opposite: each is deliberately shaped to mirror its own page's
  in-page skeleton, with a doc comment explaining that any difference between the two is a visible flash of
  one skeleton being replaced by another. Swapping them for `ListSkeleton` would re-introduce exactly the
  defect they were written to fix, and would break §02's own first rule ("a skeleton that matches the real
  row height means nothing jumps"). They are correct as they stand; the convention count was the wrong
  measure for them.
- **Money-file empty states** (`payments`, `BillingPageClient`, `IncomeView`, `BillingHistory`,
  `admin/withdrawals`, `admin/billing`, `admin/health`, `AdminFinanceClient`, `admin/payouts`,
  `admin/referral-rewards`, `AdminCardOrderDetailClient`). Protected files. Untouched.

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

### ActionSheet — 0/3 (0%)

**Ad hoc:** `admin/centers/page.tsx` (per-row `MoreVertical` → hand-built `role="menu"` panel:
viewDetails/suspend/blacklist/reactivate/changePlan/delete), `rooms/page.tsx` (per-card `MoreVertical` →
`role="menu"` Edit/Delete), `groups/page.tsx` (per-card `MoreVertical` → `role="menu"` Delete).

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
