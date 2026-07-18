# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CenterHQ - multi-tenant SaaS for Egyptian tutoring centers (سناتر). Next.js 16 App Router on Vercel, Supabase Postgres + Auth, served bilingually at `/ar/...` (default, RTL) and `/en/...` (LTR). Production: https://tutoringhq.app (centerhq.app is retired; the internal repo name, Vercel project name, and @centerhq.local auth emails stay as-is).

**Stack:** React 19.2 + Next 16.2 (App Router, React Compiler on) · TypeScript 5 · Tailwind 4 · Zod 4 · Recharts 3 · SWR + Zustand · `next-intl` 4 · Supabase JS 2 + `@supabase/ssr` · Sentry · Upstash Redis (rate limiting) · Playwright + Vitest 4.

## Working rules (always apply, every session)

1. Model selection: Sonnet for mechanical and inventory jobs. Opus 4.8 for medium-judgment work. Fable 5 for large batched builds and anything touching money or auth. State the chosen model at the start of substantive work.
2. Verify, do not trust: before acting on any claim about database or code state, check the live catalog (information_schema, pg_constraint, pg_proc) or read the actual file. schema_migrations is bookkeeping, not proof. Summaries, including AI-written summaries and PR descriptions, are not evidence. Before adding ANY column to a query, confirm it physically exists in the live schema (information_schema.columns); other code referencing a column is not proof it exists, and CI has no live database so a missing column passes every gate. This exact gap caused the July 8 student-detail outage.
3. Nothing merges without review: all work lands on a held branch with a PR. Eyad approves after all checks are green. Never merge to master directly, never delete a branch before review. This applies to everything including doc-only changes and side explorations.
4. Migrations are manual apply to production. Supabase Branching auto-applies to preview branches only, never to production on merge. This was tested on 2026-07-15: PR #159 merged as 80f82ba and the migration was still absent from the production catalog and from the production migration history 8 minutes later. Apply the migration by hand, confirm the columns exist in information_schema, then let the code deploy. Never merge and assume. An inference is not a finding: the earlier claim that Branching auto-applies on merge was a guess presented as an answer, and it caused a deploy that read columns which did not exist.

## Commands

```bash
npm run dev                 # next dev (localhost:3000)
npm run build               # gates: i18n:check + check:bidi + check:tolocale + setup-fonts, then next build (8GB heap)
npm run lint                # eslint
npm run typecheck           # rimraf .next/types && tsc --noEmit (8GB heap)
npm run verify:stabilization  # i18n + bidi + tolocale gates (run before pushing UI)
npm run analyze             # ANALYZE=true build → bundle analyzer

# Tests
npm run test:unit           # vitest run (tests/unit/**/*.test.ts, TZ=UTC)
npm run test:unit:watch
npm run test:e2e            # playwright test (needs tests/e2e/.env.local - see docs/E2E_TESTING.md)
npm run test:e2e:ui
npm run test:all            # unit + e2e
npx playwright test --project=desktop-chrome   # owner-auth smoke only
npx playwright test path/to/spec.ts            # single spec
npx vitest run path/to/file.test.ts            # single unit file

# Audits / one-offs
npm run security:audit                         # wraps scripts/security-audit.ts
npm run check:env                              # scripts/check-env.ts - validates required env vars
npm run check-secrets                          # scripts/check-secret-rotation.js - rotation status
npm run verify-backup                          # scripts/verify-backup.js - Supabase backup sanity check
npx tsx scripts/security-audit.ts --all        # needs SECURITY_AUDIT_BASE_URL / PLAYWRIGHT_BASE_URL
npx tsx scripts/check-i18n.ts                  # ar/en parity
npx tsx scripts/check-bidi.ts                  # logical-property enforcement
npx tsx scripts/check-no-tolocalestring.ts     # blocks raw toLocaleString in charts/UI
```

The three `check:*` scripts are **build gates** - failures break `next build`. Run `verify:stabilization` before committing UI/i18n changes; it's the same gate CI runs.

