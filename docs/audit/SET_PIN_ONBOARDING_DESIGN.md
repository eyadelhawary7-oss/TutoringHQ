# Set-PIN onboarding (Option B) — design note

> POINT-IN-TIME DESIGN NOTE (2026-05-23). Re-synced 2026-07-18. This design SHIPPED: `src/app/[locale]/set-pin/page.tsx` and `SetPinClient.tsx` exist in the tree (verified 2026-07-18). Two current-state corrections since this note was written (verified live 2026-07-18): (1) `public.users.pin_code` NO LONGER EXISTS — it was dropped by migration `20260701150506_drop_pin_code`. Every reference below to `users.pin_code` (the NULL gate, the bcrypt mirror write) is stale schema; the live credential is the Supabase Auth password and `users.pin_set_at` is the "has set a PIN" marker. (2) The Set-PIN link URLs have been corrected from the retired `centerhq.app` to the live product domain `tutoringhq.app`; the `@centerhq.local` auth-email suffix intentionally stays CenterHQ, and customer-facing brand copy should read TutoringHQ (the sample WhatsApp bodies still say "CenterHQ").

**Status:** DESIGN ONLY. No code in this change.
**Date:** 2026-05-23.
**Author:** automated analysis, pending owner review.
**Scope:** replace the broken auto-approve PIN delivery in `src/lib/signupPaymobAutoApprove.ts` (lines 399-407) with a "set your own PIN on first login" flow. The owner is redirected, after Paymob payment approval at self-serve owner signup, to a Set-PIN page and chooses their own PIN. No PIN value is ever transmitted to the owner over WhatsApp / SMS / email on the happy path.

This note is to be reviewed before any implementation. The two blocking review points are **Section 1 (trust anchor)** and **Section 5 (login lockout dependency)**.

---

## 0. Why this exists (recap of the broken behavior)

`signupPaymobAutoApprove.ts:399` mints a `Math.floor(100000 + Math.random() * 900000).toString()` PIN, bcrypts it into `public.users.pin_code`, sets it as the Supabase Auth password (`supabase.auth.admin.createUser({ password: pin })`), then calls `sendWelcomeTemplate(...)` with parameters `[center.name, PLATFORM_URL, center.phone]`. The PIN itself is never in those parameters, never logged to the owner, never put on screen. Confirmed RED in `docs/audit/WHATSAPP_LAUNCH_READINESS.md` Section 1.

The result on production right now: an auto-approved owner finishes Paymob, lands somewhere with no credential, taps "Forgot PIN" on the login page, and the reset flow itself is gated on the Meta-unapproved `chq_pin_delivery` template. Onboarding silently breaks.

Option B (this design): the owner sets their own PIN on a dedicated `/set-pin` page after payment. The happy path needs no Meta template at all. The cross-device fallback uses a Set-PIN **link** delivered via WhatsApp (see Section 7).

---

## 1. Trust anchor (CRITICAL — review this first)

The authority to set the initial PIN MUST be minted only AFTER the HMAC-verified Paymob webhook (`/api/paymob/webhook`, confirmed canonical at `src/app/api/paymob/webhook/route.ts:227-326`, HMAC validated against `PAYMOB_HMAC_SECRET`) confirms payment. The Paymob browser redirect / success-URL is user-controlled and is NOT proof of payment; nothing in this design grants set-PIN authority on the redirect alone.

There are two paths to consider, the in-session happy path and the cross-device / closed-tab fallback. Both share the same authority token, called from here on `pin_setup_token` (a short-TTL, single-use, hashed-at-rest, bound-to-one-user-id token; structure in Section 2).

### 1a. In-session happy path

The owner returns from Paymob in the same browser they signed up in. Two facts must be true before the Set-PIN page lets them set a PIN:

1. **Same-browser proof.** During `POST /api/signup` (before redirecting the user to Paymob), the server sets a signed, httpOnly, SameSite=Lax cookie called `chq_signup_session` on the response. Payload (signed with `CSRF_SECRET` reused or a new `SIGNUP_SESSION_SECRET` env var — recommend the latter for clean separation): `{ centerId, signupSessionId, expiresAt }`. TTL **30 minutes** (the entire Paymob window). The signed cookie is the browser-side proof that this particular browser is the one that initiated this particular signup; it carries no authorization on its own.

2. **Webhook-confirmed payment.** On the Set-PIN page (`/[locale]/set-pin`), a server component reads the cookie, validates the signature, then calls `getSupabaseAdmin()` to check that the matching `centers` row is in a webhook-finalized state. The state the design relies on:
   - `centers.status === 'active'` AND `centers.approved_at IS NOT NULL` (auto-approve happy path), OR
   - `centers.status === 'paid_pending_activation'` (auto-approve paused or pricing-invalid; the owner has paid but admin still has to flip the switch — see Section 6 edge case "intake paused"), OR
   - `centers.billing_status === 'paid'` AND the matching `pin_setup_tokens` row was minted by the webhook.

   No code path may rely on the redirect URL having been visited; the cookie + the webhook-set DB state together are the proof.

