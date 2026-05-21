# Audit tracker — final disposition (v4 fallback)

**Source of truth:** internal tracker file when present (`audit_tracker.jsx`). This document is the **repo fallback** for audit closure sign-off.

## Final summary (2026-05-09)

**316 findings — resolved: majority (code + verification hooks); wontfix-by-design / wontfix-positive: as listed per area; residual: manual SQL + staging secrets only.**

| Metric | Value |
|--------|-------|
| Total findings catalogued | 316 |
| Resolved (code / process) | Closure PR: `/api/db` audit logging, scanner payment UX, payment proof columns, card design doc + tooltip, i18n gate on build, enabled Playwright flows with API mocks, expanded `security-audit.ts` probes |
| Won’t fix — by design / accepted residual | (`/api/db` cross-tenant exposure previously listed here was **reopened and resolved 2026-05-21** — see F-410 row below.) Long-term migration of `/api/db` callers to narrow REST routes per domain remains deferred. |
| Residual / operational only | Eyad-run SQL in `STOPPED.md`; webhook HMAC/replay/DLQ deep checks need live `BASE_URL` + provider secrets + Supabase + `CRON_SECRET` where applicable |

## Disposition legend

- **resolved** — Fixed in codebase or verified N/A.
- **wontfix-by-design** — Accepted product/architecture choice documented.
- **wontfix-positive** — Intentional behaviour (e.g. Eyad-confirmed B/C card labels).
- **residual** — Requires manual run, secret, or non-code action.

## Feature ↔ disposition (high level)

| Area | Disposition |
|------|-------------|
| F-410 `/api/db` | **reopened then resolved (2026-05-21)** — the prior "wontfix-by-design + mitigated" disposition was based on an incomplete threat model that missed cross-tenant query scoping. A code-level audit confirmed any authenticated centre B user could read/update/delete centre A's rows on every allow-listed table by supplying `center_id` in `filters` (SELECT was also CSRF-exempt). Closed by `src/lib/dbProxyScope.ts` + forced scoping in `src/app/api/db/route.ts`; see `docs/DB_PROXY_SECURITY.md`. Long-term migration to narrow REST routes per domain remains the follow-up. |
| F-211 scanner payment UX | **resolved** — submitting state + `scanner.processing` |
| F-806 payment proof column | **resolved** — Type + Reference columns (display-only) |
| F-310 card options | **wontfix-positive** — Option A reserved; see `docs/CARD_DESIGN.md` |
| F-605 deterministic UUIDs | **residual** — SQL in `STOPPED.md`; Eyad decision |
| F-713 admin 404s | **resolved** — sidebar hrefs matched to `page.tsx` routes (see `STOPPED.md`) |
| i18n backlog | **resolved** — `npm run i18n:check` in `npm run build`; stubs script `scripts/i18n-backfill-stubs.ts` |
| E2E deferred flows | **resolved** — previously skipped specs enabled with Playwright `route` mocks (`signup-*`, scanner smoke, admin orders) |
| Webhook HMAC / rate-limit / audit / DLQ probes | **resolved** — `scripts/security-audit.ts` (`--webhooks-deep`, `--rate-limit-deep`, `--audit-log`, `--dlq`, `--all`); SKIP/WARN without env |

_Last updated: 2026-05-21 — F-410 reopened and resolved with forced tenant scoping in `/api/db`._
