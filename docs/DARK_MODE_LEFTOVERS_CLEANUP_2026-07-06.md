# Dark-mode leftovers cleanup — findings (2026-07-06)

Dead-code removal. Dark mode was removed as a product decision (2026-07-05) and
the three previously dark-locked auth pages (`/signup`, `/session-expired`,
`/accept-invite`) then finished their cream redesign, dropping their
`[data-chq-*]` locks and `LoginThemeEffect`. That left the dark scaffolding
inert. This pass deletes it. **Pure deletion — no visual change, no logic
change.**

## What was verified dead (before deleting)

Each item was proven unreachable, not assumed:

1. **`src/components/LoginThemeEffect.tsx`** — the only runtime code that ever
   added `.dark` to `<html>`. Grep for `LoginThemeEffect` across `src` returns
   **zero importers** (only its own definition). Nothing else calls
   `classList.add('dark')` / `.toggle('dark')`. **Deleted.**

2. **`.dark` / `html.dark` token + override blocks in `globals.css`** — dormant,
   because nothing adds a `.dark` class or `data-theme="dark"` at runtime:
   - No `next-themes`, `useTheme`, `setTheme`, `ThemeProvider`, or `chq-theme`
     anywhere in `src` (all removed in the 2026-07-05 pass).
   - No inline theme/FOUC script in `src/app/[locale]/layout.tsx`.
   - No `className="dark"` / `class="dark"` on any element.
   - No `@media (prefers-color-scheme: …)` anywhere in the repo.
   - `color-scheme: light` is pinned at `:root` **and** `html`.
   With `.dark` never present, every `html.dark …` / `.dark …` rule was inert and
   every paired `html:not(.dark) …` rule always matches. **Dead blocks removed.**

3. **~840 `dark:` Tailwind variant occurrences across 68 files** — a `dark:`
   variant only activates under a `.dark` ancestor, which the app never has.
   Confirmed there is no `.dark` scope and no `prefers-color-scheme` path, so they
   can never trigger. **All removed** (whitespace-clean; verified no double-spaces
   or empty class strings introduced).

Nothing in item 1–3 turned out to be referenced by live code, so nothing was
force-deleted and no STOP was required.

## What was removed

- `src/components/LoginThemeEffect.tsx` (whole file).
- `globals.css`: the `html.dark { … }` token block, `html.dark .btn-outline`,
  the `html.dark { --ceo-chart-* }` block, the whole "Dark: hardcoded light
  backgrounds flip to dark surfaces" `html.dark …` block, the `.dark { … }`
  shadcn base block, `.dark .badge-confirmed/pending/late`, `html.dark .skeleton`,
  `html.dark { color:#f8fafc }`, the `.dark [data-admin] …` date-input +
  `.admin-textarea` blocks, and `html.dark .chq-skeleton`.
- `globals.css`: `--shadow-card-dark` — orphaned once its only consumer (the
  deleted `html.dark` block) was gone.
- Stale comments updated to match (no dangling references to the removed
  machinery / `LoginThemeEffect`).
- `dark:` variant tokens stripped from 68 `.tsx`/`.ts` files.

## What was intentionally kept (and why)

- **`html:not(.dark) …` rules** — these are the **live light theme** (they always
  match). They were left byte-identical. The `:not(.dark)` guard is now vestigial,
  but stripping it to plain `html` would lower selector specificity and could, in
  principle, change which rule wins — so it stays, guaranteeing zero visual change.
  There are therefore **zero `.dark` *token blocks*** left, but `.dark` still
  appears textually inside these always-matching light-theme guards.
- **`:root` / `html { color-scheme: light }`** and all `:root` cream tokens — the
  base/light theme. Untouched.
- **`--grad-live` / `.panel-live`** — a deliberate dark *component* accent
  (live/focus session panels inside the cream app), not the theme. Kept.
- **`data-chq-signup` / `data-chq-session-expired`** attributes — inert page
  markers; no CSS selector references them. Left as-is (out of scope).
- **`src/app/not-found.tsx`, `src/app/global-error.tsx`, `src/app/[locale]/error.tsx`**
  — standalone hardcoded-dark 404/error pages (fixed hex by design, same category
  as the invoice PDF). **Not touched.**
- **Invoice PDF / email HTML** and the QR-code `color: { dark, light }` object keys
  — hardcoded hex by design. **Not touched** (the QR keys are JS object properties,
  not Tailwind variants).

## Verification

- **Zero remaining `dark:` Tailwind variants** and **zero `.dark` token blocks** —
  confirmed by grep. The only residual `dark` text is (a) the vestigial
  `html:not(.dark)` light-theme guards, (b) history comments, (c) the
  `--shadow-…`/`--color-navy-950` token *names*, and (d) the intentional
  hardcoded-dark error/404 pages and QR object keys listed above.
- **Device/OS dark mode has no effect (proven).** Under Chromium `colorScheme:
  'dark'` emulation, every reachable page rendered **byte-identical** to the same
  page under `colorScheme: 'light'` — same `<html>` class (`(none)`), same root
  `color-scheme: light`, same body background. There is no `prefers-color-scheme`
  code path, so a device set to dark cannot darken the app. (Full pixel screenshots
  of the authed pages were not captured because this environment has no valid
  Supabase credentials — the client bundle inlines `NEXT_PUBLIC_SUPABASE_*` at
  build time, so without them every `[locale]` route hits the hardcoded-dark error
  boundary. The identical-across-OS result is global and independent of which page
  renders, so it holds regardless.)
- **Gates (all green):**
  - `npm run build` — ✓ compiled in ~49s, **394/394** static pages, exit 0.
  - `npm run typecheck` — clean.
  - `npm run lint` — **0 errors** (161 pre-existing warnings, all in test files).
  - `npm run test:unit` — **1153 passed / 142 files**.
  - `npm run verify:stabilization` — i18n (en/ar parity, 3840 keys), bidi, tolocale
    all OK.

## Diff shape

`LoginThemeEffect.tsx` deleted; `globals.css` dead blocks removed; 68 component
files had `dark:` variants stripped. No API route, helper, schema, auth module, or
pricing/billing file changed. No logic touched.
