# WhatsApp launch-readiness audit

> POINT-IN-TIME AUDIT (2026-05-23). Re-synced 2026-07-18. Webhook-registration, sync-templates, and health-check URLs below have been corrected from the retired `centerhq.app` to the live product domain `tutoringhq.app` (verified live 2026-07-18); the `@centerhq.local` auth-email suffix intentionally stays CenterHQ. Current-state note (verified 2026-07-18): the Section-1 RED finding — the auto-approve happy path minting a PIN it never delivers — has since been addressed by the set-PIN-on-first-login flow (`src/app/[locale]/set-pin/`, see `docs/audit/SET_PIN_ONBOARDING_DESIGN.md`), and `public.users.pin_code` was dropped by migration `20260701150506_drop_pin_code`, so the "bcrypt-hashed into users.pin_code" mechanics described below are stale schema (the live credential is the Supabase Auth password). `wa_sending_enabled` is true live. The env-alias and HMAC internals were not re-verified line-by-line this pass; treat them as of 2026-05-23.

**Scope:** signup/login PIN delivery, env-alias hygiene, webhook HMAC integrity, Meta template gating, launch-day env + webhook checklist.
**Date:** 2026-05-23
**Method:** read-only code audit. No code changes.

---

## Top summary

| # | Section | Finding | Verdict | Action before launch |
|---|---------|---------|---------|----------------------|
| 1 | Critical-path delivery | Meta Cloud API direct (no Twilio). **Generated signup PIN is never delivered to the user** — auto-approve creates a random PIN, sets it as the Supabase Auth password, but `sendWelcomeTemplate` does not include it. Users can only obtain a PIN via the `/forgot-password` reset flow, which depends on `chq_pin_delivery` being APPROVED. | **RED — onboarding silently breaks** | Fix delivery path: either include the PIN in `chq_welcome` body or call `sendPinDelivery(pin)` immediately after `processInvoiceSignupAfterPaymobSuccess` mints the PIN. |
| 2 | Phone-id env aliases | Three names read across the codebase, each with a different precedence. `centerNotify.ts` (PIN/welcome) reads `PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID`. `whatsapp/client.ts` throws if `WHATSAPP_PHONE_ID` unset. `health` only reads `WHATSAPP_PHONE_NUMBER_ID`. | **AMBER — alias sprawl** | Set ALL THREE to the same production phone-number-id in Vercel Prod + Preview. Standardize new code on `PHONE_NUMBER_ID`. |
| 3 | Webhook HMAC integrity | `/api/whatsapp/webhook` and `/api/whatsapp/inbound` both fail-closed on missing/invalid `x-hub-signature-256` (401) and missing `WHATSAPP_APP_SECRET` (401), using timing-safe HMAC-SHA256. Both are listed (not duplicated) in `PUBLIC_WEBHOOK_PREFIXES`. | **GREEN** | Confirm `WHATSAPP_APP_SECRET` set in Vercel before registering Meta webhooks. |
| 4 | Template gating | All template sends are gated on `wa_meta_templates.status='APPROVED'`. `chq_welcome` and `chq_pin_delivery` are mandatory critical-path templates. `chq_pin_delivery` is documented in `docs/WA_TEMPLATES.md` as "registered only — unwired", but `/api/auth/reset-pin` DOES call it. | **AMBER — submit early** | Submit `chq_welcome`, `chq_pin_delivery`, `chq_onboarding_step1`, `chq_renewal_overdue`, `chq_payment_confirmed`, `chq_payment_retry`, `chq_inactivity_alert` to Meta 48 h before launch. After approval, run `POST /api/admin/whatsapp/sync-templates` to flip DB rows to APPROVED. |
| 5 | Env + launch sequence | 7 WhatsApp env vars required (3 phone-id aliases, 2 token aliases, 1 app secret, 1 verify token plus its alias). DB flag `platform_config.wa_sending_enabled` is a global kill switch. Hard-coded Meta test phone-id `1013787185158313` short-circuits every send when matched. | **AMBER** | Follow the numbered sequence below. |

