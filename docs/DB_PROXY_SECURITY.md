# `/api/db` proxy — security posture (audit F-410)

The endpoint `POST /api/db` is a **legacy typed Supabase proxy** (service role) used widely by the dashboard and scanner via `src/lib/db-proxy.ts`.

It is **not** unconstrained SQL: operations are allow-listed, payloads are validated where schemas exist, **mutations require CSRF**, scanner inserts are **rate-limited**, and **every request is forcibly scoped to the caller's session-derived `center_id`**.

## Tenant isolation (2026-05-21)

The route runs every query through the Supabase service-role client, so RLS does not apply. Cross-tenant safety is enforced in the handler via `src/lib/dbProxyScope.ts`:

- **Identity is session-derived.** `actorCenterId` and `isSuperAdmin` come from the verified bearer token's `users` / `admin_users` rows. Request body, headers, and query string are never consulted for identity.
- **Every table has a scoping rule** (`TABLE_SCOPE` in `dbProxyScope.ts`):
  - `direct(col)` — the handler **force-appends `.eq(col, actorCenterId)`** to SELECT/UPDATE/DELETE/COUNT WHERE clauses, and **force-overwrites `data[col] = actorCenterId`** on INSERT/UPDATE payloads. Cross-tenant filters (`.eq(col, FOREIGN)`, `.in(col, [..., FOREIGN])`, `.neq(col, ACTOR)`) are rejected with 403 `CROSS_TENANT_FILTER_REJECTED`.
  - `indirect` — applies to join tables with no direct `center_id` (`student_group_members`, `attendance_overrides`). The handler validates that referenced parent rows (group_id, student_id) belong to the caller's center before the query runs.
  - `forbidden` — applies to tables with no center scope at all (`demo_requests`, `whatsapp_incoming`). Non-super-admin callers get 403 `TABLE_NOT_PERMITTED_VIA_PROXY`. These tables must use dedicated REST routes.
- **`centers` is special.** Its scope column is the primary key `id`, so the handler does not force-overwrite the payload (Postgres won't reassign the PK anyway). Non-super-admin INSERT is forbidden — new centers come from the signup / admin flow, never the proxy.
- **Super-admin override.** Detected the same way as `src/lib/centerAuth.ts:93-99` (role `super_admin` OR row in `admin_users`). Super-admins bypass scoping entirely — cross-tenant access is intentional for that role.

The decision is implemented as a **pure function** (`planScope`) plus async per-table parent validators, tested in `tests/unit/dbProxyScope.test.ts`.

## What changed in this hardening

Prior to 2026-05-21 the proxy authenticated the session and looked up `actorCenterId`, but only wrote it to `audit_log` — query filters were passed through verbatim. An authenticated centre B user could read/update/delete any centre's rows on the 20 allow-listed tables by supplying `center_id` in the request `filters`. `SELECT` was additionally CSRF-exempt, so even a stolen bearer token in any XSS context could exfiltrate cross-tenant data without CSRF.

That vector is now closed:

- SELECT/COUNT — forced `.eq(scopeColumn, actorCenterId)`; cross-tenant filters rejected.
- INSERT — `data[scopeColumn]` overwritten with `actorCenterId` (except `centers`, which is forbidden).
- UPDATE — both the WHERE filter and the payload's `scopeColumn` are forced to `actorCenterId`.
- DELETE — forced WHERE filter; cross-tenant filters rejected.
- Indirect tables — parent-row tenant check.
- Forbidden tables — denied to non-super-admins.

## Defense-in-depth

- **CSRF** required on all state-changing operations (`csrf.ts`).
- **Rate limiting** on `attendance_scans` inserts via Upstash (`ratelimit.ts`).
- **Audit log** on every successful mutation (`db_proxy.<operation>.<table>` with `details.filter_preview` and `details.super_admin`).
- **Allow-listed operations** (`select`, `insert`, `update`, `delete`, `count`) and **allow-listed tables** (`TABLE_SCOPE`).
- **Body size cap** at 64 KiB (`parseBodyWithLimit`).
- **Schema validation** for tables with `dbInsertSchemas` / `studentUpdateSchema`.

## Follow-up (still tracked)

- Migrate `src/lib/db-proxy.ts` call sites to narrow REST routes per domain, then retire `/api/db`. The hardening above makes the proxy safe in the meantime; it does not change the long-term direction.
- Add `CREATE POLICY` definitions for tenant tables that lack them (`students`, `attendance_scans`, `student_groups`, `student_group_members`, `rooms`, `schedule_slots`, `subscriptions`, `subjects`, `whatsapp_messages`, `permissions`, `paid_parents`, `wa_templates`, `reminder_settings`, `card_orders`) so that RLS becomes a working safety net for any future anon-key code path. The proxy does not rely on RLS, but a missing policy means a single accidental anon-key query elsewhere has nothing catching it.
