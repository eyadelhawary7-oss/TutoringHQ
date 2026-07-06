# Auth pages cream redesign — findings

Redesign of the last three dark auth pages (`/signup`, `/session-expired`,
`/accept-invite`) into the cream + teal look, finishing the "zero dark anywhere"
goal. **Styling only — every bit of auth logic stays byte-identical.**

Approach: pilot `/session-expired` first (Phase A), hold for review, then apply
the same established style to `/signup` and `/accept-invite` (Phase B).

---

## Phase A — pilot `/session-expired` (DONE, awaiting review)

### What changed

**`src/app/[locale]/session-expired/page.tsx`** — redesigned to the cream/teal
look, consistent with the already-light `/login` page family:

- Cream page background via `var(--color-surface-0)` (was hardcoded `#080f1a`).
- Soft white card via `var(--color-surface-1)`, `1px var(--color-border)`,
  `border-radius: 20px`, one gentle shadow `var(--shadow-md)`, generous padding.
- Teal clock-icon badge: `var(--color-teal-soft)` fill, `var(--color-border-brand)`
  hairline, icon stroked `var(--color-teal)` (was dark `teal-900/20` chip +
  `#0D9488` hardcoded stroke).
- Title in the Playfair display face (matching `/login`), `var(--color-text-primary)`
  (was `text-white`); description `var(--color-text-secondary)` (was `text-slate-400`).
- Primary CTA: full-width teal button `var(--color-teal)`, white label, keeps the
  existing `btn-press` + `chq-focus` utility classes.
- Removed `import { LoginThemeEffect }` and its `<LoginThemeEffect />` render — this
  page no longer asks the document root to go `.dark`.
- RTL-safe: logical spacing only; no physical `left/right/ml/mr`.

The **only interactive element is `<Link href="/login">`**, preserved verbatim. This
page has no form, no OTP, no submit, no redirect logic — so "auth logic unchanged"
is trivially and fully satisfied here.

**`src/app/globals.css`** — removed the three `[data-chq-session-expired]` dark
locks (following the exact precedent set for `[data-chq-login]` in the ADR 031 pass):

1. The token lock (`--color-surface-0: #080f1a !important` … block) — dropped the
   `[data-chq-session-expired]` selector, kept `[data-chq-signup]` (signup is still
   dark until Phase B).
2. The full-page dark surface block (`background-color: #080f1a` + `.text-white` /
   `.text-slate-400` overrides) — removed entirely, replaced with a "do not re-add"
   comment.
3. The dark-canvas anti-flash block (`[data-chq-signup], [data-chq-session-expired]`
   + the `html:has(...)` / `body:has(...)` rules) — dropped the
   `[data-chq-session-expired]` selectors, kept the `[data-chq-signup]` ones.

The `data-chq-session-expired` attribute is **kept on the page element** as an inert
page marker — same as `data-chq-login` on `/login`. With all three CSS locks gone it
resolves the cream surface tokens like the rest of the app.

### Verification

Screenshots captured with the dev-server + Playwright method from the dark-mode
removal task (`colorScheme` emulation, `executablePath: /opt/pw-browsers/chromium`):

| Render | `<html>` class | root `color-scheme` | body bg | result |
|---|---|---|---|---|
| Before `/ar/session-expired` | `dark` | `dark` | `rgb(8,15,26)` `#080f1a` | dark (old) |
| After  `/ar/session-expired` | `(none)` | `light` | `rgb(236,232,223)` cream | **light** |
| After  `/en/session-expired` | `(none)` | `light` | `rgb(236,232,223)` cream | **light** |
| After  `/ar` under **emulated dark OS** | `(none)` | `light` | `rgb(236,232,223)` cream | **light** |

The emulated-dark-OS render being identical to the light render proves the page stays
cream regardless of device preference, and that dropping `<LoginThemeEffect />` leaves
no `.dark` stranded on the root.

Gates (all green):

- [x] `next build` — compiled in ~50s, **394/394** static pages generated, exit 0.
- [x] Unit suite — **1147 passed / 141 files**.
- [x] `npm run typecheck` — clean.
- [x] `npm run lint` — **0 errors** (162 pre-existing warnings, all in untouched test files).
- [x] `verify:stabilization` — i18n (3832 keys, en/ar parity), bidi, tolocale all OK.

Logic diff: **styling/markup only.** `git diff` touches exactly two files
(`page.tsx`, `globals.css`); no API route, helper, schema, or auth module changed.

---

## Phase B — `/signup` and `/accept-invite` (NOT STARTED — held for approval)

Pending Eyad's sign-off on the pilot look. Plan, once approved:

- Apply the same cream/teal card style established in Phase A.
- On `/accept-invite`, the `PhoneInput` / `OTPInput` currently resolve their colors
  under a `.dark` scope. In light they resolve to the light token values — verify they
  render correctly and legibly in the cream look before finalizing.
- Screenshot each (shell render is fine where a live token/invite is needed), including
  under emulated dark OS.
- Keep the same hard guardrail: all fields, OTP send/verify flow, invite-token handling,
  submits, redirects, error states, and rate-limit behavior stay byte-identical.

---

## Reported for a later separate cleanup step (do NOT collapse in this build)

Once all three pages are light, the following become fully inert and can be removed in
a dedicated follow-up:

1. **`src/components/LoginThemeEffect.tsx`** — after Phase B no page imports it, so
   nothing ever adds `.dark` to the document root. Currently still used by
   `src/app/[locale]/signup/layout.tsx` and `src/app/[locale]/accept-invite/page.tsx`.
2. **The `.dark` token blocks in `globals.css`** — the `html.dark` / `.dark` cascade and
   the remaining `[data-chq-signup]` lock become dead once signup is cream.
3. **~54 files using `dark:` Tailwind variants** — inert app-side; safe to strip in the
   cleanup pass.

These are intentionally left in place in this build.
