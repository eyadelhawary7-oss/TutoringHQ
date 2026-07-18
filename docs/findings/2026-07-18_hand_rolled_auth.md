# Hand-rolled auth routes - report (2026-07-18)

Re-derived from **current master** (commit at time of writing includes PR #166, which
folded the single-day lock gate into `requireCenterAuth` / `requireOwnerAdminCenter`).
REPORT ONLY - nothing in this PR changes any auth path. Eyad decides the migration order.

**How this was produced:** an assistant enumerated all `src/app/api/**/route.ts` handlers
and classified each by the gate it uses. The high-risk findings below (every money and
student-data route) were then **personally re-read against source** and the line references
verified; those are marked `[verified]`. The full-fleet counts are the enumeration's and
are marked `[enumerated]` - treat them as a strong inventory, not a line-by-line proof of
all 300+ files.

## Standard gates (using one of these = NOT a finding)
`requireOwnerAdminCenter`, `requireCenterAuth` / `requireTeacherAuth` (centerAuth.ts),
`getAdminContext` + `requireAdminRole` (admin-auth.ts) / `requireSuperAdminApi` /
`requireInternalAdminApi`, `centerPermissions`, `requireCronSecret`, webhook HMAC
verification, and the `/api/db` proxy's own gate. Webhooks (`paymob`, `bosta`, `whatsapp`,
`sentry`) verifying HMAC themselves is correct, not a finding.

## What PR #166 did and did NOT resolve `[verified]`
- `requireOwnerAdminCenter` (requireOwnerAdminCenter.ts:85-91) and `requireCenterAuth`
  (centerAuth.ts:276-279) now call `centerAccessGateResponse` (suspension + blacklist +
  single-day lock). So **every route already on a standard gate inherited the lock gate
  fleet-wide** - that half is resolved.
- **But none of the hand-rolled center/org routes were migrated onto those gates.** Their
  lock-leak was instead closed one-by-one by direct `centerAccessGateResponse(...)` calls
  (the "Part 6 BLOCK" comments). So: lock-leak resolved on them; the hand-rolled
  authentication itself (Bearer -> `getUser` -> `users` row, duplicated ~20x) is NOT
  resolved and #166 did not touch it.

---

## TIER 1 - hand-rolled AND touches MONEY (highest priority)

### 1. `analytics/revenue/route.ts` - MONEY + STUDENT/PARENT PII - drift `[verified]`
- Checks: `getAnalyticsAuth` Bearer -> `getUser` -> `users`(id, center_id, phone) +
  `admin_users`. Super-admin = `!!adminRecord || isSuperAdminPhone(userRecord.phone)`
  (route.ts:76-79). Super-admin may pivot to any center via `?center_id=` (:80-84). Lock
  gate present (:109-112).
- Correct part: it does NOT trust `users.role` (there is an explicit comment warning against
  it). Nit: it derives the phone from **`public.users.phone`**, whereas the hardened gate
  (`centerAuth.ts:187-208`) derives the phone from the auth-email local-part precisely
  because `users.phone` is centre-tenant data. Practical severity is LOW because `users.phone`
  writes are blocked at the `/api/db` proxy, but it is the documented anti-pattern.
- Exposes (GET, read-only): MRR, payments, per-student **balances, student names, parent
  phones**, aging report (:132-134, :146-157, :260-273).

### 2. `analytics/consolidated/route.ts` - MONEY (org revenue) - drift `[verified]`
- Checks: `getOrgContext` Bearer -> `getUser` -> `users`(center_id, organization_id);
  resolves org, returns per-branch data. **No owner/role check** - any org-member user reads
  consolidated revenue. Lock gate is on the caller's home center only (:61-64).
- Exposes (GET): per-branch MRR, student counts, outstanding balances for every center in
  the org (:70-151).

### 3. `branches/route.ts` - MONEY-adjacent (creates a center) - drift `[verified]`
- POST (:56) creates a new center with billing fields; checks `role === 'owner'` (:83); lock
  gate (:65). GET (:167) lists org branches.
- Misses: **no CSRF** on the center-creating POST (grep: no `validateCSRFRequest`).

### 4. `admin/overview/route.ts` - MONEY (finance aggregate) - mixed admin, drift `[verified]`
- Checks: a cookie `getSession` branch that reconstructs `internalRole` by hand and splits
  raw `process.env.SUPER_ADMIN_PHONES` inline (:57-67), using
  `session.user.phone ?? userRecord.phone`; falls back to hardened `getAdminContext` on the
  Bearer path. Prefers the auth phone (good) but falls back to `users.phone`.
- Exposes (GET): platform-wide center finance aggregate (names, phones, plans, prices, MRR).

### 5. `admin/centers/route.ts` - MONEY + PII - mixed admin `[enumerated, spot-checked]`
- Base auth is standard `getAdminContext` (:237), but mutation authorization goes through
  inline `isSuperAdmin(phone)` reading raw `SUPER_ADMIN_PHONES` (:25-28) with
  `userRecord.phone` (:415, :524, :617). CSRF present.
- Exposes: create center, create/update invoice, `record_payment`, blacklist.

### 6. `billing/initiate-payment/route.ts` - MONEY (Paymob charge) - DELIBERATE, well-guarded `[verified]`
- Checks: `getUserContext` Bearer -> `getUser` -> `users`; `role !== 'owner'` -> 403 (:56);
  **CSRF present** (:69, fail-closed); deliberately NOT gated by `centerAccessGateResponse`
  (documented :60-64: a locked owner is funneled here to pay). This is the explicitly-flagged
  route; it is a correct, intentional exception (functionally `requireOwnerAdminCenter({allowSuspended:true})` + owner check). Not a defect; listed for completeness.