## High-level architecture

### Tenancy + auth flow

- All non-public traffic passes through **`src/proxy.ts`** (Next.js middleware, aliased `proxy.ts` not `middleware.ts`). It:
  1. Strips path traversal (`/.env`, `/wp-admin`, …) → 404.
  2. Enforces CORS allowlist for `/api/*` mutations (webhooks in `PUBLIC_WEBHOOK_PREFIXES` are exempt).
  3. Runs `next-intl` locale routing (`localePrefix: 'always'` - never redirect away from `/ar` or `/en`).
  4. For `AUTHENTICATED_ROUTE_PREFIXES`, calls `supabase.auth.getUser()` server-side; unauth → `/{locale}/login`.
  5. Loads `centers.status`, `billing_status`, `auto_suspend_at`, `is_blacklisted` and the matching `subscriptions.status`. Suspended/overdue centers are redirected to `/{locale}/suspended?reason=…`. Blacklisted centers get 401 except on `/settings` and `/session-expired`.
  6. Applies CSP + standard security headers on every response and tags each with `X-Request-ID`.

  **When adding a new app route prefix, you must also add it to `AUTHENTICATED_ROUTE_PREFIXES`** or it will appear unprotected.

- **Multi-tenancy = `center_id` on every row.** RLS in Supabase scopes by `center_id` derived from the authenticated user's `users` row. **The middleware does not enforce per-center access** - that is RLS + per-route checks (`requireOwnerAdminCenter`, `centerAuth`, `admin-access`, `centerPermissions`).

### Two database access paths

1. **Direct Supabase client** (`src/lib/supabase.ts` browser, `supabase-admin.ts` service-role on server). RLS-enforced.
2. **`POST /api/db` legacy typed proxy** (`src/lib/db-proxy.ts` → `src/app/api/db/route.ts`). Service-role under the hood; **CSRF-required on mutations**, allow-listed via `ALLOWED_TABLES`, scanner inserts rate-limited via Upstash, mutations write to `audit_log`. **Do not add new callers** - see `docs/DB_PROXY_SECURITY.md`. New domain logic should land as a narrow REST route under `src/app/api/<domain>/`.

CSRF is gated by `CSRF_SECRET` (`src/lib/csrf.ts`). It fails closed: when unset or malformed, `validateCSRFRequest` returns false and every caller returns 403, in every environment (`getKey` throws in production). Set it on Vercel or all mutations are blocked.

### Route layout (`src/app`)

- `src/app/[locale]/` - public + dashboard pages, locale-prefixed.
- `src/app/[locale]/(admin)/` and `(dashboard)/` - route groups for layout sharing.
- `src/app/api/` - REST endpoints, grouped by domain (`billing`, `payments`, `paymob`, `whatsapp`, `bosta`, `ceo`, `admin`, `cron`, …).
- `src/app/api/cron/*` - Vercel-scheduled jobs (see `vercel.json`). Each expects `Authorization: Bearer ${CRON_SECRET}`.
- `src/app/api/webhooks/*` and the explicit paths in `PUBLIC_WEBHOOK_PREFIXES` are **public** (no Origin check, no auth); they must verify HMAC themselves (see `verifyHmac.ts`).
- `src/app/auth/callback` - Supabase auth callback. Listed in `publicRoutes` and `apiRoutes`.
- **No Pages Router.** Everything is App Router.

### Domain modules of note

Most business logic lives in **`src/lib/`** as standalone modules. Prefer importing helpers over reimplementing:

