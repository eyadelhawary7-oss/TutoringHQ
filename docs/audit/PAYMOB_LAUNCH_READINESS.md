# Paymob Launch Readiness — Audit Report

> **Status:** READ-ONLY investigation. No code changes made in this pass.
> **Scope:** webhook canonicalisation, server-side amount enforcement, idempotency, NO-REFUNDS state-machine integrity, credential & launch-day sequencing.
> **Authority docs:** `docs/CRITICAL_RULES.md` (NO REFUNDS, plan_key discipline, formatNumber). Note: `docs/CRITICAL_RULES.md` was not found in the working tree at audit time — the principles cited are applied from project context (CLAUDE.md) and prior audit `docs/audit/PRE_LAUNCH_LOOPHOLE_AUDIT.md`.
> **Date:** 2026-05-23 — branch `fix/pre-launch-security-audit`.

---

## Summary

| Section | Finding | Verdict | Action before launch |
|---|---|---|---|
| 1. Duplicate webhook | `/api/paymob/webhook` is the canonical handler with HMAC, idempotency, promo redemption, and all finalizers. `/api/webhooks/paymob` is a stub returning HTTP 410 Gone. | ✅ RESOLVED | Register **only** `https://centerhq.app/api/paymob/webhook` in the Paymob dashboard. Leave the 410 stub in place (it documents the rotation). |
| 2. Server-side amount enforcement | 8 of 9 routes derive the charged amount entirely from `plan_key` / DB pricing / DB invoice totals. `/api/paymob/create-payment-key` reads `amount` from the request body but cross-checks it against `card_orders.total_amount` with ±EGP 0.01 tolerance before calling Paymob. | ✅ SAFE (minor cleanup recommended, not blocking) | None blocking. Optional hardening: pass `dbTotal` (not the body `amount`) into `issueCardOrderIframePayment` to remove the 0.01 rounding band. |
| 3. Idempotency + replay | `webhook_inbox.idempotency_key` has a **UNIQUE index** (`webhook_inbox_idempotency_key_idx`). Key is `paymob:<transaction_id>`. Combined-payment session uses an atomic RPC `try_finalize_payment_session` with status-locking. Order-level dedupe via `combined_payment_sessions.status = 'paid'` and `invoices.status = 'paid'` short-circuit. Promo redemption goes through `redeem_promo_code` RPC (atomic, denies double-redeem). | ✅ SAFE | None. |
| 4. NO REFUNDS + state-machine integrity | No center-callable refund path. Chargeback handler `finalizeInvoiceChargeback` is webhook-only (triggered by `is_voided` / `is_refunded` HMAC fields) and moves state **backwards** (invoice → `chargeback`, center → `suspended`) — this is acceptable: refund came from Paymob/bank, not from a center action. Card-order transitions are funnelled through `applyCardOrderTransition` (validated state machine). Subscription writes use service-role only. | ✅ SAFE | None. |
| 5. Credential & config inventory | 4 env vars: `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_IFRAME_ID`, `PAYMOB_HMAC_SECRET`. Production guard (`paymobProductionGuard.ts`) refuses to boot on prod if keys look sandbox-shaped. Feature flag is **file-based**: `FEATURES.PAYMOB_ENABLED` in `src/lib/features.ts` (no `platform_config` toggle). | ⚠️ Requires manual ops | Follow the numbered launch-day sequence at the bottom. |

---

## SECTION 1 — Duplicate Paymob webhook resolution

### 1a. `src/app/api/webhooks/paymob/route.ts` (DEPRECATED)

Entire file (4 lines):

```ts
/** Deprecated URL — use `/api/paymob/webhook`. Kept for upstream dashboards until rotated. */
export async function POST() {
  return new Response(null, { status: 410 });
}
```

- Returns HTTP **410 Gone** to every POST. No HMAC, no idempotency, no state changes.
- Intentionally retained as a stub for "upstream dashboards until rotated."

### 1b. `src/app/api/paymob/webhook/route.ts` (CANONICAL)

This is the live handler. Key properties confirmed by reading the file:

