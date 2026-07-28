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
