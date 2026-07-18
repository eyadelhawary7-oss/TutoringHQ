# Center-Side Role Gating Audit

*Generated: Tuesday, May 12, 2026*

> Point-in-time audit — snapshot of 2026-05-12. Preserved as the historical record.
> Reviewed 2026-07-18: `requireCenterAuth` still lives in `src/lib/centerAuth.ts`
> and the three RECOMMENDED OWNER-ONLY routes below (`referrals/payout`,
> `card-order-cart/checkout`, `paymob/create-payment-key`) are still ungated
> (verified live 2026-07-18 — no owner-role check present). The per-route counts and
> the full 60-route inventory are as-of the audit date and have NOT been re-audited
> since; treat them as historical unless re-verified against the current source.

## Notes on `requireCenterAuth`

`requireCenterAuth` is defined in `src/lib/centerAuth.ts`. It validates the Bearer token, looks up `users.role` from the `users` table, and returns `{ ok: true, userId, centerId, role, supabaseAdmin }`. The `role` field maps to the value stored in `users.role` (e.g. `"owner"`, `"assistant"`, `"super_admin"`). There is **no separate `center_user_memberships` table** used; role gating checks compare `auth.role !== 'owner'` directly.

Two files appeared in the initial grep (`auth/reset-pin` and `auth/verify-pin-reset`) because their comments say "No requireCenterAuth" — they are **public** routes and are excluded from this audit.

## Summary

- Total center-side routes audited: **60**
- GATED-OWNER: **18**
- GATED-ASSISTANT: **1** (custom user-level permission, not `role`)
- UNGATED — recommended OWNER-ONLY: **3**
- UNGATED — ASSISTANT-OK: **30**
- UNGATED — NEEDS-REVIEW: **7**
- Mixed (GATED write, UNGATED read): **1** (`settings/billing` GET is ungated; counted in GATED-OWNER above)

---

## Detailed Inventory

### GATED-OWNER routes (already secure)

Routes that explicitly return HTTP 403 when `auth.role !== 'owner'`.

| Route | Verbs | Purpose |
|---|---|---|
| `api/orders/[orderId]/mark-issued` | POST | Mark card order as physically issued to students |
| `api/billing/dashboard` | GET | Full billing dashboard: plan, invoices, PAYG metrics, balances |
| `api/billing/switch-payg` | POST | Enable / disable / cancel a pending Pay-As-You-Go switch |
| `api/settings/billing` | PUT, POST | Update pending plan change, submit payment proof; GET is **ungated** (reads billing config) |
| `api/settings/plan-request` | POST | Insert a `plan_requests` row for manual plan upgrade |
| `api/invoices/[id]/pdf` | GET | Download subscription invoice PDF (owner or super_admin only) |
| `api/settings/instapay` | PATCH | Save/update the center's InstaPay payout number |
| `api/billing/reactivate` | POST | Reactivate a suspended center via Paymob or credit spending |
| `api/billing/downgrade` | POST | Immediately downgrade plan, earn credit for unused days |
| `api/billing/invoices` | GET | List the 10 most recent billing invoices |
| `api/invoices/[id]/pay` | POST | Create a Paymob iframe session to pay a subscription invoice |
| `api/billing/upgrade` | POST | Prorated plan upgrade via Paymob payment session |
| `api/billing/withdrawal` | POST | Submit a quarterly credit-withdrawal request to InstaPay |
| `api/billing/next-pay-invoice` | GET | Fetch the first unpaid subscription invoice ID for "pay now" UIs |
| `api/orders/[orderId]/cancel` | POST | Cancel a card order that has not yet been paid |
| `api/billing/cancel` | POST | Request subscription cancellation (sets status to `pending_cancellation`) |
| `api/centers/reactivate` | POST | Reactivate a dormant center — creates reactivation fee invoice via Paymob |
| `api/payouts/[id]/pdf` | GET | Download payout receipt PDF |

---

### GATED-ASSISTANT routes (already role-aware)

Routes that use a mechanism other than `auth.role` to distinguish assistant capabilities.

| Route | Verbs | Purpose |
|---|---|---|
| `api/payments/confirm` | POST | Confirm a pending payment; guarded by per-user `can_record_payments` / `can_view_payments` flags on the `users` row, not by `auth.role` |

---

### UNGATED routes — RECOMMENDED OWNER-ONLY ⚠️

These currently allow any authenticated center member (including assistants) to perform actions that should be restricted to the center owner. Each needs an `if (auth.role !== 'owner') return 403` guard added.

| Route | Verbs | Purpose | Risk |
|---|---|---|---|
| `api/referrals/payout` | POST | Request a cash payout from referral reward balance via InstaPay | Assistant could drain the owner's referral balance |
| `api/card-order-cart/checkout` | POST | Finalises cart, creates a `card_orders` row, and initiates a Paymob payment session — **real money** | Assistant could place a paid card order without owner approval |
| `api/paymob/create-payment-key` | POST | Creates a Paymob iframe payment key for an existing card order | Assistant could trigger a payment flow for any unpaid order |

---

### UNGATED routes — ASSISTANT-OK