---

## Section 1 — Critical-path PIN/OTP delivery

### How a center actually gets login credentials

```
POST /api/signup
  → inserts centers row (status=pending_payment), creates Paymob iframe
        ↓ user pays
Paymob webhook → /api/paymob/webhook
  → processInvoiceSignupAfterPaymobSuccess(...)   [src/lib/signupPaymobAutoApprove.ts:252]
      • generates 6-digit PIN     [line 399]   ←  Math.random, bcrypt-hashed into users.pin_code
      • supabase.auth.admin.createUser({ password: pin })
      • inserts users row (role=owner, pin_code=hash)
      • centers.status = active
      • sendWelcomeTemplate(...)                ←  chq_welcome, params = [center.name, PLATFORM_URL, center.phone]
                                                   *** PIN is NOT in those params ***
        ↓
Owner visits /ar/login but does not know the PIN
        ↓
Owner taps "نسيت رمز" → /forgot-password
  → POST /api/auth/reset-pin                    [src/app/api/auth/reset-pin/route.ts]
      • generates new 6-digit OTP, bcrypt-hashes into pin_reset_otps
      • sendPinDelivery(phone, otp)             [src/lib/centerNotify.ts:1402]
          → POST https://graph.facebook.com/v18.0/{phoneId}/messages
            template: chq_pin_delivery, body parameter [otp]
      • route ALWAYS returns { success: true } regardless of send outcome (anti-enumeration)
        ↓ owner receives OTP on WhatsApp
POST /api/auth/verify-pin-reset → sets new PIN + Supabase Auth password
        ↓
supabase.auth.signInWithPassword({ email: '{phoneDigits}@centerhq.local', password: pin })
```

### Send mechanics

- **Library:** `src/lib/centerNotify.ts` → `sendPinDelivery` (line 1402) → `postWhatsappTemplate` (line 125).
- **Endpoint:** `POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages`.
- **Template:** `chq_pin_delivery`, language `ar_EG`, single body parameter (the 6-digit code).
- **Twilio:** Not used. No `twilio` import anywhere in `src/`. All WhatsApp traffic is Meta Graph direct (`graph.facebook.com/v18.0` and `v19.0`).

### What blocks the send

`sendPinDelivery` quietly returns `false` (and the route still returns `success: true`) in any of these cases:

1. `shouldSkipWaForTestPhoneId()` is true — phone-id env is missing OR equals `'1013787185158313'` (hard-coded Meta sandbox ID in `centerNotify.ts:59`).
2. `wa_meta_templates.chq_pin_delivery.status !== 'APPROVED'`.
3. `platform_config.wa_sending_enabled === false`.
4. `PHONE_NUMBER_ID` / `WHATSAPP_PHONE_ID` or `WHATSAPP_TOKEN` missing → `postWhatsappTemplate` logs warning and returns `false`.
5. Graph API non-200 → `false`, error logged to console only.

### Failure mode on signup

- **Hard block?** Yes. The owner cannot log in until a PIN is delivered. There is no SMS fallback, no email fallback, no on-screen reveal of the generated PIN.
- **Retry?** No retry queue. Each `/forgot-password` submission generates a fresh OTP (rate-limited per phone via Upstash `resetPinPhoneRatelimit`).
- **Visible failure?** No. `reset-pin` always returns `{ success: true }` (intentional, prevents phone enumeration). The owner sees "we sent you a message" with no way to know it never went out.

> **Launch-blocker:** the auto-approve happy path mints a PIN that is never told to the user. Either (a) extend the `chq_welcome` Meta template body to include `{{4}}` = PIN and pass `pin` from `signupPaymobAutoApprove.ts` into `sendWelcomeTemplate`, or (b) call `sendPinDelivery(normalizedPhone, pin)` immediately after `bcrypt.hash(pin, 10)` at `signupPaymobAutoApprove.ts:400`, or (c) ship a copy change on the post-payment success page instructing owners to use "Forgot PIN" on first login. Option (b) is the smallest diff.

