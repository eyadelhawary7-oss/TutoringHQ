# Redesign change log

**One row per merged PR, newest last.** Started 28 July 2026 with the token layer.

## How to use this

When a screen or a route misbehaves, look it up here **before touching anything**. Find the row
that last touched it, read what that PR changed, and start there.

- **Screens touched** — named as in the merged design files (`Center-Home §01`, `Public-Legal §03`).
- **Routes touched** — live paths, not file paths (`/{locale}/dashboard`).
- **ALL screens** — a PR that changes a shared foundation (tokens, `globals.css`, a layout, a shared
  component) is logged as affecting ALL screens. That is the one case this log cannot narrow down,
  so it says so rather than listing a subset and reading as if the rest were untouched.
- **SW_VERSION** — the value in `public/sw.js` after the PR. Unchanged rows repeat the previous
  value; a bump means the service worker purged its caches on the next load.

## The six protected files

`Public-App`, `Center-Money`, `Teacher-Money`, `Admin-Money`, `Verification-Payouts` and
`Lifecycle` are money and auth. They do not appear in this log because no PR here touches them.
If a row ever names one, that row is a mistake.

## Log

| PR | SHA | Date | Screens touched | Routes touched | SW_VERSION |
|---|---|---|---|---|---|
| [#209](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/209) | `f049df7` | 2026-07-28 | **ALL screens** — the type, radius and colour scales move under every screen at once | **ALL routes** — `src/app/tokens.css` (new) is imported by `src/app/globals.css`, which `src/app/[locale]/layout.tsx` loads for every locale-prefixed route | v26 → v27 |
| [#210](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/210) | `d5551d3` | 2026-07-28 | none — doc only | none | v27 |
| [#211](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/211) | `20a0d74` | 2026-07-28 | none — migration file only, and **not yet applied to production** | none | v27 |
| [#212](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/212) | `9840c1c` | 2026-07-28 | none — doc only | none | v27 |
| [#214](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/214) | `da69648` | 2026-07-29 | `Center-Home §01` (dashboard), `Center-Home §02` (notifications) — plus `KpiCard` and `SectionHeader`, which are shared, so treat as **ALL screens** for those two components | `/{locale}/dashboard`, `/{locale}/notifications`, and the notification bell in the dashboard chrome | v27 → **v28** |
| [#213](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/213) | `2fc494a0` | 2026-07-29 | none — migration + schema snapshot only | none | v28 |
| [#215](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/215) | `e4978632` | 2026-07-29 | **ALL screens** — 1098 `teal-*` utilities across 11 shades were resolving to Tailwind's default palette, not §4 | **ALL routes** — `src/app/tokens.css` and `src/app/globals.css`, both loaded by every locale-prefixed route | v28 → **v29** |
| [#216](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/216) | `478ac860` | 2026-07-29 | `Center-Students §01`–`§04` (roster, detail, verified, import & pending) | `/{locale}/students`, `/students/[id]`, `/students/import`, `/students/pending` | v29 → **v30** |
| [#218](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/218) | `d755a8c3` | 2026-07-29 | `Center-Groups` | `/{locale}/groups` | v30 → **v31** |
| [#217](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/217) | `7c787fe9` | 2026-07-29 | none — billing cron | none | v31 |
| [#219](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/219) | `90a575d1` | 2026-07-29 | none — doc only | none | v31 |
| [#220](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/220) | `0551992f` | 2026-07-29 | `Design-Patterns §01–§06` — **ALL screens** once adopted: `EmptyState` has 11 adopters today | none yet — primitives only, adoption is per-file | v31 → **v32** |
| [#221](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/221) | `61d5cda4` | 2026-07-29 | `Admin-Accounts §01` (centre half), `§02`, `§03` (**R5**, new route), `§04` | `/{locale}/admin/centers/[id]`, `/{locale}/admin/internal-team`, `/{locale}/admin/teacher-links` (**new**), `/{locale}/admin/referrals` | v32 → **v33** |
| [#222](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/222) | `6a072c80` | 2026-07-30 | `Admin-Accounts §02` — the member sheet's toggles now persist to `public.permissions` | `/{locale}/admin/internal-team`, plus every admin gate that resolves a permission set | v33 |
| [#223](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/223) | `f129b0ca` | 2026-07-29 | `Admin-Accounts §01` — the attendance KPI, which had never computed | `/{locale}/admin/centers/[id]` | v33 |
| [#224](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/224) | `b7a49e9c` | 2026-07-30 | `Admin-Platform §01`–`§06` | `/{locale}/admin`, `/admin/analytics`, `/admin/platform-config`, `/admin/whatsapp-pack`, `/admin/promo-codes`, `/admin/privacy-requests` | v33 → **v34** |
| [#225](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/225) | `d9c37b6f` | 2026-07-30 | `Teacher-Home §02` — the 0-enrolled warning cue on a schedule card | `/{locale}/teacher/schedule` | v34 → **v35** |
| [#226](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/226) | `0c878ab9` | 2026-07-30 | `Teacher-Students §01`, `§02` | `/{locale}/teacher/students` (`AllStudentsList.tsx`) | v35 → **v36** |
| [#227](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/227) | `ea200f6e` | 2026-07-29 | `Teacher-Setup §01` (surveyed, already complete — no change), `§02` (You-earn figure, centre/group counts) | `/{locale}/teacher/centers`, `/{locale}/teacher/settings` (surveyed, unchanged) | v36 → **v37** |
| [#229](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/229) | `03d523b1` | 2026-07-29 | `Teacher-Groups §01`, `§02`, `§03` (avatar chips, subtitle, request-detail fields, contact buttons) | `/{locale}/teacher/groups`, `/{locale}/teacher/groups/[groupId]` | v37 → **v38** |

*The SHA of a squash merge is only knowable after the merge, so the newest row carries `(on merge)`
until the next PR fills it in. That is how `#209`'s own row was filled by `#210`, and `#214`'s by
this one.*

### Notes per PR

**Token layer (28 July 2026)** — wires `design/TOKEN-SPEC.md` into the app. `src/app/tokens.css` is
the single declaration site for §1 spacing, §2 type, §3 radii and the §4 colour tokens; every
legacy alias in `globals.css` now resolves through it. What moved:

| | Was | Now |
|---|---|---|
| `text-xs` | 12px | 11px |
| `text-sm` | 14px | 12px |
| `text-base` | 16px | 13px |
| `text-md` | — | 15px (new) |
| `text-lg` | 18px | 17px |
| `text-xl` | 20px | 22px |
| `text-2xl` | 24px | 30px |
| `text-3xl` | 30px | 30px (unchanged — see spec correction) |
| `rounded-sm` | 4px | 8px |
| `rounded-md` | 8px | 12px |
| `rounded-lg` | 12px | 16px |
| `rounded-xl` | 16px | 24px |
| `rounded-2xl` | 20px | 24px |
| ink (body text) | `#1b201d` | `#14181a` |
| `surface-2` / `surface-3` | `#f8f4ec` / `#eceee9` | both `#f2eee5` (`tile`) |
| `surface-4` | `#dcd7c9` | `#d8d3c6` (`canvas`) |
| `text-disabled` | `#a6a79d` | `#a09a8e` (`faint`) |
| `text-amber` / `warning` | `#8a5e16` | `#9a6b1f` (`brass`) |
| `brass-soft` | `#f1e8d6` | `#f4ebd7` (`sand`) |
| `--radius-card` | 18px | 16px |
| `--radius-modal` | 20px | 24px |

Arabic frames (`html[lang="ar"]`) take one step up on `text-xs`/`text-sm`/`text-base` only — 12/13/15
instead of 11/12/13. Headings are identical in both languages.

Two token names changed meaning and are the ones to suspect if a colour looks wrong:
`--color-accent` was the mint fill and is now the teal primary action (the old value is
`--color-mint`); `--color-muted` was a quiet surface and is now tertiary text (the 23 `bg-muted`
sites moved to `bg-tile` in the same commit).

**Spec correction landed in this PR.** `TOKEN-SPEC.md` §2 gave `text-3xl` as 44px, derived from
design-file mastheads. In the product that token backs KPI figures in 14 places, so 44 was a
design-file role mapped onto a product token. Corrected to **30px** — see the dated correction
block in `design/TOKEN-SPEC.md` §2. `text-2xl` and `text-3xl` are both 30px as a result, which
flattens the ~20 `text-2xl md:text-3xl` responsive pairs. Nothing breaks.

**Center Home restyle (29 July 2026)** — the first Task 3 screen area. Styling only; no route, no
query, no calculation and no button behaviour changed.

**§01 Center Dashboard.** `KpiCard` and `SectionHeader` are shared components, so this row is the
one to suspect if a KPI tile or a section label looks wrong anywhere in the app, not just on the
dashboard:

| | Was | Now | Why |
|---|---|---|---|
| KPI tile | borderless, `surface-2`, `rounded-lg` | `panel` + 1px `line` border, `rounded-md` | the design's `.kpi` — the border is what makes it read as a card on paper |
| KPI value | `text-xl md:text-2xl`, weight 500 | `text-lg` (17px), weight 700 | the design's `.kv`; the responsive pair collapsed anyway once `2xl` and `3xl` both became 30 |
| KPI `warning` tone | Tailwind `amber-500` | `--color-brass` | amber is not in §4 |
| KPI `danger` tone | Tailwind `red-500` | `--color-danger` | red-500 is not in §4 |
| KPI `success` tone | `--color-success` | unchanged | §4 has no success slot — see `BUILD-AFTER-REDESIGN.md` F4 |
| Section label | `text-xs` weight 500 | `text-md` weight 700, optional sub-label | the design's `.sec` / `.sub` |
| Plan pill | `text-teal-300` on inline `rgba(13,148,136,.2)` | `mint` fill, `accent-deep` ink, `rounded-pill` | the old teal was `brand-500`, not a §4 colour |
| Cards, menus, skeletons | `rounded-xl`, `border-subtle` | `rounded-md` / `rounded-lg`, `line` | §3 radii, §4 borders |

**§02 Notifications.** Covers `/{locale}/notifications` and the `NotificationBell` dropdown, which
is the same feed in a smaller frame and had drifted from it:

| | Was | Now | Why |
|---|---|---|---|
| Unread row | tinted fill (`teal-500/5`) | accent hairline + an 8px accent dot, same `panel` fill as a read row | the design's `.nrow.unread`; a screen of unread rows now reads as a list, not one coloured block |
| Bell badge | `bg-red-500` | `--color-accent` | red is `--color-danger` in §4 and it means money is wrong; unread is not an error |
| Icon tints | five unrelated Tailwind palettes (`emerald`/`amber`/`teal`/`sky`) | mint-on-accent, sand-on-brass, and one neutral | the design collapses to three tints |
| Icon chip | `rounded-full`, 32px, 15px glyph | `rounded-md`, 38px, 19px glyph | the design's `.nic` |
| Group heading | `text-xs` uppercase, tracking-wide | `text-base` sentence case | the design's `.sec` is not uppercase, and Arabic has no case — the eyebrow treatment only ever read as intended in English |
| Mark-all-read | bare teal text link | mint pill, `accent-deep` ink | the design's `.markall` |
| Row age | `--color-text-muted` | `--color-faint` | the design's `.ntime` |

**Deliberately not changed.** `KIND_RULES` in `NotificationsPageClient.tsx` — which notification
kind gets which tone — is classification, not styling. One visible consequence: the design tints
"Identity verified" as positive, while the app files anything matching `verif`/`identity` under
`system` and renders it neutral. Reconciling that means editing the rules, so it waits for the
feature pass.

**No new controls.** The design's §01 frames show a balance card, a digital-share meter and a
day schedule that the live dashboard has no data for, and §02 shows notification kinds nothing
writes yet. None were rendered — no placeholder figures, no disabled shells. They are already
logged in `BUILD-AFTER-REDESIGN.md`.

**Teal scale folded onto §4 (29 July 2026)** — a foundations PR, not a screen. Read this one first
if a teal anywhere in the app looks different.

**What was wrong.** The token layer (#209) never reset Tailwind's `teal-*` namespace, so **1098
teal utilities across 11 shades** were resolving to Tailwind's default palette instead of §4.
`bg-teal-600` compiled to `#009689`; the §4 accent is `#0e6b61`. Two utilities had been patched by
hand in `globals.css` with `!important` — `.bg-teal-600` and `.hover:bg-teal-700` — which is why
this was hard to see: the most visible case looked right while ~1096 others did not. Those three
patches are deleted here and the whole scale is mapped at source.

| shade | uses | before | after | token |
|---|---|---|---|---|
| `teal-50` | 23 | `#f0fdfa` | `#dfeeeb` | `mint` |
| `teal-100` | 46 | `#cbfbf1` | `#bfe3dd` | `mint-deep` |
| `teal-200` | 13 | `#96f7e4` | `#bfe3dd` | `mint-deep` |
| `teal-300` | 16 | `#46edd5` | `#bfe3dd` | `mint-deep` |
| `teal-400` | 27 | `#00d5be` | `#0e6b61` | `accent` |
| `teal-500` | 249 | `#00bba7` | `#0e6b61` | `accent` |
| `teal-600` | 487 | `#009689` | `#0e6b61` | `accent` |
| `teal-700` | 203 | `#00786f` | `#0a514a` | `accent-deep` |
| `teal-800` | 23 | `#005f5a` | `#0a514a` | `accent-deep` |
| `teal-900` | 8 | `#0b4f4a` | `#083f39` | `ground` |
| `teal-950` | 3 | `#022f2e` | `#083f39` | `ground` |

### 45 buttons now DARKEN on hover instead of lightening. That is deliberate.

This is the change someone will notice, so here is the answer in advance.

Two contradictory conventions existed for the same gesture: `bg-teal-600 hover:bg-teal-700`
(**129 uses**, darkens) and `bg-teal-600 hover:bg-teal-500` (**45 uses**, lightens). Collapsing
11 shades onto 5 tokens would have made the second group's hover **disappear entirely** — base and
hover both landing on `accent`.

`TOKEN-SPEC` §4 documents `accent-deep` as *"pressed, text on mint"*. **Darker on interaction is the
design's rule**, so the 129 were right and the 45 were drift. All 45 were rewritten to
`hover:bg-teal-700` in the same commit, because it is one concern and splitting it across 21 files'
worth of future screen PRs would have left the app inconsistent for weeks.

**A lighter accent was looked for and deliberately not invented.** `#0f766b` appears **96 times**
across the merged design files, which looked like a candidate — but all 96 are the stop in
`linear-gradient(150deg,#0f766b,#083f39)`, the logo mark. **Zero solid fills.** Promoting a gradient
stop to a button hover would have given it a role the design never assigned, so the answer was to
follow §4 instead of adding a colour to it.

### Two other collisions, found before mapping and fixed in it

- `analytics/page.tsx:288` — `bg-teal-50` with `border-teal-100/80`, a fill against its own border.
  Both would have become `mint`. Fixed by mapping `teal-100` → `mint-deep`; they now resolve to
  `#dfeeeb` and `#bfe3ddcc`, still distinct.
- `admin/billing/page.tsx:442` — `hover:bg-teal-700` with `active:bg-teal-800`, hover against
  active. Both would have become `accent-deep`. Fixed by mapping `teal-900` → `ground` and moving
  that one call site to `active:bg-teal-900`.

### Where the change is actually visible

Roughly **85% of the unpatched teal utilities are on authenticated screens** — `text-teal-600` is
in 42 authenticated files against 5 public ones, `border-teal-*` 41 against 8. Public marketing
pages are dominated by `bg-teal-600`, the one utility the old `!important` patch already made
correct, so they barely move. Dashboards, settings and admin move a lot.

Declared as 11 explicit numeric shades rather than `--color-teal-*: initial`, because
`--color-teal`, `--color-teal-deep` and `--color-teal-soft` are §4 aliases living in `globals.css`'s
own `@theme` block and a namespace reset would have taken them with it and broken `.btn-primary`.

### The full hover sweep — 64 sites, two groups, one rule

Extended on Eyad's instruction after the first pass fixed only the 45 he had counted. His reasoning:
fixing half would leave a product where some buttons darken on hover and others lighten with **no
rule anyone could state**, which is worse than either consistent answer. The rule now stateable
across the whole product is **interaction darkens**.

**Group 1 — the accent family, 47 sites.** `hover:bg-teal-500` on a `bg-teal-600` base accounted for
45. Two more were missed by the first pass because its predicate was "does the hover lighten"
rather than "does the hover survive the mapping":

| site | was | now |
|---|---|---|
| `admin/centers/[id]/centerManagementClient.tsx:3585` | `bg-teal-700 hover:bg-teal-600` | `hover:bg-teal-900` — 700 and 800 are both `accent-deep`, so the obvious next step would still have collapsed |
| `reactivate/page.tsx:259` | `bg-teal-500 hover:bg-teal-400` | `hover:bg-teal-700` — 500 and 600 are both `accent` |
| `students/AtRiskPanel.tsx:154` | `bg-teal-100 hover:bg-teal-200` | `bg-teal-50 hover:bg-teal-100` — 100–300 are all `mint-deep`; the base moves down so the hover has somewhere to go |

**Group 2 — outside the accent family, 17 sites.** amber 7, red 6, slate 3, emerald 1. §4 says
nothing about these: `accent-deep` being "pressed" is a rule for the accent, not for amber or red.
They were normalised anyway, because the rule is only stateable if it holds everywhere — red was
already internally inconsistent at 6 lightening against 10 darkening. **This group is the one to
reverse if you disagree**; it is independent of the accent work and touches no token.

**Not a collision, deliberately left alone.** `AdminWaPackClient.tsx:146` is
`bg-teal-600/10 hover:bg-teal-600/20` — the same shade at different **alpha**. The first detector
flagged it because it ignored the `/N` suffix. Its hover works fine and it was not touched.

### `--color-brand-*` — the same bug under a second name

Found while restyling the Students roster, whose row hover was on `--color-brand-500`.

`globals.css` declared a ten-step `--color-brand-*` palette **inside `@theme`**, so it generated
real utilities (`bg-brand-500`, `text-brand-400`) on top of 67 `var(--color-brand-500)` references
across 26 files. The values were Tailwind **v3**'s teal — `brand-500` `#0D9488` (v3 teal-600),
`brand-600` `#0f766e` (v3 teal-700), `brand-300` `#5eead4`. So the app carried **two parallel copies
of the wrong teal**: `teal-*` on v4's defaults and `brand-*` frozen at v3's.

Collision-checked the same way before mapping: **zero** elements pair two brand shades that would
collapse, and there are **zero `hover:*brand*` utilities anywhere**, so no hover direction is
affected. Offset one step from the teal mapping because `brand-500` is v3's 600.

Six hand-written `#0D9488` literals in `globals.css` (a focus outline, two borders, a border-colour,
a shimmer gradient and a fill, lines 1822–2060) moved to `var(--color-accent)` in the same pass.

### ⚠ Where this stops, and why

`#0D9488` is **still hardcoded** in files this PR deliberately does not touch:

| file | why it was left |
|---|---|
| `lib/generateInvoicePdf.ts`, `lib/generateOrderPdf.ts`, `lib/invoiceTemplates.ts` | **money documents.** Invoice and card-order PDFs are Admin-Money / Center-Money territory and their colour is not a UI restyle decision. |
| `components/charts/ChartTokens.ts`, `api/ceo/dashboard/route.ts`, `admin/analytics/page.tsx` | **chart series colours.** Changing these affects data legibility and series distinguishability, which is a separate decision from palette alignment. |
| `lib/tokens.ts` | a third parallel JS copy of the brand palette. Same bug again, but it feeds the two categories above, so it moves when they do. |

These are logged rather than fixed on purpose. Grepping `#0D9488` after this PR will still return
hits, and that is expected, not an oversight.

**Center Groups restyle (29 July 2026)** — the third Task 3 screen area. Styling only.

The cleanest screen so far: only seven off-scale occurrences before the pass, against Students'
hundred-plus. Most of what the design draws was already right, and saying so is a better outcome
than a large diff.

| | Was | Now | Why |
|---|---|---|---|
| Group card | `surface-1`, `rounded-xl`, `border-subtle` | `panel`, `rounded-md`, `line` | §3's 12 is the card/row default |
| Modal | `surface-1`, `rounded-2xl` | `panel`, `rounded-xl` | `rounded-2xl` was a legacy alias already resolving to 24; naming it `xl` puts it on the scale rather than beside it |
| Detail drawer | `surface-1` | `panel` | §4 |
| Dividers | `border-subtle` | `line` | §4 |

**Not changed, and worth recording as deliberate.** The design's `.stat` tile is radius **16**,
while `Merged-Center-Home`'s `.kpi` is **12**. `KpiCard` is shared and was settled at 12 in #214,
and one outlier in one merged file does not justify forking a shared component or adding a size
prop. Both values sit on the §3 scale, so the token layer could not have flagged the difference —
it is a design-file inconsistency, logged in `§5 DESIGN CORRECTIONS` rather than absorbed silently.

**Design-Patterns (29 July 2026)** — the first file through the per-file method, and the first PR
that builds rather than restyles.

Structure coverage **1.5/6 → 6/6**. The 1.5 is the honest starting point: `EmptyState` existed with
11 adopters, which is why it read as done, and five of its six parts were wrong — a bare 48px muted
glyph instead of a 64px mint tile, no type sizes, no measure on the body, and `.es-alt` missing
outright. §02's four loading states all existed but scattered across 9 files as ad hoc markup, not a
named set. §03–§06 did not exist at all.

New in `src/components/patterns/`:

| § | primitive | what it is |
|---|---|---|
| §02 | `ListSkeleton`, `RecordSkeleton`, `StillWorking`, `ActionSpinner` | the four states as a named set |
| §03 | `ListRow` | the `.lrow` row — avatar, title, meta, badge, chevron, three-dot |
| §04 | `ActionSheet` | the bottom sheet, contents supplied by the row |
| §05 | `RecordActionBar` | the pinned bar whose More opens the *same* sheet |
| §06 | `ExpandableRow` | tap expands to three inline actions; More opens the sheet |

**`StillWorking` deliberately offers no retry.** §02's caption is "slow, not an error" — a retry
button invites the user to restart something that is already working, which is how one slow request
becomes two.

**`ActionSheet`'s `managerOnly` is a LABEL, not a gate.** It renders the design's brass `MGR` tag;
the caller still does the permission check. Tagging an action the user cannot perform and letting
them tap it would be worse than not tagging it.

**The chevron swaps glyph rather than mirroring by transform.** A `ChevronRight` under `dir=rtl`
still points right. Swapping to `ChevronLeft` is the only version of "directional icons flip with the
language" that survives a screenshot.

**Adoption is NOT in this PR** — it is per-file, and adopting where an action does not exist would
mean inventing writes. Three screens run their own three-dot menu today and are recorded in
`PER-FILE-PROMPT.md` with the merged file each converts under: `admin/centers` (Admin-Accounts),
`rooms` (Center-Groups §03), `dashboard` (Center-Home §01).

**Admin-Accounts (29 July 2026)** — R5 built as a new route, then §01's centre half, §02 and §04
restructured. Structure coverage **1/4 → 3.5/4**.

The 1/4 is §03, which had nothing at this shape at all; §01, §02 and §04 each had the right route
and most of the wrong screen. Route coverage was 4/4 the whole time, which is exactly why the gap
was invisible.

| § | before | after | what moved |
|---|---|---|---|
| §01 Account detail | 0.5/1 | 0.8/1 | identity header, chips, KPI tiles, MANAGE, ACTIONS — over the existing 11-section form, which is untouched underneath |
| §02 Internal team | 0.4/1 | 1/1 | count header, design list rows, **the member sheet with permission toggles** — which did not exist |
| §03 Teacher links | 0/1 | 0.9/1 | the whole screen: grouping control, three groupings, assign form |
| §04 Referrals | 0.2/1 | 0.8/1 | programme block, commission ladder, top-referrer list with filter chips |

**R5 is `/admin/teacher-links`, NOT `/admin/center-assignments`.** The design's title is "Center
assignments" and the live route of that name is the sales-commission machinery (staff ↔ center).
They share a name and nothing else. The new route reads `teacher_center` and
`teacher_center_requests`; `center_assignments` was not opened.

**The admin assign form opens a REQUEST, it does not create the membership.** Linking a teacher to a
centre is two-sided by design — `/api/center/teacher-links` opens a pending row and the teacher's
acceptance is what writes `teacher_center`. An admin form that inserted an active membership would
let an internal operator attach any teacher to any centre and hand that centre the teacher's roster.
The consent step is the control that prevents it, so the admin form opens the same pending request
with `initiated_by='center'`. This is a deliberate divergence from the drawn "Save assignment".

**The commission ladder is read from the live rule.** `/api/referrals/process-commission` computes
25% in month 1, 10% for months 2–12 and 5% from month 13. The design draws "months 2 to 6" and
"month 7 onward"; that is design correction **D2 — live wins, 10% for twelve months**.
`tests/unit/adminAccountsR5.test.ts` asserts the tier table against the live rule at every month
from 1 to 36, so the screen cannot drift back to the drawing.

**Teachers are shown in free months, not EGP.** `grantReferralReward` pays +1 free month to each
side when a referred teacher clears their first real charge. A teacher referrer never has a cash
balance owed, so the teacher rows carry free months under their own label — "0 owed" would read as a
debt the model never creates.

**Omitted, each for a named missing column:**

| omitted | why |
|---|---|
| §01 Verified chip + "National ID on file · Valify" | no verification column on `centers` — **V1** |
| §01 Branches row | no `branches` table. `branch_user_assignments` records which staff see which branch, not the branches |
| §01 "Log in as center" action | no impersonation exists anywhere in the codebase |
| §01 attendance KPI, when null | a centre with no finished session has no rate; 0% would be a claim the data does not make |
| §02 "Last active 2 hours ago" | `admin_users` has no last-active column. The join date takes that slot |
| §03 "Link type · Visiting / Permanent" | `teacher_center` has no link-type column, so the control would write nowhere |
| §04 SIGNUP REWARD — "100 EGP new customer credit" | no column, no code path, no ledger entry. Nothing in the product does this |

Every one of those was checked in `information_schema` on 29 July, not inferred from a migration
file or from other code naming the column.

**Empty is not missing.** `permissions`, `referrals`, `referral_commissions` and
`referral_reward_records` are all 0 rows in production. Every screen that reads them was built
anyway and renders through `EmptyState`.

**Shared primitives, as required.** `ListRow` and `EmptyState` from `src/components/patterns/` on
all three list screens. `initialsOf` is new and shared — the design's `.av` mark appears on all four
sections, and Arabic takes one glyph rather than two, because two disconnected Arabic letterforms
read as neither name.

**`admin/centers`' own three-dot menu was NOT converted.** `PER-FILE-PROMPT.md` lists it as an
Admin-Accounts adopter, but it lives on the centres *list*, which is `Merged-Admin-Platform` §01,
not a section of this file. It converts there.

**Permissions store (30 July 2026)** — `public.permissions` becomes canonical for admin-portal
permission grants. Eyad's decision, 29 July. No screens changed; this is the store underneath
`Admin-Accounts §02`, which shipped in #221 on the old one.

**Why `permissions` and not the jsonb column.** `admin_users.custom_permissions` is a blob with no
history. `permissions` carries `enabled` and `created_at`, so a grant records who was given what and
when — and a revoked grant is flipped to `enabled = false`, never deleted, so the trail survives the
revocation. Both stores were empty, so nothing was lost in the switch.

**One store, no dual-write.** Nothing reads `custom_permissions` any more and nothing writes it. A
dual-read would be a dual-store with extra steps, and it would let a stale blob silently out-grant
the audited table. `customPermissionsToKeys` was deleted rather than deprecated in place — an
un-called normaliser for a dead column is how a dead column gets re-adopted.

**A migration was needed, and it is the reason this is its own PR.** `permissions.user_id`
referenced `users(id)` — the *centre-tenant* table. Neither `admin_users` row has a matching `users`
row, verified in the live catalog, so the first save would have raised a foreign-key violation for
every admin including the owner. `20260730090000_permissions_canonical_admin_store.sql` repoints the
FK to `admin_users(id)`. Safe: 0 rows, zero code readers before this PR, and the existing RLS policy
`user_id = auth.uid()` is unaffected because both tables key on the Supabase auth user id.

⚠ **Manual apply, and it must land BEFORE the code deploys.** The read path is safe either way, but
`setAdminPermissionKeys` writes against the new FK. Branching never auto-applies to production on
merge.

**Three gates got simpler on the way through.** `/api/admin/centers/[id]`, `/api/admin/centers` and
`/api/admin/renewals` each re-queried `admin_users` for the role and permissions that
`fetchAdminAccessFlags` had already returned. They now read the flags. `AdminAccessFlags.customPermissionKeys`
is renamed `permissionKeys`.

**`admin_users.custom_permissions` is DEAD and pending a drop** — Eyad's call, deliberately not done
here. Logged in `BUILD-AFTER-REDESIGN.md` §6.

**Admin-Platform (30 July 2026)** — six sections, no backlog entries, no
decisions outstanding. Structure coverage **2.0/6 → 4.55/6**.

| § | before | after | what moved |
|---|---|---|---|
| §01 Overview | 0.35/1 | **0.85/1** | MRR hero + MoM, the centres-vs-teachers CUSTOMERS split, four tiles, REVENUE MIX, JUMP TO |
| §02 Analytics | 0.2/1 | **0.8/1** | All/Centers/Teachers segment, growth tiles, TOP BY REVENUE, BY PLAN |
| §03 Platform | 0.4/1 | **0.65/1** | FEATURES and SYSTEM groups over the flat config list |
| §04 WhatsApp Pack | 0.15/1 | **0.5/1** | the sender's Meta template list, grouped by real category |
| §05 Promo Codes | 0.5/1 | **0.7/1** | Active / Redemptions / Given tiles |
| §06 Privacy Requests | 0.4/1 | **0.75/1** | Open / Due soon / Closed counts and the type filter |

**The overview API only ever knew about centres.** TutoringHQ serves two
customer types and the design leads §01 with the split across both. The teacher
half comes from `teacher_subscriptions` (accounts, MRR) and `enrollments` in the
teacher's own `kind='private'` `student_groups` (students).

**The centre student figure filters `center_id IS NOT NULL`.** `students.center_id`
is nullable and a solo teacher's students are rows with no centre. Live data:
2 students with a centre, 2 without. The unfiltered `totalStudents` is still
right for the "Active students" tile, but as the centre row it would absorb the
teacher row and double-count.

**Centre plans and teacher plans stay separate ladders.** `solo/nano/starter/pro/
business/enterprise` and `teacher_standard/teacher_pro/teacher_scale` are
different prices; a merged "Pro" bucket is a number nobody can act on.

**REVENUE MIX is paid-this-month by `invoice_type`, not a decomposition of MRR.**
The design draws Subscriptions + Add-ons + WhatsApp packs summing to the MRR
hero. They do not sum to it — subscriptions and the parent pack recur, WhatsApp
packs are a one-time top-up. The caption says so on the screen.

**Omitted, each with the exact reason:**

| omitted | why |
|---|---|
| §01 Unverified filter chip | **V1**, Valify |
| §01 `/admin/teachers` frame | **R7** — built 28 July, closed unmerged on Eyad's call, one teacher console not two |
| §02 "Platform fees" | the processing fee lives in `invoices.metadata.processing_fee`, a jsonb key with no column or aggregate |
| §02 per-account student counts | needs a per-centre roll-up this endpoint does not compute |
| §03 Referrals, Attendance scanner, App version, Force update | no `platform_config` key at all |
| §03 Card orders switch | gated per-centre on `centers.card_orders_enabled`, so a global switch is not that control |
| §03 INTEGRATIONS + PAYMOB DETAIL | no integrations table. `vendors` is card-printing suppliers |
| §04 the funding grouping | the design groups templates by who pays — customer credit / company paid / separate credit. No column records funding |
| §04 per-template On/Off | `wa_meta_templates` has no enabled column; Meta's `status` is the only state |
| §05 Fixed EGP, Free month, applies-to, first-month-only | `promo_codes` has `discount_pct` and nothing else — four absent columns |
| §06 request-detail "WILL BE DELETED" counts | `privacy_requests` has no link to a centre or account to join them to |

**§04 is the section left short at 0.5.** Its overview frame — outstanding
credit, notifications-vs-promotions volumes, cost to send and delivered/failed
rates — is buildable: `whatsapp_usage` carries `message_type`, `template_type`,
`meta_cost`, `overage_charge`, `status` and `delivered_at`. It is 0 rows today,
which is not a blocker. It was not built here because the frame also shows cost
and margin per message class, and pricing what a message is "sold at" is a money
decision, not a restyle.

**Teacher-Home (30 July 2026)** — the first "likely done, survey first" file, and it was. Structure
coverage: §01 (unverified/self-collect state, the only one that renders for any teacher today) **6/7**;
§02 **now matches** after one real gap.

**Independently re-verified before reporting, not just re-read.** Three agents blind to each
other's findings compared the design against the live code from scratch, specifically hunting for
a Center-Home-style false "already done." All three, then a fourth reconciling pass with its own
direct `information_schema` checks, converged on the same two facts:

- **Verification (V1) does not exist.** No column, no table, nothing — confirmed against the live
  catalog, not inferred from other code's comments about it.
- **Teacher balance/collection (V3/V4) does not exist.** No teacher-scoped payout ledger anywhere.
  `payout_requests` is centre-scoped, `commission_payouts` is EH-staff-scoped. Neither is it.

**§01's "verified (we collect)" state — the balance card, pending amount, recent payouts — is
entirely blocked on V1/V3/V4** and was not built. It cannot render for any teacher today; building
it would mean inventing a balance nobody can ever actually have. The one gap in the buildable
unverified state, the "Let us collect for you / Verify my ID" promo card, is the same block — no
verification to link to, so no card.

**A real finding logged for whoever eventually builds V4:** `transactions.settlement_status` /
`expected_settlement_at` / `settled_at` / `settlement_retry_count` and
`teacher_profiles.payout_destination` all exist in the live schema and are entirely dormant — 0 rows
touched, zero code references. Schema groundwork, not a partial feature. See `BUILD-AFTER-REDESIGN.md`
V4.

**§02 Teacher Schedule had exactly one real gap.** The design's second example card overrides its
left accent bar from teal to brass specifically on the 0-enrolled class — confirmed in the raw
markup (`style="background:#9a6b1f"` on that one card only), not a color guess. Added as a real
warning cue: brass when `enrolled_count === 0` and the class isn't cancelled, teal otherwise.
Everything else in §02 — Today/Week toggle, class cards, the Attendance action, the empty state —
already matched.

**Observed, not fixed:** the design's single unverified mockup shows the populated "This
month"/"My groups" tiles and the "Grow your private practice" income calculator on the same screen.
Live, they are mutually exclusive — the calculator is gated to `!hasPrivateAccess`, the tiles to
`hasPrivateAccess`. No real teacher account can see both at once. This is a product-eligibility
question (should the calculator also show for an active private teacher?), not a data gap, so it
was not changed here.

**Teacher-Students (30 July 2026)** — the second "likely done, survey first" file. §01 was close;
§02 (Student Detail) had real gaps, including one genuine money-touching write the design draws
that was NOT built here.

**§01 Students list — built:** the design's avatar initial per row, the "N students" count header,
and the group filter converted from a plain `<select>` to a segmented pill row — matching both the
design's drawn chips and the app's own Today/Week segment already on `/teacher/schedule`, rather
than two different filter conventions in the same portal.

**§02 Student Detail — built, all read-only:**
- **Parent contact.** The design draws a Parent row alongside Student; live had none.
  `students.parent_phone` already exists on the same row the route was already querying — one
  column added to an existing, already-scoped select. The centre-side student detail page already
  surfaces this same column to staff, so this is an established pattern, not a new exposure.
- **Call / Message quick actions**, `tel:`/`wa.me` links, for both student and parent. Purely
  client-side links; the DISPLAYED number stays masked exactly as before, only the `href` uses the
  real digits.
- **Attendance** — "N% · present M of N" — a genuinely new read-only computation. Added
  `attendanceForStudent` in `teacherAnalytics.ts`, same shape as the existing `attendanceRatePerGroup`
  (#4) but per-student: finished sessions in the student's own groups since THEIR OWN
  `enrollments.joined_at`, so a student is never counted absent for a class held before they
  enrolled. `rate` is `null`, not `0`, when there is nothing to measure yet.
- **"N classes not yet collected"** — the design's caption under Outstanding. Already-computable from
  existing per-student transaction data; added `StudentBilling.pendingCount` alongside the existing
  `outstanding` aggregate.

**⚠ NOT built, and flagged rather than silently omitted: "Mark collected" and "Send reminder".**
The design draws both as buttons on the same Balance card. `Mark collected` would reuse the existing,
already-audited `/api/teacher/private/transactions/[id]/mark-paid` endpoint (used today from
`GroupClassesTab` and the session-detail page) — reusing it here is plumbing, not new money logic.
`Send reminder` has no existing per-student manual trigger; the only related code is a bulk nightly
cron. Both are a money-state-adjacent WRITE on a screen with no protected-file wall, which is
exactly the class of thing that comes to Eyad regardless of file name. Not built; raised as an open
question rather than assumed either way.

Full survey, before/after fractions and the flagged question are in PR #226.
