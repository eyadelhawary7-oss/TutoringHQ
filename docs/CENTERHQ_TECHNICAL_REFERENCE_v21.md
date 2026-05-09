# CenterHQ Technical Reference v21

## Migrations

Apply via Supabase CLI in timestamp order — audit chain spans Prompts **1–6** (`supabase/migrations/*`). Treat `pending_signups` and pricing normalisation migrations as mandatory companions to app releases that reference those APIs.

## Notable API routes (Prompts 1–6)

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
