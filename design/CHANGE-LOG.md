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
| [#231](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/231) | `8c021fbf` | 2026-07-29 | `Center-Orders §04` (**R8**, card teaser) | `/{locale}/orders` (disabled-gate branch only) | v38 → **v39** |
| [#233](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/233) | `52b8bc2b` | 2026-07-29 | none — doc only (**D22** logged; R6 held) | none | v39 |
| [#235](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/235) | `4b4a1e52` | 2026-07-30 | `Center-Groups §01` (segmented tabs, stat fix), `§04` (KPI reposition), `§05` (week strip) — partial, see F11 for what's left | `/{locale}/groups`, `/{locale}/schedule`, `/{locale}/branches`, plus `/api/parent/portal` (timezone bug, unrelated to the redesign) | v39 → **v40** |
| [#237](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/237) | `690891d6` | 2026-07-30 | none — doc only (F5 addendum: the correct future shape for centre-staff grants, `admin_user_id` proposal corrected and not built) | none | v40 |
| [#239](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/239) | `21c1c255` | 2026-07-30 | `Center-Students §01` (roster), `§02` (student detail), `§04` (import) — plus the `/dashboard` KPI tile, payment-status donut and its Excel export (D3's other live wrong consumers, cross-file) | `/{locale}/students`, `/students/[id]`, `/students/import`, `/{locale}/dashboard` | v40 → **v41** |
| [#242](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/242) | `3de2e3c5` | 2026-07-30 | none — migration + four route write sites (D24: `students.inactive_reason`) | `/api/join/*` (2 routes), `/api/students/pending/[id]/reject`, `/api/admin/privacy-requests/anonymize` | v41 |
| [#240](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/240) | `55ce33c1` | 2026-07-30 | none — cron only (D25: `parent-balance-alerts` targeting/quoted amount) | `/api/cron/parent-balance-alerts` | v41 |
| [#243](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/243) | `90f18fed` | 2026-07-30 | `Center-Students §04` (import) — dead-column write removed, no visible UI change | `/{locale}/students/import` | v41 |
| [#245](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/245) | `89159e8b` | 2026-07-30 | `Center-Home §01` (dashboard: alert row, Today KPIs, digital share, schedule), `§02` (notifications: unread-count fix) | `/{locale}/dashboard`, `/{locale}/notifications` | v41 |
| [#247](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/247) | `dbf7ed5d` | 2026-07-31 | `Center-Home §01` — 3 small gaps from the fraction audit (attendance denominator, schedule tap affordance, day-name subtitle) | `/{locale}/dashboard` | v41 |
| [#248](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/248) | `81db40be` | 2026-07-31 | `Center-Groups §01` (teacher name, center's cut, member balance badges, delete), `§03` Rooms (edit/delete), `§05` Schedule (week nav, day-pill dots, named conflicts) | `/{locale}/groups`, `/{locale}/rooms`, `/{locale}/schedule` | v41 |
| [#249](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/249) | `1299c867` | 2026-07-31 | `Center-Students §01` (roster row balance), `§02` (student detail payment badge) | `/{locale}/students`, `/students/[id]` | v41 |
| [#250](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/250) | `d2cf22a2` | 2026-07-31 | none — doc only (#249's SHA fill; R5 closed — built via #221, never marked closed) | none | v41 |
| [#251](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/251) | `1a673bb9` | 2026-07-31 | none — doc only (Center-WhatsApp survey: fraction, D4/D5 re-confirmed, S6 CSRF finding) | none | v41 |
| [#252](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/252) | `abe2c683` | 2026-07-31 | `Center-Orders §01/§02` (4 confirmed bugs fixed), `Center-Insight` survey (S7, F18 logged) | `/{locale}/orders`, `/api/orders/[orderId]/reorder`, `/api/card-order-cart/items/[itemId]` | v41 |
| [#253](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/253) | `3e95bf19` | 2026-07-31 | none — doc only (Center-Setup survey: F19 team-management outage, S8 billing CSRF, D8 amended) | none | v41 |
| [#254](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/254) | `0ea2dce7` | 2026-07-31 | `Public-Marketing §04` (R1 built: `/talk-to-us`), 2 confirmed sign-up-CTA bugs fixed | `/{locale}/talk-to-us` (new), `/{locale}/center`, `/{locale}/pricing`, `/api/demo-request`, `/{locale}/admin/demo-requests` | v41 |
| [#255](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/255) | `dfd3e6a1` | 2026-07-31 | `Center-Attendance` (F20: fixed silent payment-recording failure), V6 re-confirmed | `/{locale}/attendance` (`ScanResultScreen.tsx`) | v41 |
| [#256](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/256) | `797b7709` | 2026-07-31 | `CEO §01` (3 confirmed bugs fixed: currency formatting, missing confirm dialog, silent config-save failure), S9/F21/second-dashboard findings logged | `/{locale}/ceo` | v41 |
| [#257](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/257) | `a363f4b4` | 2026-07-31 | none — doc only (Center-Students re-verification: fraction reconciled against the merged file post-#249, F22 logged) | none | v41 |
| [#258](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/258) | `b9a9b61c` | 2026-07-31 | none — doc only (#257's SHA fill) | none | v41 |
| [#259](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/259) | `658f53a1` | 2026-07-31 | `Teacher-Insight §01` (2 missing roadmap cards added), referral-attribution bug fixed; D14 corrected | `/{locale}/teacher/analytics`, `/{locale}/teacher/landing` | v41 |
| [#260](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/260) | `bb2000c1` | 2026-07-31 | none — doc only (#259's SHA fill) | none | v41 |
| [#261](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/261) | `6e0ca66` | 2026-07-31 | none — doc only (Teacher-WhatsApp survey: D6 corrected/expanded, nothing safely buildable) | none | v41 |
| [#262](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/262) | `bd5593aa` | 2026-07-31 | `Admin-Platform §02` — TOP BY REVENUE centre rows now carry a real per-centre active-student count | `/{locale}/admin/analytics`, `/api/admin/overview` | v41 |
| [#263](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/263) | `db56ae1` | 2026-07-31 | none — doc only (Admin-Platform re-verification: #224 confirmed, §02 student-count fix logged) | none | v41 |
| [#264](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/264) | `827e2333` | 2026-07-31 | `Teacher-Students §02` — payment-history row caption ("Not collected yet" / "Paid · <method>") | `/{locale}/teacher/students` (`AllStudentsList.tsx`), `/api/teacher/private/students` | v41 → **v42** |
| [#265](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/265) | `28bc257a` | 2026-07-31 | `Teacher-Setup §02` (group-proposal counter-offer autonote) | `/{locale}/teacher/centers` | v42 |
| [#266](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/266) | `71fefa05` | 2026-07-31 | none — doc only (Teacher-Home re-verification: #225's fraction reconfirmed unchanged, no new gaps) | none | v42 |
| [#267](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/267) | CLOSED | 2026-07-31 | superseded by #271 — forked before #266 merged, GitHub reported it unmergeable | none | v42 |
| [#268](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/268) | `761da021` | 2026-07-31 | none — doc only (Teacher-Students re-verification: §02 payment-caption gap logged, D15 re-confirmed unchanged) | none | v42 |
| [#270](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/270) | superseded by #271 | 2026-07-31 | none — doc only (Teacher-Setup re-verification: #227's claim corrected, D16/D17 reconfirmed) | none | v42 |
| [#271](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/271) | `b4f3ea3` | 2026-07-31 | none — doc only (consolidates #267+#270: Admin-Accounts re-verification + Teacher-Setup re-verification, both rebased onto current master) | none | v42 |
| [#272](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/272) | `42e5607` | 2026-07-31 | `Center-Orders §01` — Arabic `ordersEmpty` string fixed, empty-state illustration built (`EmptyState`) | `/{locale}/orders` | v42 |
| [#273](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/273) | `d7c2be6` | 2026-07-31 | `Teacher-Groups §02`/`§03` — roster-row avatar circles (pending + active), "N waiting to join" banner with Review CTA | `/{locale}/teacher/groups/[groupId]` | v42 |
| [#274](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/274) | `2990e90` | 2026-07-31 | none — doc only (#261/#271 SHA-fill, missing #263 row added, #272/#273 logged, Teacher-Groups + Center-Orders rows surveyed) | none | v42 |
| [#275](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/275) | `30de6ad` | 2026-07-31 | `Center-WhatsApp §01` — template search, WhatsApp-style preview bubble, "Variables used" chips | `/{locale}/whatsapp` | v42 |
| [#276](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/276) | `f9c5342` | 2026-07-31 | none — doc only (batch-3 wrap-up: #275 logged, Center-Insight/Center-WhatsApp rows surveyed) | none | v42 |
| [#277](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/277) | `726e928` | 2026-07-31 | `Center-Students §02`/`§04` — ID card tile, tinted balance card, sibling rows, lifetime-paid-since, import inline Fix | `/{locale}/students/[id]`, `/students/import` | v42 |
| [#278](https://github.com/eyadelhawary7-oss/TutoringHQ/pull/278) | `df8c42d` | 2026-07-31 | `Center-Groups §01` (fill bar, avg attendance, inline new-subject), `§04` (Current badge), `§05` (Now/Done badges) — plus `AttendanceHeatmap.tsx` i18n bug fix (hardcoded Arabic shown to English-locale users) | `/{locale}/groups`, `/{locale}/branches`, `/{locale}/schedule` | v42 |

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

**Center-Students (30 July 2026, PR #239)** — §01/§02/§04 built; §03 (Verified) stays untouched,
blocked on Valify (**V2**), same as every other file's Verified section.

**§01 Roster — built:** `grade_level` display (mobile card + desktop row); the fake "Last Sessions"
seven-dot indicator removed outright rather than fixed — confirmed via the CSS that it always
rendered `attendance-dot-unknown`, never `-present`/`-absent`, so all seven dots were always
identical grey regardless of a student's real attendance. `EmptyState` gained a second, lower-emphasis
action ("Import from file") next to "Add student" — the shared primitive's props, not a fork.

**§02 Student Detail — built:** an avatar (`initialsOf`) and a subject/grade/phone identity line
under the name; a third stat tile, "Lifetime paid" (Σ logged payments, `getStudentBalances`'s
`.paid`, alongside the existing Visits/Last-seen pair rather than replacing either); Call/WhatsApp
quick actions beside the existing Collect Payment/Edit tiles; a loading skeleton that matches the
real layout instead of a bare "Loading" line.

**§04 Import — built:** the 500-row cap the upload screen's own copy already promised ("CSV or
Excel, up to 500 rows") but never checked.

**D3 follow-through — the same dead column, found in two more places.** `students.payment_status`
(logged in `BUILD-AFTER-REDESIGN.md` D3 as "written once at creation, never updated by anything")
turned out to have live readers well outside this file: `/dashboard`'s paid/unpaid KPI tile and its
payment-status donut chart, and `excel-export.ts`'s `buildDashboardExcelBuffer` (the dashboard's
Excel export — its unused sibling `exportToExcel` has zero callers and was left alone). Both fixed
onto `getStudentBalances`, the same helper §01/§02 already use, so none of these four screens can
ever disagree again. D3's own entry said "nothing reads it since #188" — that no longer held, so the
entry was corrected rather than left to mislead the next reader.

**The donut's "pending" slice was a second, independent bug, not just the same one twice.** It read
`students.payment_status = 'pending'` — but the dashboard already computes a correct, live
"pending payments" figure (`pendingInvoicesCount`, from real `payments` rows) for its own KPI card
a few lines away. The fix repoints the donut at that existing number rather than inventing a new
per-student "pending" concept — the balance model has none: a pending payment already counts toward
`paid`, so there is no third bucket to draw from without re-introducing the exact overstated-debt
problem `getStudentBalances` exists to avoid.

**Flagged, not built — logged as D24/D25/F12–F15 in `BUILD-AFTER-REDESIGN.md`:** the roster's
`is_active` filter would also hide staff-paused students, not just pending signups, because the same
column serves both meanings and the general edit endpoint lets staff toggle it directly (**D24**);
the `parent-balance-alerts` cron reads the same dead column to decide who gets a paid WhatsApp
message (**D25**, see below); `pending_enrollments` cannot say whether a request came via invite
link or self-serve sign-up despite the design drawing both as distinct badges (**F12**); `grade_level`
has zero writers anywhere (**F13**); import doesn't enforce the design's "parent phone required" copy
(**F14**); lifecycle status and payment standing are two status axes nothing shows together
(**F15**).

**`parent-balance-alerts` cron (30 July 2026, PR #240)** — D25 built. Same
`payment_status`-vs-`getStudentBalances` swap, applied to who the cron messages and to the EGP figure
it quotes (previously `students.fee`, a documented unreliable fallback, never the authoritative
`student_groups.fee_per_class`). **Measured before building, then re-measured fresh right before
merge:** on the next run, current logic and fixed logic both send 0 messages — every centre in
production today has `parent_pack_enabled=false`, so the population gate is empty before
`payment_status` is ever evaluated. The bug is real and entirely latent, the same shape as D22
(referrals): correct only because nothing has turned the trigger on yet. This PR did not auto-merge
— it changes who gets messaged and what they are told they owe, so it came to Eyad regardless of
file name, same rule as every other money/write-adjacent change this session. Rebased once after
merging behind #239/#242 (a squash-merge ancestry mismatch, not a real content conflict — verified
the diff was byte-identical before and after).

**Logged as one pattern, not six bugs (F16).** Roster, student detail, the dashboard KPI+donut, the
dashboard Excel export, the cron's targeting and the cron's quoted amount are the same failure mode
six times: a column written once at insert, read as if it were current. All six are now
`getStudentBalances`. `BUILD-AFTER-REDESIGN.md` F16 records why dropping `payment_status` (D3) is
the only fix that makes a seventh instance impossible rather than merely findable.

**Roster `is_active` schema (D24, PR #242) — verified before proposing, then built.** Asked to
propose a schema fix so a roster row can show "paused" and "pending" as distinct states. Before
proposing, checked whether the existing `pending_enrollments` table already disambiguates them
without a new column — the same discipline that caught the `admin_user_id` premise error earlier
tonight. It doesn't, and the real picture is wider than "two meanings": `is_active=false` already
carries **four** live meanings (pending signup, rejected signup, staff-paused, privacy-anonymized),
and "staff-paused" itself has no confirmed live UI trigger today — the PATCH endpoint that could set
it has zero callers found anywhere in this repository. The sharpest problem: rejecting a pending
signup never touched the student row at all (confirmed by reading the entire 29-line reject route),
so a rejected student sat at `is_active=false` forever, indistinguishable from a genuine pause under
any query-time rule. Eyad approved the proposed shape; `students.inactive_reason text` (nullable,
four-value `CHECK`, matching the same convention `pending_enrollments.status` already uses) is
applied to production, confirmed live via `information_schema`/`pg_constraint` before the code
merged. Four write sites stamped, including the reject-route fix above. `'paused'` is a valid `CHECK`
value with **zero writers, on Eyad's explicit instruction** — no pause feature exists, and none
should be inferred from the constraint. Full verification and the exact write-site diffs are in
`BUILD-AFTER-REDESIGN.md` D24's addendum.

**`/students/import` dead columns (R10, PR #243) — confirmed three independent ways, then fixed.**
Surfaced while investigating the cron fix: `/students/import` sends `notes` and `group_id` on every
row to `students` — neither is a real column (the live table has `waitlist_group_id`, not
`group_id`; the only `notes` column in the schema is on `pending_enrollments`). Independently
corroborated a second and third time by the D24 verification workflow, which hit the same fact from
an unrelated angle while mapping every `students` write site. Every import failed at insert,
unconditionally, regardless of file content. Fixed by removing both fields from the insert payload,
the insert's own `.select()` string, `studentInsertSchema`'s pass-through, and the PATCH endpoint's
allow-list — plus the notes-mapping UI (dropdown option, preview column, CSV template column), rather
than leave an affordance that silently discarded whatever a user mapped to it. Group assignment was
unaffected (`student_group_members` insert never depended on the dead key). Routing import notes
through `student_notes` — a real, live table already used by the anonymize route — stays a separate,
not-yet-made decision.

**Center-Home (30 July 2026, PR #245) — the third and last of the three "token pass only" files,
redone rather than continued.** Structure coverage before this pass: an alert row, four `Today` KPIs,
a digital-share widget and a schedule list — the design's whole §01 body below the header — were
absent from the live page entirely; the previous pass (#214) had applied the token layer's colours to
the existing, much thinner screen and stopped there. Surveyed both sections fresh (a blind literal
read of the design mock, a separate blind read of the live `dashboard`/`notifications` code, then
reconciled by hand) rather than trust the prior "restyled" label or the completion table's own
pre-analysis, which turned out to be wrong on one material point — see F17 below.

**§01 Dashboard — built:** an unpaid-links alert banner (count + oldest-charge age, both from
`getStudentBalances`/`attendance_scans` — the same real-time balance model D3/D25/F16 already
established, not a new money computation); a `Today` KPI row (Sessions, Students expected, Collected,
Attendance) sitting alongside the pre-existing `At a glance` row rather than replacing it — `Monthly
Revenue`/`Active Students`/`Pending Payments` are real, permission-gated, already-used figures with a
different (weekly/monthly) time window than the design's `Today` framing, so this is additive, the
same choice made for Center-Students' extra stat tiles; a digital-share widget (online vs. cash split,
this week) built entirely from `revenueChartData`, a Cairo-week series the page already computes and
ships to the client but never renders — not a new query; and a Schedule list of today's classes. The
design's balance card and "Verified" badge are not built — both are the same V3/V4 (online
collection/payout) and V1/V6 (verification) blockers already logged for every other file that draws
them, not a new finding here.

**Two bugs found incidentally and fixed in the same PR, both pre-dating this pass:**
`PlanUsageCard` referenced a `.glass` CSS class and `--text-primary`/`--text-secondary` custom
properties that do not exist anywhere in `globals.css` — confirmed via a plain grep, not inferred. The
card had no border, no background and inherited text colour, sitting unstyled in the middle of an
otherwise fully token-restyled page. Fixed onto the same `--color-*` tokens and card shape every
sibling card on this page already uses. Separately, the exam-season enrollment-surge banner
(`/api/dashboard/stats`) built its message as a hardcoded Arabic string server-side regardless of the
caller's locale — an English-locale owner would see Arabic. Fixed by having the route return the
number of days only and letting the client render it through `t()`, the same as every other string on
the page.

**One more instance of the "one number, two sources" shape (F16), smaller than the six already
logged:** `/api/dashboard/stats`'s `activeStudentsThisWeek` computed "this week" as a Monday-start JS
week, while the same page's own `loadDashboard()` already uses the correct Saturday-start Cairo week
(`startOfCairoWeek`) for its own trend figures — two different week boundaries on the same screen.
Fixed the stats route onto the same Cairo helper. Left `loadDashboard()`'s own non-Cairo `startOfToday()`
untouched — it feeds many already-shipped, already-relied-on figures well beyond this pass's scope,
where the isolated stats-route fix touched exactly one, low-visibility, never-previously-correct field.

**§02 Notifications — one correctness fix, one gap logged as a decision, not built:** the page's
header "unread" count was undercounting for any center with more than 50 unread notifications — the
API already computes an accurate count via a dedicated, uncapped query, but the client discarded it
and recomputed from its own capped 50-row page. Wired the client onto the server's real number.
**Not fixed:** the feed itself. The design draws roughly eleven notification event types; the live
`in_app_notifications` table has exactly one real writer reachable from a center's own screen
(`card_order_status_update`) plus one admin-only kind that never reaches this screen at all
(`privacy_request`). Wiring the plausible remaining types (payment received/failed, fee
collected/overdue, student absent, new student) means new write-triggers across several already-shipped
subsystems, not a display fix — logged as **D26** for Eyad's call on scope, rather than built partially.

**F17 — a stale claim in `FILE-COMPLETION-TABLE.md` corrected before it was built around.** That table
listed `sessions` as backing Center-Home's schedule section. Checked live before building: every row
in `sessions` has `kind='private'`, including ones attached to `kind='center'` groups — it is
exclusively the teacher-private billing engine's table, never written for a center class. The real
source is `schedule_slots` (a recurring weekly template, no per-occurrence status column at all) — the
same table the live `/schedule` page already reads. The Schedule section was built from that instead;
the design's Billed/Next/Later chip is derived at render time (end_time passed vs. not), documented as
an interpretation in the new `src/lib/todayScheduleStatus.ts`, since no stored equivalent exists to
read.

**The fraction, not "done" — an adversarial re-audit of Center-Home §01, 31 July 2026.** Asked for the
exact before/after fraction of the five §01 elements rather than a completion claim. Ran two
independent blind auditors per file plus a reconciler that re-verifies every disagreement against live
code — not a vote — across three files at once (Center-Home, Center-Students, Center-Groups), since
the same discipline that caught the false "done" on Center-Home was worth applying everywhere at once
rather than one file at a time.

**Center-Home §01: 4/5 built** (alert banner, Today KPIs, digital share, schedule), **1/5 not**
(balance card). The omission is missing data — `transactions.settlement_status`/`settled_at`/
`settlement_retry_count` all exist as columns but 0 of 3 live rows have them populated and zero
application code reads them, confirmed live — and that data is missing *because* the feature it would
come from (online collection/payout, V3/V4) is gated behind identity verification (V1) shipping.
Missing data and blocked-on-Valify are the same fact, not two. The audit also found three small,
real deltas in the built elements: the Attendance tile divided by the whole roster instead of today's
expected headcount, the Schedule rows had no tap affordance, and the section header was missing its
day-name subtitle — all three closed in **PR #247**, including adopting `ListRow` (`Merged-Design-Patterns`
§03/§04) for the schedule rows instead of a bespoke div.

**Center-Students, re-scored honestly: ~51% overall, not the ~90%+ a glance at PR #239 alone would
suggest.** §01 Roster 0.75/1, §02 Student Detail 0.5/1 (five fully absent elements: kebab menu,
payment-standing badge, tinted/overdue balance card, per-member family list, sticky action bar), §03
Verified 0.05/1 (correctly deferred, Valify), §04 Import 0.75/1. #239 was real engineering, not a
restyle, and is not being redone — but §02 in particular has real gaps logged for whenever that file
comes back around.

**Center-Groups: 2.1/5 (~42%), genuinely the least-done of the three token-pass files** — §01 Groups
0.55/1, §02 Verified 0.05/1 (deferred, **D12** billing-basis decision), §03 Rooms 0.7/1, §04 Branches
0.2/1, §05 Schedule 0.6/1. One finding surfaced regardless of file order: **D23** (a branch silently
clones the parent center's full plan price instead of charging the design's flat add-on fee) is
live, real, and money-touching — re-confirmed independently by this audit, not fixed, waiting on
Eyad's call on the add-on model.

**Center-Groups rebuild (31 July 2026, PR #248)** — the safely-buildable gaps across §01/§03/§05,
explicitly not touching §02 (blocked on D12) or §04 (its Add-branch flow sits directly on the
unresolved D23 billing bug, so left alone rather than partially rebuilt on top of it).

- **§01 Groups:** `handleDeleteGroup` was fully implemented — audit-logged, deletes members, updates
  state — with zero call sites; now reachable from a kebab menu with an inline confirm. `teacher_name`
  (a real join, fetched every load) and `center_cut_egp` (written on creation) were both computed and
  discarded; both now render — the cut as the absolute EGP figure it's actually stored as, not
  converted to a percentage as **F11**'s original text speculated the design wanted, since that
  conversion is a formatting choice with no evidence behind it either way. Member rows gained an
  avatar and a real-time balance badge (`getStudentBalances`, the same helper as everywhere else this
  balance model is read — never a new per-student payment concept). `capacity_cap` and `kind` remain
  confirmed dead, same decision as before, not resolved here.
- **§03 Rooms:** the "More" kebab existed with no `onClick` — now opens working edit and delete. Delete
  warns explicitly that scheduled classes in that room are removed too, since `schedule_slots.room_id`
  and `bookings.room_id` are both `ON DELETE CASCADE` — checked live via `pg_constraint`, not assumed,
  before writing the confirm copy.
- **§05 Schedule:** added prev/next week navigation with a date-range label (the grid was permanently
  pinned to the current week); day-pill load dots; and conflict copy that names the clashing session
  ("Overlaps Math 5:30") instead of a bare "conflict" chip. **D2** (`schedule_slots.day_of_week`
  convention) was re-checked and found stale: the fix shipped in commit `ae352f94` (28 July) a full day
  *before* D2 was even written into this doc (29 July) and was simply never marked resolved — confirmed
  via both cron call sites (`daily-summary`, `parent-absence-alerts`) already calling the single
  canonical `scheduleSlotsDayOfWeek()` helper.

**Center-Students follow-up (31 July 2026, PR #249)** — the two clearest, lowest-risk wins from the
audit's §01/§02 findings, everything else logged rather than guessed at.

- **§01 Roster:** the mobile card's meta line showed `student_number`/`phone`/`grade_level` but never
  the design's "owes 300 EGP" — `balanceByStudent` was already computed for this exact page's own KPI
  tiles and balance-sort option, just never reached the card. Now it does, additively (existing lines
  kept).
- **§02 Student Detail:** a payment-standing badge ("Overdue"/"Paid up") now sits beside the student's
  name, from the same real-time `balance` the KPI card below it already reads.
- **Flagged, not built, each for a specific reason:** a kebab/more menu in the detail top bar (the
  design draws one; what it should contain — delete student? deactivate? — isn't evidenced by the
  audit and reads as a decision, not a display fix); a tinted balance-card background (the shared
  `KpiCard` component has no background-tint capability, and forking it or adding one wasn't done here
  given `KpiCard`'s own docblock already flags an unrelated pending radius decision — **D0** — as
  explicitly "not forked... settle deliberately"); the design's per-member family list, replacing the
  current one-line family summary (real data exists — `sibling_family_id` is already selected — but
  the UI shape change is bigger than this pass's two clear wins); a sticky bottom action bar (a layout
  change to already-working quick-action tiles, not a gap); an "attendance ratio this term" stat tile
  (no live concept of "term" boundaries was confirmed available to compute against safely); and the
  attendance-history badges reading payment result (paid/pending/unpaid) rather than present/absent as
  the design draws — changing that meaning would remove information already shown, not add it, so left
  alone. `BottomTabBar`'s 3 tabs vs. the design's 4 (adding "Fees") is a shared, app-wide navigation
  component, not a Center-Students-scoped fix — not touched here for that reason.

**Center-WhatsApp (31 July 2026) — surveyed, nothing built, no PR.** `FILE-COMPLETION-TABLE.md`
row 10 already marked this file "Buildable now: —", blocked entirely by **D4** and **D5**. This pass
read both live routes in full against all three design sections to confirm that call and put honest
fractions on it, the same discipline applied to the three token-pass files. Structure coverage
**2.5/5 → 2.5/5 (§01), 0/5 → 0/5 (§02), 0/4 → 0/4 (§03) — unchanged, nothing safely buildable found.**

| § | fraction | what's built | what's missing |
|---|---|---|---|
| §01 Templates | 2.5/5 | template list with preview text (`wa_meta_templates`, real `status`/`category`), a preview modal showing sample variables, full EN/AR mirroring | per-template Auto/Manual/Off toggle (**D4**), an Edit-template action (templates are Meta-managed via hourly cron sync, not center-editable), the preview sheet's "Send automatically" control |
| §02 Pack | 0/5 | *(built, but for a different model — see below)* | message-credit balance ("N messages left, never expires"), the segmented Notifications/Promotions credit balances, the three fixed recharge tiers with declining per-message rate, a "Buy credit" → Paymob purchase action |
| §03 Custom Flow | 0/4 | none | tap-Custom → set-amount (live rate + total) → confirm-and-pay (Paymob) → done, entirely — confirmed absent by exhaustive grep, matching the project's own prior claim |

**§02 is not "half-built" — it's a different business model, confirmed live, not inferred.** The design
draws a one-time message-credit top-up (buy 200/1,000/5,000 messages, or a custom amount, at a
declining per-message rate; credit never expires). Live code implements a monthly per-parent
subscription (`PACK_PRICE_PER_PARENT = 12` EGP/parent/month) plus a separate per-blast charge
(`BLAST_PRICE_PER_PARENT_INCLUSIVE = 9.8` EGP/parent, capped at 2 announcements/month, gated by a
plan-tiered monthly allowance). Real, working, money-moving code — `sendAnnouncementBlast` charges
real parents and writes real invoices — but it answers a different question than the screen this
file's design draws. This is exactly what **D5** already says ("`LOOKS LIKE A RESTYLE`... a different
model, not a partial one... this changes what an existing customer is charged") — re-confirmed, not
newly found. Building toward the design here means migrating existing customers' billing model, which
is Eyad's call, not a display fix. **D4** re-confirmed the same way: `center_message_templates.auto_send`
still has zero application-code readers or writers anywhere in `src` (grepped fresh this pass) — the
column exists on an orphaned table, adopting it is what D4 already says it is.

**A second, independent finding, not part of the design fraction: no CSRF on any WhatsApp-Pack
mutation.** All five mutation routes behind `/whatsapp-pack` — `POST /api/parent-pack/announcement`
(the one that debits `announcement_balance` and can issue an invoice), `POST .../request`,
`PATCH /api/settings/parent-pack`, `PATCH /api/parent-pack/student/[id]`, `PATCH /api/parent-pack/toggle`
— authenticate via `requireOwnerAdminCenter`/`requireCenterAuth` (bearer session + role + tenant gate)
but none of them call `validateCSRFRequest`, and neither `requireOwnerAdminCenter.ts` nor `centerAuth.ts`
call it on their behalf. `src/lib/csrf.ts`'s own doc comment claims this exact protection is already
applied "the same...rule the Paymob/WhatsApp/Bosta webhooks already apply" — that claim does not hold
for these five routes, confirmed by grep across all five files plus both auth helpers. This is a
standing-rule violation (`saas-multi-tenant-architecture` skill, locked rule 6: mutations require CSRF,
fails closed) independent of the design-restructure work, and money-adjacent (the announcement route
moves real balance and can create real invoices) — flagged for Eyad rather than silently patched
mid-loop, per the standing stop condition on anything touching money or auth.

**Center-Orders (31 July 2026) — the best-built file surveyed so far, plus four small confirmed bugs
fixed.** `FILE-COMPLETION-TABLE.md` row 8 already had **R8** built (#231, the §04 teaser) with only
**D7** (notify-me destination) unresolved. Structure coverage, surveyed properly this pass rather than
taken on the table's word: **§01 Orders 4/5, §02 Order Detail 5/5, §03 Checkout 4/5, §04 Coming Soon
4/5 — ≈4.25/5 overall (~85%).**

| § | fraction | notes |
|---|---|---|
| §01 Orders | 4/5 | order history is richer than the design (search/filter/sort/paginate vs. a flat 3-row list) and the cart-based flow functionally covers "New order," but the design's hero ID-card-preview entry point isn't there — replaced by going straight into the cart, a different but not worse presentation |
| §02 Order Detail | 5/5 | matches and exceeds: an 8-stage state machine vs. the design's 5 steps, added terminal banners for cancelled/refunded/failed states the design doesn't draw, a full VAT/processing-fee/shipping breakdown, real receipt download and cancel/mark-issued actions |
| §03 Checkout | 4/5 | the 4-step wizard (delivery → customize → review → payment) plus success matches closely, VAT (14%) and the 20 EGP processing fee both present and correct; missing the Customize step's per-field print toggles (name/QR/photo/ID on/off) — logged as **F18**, needs new columns |
| §04 Coming Soon | 4/5 | teaser + feature list built (#231); notify-me + confirmation state still blocked on **D7**, re-confirmed this pass — `CardOrdersTeaser.tsx`'s own JSDoc documents the omission as deliberate, not dead code |

**Four small, confirmed bugs fixed, all mechanical, none touching schema or money flow:**
- **Hardcoded `62` EGP/card**, in two spots (`OrdersPageClient.tsx`'s shipping-estimate example banner and the `price_per_card` display fallback) — stale relative to `taxMath.ts`'s real `CARD_UNIT_BASE_EGP` constant, which grosses to exactly 60 EGP/card inclusive. Both now derive from `cardOrderProductInclusiveFromQty(1)` instead of a second, disagreeing hardcode.
- **WhatsApp order-confirmation short-ref mismatch**: every UI surface and the receipt itself derives the human order reference as `id.replace(/-/g,'').slice(-8)` (**last** 8 hex chars) except `cardOrderCheckoutOwnerNotify.ts`, which used `.slice(0,8)` (**first** 8) for the one-time owner WhatsApp message — the confirmation text showed a different reference than every screen and PDF the owner could see it against. Now consistent.
- **`/api/orders/[orderId]/reorder`** was missing the `cardOrdersDisabledResponse` gate and the `can_place_card_orders` permission check that its sibling routes (`checkout`, `create-payment-key`) both already enforce — added, matching the exact pattern. Zero functional impact on legitimate users: checkout itself already required the same permission, so this only closes a defense-in-depth gap (populating a cart via reorder without ever being able to complete purchase).
- **`DELETE /api/card-order-cart/items/[itemId]`** was missing the same `cardOrdersDisabledResponse` gate its sibling `PATCH` in the same file already has — added for consistency.

**Not built, each flagged for a specific reason:** the §01 hero visual (a presentation choice, not a missing capability — logged, not treated as a gap to close); the §03 print-field toggles (**F18**, needs new columns, Eyad's call); the Sidebar's `can_manage_students` vs. the page/API's `can_place_card_orders` nav-permission mismatch (a role could see the "Orders" nav item then land on a blocked page — reads as a policy question of which permission should gate nav visibility, not an unambiguous bug, so flagged rather than changed); a redundant no-op branch in `CardOrderCartItemRow.tsx`'s touch handler (dead code, zero behavior change, left alone per the no-unrequested-cleanup rule).

**Center-Insight (31 July 2026) — surveyed, no build.** Row 9 had never been surveyed for structure.
**§01 Analytics 4/5, §02 Benchmarks 4.5/5, §03 Referrals 1.5/5 — ≈3.3/5 overall (~66%)**, dragged down
almost entirely by one already-known, independently re-confirmed finding in §03, not by anything new
and undecided.

| § | fraction | notes |
|---|---|---|
| §01 Analytics | 4/5 | KPI tiles, the revenue chart, payment-methods donut, revenue-by-group, P&L (with CSV export) and the aging report (with **correctly CSRF-protected** WhatsApp reminders) are all real and live; missing the "Projected · month-end" forecast tile and its dashed projection bar — logged, not built, since it needs a pace-extrapolation formula added to `/api/analytics/revenue`, not just a display change. The design's paid-add-on gate (Frame 3) is correctly **not** built — **D13**, closed 26 July, re-confirmed this pass. |
| §02 Benchmarks | 4.5/5 | once corrected for an **already-decided design error** — `NEW-FEATURES.md` Appendix D9, 27 July: the design draws 5 metrics, the live cohort table supports 4, and Eyad's call was to build the 4 real ones and fix the drawing, not add "average fee"/"new students per month" as new metrics — Benchmarks is essentially complete: the data-sufficiency lock state, all 4 metric cards with percentile bars and median ticks, the Refer & Earn cross-link, the anonymity footer. The design's paywall (99 EGP/mo) is correctly **not** built, same **D13**. |
| §03 Referrals | 1.5/5 | the KPI tiles and two data tables are built and functional for *reading*, but every figure they show comes from `referral_reward_records` — a table **already found dead on 29 July (D22)** and **independently re-confirmed this pass**, reading the code cold rather than re-reading D22 first: the real monthly commission cron writes exclusively to a different table, `referral_commissions`, and nothing ever reconciles the two. The design's richer per-referral rate-decay/countdown cards and its dedicated referral-detail sub-page (**R6**) are correctly **not** built — already logged as blocked by D22, re-confirmed, not re-opened. |

**New finding, independent of the fraction: S7, no CSRF on `/api/referrals/payout`.** Same class of gap
as WhatsApp-Pack's S6 — `requireCenterAuth` + a permission flag guard it, `validateCSRFRequest` does
not. Currently low-blast-radius only *because* of D22 (the balance it guards is always 0 in production
today) — flagged now, together with D22, so the two get decided as one problem rather than the CSRF
gap being deprioritized on the mistaken belief that "it can't move money yet" stays true forever.

**Independently re-confirmed same day, batch-3 sweep (agent: survey-Center-Insight).** All three
fractions (4/5, 4.5/5, 1.5/5) held unchanged; D13, D9, D22 and S7 all re-verified live rather than
trusted from this entry — D22 via a fresh row-count check against `referral_reward_records`,
`referral_commissions`, `referrals` and `payout_requests` (all 0, matching exactly), D9 via
`pg_get_functiondef(get_center_benchmarks)` read cold. One question re-examined under the stricter
100%-or-blocked bar and still found not safely buildable: the "Projected · month-end" forecast tile —
the data exists (`mrr_trend`), but a naive linear pace-extrapolation is genuinely misleading early in a
month (a single day-1 payment would project an absurd month-end figure for a real business), so it
needs Eyad's call on methodology before wiring it, not just a display change. No code changed, no PR
opened. `FILE-COMPLETION-TABLE.md` row 9 updated in this same PR — it had never been updated after this
same-day survey and still read "not surveyed."

**Center-Setup (31 July 2026) — surveyed, no build. The most consequential findings of this whole
project so far are here, and they are not design-fidelity gaps.** Row 14, 9 sections, never surveyed.
Leading with what matters most before the fraction:

**Team management is broken in production, three separate ways (F19).** Verified directly against
the live schema, not migration history:
1. **Inviting a team member fails every time.** `center_invites` is missing the `status` column the
   Team page reads and the `status`/`invited_name` columns *and* the `(center_id, phone)` unique
   constraint that `POST /api/invite-user`'s upsert depends on. Every invite attempt 500s. The primary
   button on the Team settings page does not work.
2. **Activating or deactivating a team member always fails.** The client never sends a password/PIN;
   the server unconditionally requires one for any `/api/permissions` call. The sibling
   granular-permission-edit path works only because it routes through `PasswordConfirmModal` first —
   the activate/deactivate button was never wired the same way.
3. **The seat limit is dead code.** `centers.max_teachers`/`max_students` don't exist live. Both
   `/api/settings/limits` and `/api/invite-user`'s own cap check fail silently and fall back to a
   hardcoded 2-seat cap — **every center is invisibly capped at 2 team members regardless of plan.**
   This directly amends **D8**: deciding an extra-seat add-on price is premature while the *included*
   seat count is reading columns that were never created.

None of the three was fixed here. (1) and (3) need a schema migration — manual-apply-to-production per
this repo's own migration rule, not something to merge-and-assume. (2) is schema-free but changes
account state (a person's access), a standing stop condition. All three need Eyad's go-ahead.

**Second finding: no CSRF on any subscription-billing mutation, plus two misleading money figures on
the same screen (S8).** Upgrade, downgrade, reactivate, withdrawal, cancel, pack-request, and invoice-pay
all skip `validateCSRFRequest` — same class as S6/S7, now on the biggest money surface yet. Separately,
not a CSRF issue: the downgrade screen shows a client-computed "credits earned" figure the server
*never grants* (`creditEarned: 0` always, by the server's own design comment), and the reactivation
modal still branches on a retired tiered-penalty model whose two possible rows both always show 0 EGP.

**Structure coverage, section by section (surveyed properly, not taken on the table's word):**

| § | fraction | notes |
|---|---|---|
| §01 Onboarding | not scored — different flow | the design draws a center-configuration wizard (name/area → subjects/grades → payment methods → done); live's 4-step wizard is a value-demo flow (add first student → create first group → simulate a scan → ROI summary). Neither is a subset of the other — flagging the divergence rather than forcing a fraction against a screen the live flow was never trying to be. |
| §02 Settings hub | ~2.5/5 | the hub itself is close (most rows present); **"General" doesn't exist as a screen at all** — the route `/settings/general` is actually the settings menu hub, not the design's language/region/display screen (**D11**); the live **Account** page is far thinner than drawn — just Change PIN + Log out, no personal-info display, no 2FA toggle |
| §03 Billing | ~4/5 (coverage) — see S8 for correctness | nearly every design element has a live counterpart (plan hero, upgrade/downgrade, credits, withdrawal, pack, invoices, plan history, cancel) — the gaps here are correctness bugs (S8), not missing structure |
| §04 Center + Subjects | ~4.5/5 | closely matches: logo/name/phone/district/governorate, subjects/grades chip management with add/edit/delete |
| §05 Notifications & Support | ~1.5/5, mostly by decision | the rich notification-preference model (6 category toggles, push/email, quiet hours) is correctly **not** built — **D9**, closed 28 July; what exists (`daily_summary_enabled`, `summer_mode`) is unrelated to that decision. Support is genuinely thin against the drawing though (WhatsApp + email only vs. the design's 7 rows), not decision-blocked |
| §06 Scanner | ~2/5 | the one real column (camera/Bluetooth input) is exposed; Sound/Vibrate toggles and the duplicate-scan window aren't built and aren't covered by **D10**'s decision text either (D10 only speaks to `scanner_default_mode` and "mark attendance automatically") — a genuine small gap, not a re-litigation of D10 |
| §07 Team | structural ~4/5, functional ~1.5/5 | looks complete (seat bar, member list, invite modal, permission editing) but two of its three core actions don't work in production — see F19. Structure coverage and "does it work" are different axes here, worth reporting as both |
| §08 Team Verified | ~1/5 | this is the same live file as §07, not a separate screen — the design's money-safe permission split (DAILY vs. MONEY groups, two non-delegable owner-only locked actions for withdraw-money/change-payout-account) has no live counterpart; the live permission model is a flat set of generic toggles with no such grouping |
| §09 My Teachers | ~3.5/5, partial evidence | the 4-tab shell and two of its four tab bodies (Requests, Slots) check out cleanly against the design and against the live schema with no breakage found; the other two tab bodies (`MyTeachersPanel`, `AddTeacherPanel`) were out of this pass's read scope — flagged rather than guessed at, a follow-up read closes this |

**D9/D10/D11 all re-confirmed live, D11 gaining the route-identity gap above.** No new decisions opened
by this survey beyond the D8 amendment (F19) — everything else found is either already-decided (D9/D10),
a correctness bug independent of any design question (F19, S8), or a genuine small display gap (§06,
§08, Support half of §05).

**Public-Marketing (31 July 2026) — R1 built, two live bugs fixed, one structural divergence logged.**
Row 15, never surveyed. `FILE-COMPLETION-TABLE.md` already had this as **R1 — unblocked 29 July**, and
the migration (`20260728120000`) was independently re-verified live rather than trusted from the doc —
still holds exactly as R1 said.

**Built: `/talk-to-us`, R1's lead-capture form.** Five fields (name, mobile, center name, area, rough
student count), submits to the existing `POST /api/demo-request` (schema and insert extended to carry
`area`/`student_count`), a submitted state that echoes the area back and keeps "Start free trial now"
on screen per the design's own stated rationale, and `/admin/demo-requests` now renders both new
columns it was already silently selecting. **Area is a `<select>` over the existing `EGYPT_GOVERNORATES`
list, not free text** — the migration's own column comment says "the form offers a fixed list," read as
an instruction. **Not built: automatic area→territory→rep routing.** `center_assignments.territory_city`
— the join target — turned out to be a plain free-text admin input with no shared vocabulary against
the governorate list at all (checked live, not assumed). Matching a fixed list against unconstrained
free text is the same shape as **F19**: it would look wired and quietly match nothing. Flagged in the
amended R1 entry rather than shipped as a silent no-op. `/demo-request`'s fate — R1's own "the two
cannot both be the lead door" question — is untouched and still Eyad's call.

**Two real, confirmed bugs fixed, found while reading the header nav on `/center` and `/pricing`:**
the persistent header "Start free"/sign-up button on **both** pages pointed at `/teacher/signup`
regardless of context. On `/center` — a page with zero teacher content — this sent every center visitor
who used the header CTA into the teacher signup flow instead of the center one (the page's own hero and
final-CTA buttons already correctly point at `/signup`; only the header nav, in two places, desktop and
mobile, had the wrong target). On `/pricing`, which has a real center/teacher audience toggle, the
header CTA ignored that toggle entirely — now routes to `/signup` or `/teacher/signup` based on which
audience is selected, matching the toggle it already tracks in state. Also fixed: `/demo-request`'s
hardcoded WhatsApp number didn't match the site-wide `SITE.supportWhatsAppIntl` used everywhere else —
now reads from the same config.

**Structure coverage, section by section:**

| § | fraction | notes |
|---|---|---|
| §01 Public Landing | not scored — structural divergence | design draws a single unified "one object" page (promo banner + code, an animated attendance→payment demo widget, paired center/teacher comparison cards, one FAQ, one footer); live's `SplashClient.tsx` is an older, simpler shape — static sample dashboard preview, generic feature tiles, and two persona cards routing out to separate `/center`/`/teacher/landing` pages instead of showing both audiences on one page. Neither is a subset of the other; rewriting the flagship landing page is a bigger call than this pass's scope, so logged rather than attempted. |
| §02 Public Audience | partial evidence | `/center` broadly parallels design's `/centers` in intent (hero, comparison table, pricing teaser, FAQ, footer) but several of its own sub-components (`ComparisonTable`, `LandingFAQ`, `TrustSignals`) weren't read in full this pass, so copy/figure-level fidelity isn't confirmed either way; `/teacher/landing` (design's `/teachers` counterpart) wasn't inspected at all — out of this pass's scope, flagged for a follow-up read rather than guessed at. One confirmed bug fixed here (above). |
| §03 Public Pricing | strong match on the money, unconfirmed on add-ons | all six center-plan prices and all three teacher-plan prices match `plans.ts`/`teacherPlans.ts` exactly (999/1,999/4,499/7,999/12,999/18,499 and 499/999/2,499); the interactive capacity-chip card design draws is instead six simultaneous cards live, a presentation difference not a data one. Design's 6-item add-ons section (extra branch 299/mo, team seat 99/mo, etc.) wasn't confirmed present on the live page — not read closely enough this pass to call it a gap with confidence, flagged as unconfirmed rather than asserted missing. One confirmed bug fixed here (above). Also noted, not fixed: the Solo "999 EGP" price is hardcoded a second and third time outside `PLANS` (JSON-LD schema, FAQ prose) — a drift risk, not touched this pass given it's cosmetic/SEO metadata rather than a charged figure. |
| §04 Lead Capture | built, per R1 above | see the R1 entry for exactly what shipped and what didn't. |

**Center-Attendance (31 July 2026) — surveyed, one confirmed bug fixed, four more found and deliberately
left unfixed. The most severe money-integrity findings of this whole project so far are here.** Row 16,
tagged **V6 — blocked wholesale** on identity verification (Valify/V1). Re-confirmed independently on
both the design and the live-code side — design draws the "Verified" badge unconditionally in every
frame with no unverified state anywhere; live code has zero verification-aware branches at all — still
blocked exactly as V6 says, nothing new there. But surveying the live scanner surfaced something far
more urgent than the Valify gate: **two of the six payment methods on the core scan-to-bill screen used
by every center every day silently fail to record a payment (F20).**

- **Fixed:** Vodafone Cash and Bank Transfer sent `'vodafone_cash'`/`'bank_transfer'`, which match neither
  the live `payments_method_check` constraint nor the app's own Zod schema (both already agree on
  `'vodacash'`/`'bank'`). The write silently failed — no error surfaced, attendance still marked present,
  a "pending payment" WhatsApp still sent, the queue item marked synced — while the `payments` row was
  simply never created and the student's real balance stayed outstanding. Changed the two method values
  to match the schema exactly; this also fixed a second bug in the same file where the last-payment-method
  label lookup used the identical wrong strings.
- **Found, deliberately not fixed — coordinated, not sequential, fixes needed:**
  - The main payment-insert path doesn't check its own error return (unlike every sibling `dbInsert` call
    in the same function) — but fixing that in isolation would convert a "payment silently missing" bug
    into a "payment retries forever, re-charging the student every cycle" bug, because there is no way to
    dedupe a retried attendance scan. That second failure mode is not hypothetical: it is **already live**
    for "Allow late entry," whose `payments` write uses a `method` value (`'late_entry'`) that was never
    added to the schema, retries every ~30 seconds forever, and re-inserts a fully-charged attendance row
    on every retry — a real, present-tense balance-inflation bug for any center that leaves a late-entry
    tab open.
  - Fee-exempt admissions write `payment_status_at_scan: 'admitted'` — real, load-bearing application
    vocabulary (`EXEMPT_SCAN_STATUS` in `studentBalance.ts`, with its own exclusion logic), not a typo —
    against a live constraint that only allows `paid`/`unpaid`. The insert should fail outright, meaning
    an exempt student may not be marked present at all.
  - Even the four payment methods that pass validation lose most of their intended data: Zod strips every
    field the validator doesn't declare, so `group_id`, `paid_at`, `recorded_by`, `status`, and `confirmed`
    all silently fall back to column defaults instead of the real values `sync.ts` sends.
  - `payments` inserts on this path have no role/permission gate at all — any authenticated center user,
    regardless of permissions, can record one — a gap `/api/payments/collect` was already built to close
    for a different page, just never extended to this one.
- **Why none of the last four were attempted:** each needs either a schema/enum decision (late-entry's
  method value, the exempt status) or a coordinated security-plus-validation fix (the permission gate and
  the Zod-stripping compound each other) — all real money or auth decisions, flagged per the standing
  stop condition rather than guessed at under the pressure of "it looks like a two-line fix."
- **Full detail, including exact file:line citations and the live-catalog queries that confirmed each
  claim, is in `BUILD-AFTER-REDESIGN.md`'s F20.**

**CEO (31 July 2026) — surveyed, 3 small confirmed bugs fixed, several more logged.** Row 17, tagged
**V5 — blocked on Valify**, re-confirmed fresh (zero "verified" matches anywhere in `/ceo` or
`/ceo/teachers`, independently reproducing the existing claim). Live `/ceo` turned out to be a far
bigger, differently-shaped surface than the design's simple "strategic snapshot" — an 8-section ops
command center (KPIs, trials watch, combined revenue, center health tiers, action queue, sales
pipeline, activation funnel, a center-health table with a suspend action, cash, and two overlapping
platform-config sections) rather than the design's single dashboard + one drill-down.

| § | fraction | notes |
|---|---|---|
| §01 CEO Dashboard | structural superset, unconfirmed on the chart | live delivers the design's strategic-snapshot intent and far more (health tiers, actions, pipeline, activation, cash — none drawn in the mock); the design's specific 6-month revenue bar chart wasn't confirmed present on live `/ceo` in this pass — flagged as unconfirmed, not asserted missing, since a live equivalent may exist under a component name this pass didn't recognize |
| §02 CEO Teachers | real divergence | design wants an overview (hero, KPI grid, plan-mix bars) plus a top-earners leaderboard and a verification-gate banner; live's `/ceo/teachers` is organized around 5 different tabs (Subscriptions/Referrals/Teachers/Attachments/Credits) with no top-earners list and no verification banner — a different information architecture, not a partial build of the drawn one. Live's referrals/attachments/credits views are real, valuable, and not in the design at all. |
| §03 CEO Centers Benchmark | 0/2, correctly blocked | confirmed absent, matches **V5** exactly, re-confirmed independently this pass |

**Three small, confirmed bugs fixed:**
- **`/ceo` bypassed `formatCurrency` in 4 places**, hardcoding `` `EGP ${number}` `` instead — on Arabic, this would show Western digits and the English word "EGP" instead of Arabic-Indic digits and "ج.م", inconsistent with the same page's own "Combined revenue" section three lines away, which already used the correct helper. Fixed all 4 sites.
- **Two of the platform-wide kill-switches (`read_only_mode`, `cron_paused`) fired immediately on checkbox click with zero confirmation**, while their two neighbors (`maintenance_mode`, `wa_sending_enabled`) already required a confirm dialog — the least-friction path to any control on the page led straight to the two most disruptive ones. Widened the existing confirm-dialog gate to cover all four keys uniformly, matching the pattern already established for the other two.
- **`patchPlatformConfig` never checked its own response**, so a failed platform-config change (e.g., a 403) failed completely silently with no indication to the operator. Added a check and a plain error alert, matching the same "check response, alert on failure" pattern already used elsewhere in the codebase (Settings → Team's activate/deactivate handler).

**Found, logged, not fixed — each flagged with why:**
- **S9**: no CSRF on 4 CEO/admin mutation routes, including the platform-config kill-switch endpoint and the center-mutation endpoint that handles invoices/blacklisting/plan overrides — the fourth CSRF gap of this kind found this session (after S6/S7/S8). Needs a coordinated client+server fix, not a server-only patch, since the client never sends the CSRF headers today.
- **F21**: a teacher-tier price fallback (`ceoTeachers.ts`) hardcodes the same figures `teacherPlans.ts` already exports as "the single source of truth" — values agree today, nothing enforces they stay that way.
- **A second CEO dashboard** (`/ceo-dashboard`, its own client + API routes, never called by `/ceo`) exists alongside this one — the same shape as the four pairs already tracked in `DUPLICATE-ROUTES.md`, not added there yet since its own client wasn't read in full this pass.
- **Section H of `/ceo`** is a hardcoded client-side "password" (`'CENTERHQ-ADMIN'`, visible in the shipped bundle) gating 4 buttons that set the exact same config keys Section G already exposes as plain checkboxes — dead weight giving a false sense of an extra security layer, not a real one. Likely worth deleting outright; not done here since removing a whole section is a product call, not a bug fix.
- A dead `legacyPayload` in `/api/ceo/dashboard` drives real extra Supabase queries every 30-second poll for a response nothing reads — a cost/performance cleanup, not a correctness bug.
- The sales-lead form hardcodes `governorate: 'cairo'` for every lead regardless of where the center actually is — needs a real selector, not a one-line fix.

**Center-Students re-verification (31 July 2026) — asked to confirm the fraction against the merged
file, not memory, after the file had already been surveyed twice (#239, #249).** Ran two independent
fresh reads — a granular line-by-line checklist of every frame in `Merged-Center-Students.html`, and a
full re-read of all four live page files — and reconciled them by hand against what #239/#249 had
already recorded, rather than trusting the prior ~51% figure on its own.

**Result: the prior work holds up.** Nearly every gap this fresh pass found was already on record —
independent re-derivation landed on **F12, F14, F15, F16**, and the exact §02 attendance-badge/attendance-ratio
calls from #249's own notes, without having read those notes first. That is the outcome "verify, don't
trust" is supposed to produce: not new alarms, confirmation that the earlier audit was accurate.

| § | before (post-#239, pre-#249) | after (confirmed today, post-#249) | what moved |
|---|---|---|---|
| §01 Roster | 0.75/1 | **0.8/1** | #249's mobile "owes X EGP" line confirmed live. Residual: **F15** (lifecycle chips vs. the design's payment-standing chips are two taxonomies, unfused) re-confirmed; one new small item — the design's header/KPI assume a multi-branch rollup ("128 active · 3 branches"), live shows a total count only, no branch breakdown |
| §02 Student Detail | 0.5/1 (5 named gaps: kebab menu, payment-standing badge, tinted balance card, per-member family list, sticky action bar) | **0.55/1** | #249's payment-standing badge confirmed live, closing 1 of 5. The other 4 confirmed still absent, unchanged. Two new items surfaced: no aging/next-due sub-line under the balance figure at all, and no "ID card" quick-action tile (live's 4 tiles are Call/Message/Collect payment/Edit) |
| §03 Verified | 0.05/1 | **0.05/1, unchanged** | confirmed nothing overlaps functionally — the one shared UI shape (Call/WhatsApp contact cards) lives on `/students/pending`, a different feature (signup approval, not payment tracking), so it isn't partial credit toward this section |
| §04 Import & Pending | 0.75/1 | **0.75/1, unchanged** | **F12** and **F14** both re-confirmed live exactly as logged. One adjacent nuance not previously called out: the Review step's flagged rows are skip-only in code (design shows a per-row "Fix" button to correct in place) |
| **Overall** | **~51%** | **~54%** | entirely #249's effect — no section moved down on re-check |

Full detail on the two new small gaps (§01 branches rollup, §02 balance-aging sub-line, §02 ID-card
tile, §04 inline-fix) is logged as **F22** in `BUILD-AFTER-REDESIGN.md`, grouped as one entry since all
four are the same shape: real, low-severity, display-only gaps found while re-verifying already-shipped
work, none touching money computation or write paths.

**Teacher-Insight (31 July 2026) — first survey, and a factual correction to D14, not just a build.**
Row 18, previously "not surveyed," blocked by **D14** ("teacher referral model... every referral table
is center-to-center only, confirmed absent, not merely unfound"). Read `Merged-Teacher-Insight.html`
fresh (2 sections: Analytics, Referrals) against a full re-read of the live code, independently, then
reconciled.

**D14's stated reason was wrong, not stale — verified live before touching anything.** A complete,
working teacher-to-teacher referral loop already exists: `teacher_profiles.referral_code` (unique) and
`referred_by_teacher_id`, plus `teacher_subscriptions.free_months_credit`/`referral_rewarded_at` — all
four confirmed directly against `information_schema.columns` on the production database, not inferred
from a migration file. `grantReferralReward` is genuinely wired into `combinedPaymentFinalize.ts`,
idempotent, blocks self-referral. It has just never fired yet — 3 teachers hold an issued code, 0 have
`referred_by_teacher_id` set, confirmed by a live count query. **What it is NOT is a percentage
commission**: the code's own comment is explicit that "teachers do not earn commission" — the reward is
a flat one-time +1 free month to both sides, nothing recurring, nothing decaying, no cash. The design
draws a full copy of the **center** program instead — 25%/10%/5% recurring commission on the referred
teacher's subscription fee, monthly aggregate income, a per-referral earnings/countdown list, and
bank-withdrawal gated on identity verification. Building that means replacing the working free-month
loop or running two reward systems side by side — genuinely still a decision, just not the one D14
used to describe. Corrected rather than left to mislead the next reader, same discipline as D3's
correction in this log.

**§01 Analytics — built:** the design's single drawn frame ("the Pro-gated state a Standard teacher
sees") promises 5 "what you'll unlock" roadmap cards; live's `PileBPlaceholders` only had 3
(dropout rate, enrolment trend, students who often miss class) despite matching those 3 by name
exactly. Added the missing 2 (`avgSessionTitle`, `missedIncomeTitle`) as the same honest
"collecting data" placeholder already used for the other 3 — zero new computation, matching the
existing component's own pattern, not a new metric being promised. Nothing else was built here: the
live Pro dashboard behind this gate is already a full, sophisticated, real analytics suite (live
revenue by group, 6-month trend, attendance by weekday, payment-risk list, all through
`getStudentBalances`/`transactions.teacher_net`/`ar_by_student`, never a hand-rolled figure) — far
beyond what this design file even draws, since the mock only shows the locked teaser, not the
unlocked view.

**Referral-attribution bug found and fixed, independent of D14.** `ReferralCard`'s share link points to
`/teacher/landing?ref={code}`, but `TeacherLandingClient.tsx` never read the query string — all 5
"Sign up" CTAs on that page were a static `href="/teacher/signup"`, silently dropping `ref` for anyone
who clicked through instead of retyping the code. Fixed by having `teacher/landing/page.tsx` read
`searchParams.ref` server-side and thread it into the client component as a prop — not
`useSearchParams()` client-side, which would need a Suspense boundary this page doesn't have and risks
breaking static rendering.

| § | fraction | notes |
|---|---|---|
| §01 Analytics | 0.9/1 | upsell messaging/CTA matches in intent (styled differently — brass banner vs. the design's teal-gradient card with a lock icon and "Pro" pill, a restyle item, not a structural one); all 5 roadmap cards now present. The design has no frame for the actual Pro-unlocked dashboard, so nothing to score there — live's version is a superset |
| §02 Referrals | 0.1/1, correctly still blocked | the only fragments that exist (a share-link card on the teacher home page, a bare-code display in Settings/Centers) are real but serve a different, simpler mechanism than the one drawn; the hero card, rate-decay timeline, per-referral earnings list and verification-gated withdraw/credit UI are all absent, same conclusion as before — now for the right reason |
| **Overall** | **~50%** | first survey — no prior fraction to compare against |

**Teacher-WhatsApp (31 July 2026) — surveyed, nothing built, no PR for code (docs only).** Row 19,
blocked by **D6**, previously a two-line placeholder ("Balance, what used it, the template list" /
"every referral table is center-to-center only" — no, that's D14; D6's own text was just as thin:
"Blocked by D5, plus the allowance decision itself"). Route coverage is genuinely 0/1 — no
`/teacher/whatsapp` page exists — matching the table exactly. But the design's own lede claims
teachers "already get bundled credit" and "buy the same packs at the same rate" as centers, so each
claim was checked live rather than assumed folded into "0/1, nothing to see."

**The credit balance is real, live and marketed — and structurally can never go down.**
`teacher_profiles.blast_credits_subscription`/`blast_credits_purchased` exist in production
(confirmed via `information_schema.columns`), granted 100/month to Pro/Scale teachers by a real RPC,
reset by a real cron, and marketed today on the plan-comparison table ("100 EGP WhatsApp credit
monthly"). The spend side, RPC `deduct_blast_credits`, has **zero callers anywhere in `src/`** —
confirmed by grep. The number only ever goes up. Nowhere in the teacher portal shows it to the teacher
either — it only appears in the CEO admin view. A marketed monetary benefit that cannot deplete is a
product-integrity finding, not a missing screen.

**None of the design's 5 templates are delivering to a teacher's parents today, for five different,
independently live-checked reasons:** Welcome doesn't exist for teachers (hard-keyed to `center_id`);
Fee reminder's code path is real (the cron already covers teacher-billed lessons) but its Meta template
is `PENDING`, not `APPROVED` — a platform-wide gap, not teacher-specific, confirmed live via
`wa_meta_templates`; the three schedule-change templates have real send code but **no Meta template
row at all**, not even pending; and Payment link/Receipt — the "sent by us, we pay" pair — doesn't
exist **for anyone**, center or teacher. Grepped all 54 `chq_*` template names in the codebase; the
closest match, `chq_payment_confirmed`, confirms a center's own subscription bill to TutoringHQ, not a
parent-facing session receipt.

**The pack/purchase side is unbuilt, confirmed, not just thin.** The only prepaid-tier concept
anywhere (`whatsapp-pack`) is center-only and isn't even the same shape as the design's fixed
200/1,000/5,000 tiers — it's an invoiced rolling balance with monthly minimums. Nothing to extend to
teachers as-is.

| § | fraction | notes |
|---|---|---|
| §01 Teacher WhatsApp | 0/1, correctly blocked | matches route coverage exactly; the underlying credit-balance columns are real but disconnected from spend, and 0 of 5 drawn templates are actually delivering today (for 5 different, independently-verified reasons — one platform-wide Meta-approval gap, three never-submitted templates, one pair that doesn't exist for anyone) |

Full detail — including the live `wa_meta_templates` approval-status query and the `deduct_blast_credits`
zero-callers grep — is folded into an expanded **D6** in `BUILD-AFTER-REDESIGN.md`, since every finding
here bears directly on what building this screen would require, rather than split into separate F-items.

**Admin-Platform re-verification (31 July 2026)** — asked to confirm PR #224's fraction against the
merged file, not memory, before accepting a "done" file at face value. Read `Merged-Admin-Platform.html`
fresh across all 6 sections against a full re-read of the live code, plus independent
`information_schema`/`platform_config` queries against production, then reconciled by hand against
#224's own recorded numbers rather than trusting them on sight.

**Result: #224 holds up on 5 of 6 sections, and one real, already-flagged gap was still open.**
§01, §03, §04, §05, §06 re-confirmed unchanged at exactly the fractions #224 recorded — every schema
claim underneath them (`promo_codes`, `platform_config`, `privacy_requests`, `vendors`,
`wa_meta_templates` column sets) re-checked live and matched. §02 was the one section #224 had marked
short in its own omitted table ("per-account student counts — needs a per-centre roll-up this endpoint
does not compute") without building it. Confirmed the gap was real — `src/app/api/admin/overview/route.ts`
hardcoded `students: null` on both `centreAccounts` and `teacherAccounts` — and built it.

| § | before (#224, 30 Jul) | after (confirmed 31 Jul) | what moved |
|---|---|---|---|
| §01 Admin Overview | 0.85/1 | 0.85/1, unchanged | re-confirmed live, no new gaps |
| §02 Admin Analytics | 0.8/1 | **0.85/1** | TOP BY REVENUE centre rows now carry a real per-centre active-student count |
| §03 Admin Platform | 0.65/1 | 0.65/1, unchanged | FEATURES/SYSTEM omissions re-confirmed — no `referrals`/`attendance_scanner`/`app_version`/`force_update` key exists in live `platform_config` |
| §04 Admin WhatsApp Pack | 0.5/1 | 0.5/1, unchanged | overview frame still blocked on **D5** (credit-model pricing decision), re-confirmed, not re-attempted |
| §05 Admin Promo Codes | 0.7/1 | 0.7/1, unchanged | `promo_codes` column set re-confirmed exactly as #224 recorded |
| §06 Admin Privacy Requests | 0.75/1 | 0.75/1, unchanged | `privacy_requests` re-confirmed to carry no centre/account link to join against |
| **Overall** | **4.55/6** | **4.6/6** | entirely §02's effect |

**§02 built, narrowly.** `fetchCenterStudentCounts` (`src/lib/adminCustomerSplit.ts`) queries active
student counts scoped to only the 5 ranked centre IDs actually rendered in TOP BY REVENUE — not a full
centres scan — wired into `/api/admin/overview` and rendered in `AnalyticsGrowthHeader.tsx` as
`'<plan> · N students'` for centre rows, leaving `'Teacher · <plan>'` unchanged for the one teacher row,
matching the design's own centre/teacher asymmetry exactly. Kept deliberately narrow given what it sits
next to: MRR ranking logic, a money-adjacent surface this pass had no reason to touch beyond the one
missing field. Added `admin.platformAnalytics.studentsCount` to both `messages/en.json` and
`messages/ar.json`; `npx tsx scripts/check-i18n.ts` confirmed parity after the add.

**Every other omission in #224's table re-confirmed live, not re-asserted from memory:**

| omitted | why (re-confirmed) |
|---|---|
| §01 Unverified filter chip | **V1** — Valify identity verification is not live, still nothing to filter on |
| §01 `/admin/teachers` frame | **R7-CLOSED** — built 28 July, closed unmerged on Eyad's explicit call; re-building it would contradict that decision, not fill a gap |
| §02 "Platform fees" line | `invoices.metadata.processing_fee` is still a jsonb key with no column or aggregate anywhere — confirmed live, only 2 of the dataset's rows even carry it; summing it invents a "platform fees" definition, a pricing call not a restyle |
| §03 INTEGRATIONS + PAYMOB DETAIL | still no integrations/vendor-health table; `vendors` is confirmed card-printing suppliers only (`name`, `whatsapp_number`, `pickup_address`, `city`, `is_active`), `/admin/health` shows Paymob/WhatsApp mode only, no success rate or merchant ID — rendering Valify "Connected" would fabricate a state that isn't live |
| §03 Referrals, Attendance scanner, App version, Force update | re-queried `platform_config` directly — no such keys exist, same conclusion as #224 |
| §03 Card orders (global) | still per-centre (`centers.card_orders_enabled`), not a platform switch |
| §04 overview frame (credit liability, cost/margin per category) | blocked on **D5** — the design's one-time-top-up credit model is a different charge shape than the live per-parent monthly pack; building the overview means pricing something first, not restyling |
| §04 per-template On/Off, funding grouping | `wa_meta_templates` still has no `enabled` column and no funding-source column; grouping by real Meta category, confirmed still correct |
| §05 Fixed EGP / Free month / applies-to / Scheduled | `promo_codes` columns re-confirmed live (`id`, `code`, `discount_pct`, `max_uses_total`, `uses_count`, `expires_at`, `is_active`, `created_at`, `created_by`) — still no target-type, discount-kind, or start-date columns |
| §06 request-detail "WILL BE DELETED" counts | `privacy_requests` still carries only free-text requester fields, no link to count against |

**Verification, not trust, on every line above:** `mcp__Supabase__execute_sql` against
`information_schema.columns` for `promo_codes`/`platform_config`/`privacy_requests`/`vendors`/
`wa_meta_templates`/`whatsapp_usage`/`centers`, plus a direct `select key,value from platform_config`
for the §03 FEATURES/SYSTEM claims. `npx eslint` on the three touched files came back clean; full unit,
E2E-smoke, i18n, bidi and build gates green on the PR. Squash-merged as `bd5593aa`.

**Teacher-Home re-verification (31 July 2026)** — asked to confirm PR #225's fraction against the
merged file, not memory, before accepting a "done" file at face value. Re-read
`Merged-Teacher-Home.html` in full against a fresh read of the live `page.tsx`, `schedule/page.tsx`,
`TeacherShell`, `TeacherNav`, `IncomeCalculator` and `FreeZoneBanner`, plus independent
`information_schema` queries against production, then reconciled by hand against #225's own recorded
numbers rather than trusting them on sight.

**Result: #225 holds up on all three tracked states, nothing moved.** The unverified/self-collect
state — the only one that renders for any real teacher today — re-confirmed at 6/7, same single gap.
The verified/we-collect state re-confirmed 0/3, still fully blocked. §02 Teacher Schedule re-confirmed
6/6, the brass 0-enrolled accent from #225 still live.

| § | before (#225, 30 Jul) | after (confirmed 31 Jul) | what moved |
|---|---|---|---|
| §01 unverified/self-collect state | 6/7 | 6/7, unchanged | same single gap, still blocked on V1 |
| §01 verified/we-collect state | 0/3, blocked V1/V3/V4 | 0/3, unchanged | cannot render for any real teacher; no balance to invent |
| §02 Teacher Schedule | 5/6 pre-#225 → 6/6 after | 6/6, unchanged | brass 0-enrolled accent (`schedule/page.tsx:237`) re-confirmed live |
| **Overall** | **12/16** | **12/16** | nothing moved |

**V1 re-confirmed, not re-asserted.** Grepped `src/app/[locale]/teacher` for "Let us collect" /
"Verify my ID" / "collect-for-you" — no match. Queried live `information_schema.columns` for anything
verification/identity-shaped — only unrelated rows (`phone_verifications`,
`students.phone_verified`/`parent_phone_verified`, `mfa_challenges`, `oauth_client_states`,
`enrollment_otps`, `teacher_signup_otps`); no Valify or identity-verification table exists anywhere in
the catalog. The "Let us collect for you / Verify my ID" banner still has nothing to link to.

**V3/V4 re-confirmed, not re-asserted.** Grepped for "your balance" / "recent payouts" /
"next processed" across the teacher portal — no match. No teacher-scoped payout ledger exists:
`payout_requests` is centre-scoped, `commission_payouts` is EH-staff-scoped. The dormant settlement
columns flagged 30 July are still untouched — `transactions.settlement_status` /
`expected_settlement_at` / `settled_at` / `settlement_retry_count` and
`teacher_profiles.payout_destination` all still exist and are still 0 rows touched (`SELECT count(*)
FROM transactions WHERE settled_at IS NOT NULL OR settlement_retry_count > 0` = 0), zero code
references.

**No new safely-buildable gap found, no code changed.** The only remaining gaps are the same two
blocks already logged as **V1** and **V3/V4** in `BUILD-AFTER-REDESIGN.md`. This entry documents a
confirmed-unchanged fraction, not a build — no code PR accompanies it.

**Teacher-Students re-verification (31 July 2026) — re-checked #226's "close" call against the merged
file, not memory, and logs #264 (`827e2333`), which this table had not caught up to yet.** Read
`Merged-Teacher-Students.html` fresh across both sections against a full re-read of the live route, API
and component (`teacher/students/page.tsx`, `AllStudentsList.tsx`,
`/api/teacher/private/students/route.ts`), plus `BUILD-AFTER-REDESIGN.md`'s D15 entry, before touching
anything.

**Table correction: the row above for #266 previously read `v41`.** It should have read `v42` — #264
(chronologically earlier: `827e2333` merged before `28bc257a`/#265 and `71fefa05`/#266) bumped
`SW_VERSION` and had simply never been logged as a row, so every SW_VERSION cell after it inherited the
stale value. Fixed by adding #264's row in place and correcting #266's cell, same discipline as D14's
and D3's prior corrections in this log.

**§01 holds up exactly as #226 recorded.** Every drawn element is live, confirmed by grep against
current source: search input, the segmented group-filter chip row, the "N students" count header, and
avatar-initials + name + group tag + phone on each row. Nothing moved.

**§02 had one real gap #226 missed: the payment-history row had no caption.** The design draws "Not
collected yet" for a pending charge and "Paid · Cash" / "Paid · InstaPay" for a paid one; live showed
only date, group and a bare Paid/Pending pill. Confirmed absent before touching anything — grepping
`src/` and `messages/` for "Not collected" / "paidVia" / "Paid ·" returned zero matches.

**Closed with no schema change.** `transactions.method` already exists in production — confirmed live
via `information_schema.columns` — and is already populated by the existing mark-paid RPC path
(`apply_transaction_transition` sets it; `MANUAL_METHODS` = `cash | instapay | vodafone_cash | other`,
confirmed by reading the mark-paid route). The students API route's `.select()` simply wasn't asking
for it. Added `method` to the select, threaded `method: string | null` through
`StudentBilling.transactions` in both the route and `AllStudentsList.tsx`, and rendered the caption
reusing the existing `teacherPortal.markPaid.*` labels — the same mapping `IncomeView.tsx` already
uses — rather than inventing new copy. Two new keys (`teacherPortal.studentsList.paidVia`,
`.notCollectedYet`), en+ar, parity-checked (`npx tsx scripts/check-i18n.ts` → OK, 4129 resolved keys).

**D15 re-confirmed, not re-attempted.** The Balance card's `Mark collected` and `Send reminder` buttons
are unchanged from 30 July. `Mark collected` is wireable today — the mark-paid endpoint is already live
and already called from `GroupClassesTab` and the session-detail page, it simply has no caller from
student-detail — but it is still a money-state write with no decision from Eyad on exposing it from
this screen. `Send reminder` is genuinely new functionality (only the nightly `send-balance-reminder`
cron exists today) that spends WhatsApp cost per send. Neither was built, for the same reason D15 was
originally held, re-verified live rather than re-asserted from memory.

| § | before (#226, 30 Jul) | after (confirmed 31 Jul) | what moved |
|---|---|---|---|
| §01 Teacher Students (list) | "close" — search, group-filter chips, count header, avatar+name+group+phone all built | unchanged, confirmed live | nothing |
| §02 Teacher Student Detail | "built, all read-only", D15 blocked | payment-history row caption closed; D15 re-confirmed, still correctly blocked | §02's one real gap |

Full detail on the caption fix is in **#264** (`827e2333`); D15 itself is unchanged in
`BUILD-AFTER-REDESIGN.md`. No new decision needed from Eyad beyond D15's existing two items.
**Teacher-Setup re-verification (31 July 2026)** — asked to confirm PR #227's "already complete —
no change" claim against the merged file, not memory, before accepting a "done" claim at face
value. Read `Merged-Teacher-Setup.html` fresh across both sections against a full re-read of the
live code (`teacher/(portal)/settings/page.tsx`, `GroupProposalsSection.tsx`, `CenterCutsSection`,
`CenterEarningsSection`, `JoinCenterCard`), plus independent `information_schema` and
transaction-count queries against production, then reconciled by hand against #227's own claim
rather than trusting it on sight.

**Result: #227's claim was one gap too generous — the same shape as D3/D14's prior corrections, not
a regression.** §01's "already complete" verdict silently folded in a "Collect payments for me"
toggle and its verified-state Payout details section that do not exist in the live code at all —
0/2, never itemized before. The rest of §01 (Account 3/3; Payment details/unverified, My code,
Change PIN, Your account, Manage billing 5/5) is genuinely complete, confirmed live. §02 Teacher
Centers is 6/6 structurally present, unchanged since #227's fix, but its hero/per-center "Owed"
figures still read 0.00 EGP live (**D16**) and "Share your profile" still 404s (**D17**) — both
pre-existing, re-confirmed, not new.

| § | before (#227's claim, 29 Jul) | after (confirmed 31 Jul) | what moved |
|---|---|---|---|
| §01 Account (name/subject/save) | "already complete" | **3/3** | confirmed live, unchanged |
| §01 Collect-payments toggle + Payout details (verified state) | folded into "already complete" | **0/2**, confirmed blocked | genuinely absent — no `verification_status` column on `teacher_profiles`, confirmed via `information_schema.columns`; matches `DECISION-national-id-2026-07-26.md` and `VERIFICATION-SPEC.md` |
| §01 Payment details (unverified), My code, Change PIN, Your account, Manage billing | "already complete" | **5/5** | confirmed live; Manage-billing is a superset inline section, not the design's compact row — noted, not rebuilt |
| §02 Teacher Centers (hero, centers list, group proposals, class times, join-a-center, counter sheet) | you-earn figure + centre/group counts fixed by #227 | **6/6** structurally present | hero/owed figures still 0.00 EGP (**D16**, re-confirmed: `select count(*) from transactions where kind='center_fee'` = 0) · "Share your profile" still 404s (**D17**, re-confirmed by route glob) — both pre-existing, unchanged, blocked on Eyad |
| **Overall structure** | claimed complete | **14/16** | the 0/2 gap was never itemized before — a correction, not a regression |

**Built, narrowly: one counter-offer autonote.** `GroupProposalsSection.tsx` gets the design's
"Student rate stays X · center would keep Y" line under a counter-offer, computed from already-live
`feePerClass`/`center_cut_egp` data — pure display arithmetic on real values already surfacing
correctly elsewhere (see D16's own note on this exact field), no new write path, no schema change.
Added `groupProposals.counterAutonote` to both `messages/en.json` and `messages/ar.json`;
`npx tsx scripts/check-i18n.ts` confirmed parity.

**Declined, deliberately: the richer `CounterOfferForm`/`OfferHistory` redesign.** The design's
stepper control, "Their offer" summary box and full bottom-sheet layout would touch components
shared with the center console's own `GroupProposalsTab.tsx` (Center-Groups) — confirmed live by
`grep -rln "CounterOfferForm\|OfferHistory" src --include=*.tsx`, two consumers. Changing shared
copy or behavior for this file's design without checking it against Center-Groups' own design is
exactly the mistake the shared-component discipline exists to prevent — left alone, not rebuilt.

**Verification, not trust, on every blocked line.**
`grep -rn "Collect payments for me\|Payout details" "src/app/[locale]/teacher"` → no matches
(genuinely absent, not merely unfound). `select column_name from information_schema.columns where
table_name='teacher_profiles' and (column_name ilike '%verif%' or ilike '%payout%' or ilike
'%collect%')` → only `payout_destination`, no `verification_status`. `select count(*) from
transactions where kind='center_fee'` → 0, same as D16's original finding. No route matches
`/teacher/profile/[id]` anywhere under `src/app/[locale]/`, same as D17's original finding. Full
unit, E2E-smoke, i18n, bidi and build gates green on the PR. Squash-merged as `28bc257a`.
**Admin-Accounts re-verification (31 July 2026)** — asked to confirm PRs #221-#223's fractions
against the merged file, not memory, before accepting a "done" file at face value. Read
`Merged-Admin-Accounts.html` fresh across all four sections (five, counting the teacher half of §01
separately) against a full re-read of the live code, plus independent `information_schema` queries
against production, then reconciled by hand rather than trusting FILE-COMPLETION-TABLE.md's row 2
("100% today? YES") on sight.

**Result: three of four tracked sections hold exactly at their #221-#223 fractions; the fourth was
never tracked as its own number and turns out to be permanently zero.** §02 Admin Staff re-confirmed
1/1 — list and member-detail permission sheet still wired to `public.permissions`. §03 Admin Center
Assignments re-confirmed 0.9/1 — the route itself (**R5**) is built and live at
`/admin/teacher-links`; the one gap, a Link-type (Visiting/Permanent) segmented control, is still
schema-absent (`teacher_center_requests` carries `id, teacher_id, center_id, status, message,
created_at, updated_at, responded_at, responded_by, initiated_by` — no link-type column, confirmed
live). §04 Admin Referrals re-confirmed 0.8/1 — the SIGNUP REWARD block still has no ledger, column,
or code path anywhere (grepped referral libs/routes for credit/reward code, nothing). §01 centre half
re-confirmed 0.8/1 (16/20 design elements), unchanged from #223.

**§01 teacher half is not a fraction that ever moved — it is R7, and R7 is closed.**
FILE-COMPLETION-TABLE.md still listed R7 under "Buildable now," which is stale: R7 was built 28 July
2026 (a full `/admin/teachers`, `/admin/teachers/[id]` pair) and then closed unmerged on Eyad's own
call — "one teacher console, not two" — with `/ceo/teachers` covering that data instead. Grepped
`admin/teachers` across `src`: only two comments, in `AccountDetailHeader.tsx` and
`PlatformOverviewHeader.tsx`, documenting that closure; no live route or files exist under an admin
teacher-detail path. This is a resolved decision against building it this way, not a pending gap —
recorded here as **R7-CLOSED**, the same code #224's table already uses for Admin-Platform.

**Two more gaps confirmed genuinely blocked, not previously broken out on their own:**

| item | why |
|---|---|
| Verified chip + "National ID on file · Valify" row (both frames) | **V1** — no verification column on `centers`, confirmed live (`information_schema.columns`, zero rows matching `%verif%`/`%valify%`) |
| Branches row in MANAGE group (with count) | no `branches` table exists — only `branch_user_assignments` (staff↔branch visibility, not the branches themselves), confirmed via `information_schema.tables` |
| ACTIONS: "Log in as center" / "Log in as teacher" | no impersonation mechanism exists anywhere — grep for `impersonat\|login_as\|loginAsCenter` returns only the two comments documenting its absence; this needs a new auth primitive, not a UI row |

**No code changed, no PR opened for the file itself.** `AccountDetailHeader.tsx` has exactly one call
site (`centerManagementClient.tsx:1688`), all 8 anchors present and wired (`acct-profile`/`plan`/
`addons`/`invoices`/`activity`/`notes` at lines 1697, 1846, 2158, 2657, 3468, 3498). i18n parity
checked and holds: `admin.accountDetail` (9/9), `admin.teacherLinks` (24/24),
`admin.referralsAdminPage` (31/31), `admin.internalTeam` (25/25) — no stubs. None of the six
remaining gaps was safely buildable this pass — three on absent schema, one on Valify, one on
missing auth infrastructure, one on Eyad's own resolved decision.

| § | before (#221-#223, 29 Jul) | after (confirmed 31 Jul) | what moved |
|---|---|---|---|
| §01 Admin Account Detail — centre half | 0.8/1 | 0.8/1, unchanged | 16/20 design elements, same single-call-site wiring re-confirmed |
| §01 Admin Account Detail — teacher half | not tracked separately (R7) | 0/1 | does not exist; R7 built 28 Jul, closed unmerged on Eyad's decision |
| §02 Admin Staff | 1/1 | 1/1, unchanged | list + member-detail permission sheet still wired to `public.permissions` |
| §03 Admin Center Assignments | 0.9/1 | 0.9/1, unchanged | only gap is the Link-type control, still schema-absent |
| §04 Admin Referrals | 0.8/1 | 0.8/1, unchanged | only gap is the SIGNUP REWARD block, still no ledger/column |
| **Overall (tracked sections)** | **3.5/4** | **3.5/4** | nothing moved; teacher half was never in this denominator and stays 0/1 on its own |

`FILE-COMPLETION-TABLE.md` row 2 updated in this same PR: structure coverage recorded, "Buildable
now" cleared of the closed R7, and "100% today?" corrected from **YES** to **no**.

**Docs-append note (this PR).** #267 and #270 each independently documented the above two files'
re-verifications, but both forked before the other's fixes landed and neither could safely
self-detect the resulting GitHub-level content conflict (`mergeable_state: dirty`) since it doesn't
fail CI — both were closed and their content consolidated here, rebuilt on top of current master in
one pass. No content changed from either original PR, only the base.
