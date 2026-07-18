# Build-Cost & Update-Bot Findings

> HISTORICAL CI-cost record, synced against the live repo on 2026-07-18. The chosen settings landed and still hold: `.github/dependabot.yml` exists (verified live 2026-07-18). The specific open-PR numbers (#104, #83, #82, #62, #60) are the point-in-time backlog that was closed and are not a current list.

_Introspection of `.github/workflows/*`, dependabot, and Vercel deploy behaviour, with the chosen settings. Written before any change was made._

## What runs today

### `.github/workflows/ci.yml` — "CI"
Triggers: `push` and `pull_request` on `main`/`master`. In practice a feature/dependabot branch with an open PR re-runs this on **every push** (the `pull_request: synchronize` event).

Jobs:
- **type-check** — `npm ci` + `tsc --noEmit`. Fast, cheap. **Keep.**
- **lint** — `npm ci` + `eslint src/`. Fast, cheap. **Keep.**
- **build** — `npm ci` + `npm run build` (needs type-check + lint). Real gate. **Keep.**
- **playwright-e2e** — `name: Playwright E2E (informational)`. `npm ci` + `npx playwright install chromium --with-deps` + `npx playwright test`, `continue-on-error: true` (blocks nothing). This is the **~4-min browser job that runs on every push but gates nothing** — the main waste in CI.

### `.github/workflows/test.yml` — "Test Suite"
Triggers: `push` on `master`, `pull_request` on `master`.

Jobs:
- **i18n-check** — root-key parity, no `npm ci`. Cheap. **Keep.**
- **unit-tests** — `npm ci` + bidi/tolocale gates + `npm run test:unit` (needs i18n). Real. **Keep, unchanged.**
- **e2e-tests** — Playwright smoke, `continue-on-error: true`. Only fires on master push / PR-to-master (not arbitrary branch pushes), so lower-volume than ci.yml's copy. Left running; concurrency added so stacked pushes cancel.
- **security-audit** — `security-audit.ts --all` (skippable via `security-audit-skip` label). **Keep.**

### `.github/workflows/schema-drift.yml` — "Schema Drift Gate"
Path-filtered (`supabase/migrations/**`, `db/schema.snapshot`, `scripts/schema/**`, own file). Only runs when schema files change. This is the **schema drift gate — not touched** per the brief.

### `.github/workflows/schema-drift-live.yml` — "Live Schema Drift Check"
Scheduled daily + `workflow_dispatch`. Read-only prod check. Not push-triggered. **Not touched.**

### `.github/workflows/security-reminder.yml` — "Security Rotation Reminder"
Weekly cron + `workflow_dispatch`. **Not touched.**

### Dependabot
There was **no `.github/dependabot.yml`** in the repo. Dependabot has been running with GitHub defaults, opening routine version-bump PRs continuously; each open PR re-runs full CI on every push. Open at time of writing: #104 (js-yaml), #83 (dompurify), #82 (@opentelemetry/core, @sentry/nextjs, posthog-js), #62 (esbuild, tsx), #60 (tmp) — all `dependabot[bot]`, all redundant (the 4 high-sev advisories were already fixed via same-major overrides merged to master).

### Vercel
No git/deploy config in `vercel.json` (only `crons` + `functions`). Vercel therefore builds a **preview on every branch push** with its default Git integration. Eyad reviews from Claude Code screenshots, not previews, so these preview builds are wasted spend.

## Chosen settings

1. **Redundant dependabot PRs** — close #104, #83, #82, #62, #60 via `@dependabot close` (closes the PR *and* deletes the branch). No non-dependabot PR touched.

2. **Quiet the update bot** — new `.github/dependabot.yml` for the `npm` ecosystem:
   - `schedule.interval: monthly`
   - `open-pull-requests-limit: 1`
   - all routine updates grouped into a single PR (`groups`)

   Result: at most **one grouped version-bump PR per month** instead of a continuous stream. **Security updates are unaffected** — Dependabot security updates come from Dependabot alerts (repo Security settings) and are not throttled by this file, so vulnerability fixes still flow. (Confirm "Dependabot security updates" is ON under repo Settings → Code security.)

3. **Playwright on every push** — the informational `playwright-e2e` job in `ci.yml` no longer runs on ordinary pushes. It runs only **on demand**: on `workflow_dispatch`, or on a PR labelled `run-e2e`. The fast gates (type-check, lint, build) still run on every PR; the 4-min browser job runs only when explicitly requested before merge. `test.yml`'s e2e smoke is left in place as the pre-merge safety net.

4. **Auto-cancel superseded runs** — `concurrency:` group `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true` added to `ci.yml` and `test.yml`, so a newer push on a branch cancels the older in-flight run.

5. **Vercel preview builds** — added `ignoreCommand` to `vercel.json`:
   `"ignoreCommand": "if [ \"$VERCEL_ENV\" = production ]; then exit 1; else exit 0; fi"`
   Vercel proceeds with the build on exit 1 and skips on exit 0, so **production (merge to master) still deploys** and **all preview/branch builds are skipped**. Verify in Vercel → Project → Settings → Git that the Ignored Build Step reflects this.

## What was deliberately NOT changed
Test logic, the schema-drift gate, the summer billing path, the fast checks (lint / type-check / schema-drift / i18n), and the unit-test suite — all untouched. Security updates and security alerts stay ON.

## Expected savings (plain language)
- **GitHub Actions:** the ~4-min Playwright job stops running on every push (only on demand) → biggest per-push saving. Concurrency cancels stacked runs so a rapid series of pushes no longer runs CI to completion N times. Dependabot noise drops from a continuous PR stream (each re-running full CI) to ≤1 PR/month.
- **Vercel:** preview builds drop to zero; only the production build on merge to master remains.
- **Safety kept:** security updates, the schema-drift gate, unit tests, and all fast checks are unchanged; E2E is still one click/label away before merge.
