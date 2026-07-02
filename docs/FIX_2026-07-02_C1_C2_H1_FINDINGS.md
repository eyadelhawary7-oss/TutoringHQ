# Findings — data-exposure holes C1, C2, H1 (2 July audit)

Introspected the live catalog (project `lczmjpnbuhnsislcvzar`) and the two routes before touching anything. All three are the same class of bug: data returned without checking the caller owns it.

## C2 — `content_access_log` anon cross-tenant SELECT (CRITICAL)

Live policy, before:

```
polname : content_access_log_select
polcmd  : r (SELECT)
roles   : PUBLIC   (pg_policy.polroles = {0} → includes anon)
qual    : EXISTS (SELECT 1 FROM content_items ci WHERE ci.id = content_access_log.content_item_id)
```

The qual is true for **any** row whose content item still exists — no tenant predicate at all. RLS is enabled (`relrowsecurity = true`), and `anon` additionally holds a table-level `SELECT` grant (baseline L7385). So an unauthenticated caller could read every row across every center.

Supporting facts:
- Only policy on the table is this SELECT (no INSERT/UPDATE/DELETE policies) → writes only succeed via `service_role`, which bypasses RLS. Rescoping SELECT cannot break a writer.
- `content_items.owner_center_id` is the tenant key. `get_auth_center_id()` (STABLE SECURITY DEFINER) returns the caller's `users.center_id`.
- Table currently holds 0 rows; no SQL function or app-code path references it (ghost/future content-distribution feature). Nothing live depends on the permissive policy.

Fix (one tracked migration): drop the PUBLIC SELECT policy, recreate it `TO authenticated` with qual
`EXISTS content_items ci WHERE ci.id = content_item_id AND ci.owner_center_id = get_auth_center_id()`,
and `REVOKE SELECT ... FROM anon`. Ends with `NOTIFY pgrst, 'reload schema'`.

## C1 — `GET /api/center-users` cross-tenant staff leak (CRITICAL)

Route state, before (`src/app/api/center-users/route.ts` L30-45): authenticates the JWT, then reads `centerId` **from the query string** and queries `users` via the **service-role** client (RLS bypassed) with no check that the caller belongs to that center. A user of center A could pass center B's id and read B's staff (id, phone, role).

Fix: route through `requireCenterAuth` (same authority model as `/api/benchmarks`). Reject any requested `centerId` that isn't the caller's own center (403), unless the caller is super-admin. Query is scoped to the resolved own-center id.

## H1 — `POST /api/billing/payg-calculate` auth bypass (HIGH)

Route state, before (`src/app/api/billing/payg-calculate/route.ts` L33-56): auth runs **only when the body has no `centerId`** (`if (!targetCenterId && authHeader)`). Sending `{ "centerId": "<any>" }` skips auth entirely, then the route queries `attendance_scans` for that center via the service role — an unauthenticated caller learns any center's weekly student count / PAYG charge.

Fix: always call `requireCenterAuth`. Ignore a body-supplied `centerId` unless the caller is super-admin; otherwise scope to the caller's own center.

## Schema snapshot

The C2 migration tightened the live rule, so `db/schema.snapshot` (the drift
reference) no longer matched — the drift gate fired, correctly. Regenerated the
two affected lines to match a PG17 rebuild:
- `POLICY content_access_log.content_access_log_select` → `roles=authenticated`,
  qual gains `AND (ci.owner_center_id = get_auth_center_id())`.
- Removed `TABLE_GRANT content_access_log grantee=anon priv=SELECT`.

Both lines were taken byte-for-byte from `introspect.sql`'s own expression run
against the live PG17 database, so they are identical to what CI's migration
rebuild will emit. (A full local `schema:snapshot` rebuild couldn't run here:
the sandbox only has Postgres 16, which rejects the baseline's PG17-only
`MAINTAIN` grants, and PG17 was unreachable — PGDG apt and the Docker registry
CDN are both blocked by egress policy.)

## Adjacent observation (NOT fixed — out of scope)

The sibling table `content_access` carries the **same class** of bug as C2: its
`content_access_select` policy is `roles=public` with qual
`EXISTS (SELECT 1 FROM content_items ci WHERE ci.id = content_access.content_item_id)`
— no tenant predicate, readable by anon across centers. Left untouched per the
"exactly these three" scope; flagging it for a follow-up decision.

## Verify (before → after)

- **C2**: anon `SELECT * FROM content_access_log` → before: all rows platform-wide; after: `permission denied` (grant revoked) / zero rows (policy is `authenticated` + own-center only). Confirmed from live catalog.
- **C1**: center A caller `?centerId=<B>` → before: B's staff; after: `403 Forbidden`. `?centerId=<A>` still returns A's staff.
- **H1**: unauthenticated `POST {centerId:<X>}` → before: X's figures; after: `401 Unauthorized`. Logged-in center still gets its own figures.