These are routine operations safe for any authenticated center member.

| Route | Verbs | Purpose |
|---|---|---|
| `api/orders/[orderId]/reorder` | POST | Copy students from a past order into the open cart |
| `api/parents/notify-scan` | POST | Send a WhatsApp scan-result notification to a student's parent |
| `api/orders/history` | GET | Paginated/filtered list of the center's card orders |
| `api/card-order-cart/student-card-status` | POST | Bulk-check whether a list of students already have/are getting cards |
| `api/audit-log` | POST | Append a row to `audit_log` (center scoped by session) |
| `api/groups/[groupId]/attendance-heatmap` | GET | Weekly attendance heatmap for a group |
| `api/onboarding/simulate-scan` | POST | Trigger `upsert_scan_metric` RPC and advance onboarding step 3 |
| `api/card-order-cart/cleanup-stale-items` | POST | Purge stale items from the open cart and return updated payload |
| `api/orders/[orderId]/receipt` | GET | Download card order receipt PDF (also accepts admin auth fallback) |
| `api/card-order-cart` | GET, POST, PATCH, DELETE | Read / create / update / abandon the open card-order cart |
| `api/payments/stats` | GET | Today/month revenue, pending digital payments, total balance due |
| `api/orders/[orderId]` | GET | View full detail of a single card order |
| `api/paymob/payment-status` | GET | Poll Paymob for card-order payment result and finalise if paid |
| `api/paymob/invoice-status` | GET | Poll Paymob for invoice or combined-session payment result |
| `api/onboarding/add-student` | POST | Add a student during the onboarding wizard (step 1) |
| `api/card-order-cart/items` | POST | Add student or blank-card items to the open cart |
| `api/families` | GET, POST | List / create family records |
| `api/scan/roster-cache` | GET | Return all active students for offline scanner caching |
| `api/notifications/[id]/mark-read` | PATCH | Mark a single in-app notification as read |
| `api/notifications/mark-all-read` | PATCH | Mark all unread in-app notifications as read |
| `api/notifications` | GET | Paginated list of in-app notifications with unread count |
| `api/groups/[groupId]/waitlist` | GET, POST | List waitlist / add a student to the group waitlist |
| `api/card-order-cart/items/[itemId]` | PATCH, DELETE | Edit quantity / saved-for-later flag or remove a cart item |
| `api/term-summary` | POST | Send end-of-term WhatsApp summary to parents in a group |
| `api/dashboard/stats` | GET | Dashboard KPIs: revenue, attendance, activity feed |
| `api/onboarding/create-group` | POST | Create a student group during onboarding wizard (step 2) |
| `api/onboarding/complete-step` | POST | Manually advance an onboarding step via RPC |
| `api/groups/[groupId]/notify-waitlist` | POST | WhatsApp-notify the first waitlist parent when a spot opens |
| `api/settings/limits` | GET | Read the center's plan limits and current student/team counts |
| `api/orders/recommendations` | GET | Suggest students without cards and recently-added students |

---

### UNGATED routes — NEEDS REVIEW

Ambiguous cases where business intent is unclear or the action spans both roles.

| Route | Verbs | Purpose | Notes |
|---|---|---|---|
| `api/centers/me` | PATCH | Update `centers` row fields: name, city, governorate, phone, onboarding flags | Onboarding fields are assistant-safe, but updating center name/phone is owner-level configuration. Consider splitting or gating non-onboarding fields to owner. |
| `api/settings/billing` | GET | Read full billing config: plan, pricing, billing_type, PAYG stats, invoices, scan usage | Exposes detailed financial metrics. Low risk (read-only), but assistants can see all billing history. Consider owner-only or a reduced scope for assistants. |
| `api/whatsapp/schedule-onboarding` | POST | Schedule WhatsApp onboarding Flow 1 for the center's phone | Sends an outbound WA message on behalf of the center. Low-risk during setup; may want owner-only after onboarding is complete. |
| `api/students/[id]` | PATCH, DELETE | Edit student fields (name, phone, group, notification prefs) or soft-delete (set `is_active = false`) | PATCH of routine fields is assistant-safe. DELETE (deactivation) is a destructive action — consider restricting to owner. |
| `api/students/pending/[id]/approve` | POST | Call `approve_student_rpc` to activate a pending enrollment | Approval is an administrative action that modifies enrollment status and writes an audit log entry. Likely owner-only or gated to `can_record_payments`-style flag. |
| `api/academic` | GET, POST | Read/write academic years, periods, and holidays (CRUD via action param) | GET is clearly assistant-safe. POST write-actions (create/update/delete year, period, holiday) modify center-wide scheduling configuration — consider owner-only for mutations. |
| `api/students/lifecycle` | PATCH | Update `lifecycle_status` (full live enum, verified 2026-07-18: `enrolled`, `active`, `at_risk`, `inactive`, `churned` — the `students_lifecycle_status` CHECK constraint; this audit's original "enrolled → active → at_risk → churned" omitted `inactive`) | CRM-style status changes affect business logic and reporting. Could be assistant-safe if assistants actively track student health, or owner-only if lifecycle is a management concept. |
