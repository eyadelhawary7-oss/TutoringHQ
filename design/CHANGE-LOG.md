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