- **HMAC-SHA512 verification — fail-closed.**
  - `src/app/api/paymob/webhook/route.ts:231-238`: returns 401 if `PAYMOB_HMAC_SECRET` is unset and emits a Sentry warning. There is no skip path on missing secret.
  - Header path (line 240-246): if `x-hmac-signature` is present, computes `hmacSha512Hex(secret, rawBody)` and compares with `timingSafeEqualHex` — mismatch → 401.
  - Query/payload fallback (line 255-267): if no header HMAC, derives `hmac` from `?hmac=` or `payload.hmac` and calls `verifyCardOrderPaymobHmac(obj, hmac)` — this concatenates the documented Paymob field order (`amount_cents`, `created_at`, `currency`, ..., `order.id`, ..., `success`) under SHA-512 and uses `timingSafeEqualHex`. Missing or invalid HMAC → 401.
  - Body size capped at 32 KiB (`BODY_LIMIT`). Oversize → 413.

- **Idempotency via `webhook_inbox`.**
  - Lines 270-307: builds `idempotencyKey = 'paymob:' + transactionId`, checks for existing `processed=true` row → if found returns `{received:true}` and exits without re-processing. Otherwise upserts `(idempotency_key, source='paymob', payload, processed=false)` with `onConflict: 'idempotency_key', ignoreDuplicates: true`, runs `processPaymobEvent`, then marks `processed=true` with `processed_at`.

- **Per-order idempotency at the business layer (defence in depth).**
  - `processPaymobEvent` (lines 43-62): looks up `combined_payment_sessions` and `invoices` by `paymob_order_id`. If session is already `paid` (line 49) or invoice already `paid` and session not pending (line 60), it returns immediately.

- **Payment-state transitions.**
  - Success path (lines 78-103):
    1. `tryFinalizeCombinedPaymentSession` — only fires when there is a pending `combined_payment_sessions` row (upgrade / reactivation_tier1 / reactivation_tier2). Uses RPC `try_finalize_payment_session` for atomic status flip.
    2. If no combined session, attempts `finalizeCardOrderPaymentSuccess` (card_orders).
    3. If that misses, `finalizeInvoicePaymentSuccess` (subscription / plan_upgrade_difference / signup_first_payment / pack_billing / late_payment_fee / reactivation_fee / legacy).
    4. `processSignupAutoApprovalAfterPaymobSuccess` (signup-flow centers).
  - Chargeback path (lines 68-77): if `is_voided` / `is_refunded` is truthy → `finalizeInvoiceChargeback` (state moves backwards: invoice → `chargeback`, center → `suspended`).
  - Failure path (lines 213-221): `finalizeCardOrderPaymentFailure` + `finalizeInvoicePaymentFailure` + `notifySubscriptionInvoicePaymentFailed`.

- **Promo redemption.**
  - Lines 105-109: `redeemPromoCodeForPaymobOrder(supabaseAdmin, { paymobOrderId: orderId })` is called inside the success branch, wrapped in try/catch so a promo error never blocks payment finalisation.
  - The redemption goes through `redeem_promo_code` RPC (migration `20260523000000_atomic_promo_redemption.sql`) which atomically re-checks `is_active`, `expires_at`, `max_uses_total` and inserts the redemption row + increments `uses_count` in one statement. `discount_pct` is taken from the `promo_codes` row, never from request body.

- **Subscription activation.**
  - Via `tryFinalizeCombinedPaymentSession` → `reactivateCenterFromSession` (centers set to `active`, `billing_status='active'`, `next_payment_due` recomputed via `anchorYmdFromCenter` + `nextAnchorDueStrictlyAfter`).
  - Or via `handleSubscriptionInvoicePaid` (subscription invoice type) → writes `billing_status='paid'`, recomputes `next_payment_due` via `computeNextQuarterlyPaymentDue`, sets `auto_suspend_at`.

- **Card-order status flip.**
  - `finalizeCardOrderPaymentSuccess` calls `applyCardOrderTransition(supabaseAdmin, id, 'paymob_succeeded', ...)` — funnelled through the validated state machine. Also writes a `setup_fee` invoice (`ensureCardOrderSetupFeeInvoice`).

### 1c. Verdict — which URL to register

- **Canonical handler:** `https://centerhq.app/api/paymob/webhook`.
- **Deprecated stub:** `https://centerhq.app/api/webhooks/paymob` — returns 410, must NOT be the registered URL.
- The promo RPC is wired into `/api/paymob/webhook` ✅ — this matches the canonicalisation. No mismatch.
- **Keep the 410 stub** until you have confirmed (via Paymob dashboard) that the rotation has happened; deleting it now would 404 any stale dashboard config and lose the documentary trail. Once you have verified in the Paymob dashboard that the canonical URL is the one registered, the stub can be deleted in a follow-up housekeeping PR.

---