---

## TIER 2 - hand-rolled AND touches STUDENT / PARENT (minors') data

### 7. `students/at-risk/route.ts` - STUDENT/PARENT PII - drift, lock-remediated `[verified]`
- `getContext` Bearer -> `getUser` -> `users` center_id; lock gate (:110-111); scoped to the
  caller's own center. No teacher handling; `.single()` can throw. Exposes at-risk student
  names, `student_number`, parent_phone, balances (:245-257). GET.

### 8. `onboarding/first-student/route.ts` - creates STUDENT (minor) - drift `[verified]`
- `getUserCenterContext` Bearer -> `getUser` -> `users` center_id; `can_manage_students`
  best-effort; lock + guardian-consent gates. **No CSRF** on the student INSERT (grep: none).
  POST.

### 9. `whatsapp/send-balance-reminder/route.ts` - STUDENT/PARENT PII + outbound - drift `[enumerated, spot-checked]`
- `getUserContext` Bearer -> `getUser` -> `users` center_id; lock gate. **No permission check**
  (any center user triggers it), **no CSRF**. Reads student names/phones and sends WhatsApp
  templates to parents. POST.

---

## TIER 3 - hand-rolled admin (non-money control / PII) `[enumerated]`

- `admin/pending-signups/route.ts` GET (:8-83): cookie `getSession` OR Bearer, then raw
  `SUPER_ADMIN_PHONES` inline using `users.phone` (:67-71). POST/DELETE correctly use
  `getAdminContext` + `requireAdminRole(['super_admin'])` - only the GET is a finding. Exposes
  pending-signup owner names/phones.
- `admin/centers/[id]/route.ts`: GET/PATCH/DELETE use standard `getAdminContext` +
  `fetchAdminAccessFlags`; PATCH additionally uses inline cookie `getUser` only to attribute
  the audit actor (:353), not as the primary gate. Borderline - lower concern; touches
  invoices/payments/blacklist.

## TIER 4 - self-scoped / bootstrap (low risk, mostly deliberate) `[enumerated]`
`me` (own data, must render on lock screen - deliberate), `user/locale` (own locale,
documented lock exemption, no CSRF), `csrf-token` (bootstrap), `benchmarks` (validated
membership, read-only), `realtime/subscribe` (channel-scoped, lock gate),
`whatsapp/send-welcome-test` (own phone), `auth/check-invite`, `signup/complete`,
`accept-invite/complete` (pre-users-row bootstrap - deliberate).

## Not findings (verified correct)
Public-by-design (`join/pending-enrollment` rate-limited, `join/*` OTP, `signup/*`,
`pricing*`, `demo-request`, `promo/validate`, `referral/validate`, `privacy-request`,
`status`, `health`; `onboarding/route.ts` retired -> 410). Token/secret-gated
(`parent/portal` hashed token, `referrals/calculate-rewards` timing-safe CRON_SECRET,
`whatsapp/process-onboarding-step` service-role bearer). `/api/db` proxy (own gate).

---

## Summary and ranking
- **Hand-rolled total (own authN/authZ inline): ~20** `[enumerated]` - 16 center/org + ~4
  admin. Matches the July "~12 center/org + 3 mixed admin + initiate-payment" shape.
- **Touch MONEY: 6** - `analytics/revenue`, `analytics/consolidated`, `branches`,
  `admin/overview`, `admin/centers`, `billing/initiate-payment` (deliberate).
- **Touch STUDENT/PARENT (minors') data: 5** - `analytics/revenue`, `students/at-risk`,
  `onboarding/first-student`, `whatsapp/send-balance-reminder`, `admin/centers/[id]` (reads
  roster).
- **Deliberate exceptions (not defects): ~8** - `billing/initiate-payment`, `user/locale`,
  `me`, `csrf-token`, `auth/check-invite`, `signup/complete`, `accept-invite/complete`, plus
  public `join/pending-enrollment`.
- **Drift (predates the gates): ~12** - the analytics / students / branches / benchmarks /
  realtime / whatsapp center routes + the ~4 admin routes.

### The one substantive cross-cutting gap
Beyond "it is hand-rolled," the real pattern worth fixing is **super-admin authority derived
from `public.users.phone`** (centre-tenant-writable) rather than the auth-email-derived phone
the standard gates use: `analytics/revenue`, `admin/overview`, `admin/pending-signups`,
`admin/centers`. Practical severity is lowered because `users.phone` writes are blocked at the
`/api/db` proxy, but it is the exact source of a prior privilege-escalation P0 and should be
normalized to the hardened phone source.

### Missing CSRF on mutations (independent of the auth pattern)
`branches` POST, `onboarding/first-student` POST, `whatsapp/send-balance-reminder` POST.

### Migration cost / risk (for Eyad to sequence; NOT done here)
- **Safe** (single-center, map cleanly onto `requireCenterAuth` / `requireOwnerAdminCenter`):
  `students/at-risk`, `onboarding/first-student`, `whatsapp/send-balance-reminder`,
  `whatsapp/send-welcome-test`, `benchmarks`, `realtime/subscribe`, `user/locale`, `me`,
  `csrf-token`.
- **Medium** (need org fan-out / member scoping preserved): `analytics/consolidated`,
  `branches`.
- **Risky - each deserves its own PR** (custom super-admin `?center_id=` pivot, dual
  cookie+Bearer auth, audit attribution, or must stay lock-reachable): `analytics/revenue`,
  `admin/overview`, `admin/centers`, `admin/centers/[id]`, and `billing/initiate-payment`
  (would need `allowSuspended:true` to preserve the intentional lock exemption).

Rewriting an auth path is not a cleanup task; none of the above was migrated in this PR.
