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
