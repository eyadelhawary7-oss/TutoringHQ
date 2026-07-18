---
name: saas-multi-tenant-architecture
description: Tenant isolation and minors' data protection rules for TutoringHQ. Use whenever touching auth, API routes, middleware, database queries, RLS, service-role code, exports, cron jobs, or anything that reads or writes center, student, or parent data.
---

# Tenant and data safety (LOCKED)
> Synced against the live database and code on 2026-07-18. Load-bearing tenant/RLS facts verified live are tagged (verified live 2026-07-18); the zero-policy count is stated with its date and query because it moves as tables land.

Cross-tenant leakage of minors' data is an existential risk for this business. Treat any doubt as a blocker, not a judgment call.

1. Every tenant-owned row carries center_id and RLS scopes by it. If you cannot point to the exact line where a query is scoped to the caller's center, that is a finding, not an assumption.
2. Service-role paths (supabase-admin, /api/db) bypass RLS entirely. They MUST derive center_id server-side from the authenticated user. Caller-supplied center_id in body, query, or headers is hostile input and is never trusted.
3. Model B is locked: teachers are center-less (users.center_id is NULL), linked via the teacher_center table. Do not "fix" this.
4. Any new authenticated route prefix must be added to AUTHENTICATED_ROUTE_PREFIXES in src/proxy.ts or it ships unprotected.
5. Routes under PUBLIC_WEBHOOK_PREFIXES get no middleware auth. Each must verify HMAC itself with a timing-safe comparison and re-verify amounts against expected totals. A webhook trusting its payload amount is a critical finding.
6. Mutations require CSRF (validateCSRFRequest, src/lib/csrf.ts). It fails CLOSED: when CSRF_SECRET is unset or malformed, validateCSRFRequest returns false and every caller rejects the mutation with a 403 (the uniform `if (!validateCSRFRequest(...)) return 403` pattern), in every environment; getKey additionally throws in production. An unset secret does NOT silently skip validation, it blocks all state-changing requests, so CSRF_SECRET must be set in every environment. (Corrected 2026-07-16 to match csrf.ts and its callers; the earlier "silently skips" wording described a fail-open vulnerability that does not exist.)
7. Admin aggregates default is_test = false. Test data (is_test, e2e_seed:v1, TEST-xxxxx numbers) must never leak into customer-facing views or finance metrics.
8. Suspension and blacklist gating lives in middleware plus resolveBillingAccess. Never create a route or payment path that reactivates or bypasses a suspended center outside the intended handlers.
9. No new callers of the legacy /api/db proxy. New domain logic lands as a narrow REST route with the right gate (requireOwnerAdminCenter, centerAuth, or admin-access).
10. Parent-facing links must be short-lived and revokable (PDPL phase 2 direction). Never mint long-lived tokens to student or parent data.
11. Known accepted state (verified live 2026-07-18 by counting pg_class where relrowsecurity is true and no pg_policy row exists): 22 server-only tables run RLS-on with zero policies, deny-by-default on purpose. 18 are the established July-2026-scan set; the other four (trial_claims, teacher_assignments, promo_code_requests, billing_lockout_events) were added since and are each deliberately service-role-only and deny-by-default in their creating migration (RLS enabled, anon/authenticated REVOKEd, only the service role reads/writes them). Several SECURITY DEFINER helper functions are RPC-callable; anonymous EXECUTE on them should be revoked before launch. Do not "fix" the zero-policy tables by adding permissive policies. (The earlier "18" was a stale count from the July scan and was never re-verified; re-run the count above rather than trusting a number in prose.)

# Review method
For any diff touching these areas, read the actual code path end to end and state in the PR where center scoping happens for each new query. Run npm run security:audit when relevant.

# Additional verified notes
Correct facts carried forward from the previous version of this skill, verified against the codebase 2026-07-16. None contradict the locked rules above.

- CSP lives in two places: next.config.ts headers() and src/proxy.ts SECURITY_HEADERS. Adding a third-party origin (PostHog, Sentry, Paymob, Supabase realtime) means editing both.
- Suspension enforcement, in detail: middleware loads centers.status, billing_status, auto_suspend_at, is_blacklisted plus the matching subscriptions.status per authenticated request. Suspended/overdue centers redirect to /{locale}/suspended. Blacklisted centers get 401 everywhere except /settings and /session-expired.
- The single-day lock is implemented in src/lib/billingLifecycle.ts and gated through resolveBillingAccess (src/lib/billingAccessGate.ts). It is currently BUILT BUT INERT: PAYMOB_RECURRING_INTEGRATION_ID is a placeholder, so no saved card is charged and the auto-suspend is suppressed (verified live 2026-07-18) — the isolation code paths are wired, but no center is actually locked out today. On lock, teachers drop to a free tier with data preserved via the teacher private-view path (teacher_private_access, src/lib/teacherPrivateView.ts). That free-tier drop is a separate mechanism from the teacher_center linking model in rule 3.
- Every user-facing path is locale-prefixed (/ar default RTL, /en) with localePrefix: 'always'. Never redirect off the locale prefix.
- Route-protection checklist for every new route: page route to AUTHENTICATED_ROUTE_PREFIXES; API mutation to validateCSRFRequest; correct auth gate (requireOwnerAdminCenter, centerAuth, admin-access / isSuperAdminPhone, centerPermissions); webhook in PUBLIC_WEBHOOK_PREFIXES with its own HMAC; cron gated on CRON_SECRET and registered in vercel.json; new table ships its RLS policy in the same migration.