- **Money / display** - `formatNumber.ts` (`formatNumber`, `formatCurrency`, `formatPercent`, `formatGrowth`, `formatDate`). `check:tolocale` blocks raw `toLocaleString` in chart/UI files - route ticks and tooltips through these.
- **Pricing** - `pricing.ts`, `pricing/plans.ts`, `pricingConfig.ts`. Tiered subscription plans. **Tax is 14% VAT only, inclusive** (`base = inclusive / 1.14`, see `src/lib/pricing/taxMath.ts`; the former 6% service fee + 0.5% stamp duty were removed - see `docs/SERVICE_FEE_REMOVAL_FINDINGS.md`). A separate flat **20 EGP processing fee** is added per charge invoice (config-driven, snapshotted into `invoices.metadata.processing_fee`). `docs/PRICING_SPEC.md` is source of truth. `top_centers` is custom-priced and reads `centers.all_in_price` (code must throw + Sentry-warn on NULL). See `.claude/skills/automated-billing-and-fees/`.
- **Billing engine** - `billingEngine.ts`, `billingSchedule.ts`, `billingGrace.ts`, `cairoBillingCalendar.ts`, `subscriptionBillingCron.ts`, `subscriptionPastDue.ts`, `packBilling.ts`. All anchored to **Cairo time** (`src/lib/cairo/`, helpers like `startOfCairoDay`, `cairoDateKey`). Never use `new Date()` for billing windows directly.
- **Payments** - `paymob/`, `paymob.ts`, `combinedPaymentFinalize.ts`, `invoicePaymobPayment.ts`, `paymobGuardLogic.ts` (gates live/test mode by `VERCEL_ENV` + `NEXT_PHASE`). HMAC verification via `verifyHmac.ts`.
- **Shipping** - `bosta.ts`, `bostaShipping.ts`, `autoBookBosta.ts`. Zones and rates from `loadBostaShippingRates`.
- **WhatsApp** - `whatsapp.ts`, `whatsapp/`, `wa_templates` table, `whatsapp-pack.ts`. Phone-number-id has three env aliases (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PHONE_ID`, `PHONE_NUMBER_ID`); code reads all three.
- **Scanner / offline** - `scanner/`, `db.ts` (IndexedDB via `idb`), `sync.ts`. Scanner inserts use `/api/db` with Upstash rate-limiting.
- **Card orders** - `card-order-cart/`, `cardOrderState.ts`, `cardOrderPayment.ts`, `cardOrderNotifications.ts`. Sample students rule: paid card orders with **blank line items only** keep roster students eligible for recommendations.
- **Auth / admin gating** - `admin-access.ts`, `admin-auth.ts`, `admin-check.ts`, `admin-roles.ts`, `requireOwnerAdminCenter.ts`, `centerAuth.ts`, `centerPermissions.ts`. Super-admin is **phone-based** via `SUPER_ADMIN_PHONES` env + `isSuperAdminPhone()`, NOT solely a DB role.

### Test data conventions

- E2E seed writes rows marked `notes = e2e_seed:v1`, fixed student numbers `TEST-00001…TEST-00005`, `TEST-NOCARD01`. Idempotent. `CLEANUP_TEST_DATA=1` purges prior seed.
- **Admin aggregates default `is_test = false`** - never expose a test-row leak in finance views. Use `include_test=1` as a documented diagnostic toggle only.
- Audit/dev seed accounts: see `scripts/audit/README.md` (super-admin `+201111111111`/`111111`, owner `+201333333333`/`333333`, etc.). Supabase auth email format is `{digits}@centerhq.local`.

### State & contexts

- React contexts in `src/contexts/`: `UserContext` (auth session + role), `LayoutContext`, `SidebarContext`, `ThemeContext`. Wrapped in `src/app/[locale]/layout.tsx`.
- Client store: `src/stores/branchStore.ts` (Zustand) - active branch selection.
- Data fetching: SWR for client, server components for SSR pages.

### i18n

- `messages/ar.json`, `messages/en.json` are the only translation sources. `next-intl` is wired via `src/i18n/request.ts` and `routing.ts` (`defaultLocale: 'ar'`, `localePrefix: 'always'`).
- **`scripts/check-i18n.ts` enforces key parity** and runs on every `npm run build`. Missing/extra keys fail CI. For RTL-safe styling rules, see `docs/RTL.md` (logical properties only, with documented exemptions for PDF/print, Recharts margins, email HTML).

### Cron jobs

35+ Vercel-scheduled cron routes under `src/app/api/cron/*` defined in `vercel.json`. All check `Authorization: Bearer ${CRON_SECRET}`. Long-running ones (`weekly-backup`, `monthly-backup`, `process-renewals`, `daily-summary`, `detect-churn`, …) have `maxDuration` overrides in `vercel.json` - when adding a new cron that needs >10s, set its `functions[...].maxDuration` too.

### Build / runtime config

- **React 19 + React Compiler is on** (`reactCompiler: true` in `next.config.ts` + `babel-plugin-react-compiler`). Avoid manual `useMemo`/`useCallback` boilerplate unless you measure a regression. **`ref` is a normal prop in React 19** - no `forwardRef` for new components, and remove it when touching old ones.
- **CSP is set in two places** - `next.config.ts` `headers()` and `src/proxy.ts` `SECURITY_HEADERS`. Keep them in sync when adding a third-party origin (PostHog, Sentry, Paymob, Supabase realtime).
- **Sentry** wraps the Next config (`withSentryConfig`) with sourcemaps **disabled** in the upload step. Server vs edge runtime branches in `instrumentation.ts`. Requires `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`; `SENTRY_AUTH_TOKEN` only needed if re-enabling sourcemap upload.
- **Upstash Redis** is runtime-critical - scanner inserts via `/api/db` and several abuse-prone endpoints rate-limit through `@upstash/ratelimit`. Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` on Vercel; without them rate-limiting falls open.
- Path alias: `@/*` → `./src/*` (`tsconfig.json`). `supabase/functions` is excluded from tsc.

## Conventions to keep

- **Logical CSS only in app UI** (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`). Physical properties stay only in PDF/print, email HTML, Recharts margin props (mark `// RTL-EXEMPT`).
- **All number/date formatting goes through `formatNumber.ts` helpers.** Raw `toLocaleString` is blocked by `check:tolocale`.
- **Cairo time, not UTC, for any user-visible billing/calendar window.** Tests run `TZ=UTC` to surface bugs - use the `cairo/` helpers.
- **`is_test = false` default** on admin aggregates.
- **CSRF on mutations** routed through `/api/db`; new mutation endpoints should call `validateCSRFRequest`.
- **Webhooks verify HMAC themselves** - middleware does not check auth on `PUBLIC_WEBHOOK_PREFIXES`.
- **No `forwardRef` boilerplate.** `ref` is a normal prop in React 19 - don't wrap new components in `forwardRef`, and strip it from older components when you touch them. Footgun: copy-pasting pre-React-19 component patterns drags `forwardRef` back in.

## Where to look first

- New API route: `src/app/api/<domain>/route.ts` + a helper in `src/lib/<domain>.ts`. Check `requireOwnerAdminCenter` / `centerAuth` / `admin-access` for the right gate.
- New scheduled job: add `src/app/api/cron/<name>/route.ts`, register in `vercel.json` `crons[]`, set `functions[...].maxDuration` if >10s, gate on `CRON_SECRET`.
- New page: pick a locale group under `src/app/[locale]/`, register the prefix in `AUTHENTICATED_ROUTE_PREFIXES` in `src/proxy.ts` if it needs auth.
- Pricing change: `docs/PRICING_SPEC.md` first, then `src/lib/pricing/`.
- Billing window edge case: `src/lib/cairoBillingCalendar.ts` + `src/lib/cairo/`.
- Reference docs live in `docs/` - `CENTERHQ_TECHNICAL_REFERENCE_v21.md`, `HELPERS_INVENTORY.md`, `RTL.md`, `E2E_TESTING.md`, `DB_PROXY_SECURITY.md`, `PRICING_SPEC.md`, `SECURITY_MAINTENANCE.md`, `LAUNCH_CHECKLIST.md`.
