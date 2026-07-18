# Dark Mode Removal — Reference Map & Findings (2026-07-05)

> HISTORICAL point-in-time record (2026-07-05), synced against the live database and code on 2026-07-18. The state it describes as "current" — the `.dark` machinery KEPT to serve three still-dark auth pages — has since been SUPERSEDED: the auth pages got their cream redesign (`docs/AUTH_PAGES_CREAM_REDESIGN_2026-07-05.md`) and the dark scaffolding was then deleted (`docs/DARK_MODE_LEFTOVERS_CLEANUP_2026-07-06.md`). Live 2026-07-18: `LoginThemeEffect.tsx` and `contexts/ThemeContext.tsx` are gone, `next-themes` is absent from `package.json`, and there are **zero Tailwind `dark:` variants left in `src`** (the only `dark`-keyed strings remaining are QR-code `color:{dark,light}` object props) (verified live 2026-07-18). Read the two follow-up docs for the end state; this file is preserved as the original removal map.

**Goal:** One theme, light, everywhere. Remove the dark-mode *theme system* (toggle,
provider, persistence) and guarantee the app renders light even on a device/OS set to
dark. Deliberate, reversible product decision. No DB schema change. Hold for Eyad's
review — no PR until approved.

## TL;DR outcome

- The dark-mode **theme system** (moon toggle, `next-themes` provider, `chq-theme`
  persistence, load-time inline script) is removed. The app now renders **light
  everywhere by construction** — nothing ever adds `.dark` to `<html>` for the app, and
  `color-scheme: light` is pinned at the root, so an OS/device set to dark **cannot**
  darken the app.
- The three **deliberately dark-locked auth pages** (`/signup`, `/session-expired`,
  `/accept-invite`) are **left as-is** per Eyad's decision (same category as the invoice
  PDF: an intentional fixed dark design, pending their own future "cream redesign" pass).
  They paint dark from **hardcoded hex** + the `[data-chq-*]` locks, not from the removed
  toggle. See "Reported for later" below.

## Where the live theme system lives

Stale duplicates (`src/components/ThemeToggle.tsx`, `src/contexts/ThemeContext.tsx`) were
already deleted in the dead-code pass (see `docs/DEAD_CODE_REMOVED_2026-07-05.md`). The
**live** system is:

| Piece | File | Role |
|---|---|---|
| Toggle UI (moon icon) | `src/components/ui/ThemeToggle.tsx` | `useTheme()` two-state cream/dark switch |
| Theme provider | `src/components/ThemeProvider.tsx` | `next-themes` `ThemeProvider` (`storageKey="chq-theme"`, `themes={['cream','dark']}`, `enableSystem={false}`) |
| Persistence / FOUC script | `src/app/[locale]/layout.tsx` (`<head>` inline `<script>`) | reads `localStorage['chq-theme']`, applies `cream`/`dark` class to `<html>` before paint |
| npm dep | `next-themes@^0.4.6` (`package.json`) | only importers are the two files above |

### Toggle render sites (all removed)

- `src/components/AppShell.tsx` (desktop header)
- `src/components/MobileTopBar.tsx`
- `src/components/AdminSidebar.tsx`
- `src/components/admin/AdminHeader.tsx`
- `src/app/[locale]/status/page.tsx` (×2)
- `src/app/[locale]/join/[center_code]/[group_id]/page.tsx`

### i18n keys (removed)

- `common.switchToDarkTheme`, `common.switchToLightTheme` in `messages/en.json` +
  `messages/ar.json` (only consumer was `ThemeToggle`).

## The `.dark` token machinery in `globals.css`

`globals.css` carries the full dark token system: `html.dark { … }` (surface/text/border
tokens, ~L244), the shadcn `.dark { … }` base block (~L766), `.dark`/`html.dark` accents
(`.badge-*`, `.btn-outline`, `.skeleton`, `.chq-skeleton`, CEO chart grid, admin date
inputs), and the `html:not(.dark) { … }` cream utility-remapping (~L515–620, paper wash,
text-white/slate remaps).

**Decision: this machinery is KEPT, because the intentional-dark auth pages depend on it**
(see below), and Eyad chose to leave those pages untouched. It is now **inert for the
app** — nothing sets `.dark` on `<html>` in normal app usage, so:

- every `html.dark …` / `.dark …` override is dormant app-side, and
- every `html:not(.dark) …` rule (which is what makes the app cream) **always matches**.

The ~54 files using Tailwind `dark:` variants are likewise **inert** — a `dark:` variant
only activates under a `.dark` ancestor, which the app no longer has. They are harmless
dead styling; stripping them from 54 files is out of scope for this build (large, risky,
zero behavior change) and is noted as an optional follow-up.

