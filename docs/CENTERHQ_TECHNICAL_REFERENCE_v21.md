# CenterHQ Technical Reference v21

> Synced against the live database and code on 2026-07-18. Load-bearing facts verified live are marked (verified live 2026-07-18). "CenterHQ" here is the internal/repo name and is retained by design; the live product brand is TutoringHQ (tutoringhq.app).

## Migrations

Migrations are **manual apply to production** (verified live 2026-07-18): Supabase Branching auto-applies migrations to preview branches only, never to production on merge. Apply by hand in timestamp order, then confirm the change in the Postgres catalog (`information_schema`) before letting code deploy — never merge and assume. Last migration in the prod ledger: `20260717130000_billing_config_flip`. Treat `pending_signups` and pricing normalisation migrations as mandatory companions to app releases that reference those APIs.

## Notable API routes (all verified present under `src/app/api` on 2026-07-18)

| Route | Purpose |
|-------|---------|
| `GET /api/health` | Deployment liveness |
| `POST /api/signup/persist` | Multi-step signup persistence |
| `GET /api/signup/check-pending` | Resume funnel detection |
| `POST /api/cron/cleanup-pending-signups` | TTL cleanup |
| `POST /api/cron/parent-pack-billing` | Pack billing sweep |
| `POST /api/auth/signout` | Server-side cookie teardown |

## Critical rules (continued)

Start numbering after v20 file — **Rule 111+**:

**111.** Run stabilization gates before shipping: `npm run verify:stabilization` (i18n parity scripts + `check-bidi` + `check-no-tolocalestring`).
**112.** Security harness: `npx tsx scripts/security-audit.ts --all` (needs reachable `SECURITY_AUDIT_BASE_URL` / `PLAYWRIGHT_BASE_URL`).
**113.** Admin aggregates default **`is_test = false`** unless an explicit `include_test=1` diagnostic toggle is documented.

## Audit harness layout

| Artifact | Location |
|----------|----------|
| Mobile 375 | `tests/e2e/responsive-375.spec.ts` + screenshots `tests/e2e/__screenshots__/375px/` |
| Security probe | `scripts/security-audit.ts` → `security-audit-report.md` |
| Locale / bidi | `scripts/check-i18n.ts`, `scripts/check-bidi.ts`, `scripts/check-no-tolocalestring.ts` |

## Playwright CI

`.github/workflows/test.yml` runs Vitest, Playwright smoke + new Prompt 7 specs, and `security-audit` (skippable via **`security-audit-skip`** PR label).