---

## Section 2 — The three phone-number-id env aliases

### Read sites (read-order shown verbatim)

| File:line | Precedence | Behavior when none set |
|-----------|-----------|------------------------|
| `src/lib/centerNotify.ts:51` (PIN, welcome, payments, dormancy, onboarding 2-4, team, parents, churn) | `process.env.PHONE_NUMBER_ID \|\| process.env.WHATSAPP_PHONE_ID` | `postWhatsappTemplate` returns false silently |
| `src/lib/signupPaymobAutoApprove.ts:30` (post-payment WA) | `PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID` | Skipped, console warn |
| `src/lib/whatsapp/client.ts:16` (`sendTemplateMessage` for /webhook keyword replies, onboarding flows 1) | `PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID` | Skip via `shouldSkipWaForTestPhoneId` |
| `src/lib/whatsapp/client.ts:35` (`getConfig`) | **`WHATSAPP_PHONE_ID` only** | **Throws** "WHATSAPP_PHONE_ID and WHATSAPP_TOKEN must be set" |
| `src/lib/vendorNotify.ts:13`, `:107` | `PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID` (then `PHONE_NUMBER_ID` only at :107) | Warn, no send |
| `src/lib/googleDriveBackup.ts:14` | `PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID` | Skip backup notification |
| `src/lib/notifyAdminFailure.ts:12` | `PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID` | Skip |
| `src/app/api/admin/centers/bulk/route.ts:25` | `PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID` | Skip |
| `src/lib/whatsapp.ts:7` (legacy text helper used by `/api/whatsapp/inbound` FAQ fallback + `check-token-health` cron CEO alert) | **`WHATSAPP_PHONE_NUMBER_ID` only** (also uses `WHATSAPP_ACCESS_TOKEN`, not `WHATSAPP_TOKEN`) | Returns false, warns |
| `src/app/api/health/route.ts:18`, `src/app/api/admin/health/route.ts:12` | **`WHATSAPP_PHONE_NUMBER_ID` only** | Health badge reports `wa_mode: 'live'` if set ≠ test id |
| `src/app/api/admin/whatsapp/sync-templates/route.ts:11-15` | `WHATSAPP_PHONE_NUMBER_ID \|\| WHATSAPP_PHONE_ID \|\| PHONE_NUMBER_ID` | Returns 500 if none |

### Standardized name

There is no single name that satisfies every caller. Practical recommendation:

- **Standardize new code on `PHONE_NUMBER_ID`** (it is the most-used name and the first-checked alias in every production-path file).
- **For launch, set all three to the same Meta phone-number-id value.** Skipping any one of them breaks at least one caller:
  - Skipping `WHATSAPP_PHONE_ID` → `whatsapp/client.ts:getConfig()` throws on the keyword-reply path (every inbound message processed by `/api/whatsapp/webhook`).
  - Skipping `WHATSAPP_PHONE_NUMBER_ID` → `whatsapp.ts` legacy helper used by `/api/whatsapp/inbound` FAQ fallback + check-token-health CEO alert sends `false` silently; `/api/health` reports `wa_mode: 'live'` only if this is set.
  - Skipping `PHONE_NUMBER_ID` → PIN delivery, welcome template, all `centerNotify` templates skip.

Same logic for the access token: set both `WHATSAPP_TOKEN` (primary) and `WHATSAPP_ACCESS_TOKEN` (used only by `src/lib/whatsapp.ts`) to the same long-lived system-user token.

### Footgun summary

The alias sprawl is a real launch-day hazard: an operator who sets two of the three names will get a system where most templates send, the health endpoint reports green, but inbound keyword replies in `/api/whatsapp/webhook` throw with "WHATSAPP_PHONE_ID and WHATSAPP_TOKEN must be set" — and that error is buried in server logs while the customer sees no auto-reply. The mitigation is to set all three identically. The cleanup PR is a follow-up: replace every `WHATSAPP_PHONE_ID`/`WHATSAPP_PHONE_NUMBER_ID` read with `PHONE_NUMBER_ID` and update `.env.example`.