## Why the auth pages must keep the `.dark` machinery

- `/signup` → `[data-chq-signup]` lock + hardcoded hex. No shadcn/surface tokens of its
  own.
- `/session-expired` → `[data-chq-session-expired]` lock + hardcoded hex.
- `/accept-invite` → **no** `[data-chq-*]` lock. Its `<div className="dark">` + the shared
  `PhoneInput`/`OTPInput` read `var(--color-surface-2)`, `var(--color-border)`,
  `hsl(var(--primary))`, `hsl(var(--destructive))`. Those resolve to **dark** only via
  `html.dark { … }` + the `.dark { … }` shadcn block. So this page genuinely needs a
  `.dark` scope on `<html>`.

`LoginThemeEffect` supplies that scope: on the three auth pages it adds `.dark` to
`<html>`; the rest of the app never gets it.

### `LoginThemeEffect` latent bug — fixed

Old cleanup did `applyRootThemeClass(localStorage['chq-theme'] || 'dark')`, which resolves
**any** non-`'light'` value (including the default `'cream'`) to the `dark` class. This
was masked in production because `next-themes` re-synced `<html>` to `cream` right after.
Once `next-themes` is removed that mask is gone, so leaving an auth page could strand the
whole app in dark. `LoginThemeEffect` is rewritten to simply add `.dark` on mount and
remove it on unmount — no `localStorage`, no persistence read — so leaving an auth page
always returns the app to light.

## Device / OS dark neutralization

- **No `@media (prefers-color-scheme: …)` anywhere in the repo** (verified). `next-themes`
  already ran with `enableSystem={false}`, and it is being removed entirely.
- `:root { color-scheme: light }` is pinned in `globals.css` (kept/made explicit), so
  native controls, form fields, and scrollbars stay light on a dark-set device. The only
  `color-scheme: dark` declarations are `.dark`-scoped (auth pages) and never apply to the
  app.
- **Result (by construction):** a phone/computer set to dark mode renders the app
  **light**. There is no code path that reads the device preference and no `.dark` class
  applied to the app root.

## Left intentionally untouched (not app dark mode)

- **Invoice PDF / email HTML** — fixed hex by design (guardrail #3).
- **`CardOrderStyleSampleMock.tsx`** — its `variant: 'dark' | 'light'` / `isDark` is a
  **physical student-ID-card style** choice, unrelated to the app theme.
- The three intentional-dark auth pages (reported below).

## Reported for a later decision

1. **No DB theme-preference column exists.** Verified against the live schema
   (`information_schema.columns`, `public` schema, `%theme%` / `%dark%` / `%color_scheme%`)
   — zero matches. Nothing to stop reading/writing; no schema change needed.
2. **Three intentional-dark auth pages** (`/signup`, `/session-expired`, `/accept-invite`)
   remain dark by hardcoded design, awaiting their own cream redesign pass (ADR 031
   follow-up). Left as-is per Eyad's decision.
3. **Dormant dark CSS** (`html.dark`/`.dark` blocks in `globals.css`) and **~54 files with
   `dark:` Tailwind variants** are now inert app-side. Kept to serve the auth pages above;
   full removal is a safe optional follow-up once those pages get their cream redesign.

## Verification checklist (completed)

- [x] `next build` succeeds — compiled in ~47s, 394/394 static pages generated, exit 0.
- [x] Unit suite green — **1147 passed / 141 files**. Typecheck clean. Lint 0 errors
  (162 pre-existing warnings, all in untouched test files). i18n / bidi / tolocale gates OK.
- [x] Grep proof — no `ThemeToggle` / `next-themes` / `useTheme` / `setTheme` / `chq-theme`
  anywhere in `src`; the only code that adds `.dark` to `<html>` is `LoginThemeEffect`
  (the 3 reported auth pages); no `@media (prefers-color-scheme)` in the app;
  `color-scheme: light` pinned at `:root` and `html`.
- [x] App renders light on an OS set to dark — verified in Chromium with
  `colorScheme: 'dark'` emulation:
  - `/ar/login`  → `<html>` class none, root `color-scheme: light`, body `rgb(236,232,223)` (cream) — **light**.
  - `/ar/status` → same — **light**.
  - `/ar/session-expired` → `<html class="dark">`, body `rgb(8,15,26)` (`#080f1a`) — intentional dark-lock intact.
  - Login/status showing no `.dark` on `<html>` also confirms the `LoginThemeEffect`
    fix: leaving an auth page returns the app to light (no dark stranding).