If both facts are true, the server issues a `pin_setup_token` row (Section 2), passes the **plaintext** token to the client component via the page's server-side render exactly once, and the client posts it to `/api/auth/set-initial-pin` (Section 4). The token never appears in the URL.

### 1b. Cross-device / closed-tab fallback

The owner closed the tab on the Paymob iframe, paid on a different phone, or cleared cookies. The product principle is "no founder intervention," so this must be self-serve.

Mechanism: a public POST `/api/auth/request-pin-setup-link` route. Input: `{ phone }`. Behavior:
- Rate-limit per phone (3 requests / 15 min, modeled on `resetPinPhoneRatelimit` at `src/lib/rateLimitCore.ts:77-84`).
- Always return `{ success: true }` (anti-enumeration; matches existing `/api/auth/reset-pin` behavior at `src/app/api/auth/reset-pin/route.ts:104`).
- Server-side: look up the owner user by phone, confirm `users.pin_code IS NULL` (i.e. the owner has not yet set a PIN — see Section 3 for why this column is the gate), confirm the center is in a paid+activated state. If all true, mint a new `pin_setup_token` row and send a Set-PIN LINK via WhatsApp (Section 7).

The link format: `https://tutoringhq.app/{locale}/set-pin?t=<plaintext_token>`. The plaintext token is **never** stored server-side; only its SHA-256 hash lives in `pin_setup_tokens`. When the owner opens the link, the Set-PIN page (server component) hashes the URL `t` parameter and looks it up.

A token from this fallback is single-use, short-TTL (Section 2), bound to exactly one user_id, and does not grant any authority until the owner submits a valid PIN to `/api/auth/set-initial-pin`.

### Explicit non-grants

- **Visiting the Paymob redirect alone grants nothing.** The `/set-pin` page returns a generic "we couldn't verify your signup, please request a Set-PIN link" view if cookie or DB state is missing.
- **Knowing the centerId or phone alone grants nothing.** The token table is the gate.
- **The Set-PIN page UI is decorative without a valid token in scope.** All authority lives in `pin_setup_tokens`.

---

## 2. Token lifecycle

### 2.1. Why a DB table, not a signed token

JWT-style signed tokens (HMAC over a payload) are tempting because they need no migration, but they are NOT revocable mid-life and NOT trivially single-use. We need:
- Server-authoritative single-use (mark `used_at` atomically on first success).
- Cheap re-issue without invalidating in-flight finalizers (the fallback can mint a new token even while a previous one is alive; the older one stays valid until TTL or use).
- Audit trail (when issued, by which source, when used, from which IP).
- Atomic invalidation when the user finishes setting a PIN.

A DB row with a hashed token is the right shape. Recommend a new table.

### 2.2. Proposed schema (do not write the migration here)

```
public.pin_setup_tokens
  id                uuid primary key default gen_random_uuid()
  user_id           uuid not null references public.users(id) on delete cascade
  token_hash        text not null                              -- sha256(plaintext_token), hex
  source            text not null                              -- 'webhook_paymob' | 'fallback_link'
  issued_at         timestamptz not null default now()
  expires_at        timestamptz not null
  used_at           timestamptz null
  used_ip           text null
  unique (token_hash)
  index (user_id) where used_at is null
```

The plaintext token is a 256-bit value generated with `crypto.getRandomValues(new Uint8Array(32))`, base64url-encoded. The plaintext appears exactly twice in the system: once in the response of the issuing path (server -> client component on `/set-pin` for the happy path, or in the WhatsApp link body for the fallback), and once in the `/api/auth/set-initial-pin` request body when the owner submits the form.

**Rule 146 compliance:** the migration must be applied via `supabase db push` and then **verified by querying the catalog** (`information_schema.tables`, `pg_indexes`), NOT by reading `supabase_migrations.schema_migrations`. The table references `public.users` (foundation), so it is additive and safe for production push.

### 2.3. TTL

- **Happy path token TTL: 15 minutes.** The owner is on the page seconds after the webhook fires. 15 min covers a slow phone returning from Paymob and a network hiccup. Anything longer is unnecessary surface area for a token that grants the entire login credential.
- **Fallback link TTL: 30 minutes.** Owner opens WhatsApp, sees the link, taps; sometimes this takes a few minutes. Still short.

Both TTLs are short by design. If the owner times out, they request a fresh link (`/api/auth/request-pin-setup-link`).

### 2.4. Single-use enforcement

`UPDATE pin_setup_tokens SET used_at = now(), used_ip = $1 WHERE token_hash = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id` — a row-conditional update; the route only proceeds if `rowCount === 1`. This is the atomic claim. Two concurrent requests with the same token: exactly one wins.