---

## Section 3 — Webhook integrity

Both routes are App-Router POST handlers that read the raw body via `readRawBodyWithLimit(..., 64 KB)`, then verify the Meta signature with `hmacSha256Hex(WHATSAPP_APP_SECRET, rawBody)` and `timingSafeEqualUtf8`.

### `/api/whatsapp/webhook` (main pipeline — keyword routes, vendor READY signals, parent consent button, onboarding flows)

- File: `src/app/api/whatsapp/webhook/route.ts`
- GET: verifies challenge token = `WHATSAPP_VERIFY_TOKEN ?? WHATSAPP_WEBHOOK_VERIFY_TOKEN` (either name works).
- POST gating (in order):
  1. `WHATSAPP_APP_SECRET` not set → **401** + Sentry warning. **Fail-closed.**
  2. `x-hub-signature-256` header missing → **401**. **Fail-closed.**
  3. HMAC mismatch → **401** + Sentry warning. **Fail-closed.**
  4. JSON parse failure → **401**.
  5. On valid signature, returns `{ received: true }` 200 immediately and processes asynchronously.
- Payload limit exceeded → 413.

### `/api/whatsapp/inbound` (FAQ keyword auto-reply + sales forwarding)

- File: `src/app/api/whatsapp/inbound/route.ts`
- GET: verifies challenge token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN` only (the alternate name `WHATSAPP_VERIFY_TOKEN` is NOT accepted here).
- POST: identical fail-closed sequence to `/webhook`. Same `WHATSAPP_APP_SECRET` gates both — there is only one Meta App, so one secret.
- Returns 200 `{ ok: true }` on success (so Meta does not retry) and idempotency-keys by Meta message id via `webhook_inbox`.

### Coverage in `PUBLIC_WEBHOOK_PREFIXES`

`src/proxy.ts:24-29` lists both paths separately. They bypass the Origin/CORS check (correct for server-to-server) and skip auth gating. The proxy treats `pathname === p || pathname.startsWith(${p}/)` so neither shadows the other:

```ts
const PUBLIC_WEBHOOK_PREFIXES = [
  '/api/paymob/webhook',
  '/api/bosta/webhook',
  '/api/whatsapp/webhook',
  '/api/whatsapp/inbound',
];
```

No duplicate handling. `proxy.ts` does not check HMAC itself — the route owners do.

### Verdict

- HMAC verification is correctly fail-closed on both routes.
- `WHATSAPP_APP_SECRET` is mandatory; absence drops every webhook on the floor with 401, which is the right default but will silently degrade product (no inbound keyword auto-replies, no template status updates, no vendor READY signals) if it disappears in prod.
- Recommend a synthetic monitor that POSTs an unsigned payload to both URLs daily and alerts if status ≠ 401.

---

## Section 4 — Template gating

All outbound WhatsApp template sends route through one of:

- `centerNotify.ts:postWhatsappTemplate` (most production paths)
- `whatsapp/client.ts:sendTemplateMessage` (webhook keyword replies, onboarding flow scheduler)

Both check `wa_meta_templates.status === 'APPROVED'` (or `isTemplateApproved` in client.ts) before issuing the Graph call. If not APPROVED → skip + console warn, no error to caller.

### Critical-path templates the onboarding/PIN flow depends on

| Template | Where called | Body parameters (order) | Required for launch | Notes |
|----------|--------------|------------------------|---------------------|-------|
| **`chq_welcome`** | `signupPaymobAutoApprove.ts:504, 770` (auto-approve), `whatsapp/flows/onboarding.ts:143` (8-step schedule step 1), `signupPaymobAutoApprove.ts:18` (pending-payment confirmation gate) | `[center.name, PLATFORM_URL, center.phone]` | **Mandatory** | First contact after payment. If not APPROVED, no welcome at all. PIN currently NOT in body — see Section 1 launch-blocker. |
| **`chq_pin_delivery`** | `centerNotify.ts:1411` → `reset-pin` route | `[otp]` single param | **Mandatory** | Without this, owners cannot recover/establish a PIN. `docs/WA_TEMPLATES.md` flags this as "Registered only — unwired", but code DOES call it. |
| `chq_onboarding_step1` | `centerNotify.ts:1043` (called 24h after approval by process-renewals cron) | `[center.name, PLATFORM_URL]` | Recommended | Drives day-1 activation. |
| `chq_onboarding_step2` / `step3` / `step4` | `centerNotify.ts` | `[owner, center, link]` | Recommended | Used by 8-step flow scheduler. |
| `chq_payment_confirmed` | `sendPaymentConfirmed` → renewals | `[name, period, amount]` | Recommended | Renewal success confirmation. |
| `chq_renewal_overdue` | `subscriptionBillingCron` | `[name, daysLate, amount]` | Recommended | Grace-window dunning. |
| `chq_payment_retry` | `sendPaymentRetry` | `[owner, center, amount, paymentLink]` | Recommended | Falls back to freeform text if not approved. |
| `chq_inactivity_alert` | `runChqInactivityAlertTemplates` (cron) | `[center, days]` | Optional but high-impact | Re-engagement after 5+ days inactive. |
| `chq_vendor_new_order` | `sendVendorNewOrder` | `[ref, qty, notes, courierLabel]` + quick-reply button | Required if card-orders ship | Quick-reply index 0 must be configured in Meta template. |

### Pre-launch submission list (Meta typically 24-48 h)

1. `chq_welcome` (UTILITY, Arabic + English) — **highest priority**
2. `chq_pin_delivery` (AUTHENTICATION, Arabic) — **highest priority**
3. `chq_onboarding_step1` … `step4`
4. `chq_payment_confirmed`
5. `chq_renewal_overdue`
6. `chq_payment_retry`
7. `chq_inactivity_alert`
8. `chq_vendor_new_order` (if card-order shipping live at launch)

After Meta approves, sync via `POST /api/admin/whatsapp/sync-templates` (super-admin Bearer) or `UPDATE public.wa_meta_templates SET status='APPROVED' WHERE template_name=...`.

---

## Section 5 — Credential & config inventory

### Env vars read by WhatsApp code

| Env var | Read at | Purpose | Prod | Preview |
|---------|---------|---------|------|---------|
| `PHONE_NUMBER_ID` | `centerNotify.ts:51`, `signupPaymobAutoApprove.ts:30`, `whatsapp/client.ts:16`, `vendorNotify.ts:13`, `googleDriveBackup.ts:14`, `notifyAdminFailure.ts:12`, `admin/centers/bulk:25` | Primary alias for Meta phone-number-id | **Yes — set to live ID** | Yes (set to test ID `1013787185158313` or leave unset) |
| `WHATSAPP_PHONE_ID` | `whatsapp/client.ts:35` (throws), and as fallback in all `PHONE_NUMBER_ID` sites | Required by webhook keyword-reply path | **Yes — same value** | Yes |
| `WHATSAPP_PHONE_NUMBER_ID` | `whatsapp.ts:7` (legacy), `health/route.ts:18`, `admin/health/route.ts:12`, `admin/whatsapp/sync-templates:12` | Required for legacy text sender + health badge | **Yes — same value** | Yes |
| `WHATSAPP_TOKEN` | `centerNotify.ts:55`, `whatsapp/client.ts:36`, `signupPaymobAutoApprove.ts:34`, `notifyAdminFailure.ts:85`, `googleDriveBackup.ts:475`, `vendorNotify.ts:108`, `admin/centers/bulk:29`, `admin/whatsapp/sync-templates:20`, `cron/check-token-health:44` | Long-lived Meta system-user token | **Yes** | Yes |
| `WHATSAPP_ACCESS_TOKEN` | `whatsapp.ts:8` only | Required by `/api/whatsapp/inbound` FAQ fallback + cron CEO alert | **Yes — same value as WHATSAPP_TOKEN** | Yes |
| `WHATSAPP_APP_SECRET` | `whatsapp/webhook:401`, `whatsapp/inbound:269`, `cron/check-token-health:46` | x-hub-signature-256 HMAC verification (both webhooks) | **Yes** | Yes |
| `WHATSAPP_VERIFY_TOKEN` | `whatsapp/webhook:213` (only) | GET challenge for /webhook (alternative name) | Optional if WEBHOOK_VERIFY_TOKEN set | Same |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | `whatsapp/webhook:213`, `whatsapp/inbound:88` | GET challenge for both routes. **Inbound only accepts this one.** | **Yes** | Yes |
| `WHATSAPP_APP_ID` | `cron/check-token-health:45` only | Meta App ID for debug_token expiry cron | Yes (otherwise health cron fails) | Optional |
| `SALES_MANAGER_PHONE` | `inbound:257`, `flows/renewalReminders.ts:111`, `flows/churnDetection.ts:63` | Inbound FAQ forward target when no keyword match | Recommended | Optional |
| `VENDOR_WHATSAPP_NUMBER` | `centerNotify.ts:1281`, `vendorNotify.ts:83` | Card-order vendor fallback recipient | Required if card-orders ship | Optional |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | UI wa.me links (signup, support buttons) | Public support number | **Yes** | Yes |
| `ADMIN_WHATSAPP_NUMBER` | Cron alert fallback | Optional | Optional | Optional |
| `CEO_PHONE` | `cron/check-token-health:91` | Token-expiry alerts to CEO | Recommended | Optional |
| `BACKUP_NOTIFY_PHONE` | googleDriveBackup | Backup status WA pings | Optional | Optional |

### Feature flags / kill switches

- **DB:** `platform_config.wa_sending_enabled` (boolean). Default treated as true; set to `false` to globally suppress every template send. Checked in every `centerNotify.send*` helper and in `whatsapp/client.ts`.
- **DB:** `platform_config.auto_approve_signups` — when false, paid signups land in `pending` status with no PIN minted; manual admin approval required. Set to true for launch only after confirming WhatsApp PIN delivery works end-to-end.
- **DB:** `platform_config.pause_new_signups` — when true, paid signups park at `paid_pending_activation`; no PIN, no welcome.
- **Code constant:** `WHATSAPP_META_TEST_PHONE_NUMBER_ID = '1013787185158313'` is hard-coded in `centerNotify.ts:59`, `whatsapp/client.ts:13`, `signupPaymobAutoApprove.ts:20`, `vendorNotify.ts:10`, `notifyAdminFailure.ts:9`, `googleDriveBackup.ts:11`, `admin/centers/bulk:12`, and `admin/health/route.ts`. If any phone-id env equals this value, every send is skipped. Production must NOT use this ID.
- **No env-based WhatsApp kill switch.** Toggling at launch must go through `platform_config.wa_sending_enabled` (UPDATE statement). There is no `WHATSAPP_ENABLED` flag.

---

## Launch day: do exactly this

> Assumes "standardize on `PHONE_NUMBER_ID`" but set all three for safety, as recommended in Section 2.

1. **48 h before launch**, in Meta Business Manager → WhatsApp Manager → Templates, submit for approval (UTILITY/AUTHENTICATION as appropriate, Arabic primary):
   `chq_welcome`, `chq_pin_delivery`, `chq_onboarding_step1`, `chq_onboarding_step2`, `chq_onboarding_step3`, `chq_onboarding_step4`, `chq_payment_confirmed`, `chq_renewal_overdue`, `chq_payment_retry`, `chq_inactivity_alert`, and `chq_vendor_new_order` if card-orders ship.
   Body texts must match `wa_meta_templates` rows (parameter count + order). For `chq_vendor_new_order`, configure a quick-reply button at index 0.
2. **Land the PIN-delivery code fix** (Section 1 launch-blocker). Smallest diff: in `src/lib/signupPaymobAutoApprove.ts` immediately after `bcrypt.hash(pin, 10)` (line 400), call `await sendPinDelivery(normalizedPhone, pin)` and surface a Sentry error if it returns false — owner activation depends on this single send.
3. **In Vercel → Project → Environment Variables → Production**, set:
   - `PHONE_NUMBER_ID = WHATSAPP_PHONE_ID = WHATSAPP_PHONE_NUMBER_ID` = production Meta phone-number-id (must NOT be `1013787185158313`)
   - `WHATSAPP_TOKEN = WHATSAPP_ACCESS_TOKEN` = long-lived Meta system-user access token
   - `WHATSAPP_APP_SECRET` = Meta App → Settings → Basic → App Secret
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN = WHATSAPP_VERIFY_TOKEN` = a UUID you generate (same value in both names)
   - `WHATSAPP_APP_ID` = Meta App ID (needed by token-health cron)
   - `NEXT_PUBLIC_SUPPORT_WHATSAPP` = public support number digits-only (e.g. `201XXXXXXXXX`)
   - `CEO_PHONE` = recipient for token-expiry alerts
   - `SALES_MANAGER_PHONE`, `VENDOR_WHATSAPP_NUMBER`, `ADMIN_WHATSAPP_NUMBER` as applicable
   Mirror the same values in **Preview** (using the Meta test phone-number-id `1013787185158313` if you want preview deploys to NOT send real messages).