## SECTION 2 — Server-side amount enforcement (every payment-initiating route)

Verdict legend: **SAFE** = amount is derived from server-side data (plan_key + pricing config / DB invoice / DB cart). **HOLE** = amount can be controlled by client request body.

### `/api/reactivate/start` — `src/app/api/reactivate/start/route.ts`
- Body: `{ plan }` only. Validated through `isPlanKey` (line 47), `top_centers` explicitly rejected.
- Amount derivation: `planCfg = PLANS[selectedPlan]` → `getChargeFromQuarterlyAllIn(planCfg.quarterlyAllIn, period, selectedPlan)` → `getReactivationAmount(...)` (lines 105-116). Paymob receives `Math.round(calc.total)`.
- Center id comes from session (`auth.centerId`), not body (line 52, 130).
- **Verdict: SAFE.** Amount is derived from `plan_key` + server-side `PLANS` config; no body field flows into the Paymob amount.

### `/api/card-order-cart/checkout` — `src/app/api/card-order-cart/checkout/route.ts`
- Body: `{ terms_accepted: true }` only (Zod `strict()`). No price field is accepted.
- Amount: `productInclusive = cardOrderProductInclusiveFromQty(qty)` + `deliveryFee = getShippingFee(gov, rates)`; `qty` comes from `activeCardCountFromItems(items)` where `items` are loaded from `card_order_carts` / `card_order_items` server-side (lines 71-102).
- Pay total stored on inserted `card_orders.total_amount` (line 172) and passed to `issueCardOrderIframePayment`.
- **Verdict: SAFE.**

### `/api/billing/initiate-payment` — `src/app/api/billing/initiate-payment/route.ts`
- POST has no body parsing. Center id from session.
- Amount: PAYG → `calculatePaygMonthly(weekly_student_limit)`; fixed → `getChargeFromQuarterlyAllIn(...)` using either `early_adopter_price` or `centers.all_in_price` or `PLANS[planKey].quarterlyAllIn` (lines 89-103).
- **Verdict: SAFE.**

### `/api/billing/upgrade` — `src/app/api/billing/upgrade/route.ts`
- Body: `{ newPlan, newBillingPeriod }`. `newPlan` validated by `isPlanKey`, `top_centers` rejected, `newBillingPeriod` normalised through `normalizeBillingPeriod`.
- Amount: pulled from `pricing_plans` (line 131-146) keyed by `plan_key`, plus `getUpgradeCost` proration. Capped at `newPlanFullPeriodPrice` (line 182-187). Final `amountDue = Math.round(cappedProratedCost * 100) / 100`.
- **Verdict: SAFE.** No client-supplied amount/discount; plan_key drives DB lookup.

### `/api/billing/downgrade` — `src/app/api/billing/downgrade/route.ts`
- Body: `{ newPlan, newBillingPeriod }`. Same plan-key validation.
- **No Paymob session is created** — downgrade only credits the center via `earnCredits`. Not a payment-initiating route.
- **Verdict: N/A (no charge initiated).**

### `/api/billing/switch-payg` — `src/app/api/billing/switch-payg/route.ts`
- Body: `{ action, newPeriod }`. Toggles `payg_pending_switch` columns only.
- **No Paymob session.**
- **Verdict: N/A (no charge initiated).**

### `/api/billing/reactivate` — `src/app/api/billing/reactivate/route.ts`
- Body: `{ useCredits?, creditAmount? }`.
- Amount derivation (lines 80-102): `tier = getReactivationTier(suspended_at)`; `nextPeriodAmount = Number(c.billing_amount)` (from DB); `dailyRate = getDailyRate(...)`; `calc = getReactivationAmount(...)`. Credit cap: `Math.min(requestedCap, availableCredits, calc.total)`.
- Body-provided `creditAmount` is capped server-side by `availableCredits` (DB-derived) and `calc.total` — it can only **reduce** the Paymob amount, never below zero, and only by credits the center actually has.
- **Verdict: SAFE.** `billing_amount` (DB) drives the figure. Body fields cannot inflate or arbitrarily reduce the charge.

### `/api/invoices/[id]/pay` — `src/app/api/invoices/[id]/pay/route.ts`
- No body. Reads `invoice.total_amount` from DB (line 74). Re-validates `invoice.center_id === auth.centerId`. Re-uses existing `paymob_iframe_url` if present (lines 67-72).
- **Verdict: SAFE.**