### 2.5. What invalidates a token

1. The owner successfully sets a PIN via `/api/auth/set-initial-pin` (the row's own `used_at` is set, and any OTHER outstanding rows for the same `user_id` are also marked used in the same transaction — see Section 6 "token replay").
2. The token's `expires_at` passes.
3. The user's `users.pin_code` becomes non-null by any other means (defensive: the set-initial-pin route refuses to operate on a user that already has a `pin_code`, see Section 4).

There is intentionally **no manual "revoke" endpoint** in v1. The TTLs are short enough that the founder will not be paged about a leaked token; the leak is bounded.

### 2.6. Re-issue for the fallback

`/api/auth/request-pin-setup-link` always mints a fresh row. It does NOT delete or invalidate older rows; the older rows simply age out. This is intentional — invalidating older rows would let an attacker who knows the phone DoS the legitimate owner by spamming the fallback endpoint mid-setup. Multiple alive tokens for the same user is acceptable because each is bound to that user_id and the first successful set wins (Section 6).

---

## 3. Account state and the redirect-vs-webhook race

### 3.1. What signup must write as the auth password

Current `signupPaymobAutoApprove.ts:403-407` sets the auth password to the generated PIN. In Option B, we never have a PIN at that moment. The proposal:

**The auth password is a 256-bit random hex string generated with `crypto.getRandomValues`. The value is never told to anyone (not the owner, not logs, not Sentry). It is overwritten by `/api/auth/set-initial-pin` when the owner chooses their PIN.**

This is the standard "unguessable placeholder password" pattern. Until the owner sets their PIN, the account cannot be logged into via `signInWithPassword`. The owner sees this as: signup completes -> redirected to `/set-pin` -> picks a PIN -> auto-logged in to the dashboard. The placeholder is invisible.

Mirror change in `public.users`: insert with `pin_code = NULL` (not the bcrypt of a random value; explicit NULL is the "has not set a PIN yet" signal, used by `/api/auth/request-pin-setup-link` to decide whether the fallback applies). This requires verifying that `users.pin_code` is nullable in the DB (Rule 146 catalog check; the current schema appears to permit NULL based on accept-invite seeding patterns, but this must be confirmed before code lands).

### 3.2. Webhook vs redirect race

The owner can land on `/set-pin` before the Paymob webhook fires. The Paymob iframe redirect can race the server-to-server webhook by a few seconds in practice; in rare cases by longer.

Handling: the `/set-pin` page is built as a finalizing/polling shell.

- **Server component render path:** if the `chq_signup_session` cookie validates AND the matching `centers` row is already in the paid+activated state AND a `pin_setup_token` already exists for the owner user (webhook minted it), the page renders the Set-PIN form directly with the token in scope.
- **Pending state:** if the cookie validates but the center is still `pending_payment` / no owner user yet, the page renders a small "finalizing your subscription..." view with a client-side poll against a new tiny route `GET /api/signup/pin-setup-readiness` (input: signup session id, output: `{ ready: boolean, token?: string }`). Poll interval 2 s, give up after 30 s with a friendly retry-and-fallback view.
- **Cookie invalid / missing:** render the "request a Set-PIN link" view directly (the fallback flow). This is also what the owner sees on a different device.

The poll route is rate-limited (per signup session, e.g. 30 requests / 60 s, soft cap to stop runaway loops). It is NOT a side channel that grants authority; it only echoes back state that the webhook has already established.

---

## 4. The Set-PIN route and page

### 4.1. `POST /api/auth/set-initial-pin`

Inputs (JSON body, size-limited via `parseBodyWithLimit` as elsewhere): `{ token: string, pin: string, pinConfirm: string }`.

Order of operations:

1. **CSRF check** via `validateCSRFRequest` (same pattern as other mutation routes, see CLAUDE.md "CSRF on mutations"). The Set-PIN page is server-rendered and will inject the CSRF token into the form.
2. **Rate limit** per IP and per token-hash prefix, mirroring `/api/auth/change-pin` (`src/app/api/auth/change-pin/route.ts:13-42`): 5 attempts / 15 min. This protects against an attacker who has guessed/leaked a token but is hammering the route trying to also brute-force around the weak-PIN check (low risk, but cheap protection).
3. **Validate format:** `/^\d{6}$/` on both `pin` and `pinConfirm`.
4. **Validate match:** `pin === pinConfirm` (defense in depth; the client also enforces this, but server is authoritative).
5. **Validate strength:** `isWeakPin(pin)` from `src/lib/weakPins.ts:50`. Reject with `{ error: 'weak_pin' }` and a localized message. **This is the Rule 139 arming point** (see Section 8 for the rule-count update).
6. **Atomic token claim:** the single-use `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING user_id` described in Section 2.4. If `rowCount === 0`, return `{ error: 'token_invalid_or_used' }` (generic; do not differentiate expired vs used vs not-found, to avoid timing oracles).
7. **Verify user state:** load `public.users.pin_code` for the returned `user_id`. If non-null, the user has already set a PIN by another path; refuse with `{ error: 'pin_already_set' }` and DO NOT clear the existing PIN. (Section 6 edge case "already has a PIN.")
8. **Set the credential:**
   - `supabase.auth.admin.updateUserById(user_id, { password: pin })` — server-authoritative, lazy-init via `getSupabaseAdmin()` (ADR 018 compliance).
   - `bcrypt.hash(pin, 10)` and `UPDATE public.users SET pin_code = $1 WHERE id = $2`, keeping `pin_code` in sync with the change-pin pattern (`src/app/api/auth/change-pin/route.ts:109-117`).
9. **Invalidate sibling tokens:** in the same transaction as step 8, `UPDATE pin_setup_tokens SET used_at = now() WHERE user_id = $userId AND used_at IS NULL` — defensive against an attacker holding a sibling token from a leaked fallback link.
10. **Audit log:** insert into `audit_log` with `action = 'set_initial_pin'`, `user_id`, `center_id`, source (`'webhook'` or `'fallback_link'`), and timestamp. Same shape as `/api/auth/change-pin` audit entry.
11. **Auto-login:** the server cannot mint a Supabase session directly for a different client without the password (and we have just set it). The simplest and safest pattern: return `{ success: true, email: '<phoneDigits>@centerhq.local' }` and have the client immediately call `supabase.auth.signInWithPassword({ email, password: pin })` once. The PIN never leaves the page's React state; the client clears it after the sign-in call. Alternative: server uses the Auth admin API to generate a magic-link / OTP and the client consumes it — heavier, more moving parts, not recommended.
12. **Sentry on any failure** (ADR 023): every catch in this route calls `Sentry.captureException` before returning. There are no silent failures. In particular, if the Supabase admin `updateUserById` succeeds but the `pin_code` mirror update fails, we log to Sentry and still return success (the user CAN log in; the mirror is non-authoritative — same as change-pin's comment at `route.ts:115-117`).

### 4.2. `/[locale]/set-pin/page.tsx`

Server component. Reads cookies, validates, decides which view to render: Set-PIN form, finalizing-poll, or request-fallback-link.

Decided UX (per the brief, design around these — not re-litigated):

- **6-digit numeric PIN.** Both fields enforce `inputMode="numeric"` and a `/^\d$/` per-cell filter.
- **Double-entry, two fields.** Both must match; the submit button is disabled until they do (client check), and the server re-checks (Section 4.1 step 4).
- **6-box OTP-style input.** RTL-correct: cell DOM order is logical (cell 1 is the first PIN digit), but visual placement uses CSS logical `start`/`end` and `direction: ltr` only on the digits themselves so that 6 reads as "1 2 3 4 5 6" in both AR and EN. Auto-advance to next cell on keypress. Backspace moves to previous cell. Paste of a 6-digit string fills all cells. **Rule 127 compliance:** layout uses `margin-inline-start`, `padding-inline-end`, `inset-inline-end` only; no `left`/`right`.
- **Show-by-default with hide/show toggle.** This is a new account; there is no shoulder-surfer threat model on a freshly-signed-up owner's own phone, and the doubled-confirm field is the main mis-entry hazard. The toggle is wired to both cells simultaneously.
- **Server-side `isWeakPin()` rejection** (Section 4.1 step 5). The page also runs the client-side check for an instant inline hint, but the server is authoritative.
- **On success:** the page calls `signInWithPassword` (Section 4.1 step 11), then `router.replace('/dashboard')` (or `/onboarding` if `result.needsOnboarding`, matching login page's choice at `src/app/[locale]/login/page.tsx:164`).

**Rule 142:** all strings are clean ASCII / Arabic; no em dashes anywhere. The Arabic comma is U+060C `،` where a comma is needed. Sample copy:

- AR header: `اختر رمزك السري`
- AR helper: `ادخل رمزاً مكوناً من 6 أرقام، ثم أعد إدخاله للتأكيد.`
- AR weak-PIN error: `هذا الرمز ضعيف ومتوقع. اختر رمزاً أقل وضوحاً.`
- AR mismatch error: `الرمزان غير متطابقين.`
- EN header: `Set your PIN`
- EN helper: `Enter a 6-digit PIN, then enter it again to confirm.`
- EN weak-PIN error: `This PIN is too common. Choose a less obvious 6-digit code.`
- EN mismatch error: `Your two PINs do not match.`

**i18n parity (~2842 keys, AR + EN):** add to both `messages/ar.json` and `messages/en.json` under a new namespace `setPin.*` (suggested keys: `setPin.header`, `setPin.helper`, `setPin.field1`, `setPin.field2`, `setPin.show`, `setPin.hide`, `setPin.submit`, `setPin.submitting`, `setPin.error.weak`, `setPin.error.mismatch`, `setPin.error.invalidToken`, `setPin.error.alreadySet`, `setPin.error.serverError`, `setPin.fallback.header`, `setPin.fallback.helper`, `setPin.fallback.phoneLabel`, `setPin.fallback.submit`, `setPin.fallback.sent`, `setPin.finalizing.header`, `setPin.finalizing.helper`). `scripts/check-i18n.ts` will block the build if either locale is missing any of these keys; both files must be updated in the same commit as the page.

### 4.3. CSRF and rate-limiting parity

- CSRF: `validateCSRFRequest` on the route, same as other mutation endpoints. The `/set-pin` server component pulls a CSRF token from the existing cookie + secret machinery (CLAUDE.md "CSRF_SECRET gates `src/lib/csrf.ts`").
- Rate-limit: 5 attempts / 15 min per IP, mirroring `change-pin`. Also 5 / 15 min per token-hash (an attacker shouldn't get to retry a single token 1000 times even if they evade IP rotation).

### 4.4. Routes NOT touched (blast radius confirmation)

- `/api/auth/change-pin` — the settings old-PIN-to-new-PIN flow is untouched. Continues to require `currentPin`, continues to call `isWeakPin(newPin)`, continues to require `requireCenterAuth`. The new flow does not piggyback on it.
- `/api/auth/reset-pin` + `/api/auth/verify-pin-reset` — the forgot-PIN flow is untouched. It also doesn't touch `pin_setup_tokens`.
- `/api/accept-invite/complete` — the assistant invite-acceptance PIN flow is untouched.
- `/api/signup/complete` — note that this is the *legacy* signup-complete route used in a different flow (it sets a PIN server-side, like the broken auto-approve). The design here does not modify it; a follow-up may want to migrate it to set-PIN-on-first-login too, but that is out of scope for this design.

---

## 5. Login lockout dependency (CRITICAL — review before approving the PIN-strength model)

The 6-digit PIN is the entire credential. Phone + PIN, no email, no 2FA. That is 1,000,000 combinations. The PIN-strength model assumes that an attacker cannot exhaust that space against a known phone number; the brute-force budget per phone has to be tiny (think: tens of attempts before lockout).

### 5.1. The finding

**Failed-login lockout is NOT enforced per phone number.** Quoting the rate-limit site at `src/app/api/login/route.ts:23-31`:

```
const ip = getClientIp(request);
const normalizedForLoginKey = phoneRaw ? normalizePhone(phoneRaw) : '';
const loginKey =
  normalizedForLoginKey.length > 0 ? `login:${normalizedForLoginKey}` : `login:${ip}`;
const loginWindowSec = 900;
const { success } = await rateLimit(loginKey, 5, loginWindowSec);
if (!success) {
  return rateLimitExceededResponse(loginWindowSec);
}
```

That `rateLimit` call uses the **phone** as the key — so far so good. But this route ONLY returns the email (`{phoneDigits}@centerhq.local`). It does NOT verify the PIN. The actual PIN verification happens client-side in `src/app/[locale]/login/page.tsx:113-116`:

```
const { data, error: loginError } = await supabase.auth.signInWithPassword({
  email: lookupData.email,
  password: pin,
});
```

That call goes directly from the browser to Supabase's `auth/v1/token?grant_type=password` endpoint, bypassing the Next.js server entirely. The CenterHQ application server never sees the PIN attempt; the per-phone rate limit at `/api/login` is a counter on the *lookup*, not on the *attempt*.

**An attacker can compute the email format themselves** (`${phoneDigits}@centerhq.local` is documented in the codebase and in `docs/audit/WHATSAPP_LAUNCH_READINESS.md` line 50). They skip `/api/login` entirely, hit Supabase Auth from any IP with rotating sessions, and try PINs. The only brake is Supabase Auth's own per-IP rate limiting (default Supabase password grant limiter: typically 30 / hour per IP per project, depending on plan), which is trivially evaded by IP rotation across a residential proxy network. A 1,000,000-key space with no per-account lockout falls in well under a day at modest QPS.

### 5.2. Verdict

**Per-phone lockout is absent. Per-IP rate-limiting is present only at Supabase Auth's defaults, evaded by IP rotation.** This is the dependency the entire 6-digit PIN strength model rests on. The weak-PIN denylist makes a dent in the easiest 1,000 PINs but is no substitute for a per-account attempt budget; an attacker who skips the denylist still has ~999,000 candidates.

### 5.3. Required separate fix (NOT part of this design's implementation, but blocks the same launch)

A new pre-Supabase verification shim. Concretely:

- **Stop calling `signInWithPassword` from the browser.** Instead, introduce `POST /api/auth/login-verify` that takes `{ phone, pin }`. The route enforces a per-phone failure counter (e.g. 10 failures / 15 min, lockout 30 min) backed by Upstash Redis (the existing `rateLimit` helper is suitable). On success, it calls `signInWithPassword` server-side with `persistSession: false`, then returns the session tokens to the client which calls `supabase.auth.setSession(...)`.
- The route increments the per-phone failure counter on every Supabase password-grant failure, decrements (or resets) on success, and locks out at the threshold by short-circuiting with a 429 before even calling Supabase.

Without this fix, a 6-digit PIN as sole credential is unsafe regardless of the weak-PIN denylist. **Flagging this as a SEPARATE required fix** to be tracked alongside the Set-PIN work in the launch checklist.

---

## 6. Edge cases

| # | Case | Handling |
|---|------|----------|
| 1 | Owner closes the browser before submitting a PIN. | The `chq_signup_session` cookie expires in 30 min; the `pin_setup_token` row expires in 15 min. The owner reopens tutoringhq.app, sees the login page, taps "نسيت رمز" / "forgot PIN" -> a small adjustment to that page: if the phone has `users.pin_code IS NULL`, the page sends the owner down the **fallback** path (request-pin-setup-link), not the reset path. Anti-enumeration applies: response is identical regardless. |
| 2 | Token replay / reuse after success. | The `UPDATE ... WHERE used_at IS NULL` atomic claim ensures the first successful submit sets `used_at`. The second request gets `rowCount === 0` and `{ error: 'token_invalid_or_used' }`. Sibling tokens for the same user are also marked used in the same transaction (Section 4.1 step 9). |
| 3 | Token expired. | Same generic `token_invalid_or_used` response. No info leak. Owner is shown a "request a new Set-PIN link" CTA. |
| 4 | An account that ALREADY has a PIN hits the Set-PIN flow. | Refused at Section 4.1 step 7 with `{ error: 'pin_already_set' }`. The existing PIN is NOT cleared. Resetting an existing PIN remains the job of `change-pin` (with current PIN) or `reset-pin` (with OTP). |
| 5 | Double payment / webhook replay. | Paymob webhook idempotency already guards with `webhook_inbox.idempotency_key = 'paymob:<transactionId>'` (`src/app/api/paymob/webhook/route.ts:276-298`) and `combined_payment_sessions` `.eq('status','pending')` upserts (`src/lib/signupPaymobAutoApprove.ts:583-593`). The Set-PIN token issuance happens INSIDE that idempotent path; the issuing helper must `INSERT ... ON CONFLICT DO NOTHING` keyed on `(user_id, source='webhook_paymob') WHERE used_at IS NULL` (or simpler: just issue and accept that a replay creates a second alive token, both bound to the same user, first-use-wins). The conservative choice: a partial unique index on `(user_id) WHERE source = 'webhook_paymob' AND used_at IS NULL` so replays are no-ops. |
| 6 | Weak PIN rejected server-side. | Returns `{ error: 'weak_pin', message: ... }` at 400. Token is NOT consumed; the owner retries with a stronger PIN. Counts toward the per-IP 5/15min rate limit. |
| 7 | Anti-enumeration on the fallback. | `/api/auth/request-pin-setup-link` always returns `{ success: true }` regardless of whether the phone is registered, regardless of whether the user has already set a PIN, regardless of WhatsApp send outcome — matching the existing `/api/auth/reset-pin` pattern verbatim. No timing oracle: the route does a constant-ish amount of work in both branches (Sentry breadcrumb for the no-op branch, real send for the success branch). |
| 8 | PIN mismatch on double-entry. | Client disables submit while the two cells differ. If the request still reaches the server with mismatched values, server returns `{ error: 'mismatch' }` (Section 4.1 step 4). |
| 9 | Owner submits, network drops mid-call. | The atomic-claim UPDATE either committed or it did not. If it committed, the PIN is set and the next sign-in attempt succeeds; the client retry sees `pin_already_set`. If it did not commit, the token is still alive and retry works. Idempotent from the owner's perspective. |
| 10 | An attacker who somehow guesses a token. | Token is 256 bits, base64url. Guess space is 2^256. Infeasible. If the attacker steals a token via XSS or leaked log, they get one PIN-set opportunity for one specific user_id, expiring within 30 min, single-use. The weak-PIN denylist + the per-IP 5/15min rate-limit on the route bound the damage; Sentry sees the unusual IP if used_ip differs from the typical signup IP. |
| 11 | Set-initial-pin clashes with an owner already mid-`change-pin`. | The user.id is the same actor; `change-pin` requires `currentPin` (which is the random placeholder password, unknown to anyone). Effectively impossible to race; if it did, `set-initial-pin` step 7 sees `pin_code` is non-null and refuses. |
| 12 | Auto-approve disabled (`pause_new_signups=true`). | The center is set to `paid_pending_activation`. The webhook DOES NOT mint a `pin_setup_token` for this case (no owner user exists yet). The owner sees a "your account is being activated, we will message you when it's ready" view on `/set-pin`. An admin's later flip to `active` triggers a separate code path that issues a token via the fallback link route (manual admin tool — note that this is the ONE place where the no-manual-support principle bends, because the admin already had to act to activate the center). |
| 13 | Existing `chq_pin_delivery` flow concurrent with Set-PIN. | The fallback flow uses the same Meta template (see Section 7). `/api/auth/reset-pin` already debounces via `resetPinPhoneRatelimit` (3/15min). The new `/api/auth/request-pin-setup-link` adds its own 3/15min budget; a malicious actor abusing both gets 6/15min per phone, still cheap. Acceptable. |

---

## 7. Fallback template

The cross-device fallback sends a Set-PIN LINK, not a PIN, via WhatsApp.

### 7.1. Template choice

**Repurpose `chq_pin_delivery`** by adjusting its Meta-registered body to carry a single URL fragment instead of (or in addition to) a 6-digit code. Concretely, the new body parameter is the URL path-and-query suffix that the owner appends to a baked-in domain, OR (simpler for Meta approval) a single full URL string. Meta UTILITY templates allow URL parameters in body text; the click is the owner tapping the rendered link.

Suggested AR body (no em dashes, U+060C):
> مرحباً، اضغط الرابط لاختيار رمزك السري لـ CenterHQ، صالح لمدة 30 دقيقة فقط، لا تشاركه مع أحد: {{1}}

Suggested EN body:
> Hi, tap the link to set your CenterHQ PIN. Valid for 30 minutes only. Do not share: {{1}}

`{{1}}` is the full Set-PIN URL `https://tutoringhq.app/{locale}/set-pin?t=<token>`.

### 7.2. Approval clock

- **Meta approval lead time: 24-48 hours** (per existing `docs/WA_TEMPLATES.md` process notes, line 91).
- The repurposed template body must be **resubmitted** to Meta for review even if `chq_pin_delivery` is already registered for the old OTP shape; Meta re-reviews any body change. Treat the resubmission as a fresh approval and budget 24-48 hours from submission.
- After approval, flip `wa_meta_templates.chq_pin_delivery.status` to `APPROVED` via `POST /api/admin/whatsapp/sync-templates` or the SQL UPDATE shown in `docs/WA_TEMPLATES.md` line 95.

### 7.3. The HAPPY PATH NEEDS NO META TEMPLATE

This is the headline launch-readiness benefit of Option B. The in-session happy path (owner returns from Paymob in the same browser) requires only the signed cookie + the webhook + the Set-PIN page. **Zero WhatsApp dependency.** Meta approval is needed only for the cross-device fallback. If Meta approval slips, the product is still launchable: signups complete, the happy-path owner sets their PIN, and the (rare) cross-device fallback degrades to "please complete signup in the same browser" until approval lands. This is a strict improvement over today's state, where every new owner is blocked on `chq_pin_delivery`.

### 7.4. Reconcile `docs/WA_TEMPLATES.md` "unwired" note

The current `docs/WA_TEMPLATES.md` line 27 states `chq_pin_delivery` is "Registered only — unwired" and line 41 says "no automated send path in app yet." That note is stale: `/api/auth/reset-pin` calls `sendPinDelivery` since the forgot-PIN flow shipped. The implementation phase should update this doc to reflect:
- `chq_pin_delivery` is wired in `/api/auth/reset-pin` (existing).
- `chq_pin_delivery` will additionally be wired in `/api/auth/request-pin-setup-link` (new) with the URL-bearing body variant.
- The "Coming soon / Notify me" tile referenced in line 14 is no longer accurate once Set-PIN ships and should be retired.

---

## 8. File-level change list and blast radius

### 8.1. Files modified

| File | What changes | Why |
|------|--------------|-----|
| `src/lib/signupPaymobAutoApprove.ts` | Lines 399-407: replace `Math.random()` PIN + `bcrypt.hash` + `auth.admin.createUser({ password: pin })` with a 256-bit random placeholder password and `pin_code: null` on the `users` insert. After the `users` insert succeeds, call a new helper `issuePinSetupToken(supabaseAdmin, { userId, source: 'webhook_paymob' })` (Section 8.2). | Removes the broken "mint a PIN and never send it" code path. |
| `src/proxy.ts` | Add `/set-pin` to a list of **explicitly-allowed-but-unauthenticated** routes (NOT to `AUTHENTICATED_ROUTE_PREFIXES`). The page authenticates itself via the cookie + token combination, not via Supabase session. Also confirm `/api/auth/set-initial-pin` and `/api/auth/request-pin-setup-link` are reachable without an auth session (they are public, like `/api/auth/reset-pin`). | The owner has no Supabase session at the moment they need to set a PIN. |
| `messages/ar.json`, `messages/en.json` | Add the `setPin.*` namespace described in Section 4.2. | i18n parity required by `scripts/check-i18n.ts`. |
| `docs/CRITICAL_RULES.md` (or wherever Rule 139 lives, per `06_docs_CRITICAL_RULES.md`) | Update Rule 139 from "All 4 PIN-setting flows" to **"All 5 PIN-setting flows"** and add the new fifth flow: `/api/auth/set-initial-pin`. | Rule 139 compliance — every PIN-setting route must enforce `isWeakPin()` and the rule must explicitly list it. |
| `docs/WA_TEMPLATES.md` | Update `chq_pin_delivery` row: flip "unwired" -> "wired in /api/auth/reset-pin and /api/auth/request-pin-setup-link"; note the body change requires Meta re-approval. | Reconciliation per Section 7.4. |
| `docs/audit/WHATSAPP_LAUNCH_READINESS.md` | Append a "Resolution" note under Section 1 pointing to the Set-PIN design and to the implementation PR when it lands. | Closes the loop on the RED finding. |

### 8.2. Files created

| File | Purpose |
|------|---------|
| `src/app/[locale]/set-pin/page.tsx` | The Set-PIN page (server + client islands). Implements the decided UX from the brief. |
| `src/app/api/auth/set-initial-pin/route.ts` | The mutation route (Section 4.1). |
| `src/app/api/auth/request-pin-setup-link/route.ts` | The fallback "send me a link" route (Section 1b). |
| `src/app/api/signup/pin-setup-readiness/route.ts` | The tiny poll endpoint for the finalizing/race shell (Section 3.2). |
| `src/lib/pinSetupTokens.ts` | Helpers: `issuePinSetupToken({ userId, source })`, `claimPinSetupToken({ plaintext })`, `invalidateSiblingTokens({ userId })`. Lazy-init Supabase admin client (ADR 018). Each error path goes through `Sentry.captureException` (ADR 023). |
| `src/lib/signupSessionCookie.ts` | Helpers to sign / verify / read the `chq_signup_session` cookie. New env var `SIGNUP_SESSION_SECRET` (or reuse `CSRF_SECRET` — design choice deferred to implementation; prefer a dedicated secret for clean rotation). |
| `supabase/migrations/<timestamp>_pin_setup_tokens.sql` | The schema in Section 2.2. Verified per Rule 146 via `information_schema.tables` and `pg_indexes`, NOT via `schema_migrations`. |

### 8.3. Blast radius (what is NOT touched)

- **`/api/auth/change-pin`** (settings flow with current-PIN re-auth): untouched.
- **`/api/auth/reset-pin`** (forgot-PIN, OTP delivery): untouched. Still uses `chq_pin_delivery` for the OTP. Note: the Meta template body change for the fallback link means we will need either a separate template or a body that works for both (a single `{{1}}` parameter the route fills with either "your code: 123456" or "your link: https://..."). Recommended: keep them on the same template with a body of just `{{1}}` so both flows pass the entire localized sentence as one parameter — Meta does not allow that style for UTILITY templates today, so the safer route is to register a NEW template name `chq_pin_setup_link` with the URL body, and leave `chq_pin_delivery` carrying the 6-digit OTP body. This adds a second Meta approval but cleanly separates concerns. **Implementation decision deferred to PR; impact on launch is the same 24-48h clock either way.**
- **`/api/auth/verify-pin-reset`** (verify OTP + set new PIN during forgot-PIN flow): untouched.
- **`/api/accept-invite/*`** (assistant invite flow): untouched.
- **Normal login** (`/api/login`, `signInWithPassword` in `login/page.tsx`): not touched by THIS design, but Section 5 flags it as a separate required fix.
- **Admin-created users** (admin tools that seed accounts): not touched. If a future admin-created user wants the Set-PIN-on-first-login experience, it can opt in by issuing a `pin_setup_token` with `source = 'admin_created'`, but that is out of scope for v1.
- **Cron jobs, billing engine, Paymob webhook idempotency machinery:** not touched.

---

## 9. Summary for review

The two blocking review points are:

- **Section 1 (trust anchor).** Does the cookie + webhook-state combination on the in-session path satisfy the "never trust the redirect URL" rule cleanly? Does the fallback link mechanism cover the cross-device case without founder intervention? These two are the gate.
- **Section 5 (login lockout dependency).** The 6-digit PIN as sole credential is only safe with per-phone lockout. Today there is none on the actual PIN verification step. This is a separate required fix that must ship alongside Set-PIN.

If both are approved, the implementation work splits into: (a) the new table + helpers + route + page + i18n keys, (b) the snip in `signupPaymobAutoApprove.ts` that stops minting the unsent PIN, (c) the Rule 139 doc bump from 4 to 5 flows, (d) the WhatsApp template (re-)submission for the fallback link, (e) the separate per-phone login lockout shim.

End of design note.
