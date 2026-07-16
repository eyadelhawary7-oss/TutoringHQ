---
name: automated-billing-and-fees
description: >
  Automated billing configuration and complex-fee playbook for CenterHQ
  (EH Group). Use when touching pricing, invoices, renewals, processing
  fees, VAT, PAYG/pack billing, the single-day lock model, saved-card
  auto-charge, MRR, or any cron under /api/cron that moves money.
---

# Automated Billing & Complex Fees — CenterHQ

**Source of truth ranking:** `docs/PRICING_SPEC.md` > this skill > CLAUDE.md.
The old cascading tax (VAT 14% + stamp 0.5% + service 6%) is **REMOVED** —
if you see it referenced anywhere (including CLAUDE.md), that text is stale.

## Current fee model (2026-07)

- **Tax = 14% VAT only, inclusive.** `base = inclusive × 0.86`;
  `inclusive = base / 0.86`. VAT slice of a total: `total × 0.14 / 1.14`.
- **Flat processing fee**: one **20 EGP** per charge invoice (never per
  line, never % — controlled by `platform_config.processing_fee_enabled` /
  `processing_fee_amount`, read via `getProcessingFeeConfig()` in
  `src/lib/pricingConfig.ts`; helpers in `src/lib/processingFee.ts`).
  Snapshotted into `invoices.metadata.processing_fee` at creation —
  breakdowns must render from the snapshot, never live config.
- **Fee applies to:** renewals, signup first payment, PAYG, parent-pack,
  whatsapp_addon, teacher resubscribe/upgrade/switch/overage,
  plan_upgrade_difference, reactivation, card-order setup_fee,
  announcement _cap/_settlement.
  **Never on:** `referral_payout`, `payment_proof`.
- **Combined invoices carry exactly ONE fee.**
- **VAT has no carve-outs** (money invariant): the flat **20 EGP processing
  fee IS subject to VAT**, and **`card_orders.delivery_fee` IS subject to
  VAT**. VAT is computed on the **full VAT-inclusive total for every invoice
  type and every line** — `vatInside(total) = total × 0.14 / 1.14`. There
  are no carve-outs. (The former card-order shipping carve-out — "shipping
  sits above tax" — was removed 2026-07-15, commit `4089293`;
  `buildInvoiceTaxSnapshot` + `invoiceTemplates` now take VAT on the full
  total. Bosta courier cost booked in `autoBookBosta` is an operational
  cost, not a customer invoice line.)
- **Referral commission base** = `centers.all_in_price` stripped of VAT
  only (÷ 1.14), via `netReferralBaseFromAllInPrice` — never the invoice
  total.

## Late fees are dead — never reintroduce

Late fees are dead. The five `late_fee_*` keys in `platform_config` and the
`late_fee_rate`, `late_fee_amount` and `days_overdue` columns on `invoices`
are legacy. They are unreachable under the billing lockout policy, which
locks the account on day 1 while the first late fee triggers on day 4.
Never reintroduce them.

## Plan pricing invariants

- Quarterly/mo is the baseline; Monthly ≈ ×1.15, Annual ≈ ×0.85, both
  rounded to `.99` endings (marketing approximations — do NOT enforce
  exact math). **Nano Monthly is intentionally +25%** — never "fix" to
  2,299. **Enterprise is fixed-price.**
- **`top_centers`**: `centers.all_in_price` is authoritative; strict code
  paths MUST throw + Sentry-warn when NULL. MRR aggregates degrade to 0.
- Annual display prices round to whole EGP ("849.917 EGP/month" is a bug).
- MRR: single canonical API `getImpliedMonthlyMrr` (`src/lib/pricing.ts`).
  Exclusions: `is_test = true` always; statuses suspended/churned/deleted/
  cancelled/inactive; PAYG counts 0 subscription MRR.

## Invoice display (legal requirement — فاتورة ضريبية)

Customer PDFs/receipts: VAT is the **LAST** line and is *inside* the total
(does not add). Order: subscription → processing fee (ⓘ) → total → VAT
(inclusive). Never render service-fee or stamp-duty lines.

## Billing lifecycle — single-day lock model

Anchor: **00:00 Africa/Cairo on the billing calendar day** (never signup
hour, never UTC). Source: `src/lib/billingLifecycle.ts` (pure, tested).

1. Charge fails/unpaid → full access until 23:59:59 Cairo that day.
2. Next 00:00 Cairo → centers lock to `/suspended` summary screen;
   teachers drop to free tier (data preserved).
3. **No late fee, no reactivation surcharge** — reactivation charges the
   plain subscription price.
4. Manual cancellation → access until end of paid cycle
   (`pending_cancellation`).
5. No billing-date moves — lapse and resubscribe instead.
6. `centers.auto_suspend_at` = next Cairo midnight after
   `next_payment_due` (`autoSuspendAtFromDue`, DST-safe); enforced by
   `src/proxy.ts`.

## Automation state machine (know what's live vs inert)

- **Saved-card engine (Phase 1)**: built + tested, stores Paymob token
  (never PAN), consent-gated. `docs/SAVED_CARD_ENGINE.md`.
- **Midnight auto-charge (Phase 2)**: `/api/cron/subscription-autocharge`
  (0 22 * * * UTC = midnight Cairo) wired but **INERT** until
  `PAYMOB_RECURRING_INTEGRATION_ID` is issued — until then every due
  customer stays on the manual pay surface. Do not assume auto-charge
  is collecting.
- Soft-decline retry: day 0/+3/+7 capped; bank declines → OTP fallback,
  never silent retry.

## Rules for writing billing code

- **Cairo time helpers only** (`src/lib/cairo/` — `startOfCairoDay`,
  `cairoDateKey`). Raw `new Date()` in a billing window is a bug; unit
  tests run `TZ=UTC` specifically to surface this.
- **Idempotency first**: any cron or webhook that creates invoices or
  finalizes payments must be safe to run twice (dedupe on natural key —
  center + period — or transaction id).
- Money formatting through `formatNumber.ts` helpers only
  (`check:tolocale` gate blocks raw `toLocaleString`).
- New money-moving cron: register in `vercel.json`, gate on
  `CRON_SECRET`, set `maxDuration` if >10s, and write an idempotency
  test before shipping.
- Any fee change → update `docs/PRICING_SPEC.md` in the same PR and add
  a worked example; snapshot new fee fields into invoice metadata.

## Verification duties

All billing crons run on Vercel, which runs UTC only with no timezone
setting. Egypt is UTC+3 during daylight saving and UTC+2 outside it. Under
Law 34 of 2023 DST runs from the last Friday of April to the last Thursday
of October, which for 2026 is 24 April to 29 October. Any Cairo local time
in a billing rule needs the offset done by hand and must be DST aware. Two
yearly edges: on spring forward day 12:00 AM does not exist, and on fall
back day the 11 PM hour repeats. A job set to fire at exactly midnight can
skip or fire twice. Twice means two invoices.
