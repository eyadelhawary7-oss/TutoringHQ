# TutoringHQ (internal repo: CenterHQ)

> Synced against the live database and code on 2026-07-18. Key facts verified live are marked (verified 2026-07-18); unverifiable ones are marked (UNVERIFIED).

Multi-tenant SaaS for Egyptian tutoring centers (سناتر). Next.js 16 App Router on
Vercel, Supabase Postgres + Auth, served bilingually at `/ar/...` (default, RTL) and
`/en/...` (LTR).

- **Live product domain:** https://tutoringhq.app (verified 2026-07-18) — `centerhq.app` is retired.
- **Internal names stay CenterHQ by design** and are NOT bugs: the GitHub repo (`CenterHQ`),
  the Vercel project (`center-hq`), and the auth-email suffix (`@centerhq.local`).

**`CLAUDE.md` is the authoritative engineering guide** (architecture, tenancy/auth flow,
working rules, commands). Read it before making changes. This README is only an entry point.

## Stack (verified against `package.json`, 2026-07-18)

React 19.2 + Next 16.2 (App Router, React Compiler on) · TypeScript 5 · Tailwind 4 ·
Zod 4 · Recharts 3 · SWR + Zustand · `next-intl` 4 · Supabase JS 2 + `@supabase/ssr` ·
Sentry · Upstash Redis (rate limiting) · Playwright + Vitest.

## Getting started

```bash
cp .env.example .env.local   # then fill in Supabase, CRON_SECRET, CSRF_SECRET, etc.
npm install
npm run dev                  # http://localhost:3000 → redirects to /ar (default locale)
```

Requests are always locale-prefixed (`localePrefix: 'always'`): `/` redirects to `/ar`, and
both `/ar/...` and `/en/...` keep their prefix (verified in `src/i18n/routing.ts`, 2026-07-18).

## Common commands (from `package.json`, verified 2026-07-18)

```bash
npm run dev                 # next dev
npm run build               # gates (i18n:check + check:bidi + check:tolocale + check:balance-due + setup-fonts) then next build (8GB heap)
npm run lint                # eslint
npm run typecheck           # rimraf .next/types && tsc --noEmit (8GB heap)
npm run verify:stabilization  # i18n + bidi + tolocale gates (run before pushing UI)
npm run test:unit           # vitest run
npm run test:e2e            # playwright (needs tests/e2e/.env.local — see docs/E2E_TESTING.md)
npm run check:env           # validates required env vars
```

The `check:*` scripts are build gates — a failure breaks `npm run build`.

## Where to look

- **`CLAUDE.md`** — architecture, tenancy/auth, conventions, "where to look first".
- **`README-I18N.md` / `QUICK-START.md`** — i18n + RTL setup notes.
- **`docs/`** — technical reference, helpers inventory, RTL, E2E testing, DB-proxy security,
  pricing spec, security maintenance, launch checklist.
- **Middleware** lives in **`src/proxy.ts`** (aliased `proxy.ts`, not `middleware.ts`).

## Deploy

Deployed on Vercel. Database migrations are **manual apply to production** — Supabase Branching
auto-applies to preview branches only, never to production on merge (verified 2026-07-18; see
`CLAUDE.md` working rules). Apply by hand, confirm columns exist in `information_schema`, then let
the code deploy.
