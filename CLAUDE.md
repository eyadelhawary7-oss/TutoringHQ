# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CenterHQ — multi-tenant SaaS for Egyptian tutoring centers (سناتر). Next.js 16 App Router on Vercel, Supabase Postgres + Auth, served bilingually at `/ar/...` (default, RTL) and `/en/...` (LTR). Production: `https://centerhq.app`.

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
npm run test:e2e            # playwright test (needs tests/e2e/.env.local — see docs/E2E_TESTING.md)
npm run test:e2e:ui
npx playwright test --project=desktop-chrome   # owner-auth smoke only
npx playwright test path/to/spec.ts            # single spec
npx vitest run path/to/file.test.ts            # single unit file

# Audits / one-offs
npx tsx scripts/security-audit.ts --all        # needs SECURITY_AUDIT_BASE_URL / PLAYWRIGHT_BASE_URL
npx tsx scripts/check-i18n.ts                  # ar/en parity
npx tsx scripts/check-bidi.ts                  # logical-property enforcement
npx tsx scripts/check-no-tolocalestring.ts     # blocks raw toLocaleString in charts/UI
```

The three `check:*` scripts are **build gates** — failures break `next build`. Run `verify:stabilization` before committing UI/i18n changes; it's the same gate CI runs.

## High-level architecture

### Tenancy + auth flow

- All non-public traffic passes through **`src/proxy.ts`** (Next.js middleware, aliased `proxy.ts` not `middleware.ts`). It:
  1. Strips path traversal (`/.env`, `/wp-admin`, …) → 404.
  2. Enforces CORS allowlist for `/api/*` mutations (webhooks in `PUBLIC_WEBHOOK_PREFIXES` are exempt).
  3. Runs `next-intl` locale routing (`localePrefix: 'always'` — never redirect away from `/ar` or `/en`).
  4. For `AUTHENTICATED_ROUTE_PREFIXES`, calls `supabase.auth.getUser()` server-side; unauth → `/{locale}/login`.
  5. Loads `centers.status`, `billing_status`, `auto_suspend_at`, `is_blacklisted` and the matching `subscriptions.status`. Suspended/overdue centers are redirected to `/{locale}/suspended?reason=…`. Blacklisted centers get 401 except on `/settings` and `/session-expired`.
  6. Applies CSP + standard security headers on every response and tags each with `X-Request-ID`.

  **When adding a new app route prefix, you must also add it to `AUTHENTICATED_ROUTE_PREFIXES`** or it will appear unprotected.

- **Multi-tenancy = `center_id` on every row.** RLS in Supabase scopes by `center_id` derived from the authenticated user's `users` row. **The middleware does not enforce per-center access** — that is RLS + per-route checks (`requireOwnerAdminCenter`, `centerAuth`, `admin-access`, `centerPermissions`).

### Two database access paths

1. **Direct Supabase client** (`src/lib/supabase.ts` browser, `supabase-admin.ts` service-role on server). RLS-enforced.
2. **`POST /api/db` legacy typed proxy** (`src/lib/db-proxy.ts` → `src/app/api/db/route.ts`). Service-role under the hood; **CSRF-required on mutations**, allow-listed via `ALLOWED_TABLES`, scanner inserts rate-limited via Upstash, mutations write to `audit_log`. **Do not add new callers** — see `docs/DB_PROXY_SECURITY.md`. New domain logic should land as a narrow REST route under `src/app/api/<domain>/`.

CSRF is gated by `CSRF_SECRET` (`src/lib/csrf.ts`). When unset, validation is skipped (dev only). Always set it on Vercel.

### Route layout (`src/app`)

- `src/app/[locale]/` — public + dashboard pages, locale-prefixed.
- `src/app/[locale]/(admin)/` and `(dashboard)/` — route groups for layout sharing.
- `src/app/api/` — REST endpoints, grouped by domain (`billing`, `payments`, `paymob`, `whatsapp`, `bosta`, `ceo`, `admin`, `cron`, …).
- `src/app/api/cron/*` — Vercel-scheduled jobs (see `vercel.json`). Each expects `Authorization: Bearer ${CRON_SECRET}`.
- `src/app/api/webhooks/*` and the explicit paths in `PUBLIC_WEBHOOK_PREFIXES` are **public** (no Origin check, no auth); they must verify HMAC themselves (see `verifyHmac.ts`).
- `src/app/auth/callback` — Supabase auth callback. Listed in `publicRoutes` and `apiRoutes`.
- `src/pages/` — legacy Pages Router (limited surface, may still hold a handful of routes).

### Domain modules of note

Most business logic lives in **`src/lib/`** as standalone modules. Prefer importing helpers over reimplementing:

- **Money / display** — `formatNumber.ts` (`formatNumber`, `formatCurrency`, `formatPercent`, `formatGrowth`, `formatDate`). `check:tolocale` blocks raw `toLocaleString` in chart/UI files — route ticks and tooltips through these.
- **Pricing** — `pricing.ts`, `pricing/plans.ts`, `pricingConfig.ts`. Tiered subscription plans, tax (VAT 14% + stamp 0.5% + service 6%) computed via **cascading multiplication, not addition** — see `docs/PRICING_SPEC.md`. `top_centers` is custom-priced and reads `centers.all_in_price` (code must throw + Sentry-warn on NULL).
- **Billing engine** — `billingEngine.ts`, `billingSchedule.ts`, `billingGrace.ts`, `cairoBillingCalendar.ts`, `subscriptionBillingCron.ts`, `subscriptionPastDue.ts`, `paygBilling.ts`, `packBilling.ts`. All anchored to **Cairo time** (`src/lib/cairo/`, helpers like `startOfCairoDay`, `cairoDateKey`). Never use `new Date()` for billing windows directly.
- **Payments** — `paymob/`, `paymob.ts`, `combinedPaymentFinalize.ts`, `invoicePaymobPayment.ts`, `paymobGuardLogic.ts` (gates live/test mode by `VERCEL_ENV` + `NEXT_PHASE`). HMAC verification via `verifyHmac.ts`.
- **Shipping** — `bosta.ts`, `bostaShipping.ts`, `autoBookBosta.ts`. Zones and rates from `loadBostaShippingRates`.
- **WhatsApp** — `whatsapp.ts`, `whatsapp/`, `wa_templates` table, `whatsapp-pack.ts`. Phone-number-id has three env aliases (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PHONE_ID`, `PHONE_NUMBER_ID`); code reads all three.
- **Scanner / offline** — `scanner/`, `db.ts` (IndexedDB via `idb`), `offlineDb.ts`, `sync.ts`. Scanner inserts use `/api/db` with Upstash rate-limiting.
- **Card orders** — `card-order-cart/`, `cardOrderState.ts`, `cardOrderPayment.ts`, `cardOrderNotifications.ts`. Sample students rule: paid card orders with **blank line items only** keep roster students eligible for recommendations.
- **Auth / admin gating** — `admin-access.ts`, `admin-auth.ts`, `admin-check.ts`, `admin-roles.ts`, `requireOwnerAdminCenter.ts`, `centerAuth.ts`, `centerPermissions.ts`. Super-admin is **phone-based** via `SUPER_ADMIN_PHONES` env + `isSuperAdminPhone()`, NOT solely a DB role.

### Test data conventions

- E2E seed writes rows marked `notes = e2e_seed:v1`, fixed student numbers `TEST-00001…TEST-00005`, `TEST-NOCARD01`. Idempotent. `CLEANUP_TEST_DATA=1` purges prior seed.
- **Admin aggregates default `is_test = false`** — never expose a test-row leak in finance views. Use `include_test=1` as a documented diagnostic toggle only.
- Audit/dev seed accounts: see `scripts/audit/README.md` (super-admin `+201111111111`/`111111`, owner `+201333333333`/`333333`, etc.). Supabase auth email format is `{digits}@centerhq.local`.

### State & contexts

- React contexts in `src/contexts/`: `UserContext` (auth session + role), `LayoutContext`, `SidebarContext`, `ThemeContext`. Wrapped in `src/app/[locale]/layout.tsx`.
- Client store: `src/stores/branchStore.ts` (Zustand) — active branch selection.
- Data fetching: SWR for client, server components for SSR pages.

### i18n

- `messages/ar.json`, `messages/en.json` are the only translation sources. `next-intl` is wired via `src/i18n/request.ts` and `routing.ts` (`defaultLocale: 'ar'`, `localePrefix: 'always'`).
- **`scripts/check-i18n.ts` enforces key parity** and runs on every `npm run build`. Missing/extra keys fail CI. For RTL-safe styling rules, see `docs/RTL.md` (logical properties only, with documented exemptions for PDF/print, Recharts margins, email HTML).

### Cron jobs

35+ Vercel-scheduled cron routes under `src/app/api/cron/*` defined in `vercel.json`. All check `Authorization: Bearer ${CRON_SECRET}`. Long-running ones (`weekly-backup`, `monthly-backup`, `process-renewals`, `daily-summary`, `detect-churn`, …) have `maxDuration` overrides in `vercel.json` — when adding a new cron that needs >10s, set its `functions[...].maxDuration` too.

### Build / runtime config

- **React Compiler is on** (`reactCompiler: true` in `next.config.ts` + `babel-plugin-react-compiler`). Avoid manual `useMemo`/`useCallback` boilerplate unless you measure a regression.
- **CSP is set in two places** — `next.config.ts` `headers()` and `src/proxy.ts` `SECURITY_HEADERS`. Keep them in sync when adding a third-party origin (PostHog, Sentry, Paymob, Supabase realtime).
- Sentry wraps the Next config (`withSentryConfig`) with sourcemaps **disabled** in the upload step. Server vs edge runtime branches in `instrumentation.ts`.
- Path alias: `@/*` → `./src/*` (`tsconfig.json`). `supabase/functions` is excluded from tsc.

## Conventions to keep

- **Logical CSS only in app UI** (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`). Physical properties stay only in PDF/print, email HTML, Recharts margin props (mark `// RTL-EXEMPT`).
- **All number/date formatting goes through `formatNumber.ts` helpers.** Raw `toLocaleString` is blocked by `check:tolocale`.
- **Cairo time, not UTC, for any user-visible billing/calendar window.** Tests run `TZ=UTC` to surface bugs — use the `cairo/` helpers.
- **`is_test = false` default** on admin aggregates.
- **CSRF on mutations** routed through `/api/db`; new mutation endpoints should call `validateCSRFRequest`.
- **Webhooks verify HMAC themselves** — middleware does not check auth on `PUBLIC_WEBHOOK_PREFIXES`.

## Where to look first

- New API route: `src/app/api/<domain>/route.ts` + a helper in `src/lib/<domain>.ts`. Check `requireOwnerAdminCenter` / `centerAuth` / `admin-access` for the right gate.
- New scheduled job: add `src/app/api/cron/<name>/route.ts`, register in `vercel.json` `crons[]`, set `functions[...].maxDuration` if >10s, gate on `CRON_SECRET`.
- New page: pick a locale group under `src/app/[locale]/`, register the prefix in `AUTHENTICATED_ROUTE_PREFIXES` in `src/proxy.ts` if it needs auth.
- Pricing change: `docs/PRICING_SPEC.md` first, then `src/lib/pricing/`.
- Billing window edge case: `src/lib/cairoBillingCalendar.ts` + `src/lib/cairo/`.
- Reference docs live in `docs/` — `CENTERHQ_TECHNICAL_REFERENCE_v21.md`, `HELPERS_INVENTORY.md`, `RTL.md`, `E2E_TESTING.md`, `DB_PROXY_SECURITY.md`, `PRICING_SPEC.md`, `SECURITY_MAINTENANCE.md`, `LAUNCH_CHECKLIST.md`.