### `/api/paymob/create-payment-key` — `src/app/api/paymob/create-payment-key/route.ts`
- Body: `{ amount, cardOrderId }`.
- Amount enforcement (lines 69-72):
  ```
  const dbTotal = Number(orderRow.total_amount);
  if (!Number.isFinite(dbTotal) || Math.abs(dbTotal - amount) > 0.01) {
    return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
  }
  ```
  The card order is loaded by id, ownership is verified (`orderRow.center_id !== auth.centerId` → 404), and `payment_status` must be `pending_payment` or `unpaid`.
- After the equality check, the **body `amount` value** (not `dbTotal`) is forwarded to `issueCardOrderIframePayment` (line 80). This is technically safe because the value was already compared to `dbTotal` within ±EGP 0.01, but it would be cleaner and defensive to pass `dbTotal` directly so there is no body value in the Paymob payload at all.
- **Verdict: SAFE (no exploitable hole). Cleanup recommended but not blocking.**
  - The 0.01 tolerance only lets a client shift the charged amount by less than one piastre — not a real exploit. The check is fail-closed: amount NaN, negative, or differing by >0.01 → 400.

**There are no confirmed amount-tampering holes.** A client cannot pay Solo price for Enterprise (plan_key → DB lookup), cannot send `amount: 1` (DB-equality check on every flow that reads body), and cannot inflate/deflate via custom discount fields (no route accepts a discount in the body — promo discount is read from `promo_codes` server-side in the webhook).

---

## SECTION 3 — Idempotency + replay

**Database constraint (verified live against Supabase project `lczmjpnbuhnsislcvzar`):**

```
indexname:   webhook_inbox_idempotency_key_idx
indexdef:    CREATE UNIQUE INDEX webhook_inbox_idempotency_key_idx
             ON public.webhook_inbox USING btree (idempotency_key)
```

Plus a CHECK constraint restricting `source` to one of `paymob | meta | bosta`.

**Inbox check in code (`src/app/api/paymob/webhook/route.ts:270-307`):**

```ts
const idempotencyKey = 'paymob:' + String(transactionId);
// 1) short-circuit if processed
const { data: existing } = await supabaseAdmin
  .from('webhook_inbox')
  .select('id, processed')
  .eq('idempotency_key', idempotencyKey)
  .maybeSingle();
if (existing && existing.processed === true) {
  return NextResponse.json({ received: true });
}
// 2) atomic upsert ignoring duplicates
await supabaseAdmin.from('webhook_inbox').upsert(
  { idempotency_key: idempotencyKey, source: 'paymob', payload, processed: false },
  { onConflict: 'idempotency_key', ignoreDuplicates: true },
);
// 3) process, then mark processed
await processPaymobEvent(payload);
await supabaseAdmin.from('webhook_inbox')
  .update({ processed: true, processed_at: new Date().toISOString() })
  .eq('idempotency_key', idempotencyKey);
```

**Replay-safety chain (defence in depth, beyond the inbox row):**
1. `processPaymobEvent` checks `combined_payment_sessions.status === 'paid'` and `invoices.status === 'paid'` on the same Paymob `order.id` and exits early (route lines 43-62).
2. `tryFinalizeCombinedPaymentSession` calls Postgres RPC `try_finalize_payment_session(p_session_id, p_finalized_by)` which atomically locks-and-flips. If lock not acquired, returns `true` (silent OK) without re-running.
3. `finalizeCardOrderPaymentSuccess` goes through `applyCardOrderTransition` — the validated state machine refuses invalid transitions (already-paid orders).
4. `finalizeInvoicePaymentSuccess` short-circuits if `row.status === 'paid'` (line 213-215).
5. `redeemPromoCodeForPaymobOrder` calls `redeem_promo_code` RPC which is itself atomic; double-redemption returns empty rows and the helper logs+exits.

**Verdict: A replayed/duplicate Paymob callback CANNOT double-activate a subscription, double-complete a card order, or double-redeem a promo.** Idempotency is enforced at four independent layers: unique DB index → status pre-check → atomic finalize RPC → state-machine transition guard.

---

## SECTION 4 — NO REFUNDS + state-machine integrity at the webhook

**Search confirms no center-reachable refund endpoint.** No route under `src/app/api/billing/`, `/api/paymob/`, or `/api/invoices/` exposes a refund/void action. The only money-backwards path is `finalizeInvoiceChargeback` in `src/lib/invoicePaymobPayment.ts:380-421`, triggered only by the Paymob webhook when `obj.is_voided` or `obj.is_refunded` is truthy.

