# Post-Launch Lint Debt

> HISTORICAL lint-debt ledger, synced against the live code on 2026-07-18. The relaxed-rule list is preserved as the point-in-time state. One dead reference was corrected: `src/contexts/ThemeContext.tsx` (cited in §1) no longer exists — it was deleted in the dark-mode removal (see `docs/DEAD_CODE_REMOVED_2026-07-05.md`) (verified live 2026-07-18). The remaining file:line sites are as of the branch date and may have shifted.

Rules relaxed (or disabled) in `eslint.config.mjs` to unblock CI for the pre-launch
batches B and C. Each entry below lists the offending file:line sites and the
"real fix" approach. Once a section is empty, re-enable the rule as `error`.

Introduced in: `fix(ci): bump typecheck heap to 4GB + relax React 19 strictness rules` (PR for branch `fix/ci-unblock-heap-and-lint`).

---

## 1. `react-hooks/set-state-in-effect` — relaxed `error` → `warn`

Calling `setState` directly inside a `useEffect` body causes cascading renders.
React 19 best practice is to either subscribe to an external system and call
`setState` from its callback, or hoist the value out of state.

### Real fix

For each site:
- If the state is computed from props/other state: replace `useState + useEffect`
  with a derived value or `useMemo`.
- If the state mirrors an external system (window, IDB, network): subscribe with
  the appropriate API and call `setState` in the subscription callback only.
- If it's a one-shot mount initializer that can't be derived: use a lazy state
  initializer `useState(() => compute())` or a `useRef` set once.

### Sites (~58 total — full list via `npx eslint src/ 2>&1 | grep "set-state-in-effect"`)

Sample sites observed during the audit:

- `src/components/AdminSidebar.tsx:642` — `setMounted(true)` mount probe.
- `src/lib/scanner/networkStatus.ts:51` — `void runProbe()` inside `useEffect`.
- ~~`src/contexts/ThemeContext.tsx` (around the `mounted` flag)~~ — file deleted in the dark-mode removal; no longer a site (verified live 2026-07-18).

The remaining sites follow the same patterns.

---

## 2. `react-hooks/refs` — relaxed `error` → `warn`

Accessing `ref.current` during render is unsafe — refs are mutable across
renders and reads in render produce non-idempotent components.

### Real fix

Move the ref read into an effect, an event handler, or a callback. If the value
needs to be visible in render, mirror it into state through an effect that
subscribes to whatever drives the ref.

### Sites (4)

- `src/app/[locale]/settings/billing/page.tsx:208`
- `src/app/[locale]/settings/billing/page.tsx:209`
- `src/components/billing/PaymobInvoiceModal.tsx:29`
- `src/components/billing/PaymobInvoiceModal.tsx:30`

---

## 3. `react-hooks/purity` — relaxed `error` → `warn`

Components and hooks must be pure: calling impure functions like `Date.now()`,
`Math.random()`, or `crypto.randomUUID()` in render breaks the idempotency
React relies on.

### Real fix

Compute the impure value once at mount via `useState(() => Date.now())` or in an
effect. For "current time" displays, use an interval-driven state.

### Sites (1)

- `src/app/[locale]/(admin)/ceo-dashboard/CenterHealthPanel.tsx:54` — `Date.now()`
  inside the render path of a stale-scan badge.

---

## 4. `@next/next/no-html-link-for-pages` — disabled (`off`)

This rule was authored for the Pages Router and flags `<a href="/foo">` when
`/foo` matches a `pages/` route. CenterHQ is App-Router-only (no `pages/`
directory — see `CLAUDE.md`). The rule misfires on internal API download links
rendered as raw `<a>` because they intentionally trigger a browser navigation
to a streaming response, not a client-side route.

### Real fix

None required for CenterHQ — leave disabled while the project stays on the App
Router. If a `pages/` directory is ever reintroduced, re-enable and audit.

### Sites that triggered the misfire (24 errors, all in one file)

- `src/components/AdminExports.tsx:371` — `<a href="/api/admin/export/centers/...">`
- `src/components/AdminExports.tsx:378` — `<a href="/api/admin/export/invoices/...">`
- `src/components/AdminExports.tsx:385` — `<a href="/api/admin/export/commissions/...">`

These are correct usage — `<Link>` is for client-side navigation between
App-Router pages; raw `<a>` is the right primitive for downloading streamed
API responses.

---

## 5. Per-line `@typescript-eslint/no-explicit-any` disables added

Three `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
directives were added (two restored, one new) rather than tightening the
underlying types. Each site has a short-term reason recorded here.

### Real fix

Replace each `as any` with a precise type (`Route`/`Url` from `next` for the
typed-route casts; a generated Supabase row type for the data cast).

### Sites (3)

- `src/components/AdminSidebar.tsx:792` — `href={'/admin' as any}`.
  Restored disable; `--fix` stripped it spuriously when other rules were
  relaxed in the same pass. Replace with `as Route` once Next 16 typed-route
  imports are wired through this component.
- `src/components/AdminSidebar.tsx:804` — `href={'/ceo-dashboard' as any}`.
  Same case as above.
- `src/app/[locale]/settings/referrals/page.tsx:135` — `(refs as any[]).map(...)`.
  Pre-existing. Replace with a generated `Database['public']['Tables']['referrals']['Row'][]`
  type from `supabase gen types typescript`.