4. **Redeploy** so the new env vars take effect.
5. **In Meta App Dashboard → WhatsApp → Configuration → Webhooks**, register BOTH callback URLs (one Meta App is OK — the App Secret is shared):
   - `https://tutoringhq.app/api/whatsapp/webhook` — Verify Token = the value you set in step 3. Subscribe to fields: `messages`, `message_template_status_update`, `account_alerts`, `phone_number_quality_update`.
   - `https://tutoringhq.app/api/whatsapp/inbound` — Verify Token = the value you set in step 3. Subscribe to: `messages`.
   Meta will GET each URL with `hub.challenge`; both routes will echo it back.
6. **As super-admin, run** `POST https://tutoringhq.app/api/admin/whatsapp/sync-templates` (Bearer = your Supabase session JWT) to mirror Meta's APPROVED state into `wa_meta_templates`. Re-run after every Meta template update.
7. **Verify DB flags**: `SELECT key, value FROM platform_config WHERE key IN ('wa_sending_enabled','auto_approve_signups','pause_new_signups');` — `wa_sending_enabled` should be unset or `true`; `auto_approve_signups` flip to `true` only after step 9 passes; `pause_new_signups` must be `false`.
8. **Sanity-check health**: `curl https://tutoringhq.app/api/health` — must show `wa_mode: "live"`, `wa_secret_configured: true`, `wa_verify_token_configured: true`. If `wa_mode` is `test`, `WHATSAPP_PHONE_NUMBER_ID` was not set (step 3 alias 3).
9. **End-to-end smoke test** with a real Egyptian phone:
   a. Sign up via `/ar/signup` with the test number, complete Paymob payment in sandbox/live as configured.
   b. Confirm `chq_welcome` arrives on WhatsApp within 30 s of payment success.
   c. Open `/ar/login` → "Forgot PIN" → enter the same phone → confirm `chq_pin_delivery` OTP arrives.
   d. Submit OTP + new PIN at `/ar/forgot-password` (verify-pin-reset).
   e. Log in with phone + new PIN — must land on dashboard.
   f. If step (b) silently does not arrive but (c) does, the PIN-delivery fix from launch step 2 is what's missing.
10. **Post-launch monitoring**: watch Sentry for `whatsapp webhook missing WHATSAPP_APP_SECRET`, `WhatsApp webhook signature mismatch`, `centerNotify.sendPinDelivery`, and `[signupInvoiceAutoApprove] auth create` errors. Add a synthetic that POSTs unsigned bodies to both webhook URLs daily and alerts if response ≠ 401.