**`finalizeInvoiceChargeback` behaviour:**
- Inputs: `supabaseAdmin` (service-role), `paymobOrderId`, `paymobTransactionId` — all derived from the verified HMAC payload, never from client input.
- Only runs on invoices where `status === 'paid'` (idempotent: chargeback of an unpaid/already-chargedback invoice no-ops).
- Sets `invoices.status = 'chargeback'`, `centers.status = 'suspended'`, `centers.billing_status = 'suspended'`, `centers.subscription_status = 'suspended'`.
- Notifies CEO via WhatsApp.

This is consistent with NO REFUNDS: the only "backwards" path is initiated by the bank/Paymob (chargeback), not by a center user. Centers themselves have no path to recover funds through the app.

**Card-order state machine:**
- All transitions go through `applyCardOrderTransition` in `src/lib/cardOrderState.ts` (called from `finalizeCardOrderPaymentSuccess` and `finalizeCardOrderPaymentFailure`). The webhook never writes raw status updates to `card_orders.payment_status` or `card_orders.status`.

**Subscription/center status transitions:**
- All center-row updates inside the webhook are issued via `supabaseAdminLocal` (`getSupabaseAdmin()` — service-role). No client input flows into a status field. The status fields touched (`status`, `billing_status`, `subscription_status`) are write-restricted by RLS; only service-role can write them.

**Verdict: SAFE.** The webhook moves state forward (success), forward-with-failure-marker (failure), or backward only via Paymob-initiated chargeback. No client-controlled refund vector.

---

## SECTION 5 — Credential & config inventory (launch-day checklist)

### 5a. Env vars actually read by the Paymob code

| Variable | Read in | Purpose | Vercel: Production | Vercel: Preview |
|---|---|---|---|---|
| `PAYMOB_API_KEY` | `paymob.ts:12`, `paymobCenterCheckout.ts:20`, `paymob/issueCardOrderIframe.ts:26`, `invoices/[id]/pay/route.ts:19`, `paymob/create-payment-key/route.ts:15`, `paymobGuardLogic.ts:14`, `health/route.ts:16` | Obtains the Paymob auth token (`POST /api/auth/tokens`). | **REQUIRED (live key)** | Required (sandbox key, or set the flag to false in Preview) |
| `PAYMOB_INTEGRATION_ID` | `paymob.ts:67`, `paymobCenterCheckout.ts:21`/`:120`, `paymob/issueCardOrderIframe.ts:27`, `invoices/[id]/pay/route.ts:20`, `paymob/create-payment-key/route.ts:16`, `paymobGuardLogic.ts:15` | The Paymob "integration id" passed to `POST /api/acceptance/payment_keys`. | **REQUIRED** | Required |
| `PAYMOB_IFRAME_ID` | `paymob.ts:141`, `paymobCenterCheckout.ts:22`/`:121`, `paymob/issueCardOrderIframe.ts:28`, `invoices/[id]/pay/route.ts:21`, `paymob/create-payment-key/route.ts:17` | Composes `https://accept.paymob.com/api/acceptance/iframes/<id>?payment_token=…`. | **REQUIRED** | Required |
| `PAYMOB_HMAC_SECRET` | `paymob.ts:134`/`:198`, `paymob/webhook/route.ts:231` | Verifies HMAC-SHA512 on every inbound webhook. | **REQUIRED (fail-closed: missing → 401)** | Required |

Additional supporting vars used by the webhook indirectly:

