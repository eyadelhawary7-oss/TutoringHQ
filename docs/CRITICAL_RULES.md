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

## Rule 144 — Canonical design system (updated: ADR 031 resolved, cream default)

UI surfaces use the cream token set defined in src/app/globals.css:
  --paper: #ece8df (page background)
  --panel: #fffdf8 (panel/card background)
  Accent teal: #0e6b61
  Accent brass: #9a6b1f
  Typography: IBM Plex Sans Arabic (body), system-serif fallback

Dark mode is optional (`.dark` class on `<html>`). The light-white theme has been
removed. New surfaces follow the cream token set. Hardcoded dark hex values
(#080D14, bg-slate-*, from-slate-*) are forbidden in new UI code outside of
intentionally dark components (e.g. the HeroVisuals phone mockup). See globals.css
for the full token list. Design is enforced via TypeScript (ADR 014).

## Rule 146 — Migration verification via catalog introspection

After applying any schema migration, verify the change by querying the Postgres catalog (`information_schema.tables`, `pg_indexes`, `pg_constraint`) — NOT by reading `supabase_migrations.schema_migrations`. The migrations table is metadata; the catalog is ground truth.

## Rule 147 — Mobile GitHub merge hazard

Never merge PRs or resolve conflicts via the GitHub mobile app or GitHub web editor on mobile. The mobile interface silently drops conflict markers and can corrupt files without warning. All merges must happen via the GitHub desktop web UI or CLI on a device with a full keyboard.

## Rule 148 — Env vars only take effect on new deploy

Environment variable changes in Vercel (adding, updating, or removing vars) do NOT affect the currently running deployment. A new deploy is required for any env var change to take effect. This includes PAYMOB_ENABLED, CSRF_SECRET, UPSTASH_REDIS_REST_URL, and all HMAC secrets. Always trigger a redeploy after changing env vars in production or preview.

## Rule 149 — Fail CLOSED for money and credentials, fail OPEN for availability

Security and payment gates must fail CLOSED: if a dependency (Upstash, Supabase, external API) is unreachable, deny the request rather than allow it through. Availability-only features (e.g. rate limiting on a PIN-change flow, OTP delivery) may fail OPEN so that an outage does not lock legitimate users out of non-money operations. Every new gate must explicitly decide which failure mode applies and document it inline.

## Rule 150 — Set-PIN trust anchor is the webhook token, not the session

The set-PIN flow is deliberately sessionless. The trust anchor is a single-use webhook token issued by the server and delivered via WhatsApp. The token is verified server-side before any PIN is written. No browser session, cookie, or bearer token is trusted for this flow. The token must be short-lived (15 minutes), single-use (consumed on first verification), and scoped to one phone number. See ADR 024.

## Rule 151 — Identity resolution pattern for all protected routes

Every protected API route MUST resolve the actor's identity in this order:
1. Verify the bearer token via `supabase.auth.getUser()` (never decode JWT client-side).
2. Look up the actor's row in `public.users` via the admin client using `user.id` as the key.
3. Derive all authorization decisions (role, center_id, permissions) from the `public.users` row, never from the JWT claims directly.

A route that skips step 2 and reads role/center from JWT claims is a wide-select-dropped-error waiting to happen. The JWT is authentication proof only. Authorization always comes from the database row. This pattern is enforced by `requireCenterAuth` and `requireTeacherAuth` — use those helpers, do not reimplement the pattern inline.

## Rule 152 — auth.users rows created via admin API require explicit empty-string token fields

Every `auth.users` row created via the Supabase admin API (`supabaseAdmin.auth.admin.createUser`)
MUST set the following four fields to empty string `''` (never `null`, never omitted):
  - `confirmation_token`
  - `recovery_token`
  - `email_change_token_new`
  - `email_change`

If any of these fields is `null` in the database row, `supabase.auth.signInWithPassword`
will return a 500 error for that user, silently blocking all logins.

This applies to every route that creates auth users programmatically:
currently `/api/auth/teacher/signup` and the admin-seeding path in
`/api/signup` (center owner creation). Any future route that calls
`createUser` must include all four fields.

Cross-reference: centerAuth.ts teacher signup implementation. Introduced after
silent 500 login failures traced to null token fields in GoTrue.

## ADR 018 — Lazy-init Supabase clients

Modules that need a Supabase admin client expose `getSupabaseAdmin()` and call it INSIDE route handlers, not at module top level. No `process.env.*` reads at import time. This keeps tests cheap and avoids cold-start cost on routes that do not touch the DB.

## ADR 023 — Failures surface to Sentry, never silent

Every `catch` block in security-critical paths (auth mutations, payment finalization, webhook idempotency) calls `Sentry.captureException` (or `Sentry.captureMessage` for non-Error conditions) BEFORE returning. Console.error alone is insufficient — Sentry is the operational SLO surface.