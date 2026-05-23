# Critical rules

Live reference for cross-cutting rules that the codebase enforces. The full rule history is preserved in the project-knowledge snapshots under `Full CenterHQ Files 18 May 2026/`. This file is the authoritative live entry for rules currently in force.

## Rule 139 — Weak-PIN check on all PIN-setting flows

All **5** server-side PIN-setting flows MUST call `isWeakPin(newPin)` from `src/lib/weakPins.ts:50` BEFORE persisting and BEFORE setting the Supabase Auth password. Reject the request with `400 { error: 'weak_pin' }` when the helper returns `true`. Client-side checks are advisory only — the server is authoritative.

| # | Route | Call site |
|---|-------|-----------|
| 1 | `POST /api/signup/complete`                | `src/app/api/signup/complete/route.ts`             |
| 2 | `POST /api/accept-invite/complete`         | `src/app/api/accept-invite/complete/route.ts`      |
| 3 | `POST /api/auth/verify-pin-reset`          | `src/app/api/auth/verify-pin-reset/route.ts`       |
| 4 | `POST /api/auth/change-pin`                | `src/app/api/auth/change-pin/route.ts`             |
| 5 | `POST /api/auth/set-initial-pin`           | `src/app/api/auth/set-initial-pin/route.ts`        |

**Adding a new PIN-setting route?** Add it to this table AND to the assertions in the matching `tests/unit/api/*.test.ts`. No browser-side `supabase.auth.updateUser({ password })` calls in `src/app/[locale]/` or `src/components/`.

## Rule 127 — RTL logical CSS

App UI uses logical CSS properties only (`margin-inline-start`, `inset-inline-end`, `padding-block`, `text-align: start/end`, etc.). Physical `left`/`right`/`top`/`bottom` are permitted only in PDF/print output, email HTML, and Recharts margin props, and must be marked `// RTL-EXEMPT` inline.

## Rule 142 — No em dashes in user-facing strings

Translated copy must use commas (U+002C in English, U+060C `،` in Arabic), periods, or sentence breaks. Em dashes (`—`) are forbidden in `messages/*.json` values and any user-rendered string. Internal docs and code comments are unconstrained.

## Rule 144 — Canonical design system

UI surfaces use the canonical token set: bg `#080D14`, accent teal `#0D9488`, off-white `#f8fafc`, slate borders `#1e293b`/`#0f172a`, Playfair Display + Bodoni Moda. New surfaces follow the existing pages (login, set-pin) rather than introducing a parallel style sheet.

## Rule 146 — Migration verification via catalog introspection

After applying any schema migration, verify the change by querying the Postgres catalog (`information_schema.tables`, `pg_indexes`, `pg_constraint`) — NOT by reading `supabase_migrations.schema_migrations`. The migrations table is metadata; the catalog is ground truth.

## ADR 018 — Lazy-init Supabase clients

Modules that need a Supabase admin client expose `getSupabaseAdmin()` and call it INSIDE route handlers, not at module top level. No `process.env.*` reads at import time. This keeps tests cheap and avoids cold-start cost on routes that do not touch the DB.

## ADR 023 — Failures surface to Sentry, never silent

Every `catch` block in security-critical paths (auth mutations, payment finalization, webhook idempotency) calls `Sentry.captureException` (or `Sentry.captureMessage` for non-Error conditions) BEFORE returning. Console.error alone is insufficient — Sentry is the operational SLO surface.