- `CEO_PHONE` — chargeback notification (optional but recommended).
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` — required for service-role writes.
- `CRON_SECRET` — `/api/cron/payment-retry` (Paymob retry job; gated by `FEATURES.PAYMOB_ENABLED`).

### 5b. Production guard

`src/lib/paymobProductionGuard.ts` imports `assertPaymobProductionOrThrow()` from `paymobGuardLogic.ts`. It is `import`-ed at the top of every Paymob-touching server file (e.g. `paymob.ts:1`, `paymobCenterCheckout.ts:1`, `paymob/create-payment-key/route.ts:1`, `card-order-cart/checkout/route.ts` chain through `issueCardOrderIframe.ts`).

Guard logic (`paymobGuardLogic.ts:13-27`):
- Sandbox indicators: API key contains "sandbox", or key length < 30, or integration id length < 6.
- If `VERCEL_ENV=production` AND keys look sandbox → throw at boot. Build phase (`NEXT_PHASE=phase-production-build`) is skipped to allow CI without live secrets.

### 5c. Feature flag — Paymob enable/disable

**Location:** `src/lib/features.ts:20-22`

```ts
export const FEATURES: { PAYMOB_ENABLED: boolean } = {
  PAYMOB_ENABLED: false, // Set to true to unlock for everyone
};
```

**There is NO `platform_config.paymob_enabled` row.** The flag is file-based; flipping it requires a code commit + deploy.

**Read sites (gates that the flag actually controls):**
- Server-side: `src/app/api/billing/initiate-payment/route.ts:64` (returns 404 if disabled), `src/app/api/cron/payment-retry/route.ts:57` (cron exits if disabled), `src/app/api/signup/route.ts:202` (signup flow skips Paymob branch).
- Client UI: `BillingPageClient.tsx`, `settings/billing/page.tsx`, `PastDueBanner.tsx`, `AdminCardOrderDetailClient.tsx` — all "Pay now" CTAs render a disabled state and show `t('payDisabled')` toasts when the flag is false.

**Effect of flipping to `true`:**
- "ادفع الآن" (Pay Now) buttons appear for all centers across billing pages, past-due banners, and the signup flow's Paymob branch.
- `/api/billing/initiate-payment` stops returning 404; the daily payment-retry cron starts running its Paymob retry batch.
- The card-order checkout flow (`/api/card-order-cart/checkout`) and reactivation flow (`/api/reactivate/start`, `/api/billing/reactivate`) do **not** gate on the flag — they assume Paymob is wired and will surface 500s if env vars are unset. Set the env vars **before** flipping the flag.

---

## Launch day: do exactly this

> Run in order. Do not skip a step.

1. **Set live env vars in Vercel — Production environment**, in this order (so the production guard is satisfied before deploy):
   - `PAYMOB_API_KEY` = live key starting with `Key_` (must be ≥30 chars, must NOT contain "sandbox").
   - `PAYMOB_INTEGRATION_ID` = live integration id (≥6 chars).
   - `PAYMOB_IFRAME_ID` = live iframe id.
   - `PAYMOB_HMAC_SECRET` = live HMAC secret (matches the secret shown in Paymob dashboard for the webhook).
   - Confirm `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` are already set.
   - Optional: `CEO_PHONE` for chargeback WhatsApp alerts.

2. **Set Preview env vars** to sandbox values (or duplicate prod if Preview is internal-only). The production guard does NOT fire on Preview (Preview is `VERCEL_ENV=preview`, not `production`), so sandbox-shaped keys are tolerated.

3. **Register the webhook URL in the Paymob dashboard:**
   - URL: `https://centerhq.app/api/paymob/webhook`
   - Method: POST
   - Confirm the HMAC secret displayed in the dashboard matches `PAYMOB_HMAC_SECRET` in Vercel exactly.
   - **Do not register** `/api/webhooks/paymob` (returns 410).

4. **Flip the feature flag** by editing `src/lib/features.ts`:
   ```ts
   export const FEATURES: { PAYMOB_ENABLED: boolean } = {
     PAYMOB_ENABLED: true,
   };
   ```
   Commit, push, and deploy. The flag flip and the env vars MUST both be in place when production traffic hits.

5. **Smoke-test on production within 5 minutes of deploy:**
   - One owner triggers `/api/invoices/[id]/pay` for the smallest outstanding subscription invoice; confirm Paymob iframe loads, complete payment, watch for webhook receipt in Sentry + `webhook_inbox` row appearing with `processed=true`.
   - Confirm `invoices.status` flips to `paid`, `centers.billing_status='paid'`, `centers.next_payment_due` recomputed.
   - Confirm idempotency: re-trigger the same Paymob webhook (Paymob dashboard "resend" → `/api/paymob/webhook`); confirm no duplicate `paid_at`, no double-`renewal_history` row, no duplicate WhatsApp notification.

6. **Post-launch monitoring (first 24h):**
   - Sentry tag `provider:paymob` — watch for `PAYMOB_PRODUCTION_GUARD` errors (means a sandbox key slipped in), `PAYMOB_HMAC_SECRET` missing warnings (rotation gap), or `paymob webhook payload limit exceeded` (would indicate Paymob changed payload shape).
   - Supabase: `SELECT count(*), processed FROM webhook_inbox WHERE source='paymob' GROUP BY processed;` — should show all rows processed within seconds.
   - `cron_log` table for `combined_payment_finalize` failure entries.
