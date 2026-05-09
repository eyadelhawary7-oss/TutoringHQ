# `/api/db` proxy — security posture (audit F-410)

The endpoint `POST /api/db` is a **legacy typed Supabase proxy** (service role) used widely by the dashboard and scanner via `src/lib/db-proxy.ts`.

It is **not** unconstrained SQL: operations are allow-listed (`ALLOWED_TABLES`), payloads are validated where schemas exist, **mutations require CSRF**, and scanner inserts are **rate-limited**.

## Closure disposition (2026-05-09)

- **Removing** the route would break production until every caller migrates to domain-specific APIs.
- **Mitigations shipped:** server-side **`audit_log`** rows on successful mutations (`action`: `db_proxy.<operation>.<table>`, `details.filter_preview`).
- **Follow-up (tracked):** replace `db-proxy` usages with narrow REST routes per domain; then retire `/api/db`.

## Super-admin-only destructive paths

Broader row-level enforcement (per-center scoping on every `select`) is **not** expressed in this proxy; RLS and application routes remain the primary controls.
