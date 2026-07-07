---
name: saas-multi-tenant-architecture
description: >
  Multi-tenant SaaS architecture playbook for CenterHQ (EH Group). Use when
  adding routes, API endpoints, tables, or auth gates; when reasoning about
  tenancy isolation, RLS, middleware protection, or suspension/lock
  enforcement; or when reviewing code for cross-tenant leakage.
---

# Multi-Tenant SaaS Architecture — CenterHQ

## Tenancy model (non-negotiable invariants)

1. **`center_id` on every tenant-scoped row.** Isolation = Postgres RLS keyed
   off the authenticated user's `users` row → `center_id`. The middleware
   (`src/proxy.ts`) authenticates but does **not** authorize per-center —
   authorization lives in RLS + per-route gates.
2. **Two DB access paths, two threat models:**
   - Browser/SSR Supabase client (`src/lib/supabase.ts`) → RLS enforced.
   - Service-role (`src/lib/supabase-admin.ts`, `/api/db` proxy) → **RLS
     bypassed**. Every service-role query MUST apply its own `center_id`
     scoping derived from the *authenticated session*, never from
     client-supplied body/query/header values.
3. **Never trust caller-supplied `center_id`.** Resolve it server-side via
   `requireOwnerAdminCenter`, `centerAuth`, or `centerPermissions`. Design
   decision #8 in `docs/EH_GROUP_MASTER_CONTEXT_v24.md`: `/api/admin/check`
   reflects JWT-derived scope only.

## Route-protection checklist (run on EVERY new route)

- [ ] Page route → prefix added to `AUTHENTICATED_ROUTE_PREFIXES` in
      `src/proxy.ts`? (Missing prefix = publicly renderable page.)
- [ ] API mutation → CSRF via `validateCSRFRequest` (`src/lib/csrf.ts`)?
- [ ] API route → correct gate: `requireOwnerAdminCenter` (owner/admin of a
      center), `centerAuth` (member of center), `admin-access` /
      `isSuperAdminPhone` (platform super-admin — phone-based via
      `SUPER_ADMIN_PHONES`, never DB role alone), `centerPermissions`
      (fine-grained staff permission)?
- [ ] Webhook → path in `PUBLIC_WEBHOOK_PREFIXES` AND does its own HMAC
      verification (`verifyHmac.ts`)? Middleware gives webhooks NOTHING.
- [ ] Cron → `Authorization: Bearer ${CRON_SECRET}` check; registered in
      `vercel.json` `crons[]`; `maxDuration` set if >10s.
- [ ] New table → RLS policy written in the same migration; `is_test` column
      if it feeds admin aggregates (default `is_test = false` in queries).

## Suspension & access enforcement

- Middleware loads `centers.status`, `billing_status`, `auto_suspend_at`,
  `is_blacklisted` + `subscriptions.status` per authenticated request.
- Single-day lock model (`src/lib/billingLifecycle.ts`): unpaid at billing
  day → full access until 23:59:59 Cairo → next 00:00 Cairo locks to the
  `/suspended` summary screen. Teachers instead drop to free tier via
  `teacher_private_access` RPC (data preserved, never deleted).
- Blacklisted centers: 401 everywhere except `/settings` and
  `/session-expired`.

## Locale & edge rules

- Every user-facing path is locale-prefixed (`/ar` default RTL, `/en`).
  `localePrefix: 'always'` — never redirect off the locale prefix.
- CSP lives in **two places**: `next.config.ts` `headers()` and
  `src/proxy.ts` `SECURITY_HEADERS`. Adding a third-party origin means
  editing both.

## Review heuristics (cross-tenant leak hunting)

- Grep new code for `supabaseAdmin` / `supabase-admin` — each hit must show
  explicit `.eq('center_id', <server-resolved id>)` or an admin-only gate.
- Grep for `center_id` read from `req`, `body`, `params`, `searchParams` —
  each hit must be followed by a membership check against the session user.
- Any aggregate feeding `/admin/finance` or CEO dashboards must filter
  `is_test = false` unless `include_test=1` diagnostic flag is explicit.
- Rate-limiter and CSRF fallbacks must **fail closed in production**:
  missing `UPSTASH_REDIS_REST_URL`/`TOKEN` or `CSRF_SECRET` should hard-fail
  on Vercel prod, not silently skip.
