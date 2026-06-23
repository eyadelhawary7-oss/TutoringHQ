# CenterHQ Pricing Spec
Last updated: 2026-05-09

## Tax formula (internal)
Inclusive prices use cascading division: base = inclusive × 0.86 × 0.995 × 0.94 (strips 14% VAT, 0.5% stamp, 6% service). Going up: inclusive = base / 0.94 / 0.995 / 0.86. Markup factor 1.24323. NOT additive math.

## Worked examples
Inclusive 4,999 → base 4,020.99
Inclusive 4,499 → base 3,618.27
Inclusive 999 → base 803.40
Inclusive 62 (per card) → base 49.87 (display as 50)
Inclusive 9.80 → base 7.88
Inclusive 12 → base 9.65

## Plan price table (monthly INCLUSIVE EGP)
Plan         Monthly    Quarterly/mo    Annual/mo    Cap
solo          1,149          999             849       50
nano          2,499        1,999           1,699      120
starter       5,199        4,499           3,824      200
pro           9,199        7,999           6,799      500
business     14,999       12,999          11,049    1,000
enterprise   21,299       18,499          15,724    2,000
top_centers   CUSTOM       CUSTOM          CUSTOM   2,000+

Quarterly/mo is baseline shown on signup cards. Monthly ≈ Quarterly × 1.15, Annual ≈ Quarterly × 0.85, both rounded to .99 endings (marketing approximations).

Exception: Nano Monthly is intentionally +25% not +15% (incentive for Quarterly commitment). Do NOT "fix" to 2,299.

Enterprise is fixed-price. Top Centers is the only custom-priced tier; centers.all_in_price is source of truth, code reading top_centers MUST throw + Sentry-warn if NULL.

## Add-ons
qr_card: 62 EGP per card (inclusive). Bosta added on top, not taxed.
parent_pack: 12 EGP/active parent/month (inclusive).
blast: 9.80 EGP/blast (inclusive).

## Internal admin breakdown view (descending from inclusive)
Total:                              62.00 EGP
incl. VAT (14%):                     8.70
incl. stamp duty (0.5%):             0.27
incl. service fee (6%):              3.16
your net (base):                    49.87
For accounting/admin tooling ONLY.

## Customer-facing invoice display order (LEGAL REQUIREMENT)
Egyptian tax law (فاتورة ضريبية) requires VAT as the LAST line on any invoice. PDF receipts and legal invoices MUST display:

Subtotal (base):              49.87 EGP
Service fee (6%):              3.16
Stamp duty (0.5%):             0.27
VAT (14%):                     8.70    ← LAST
─────────────────────────────────────
Total:                        62.00 EGP

NEVER reverse this order on legal documents.

Display Annual prices ROUNDED to whole EGP. "849.917 EGP/month" is a bug.

## Audit divergences (2026-05-09)
1. Card order summary computes additively on base with 6%/0.4%/14%, producing 62 from 51 base. Spec: cascading, base 50, stamp 0.5%.
2. Per-card price drifts 51 (1-card) vs 51.5 (50-card). Spec: base = 50 EGP exactly.
3. Stamp hard-coded 0.4% in places. Spec: 0.5%.
4. Some invoices may not show VAT as last line — must fix for legal compliance.

## Processing fee (Summer-2026 brief, Section 5)

A flat **processing fee** is added on top of the VAT-inclusive subscription / pack price on every invoice charged via Paymob:

```
total charged = subscription (VAT-inclusive) + processing fee
```

**Two controls in `platform_config`, editable from `/admin/platform-config` (no rebuild):**
- `processing_fee_enabled` — bool, default **true**. Hides/shows the fee everywhere at once (invoice line + checkout display + legal disclosure).
- `processing_fee_amount` — number EGP, default **20**. Flat, never scales with cadence/amount (can change to e.g. 9).

Source of truth: `src/lib/processingFee.ts` (pure helpers — `applyProcessingFee`, `buildRedesignedInvoiceLines`, `vatInsideInclusive`, Arabic ⓘ copy) + `getProcessingFeeConfig()` in `src/lib/pricingConfig.ts` (reader, defaults to enabled @ 20 even before migration).

The fee applied to each invoice is snapshotted into **`invoices.metadata.processing_fee`** at creation, so rendered breakdowns are deterministic even if config later changes. For session-based charges (teacher subscriptions) it rides in `combined_payment_sessions.metadata.processing_fee` and is added to `paymob_amount` / `total_amount`.

**In scope (fee charged + redesigned display):** center subscription renewals, signup first payment, PAYG, parent-pack (`pack_billing`) + WhatsApp add-on (`whatsapp_addon`), teacher resubscribe + teacher upgrade, **`late_payment_fee`** (tier 1 + tier 2), and **`reactivation_fee`** (`centers/reactivate`).
**Deferred (no fee yet — follow-up):** center plan upgrades (`plan_upgrade_difference`), card-order `setup_fee`, session-based reactivation (`reactivation_tier1/2` combined sessions), Scale overage (overage billing not yet built).

### Late-fee / reactivation invoices (combined, single invoice)

A late-fee invoice is **one combined invoice** (subscription + late fee on the same bill), so it carries exactly **one** 20 EGP fee. CRITICAL math rule:

```
late fee  = late_fee_rate × subscription      (percentage on the SUBSCRIPTION only)
total     = subscription + late fee + 20 flat (processing fee never inside the % base)
```

The processing fee is a separate flat line; the late-fee percentage is **never** applied to it. Redesigned line order (Arabic, RTL): `قيمة الاشتراك → غرامة التأخر في السداد → رسوم المعالجة (ⓘ) → الإجمالي → ضريبة القيمة المضافة (مشمولة)`. Reactivation invoices: `رسوم إعادة التفعيل → رسوم المعالجة (ⓘ) → الإجمالي → ضريبة (مشمولة)`. Both drop the old stamp-duty / service-fee lines. Built via `buildCombinedInvoiceLines` (covered by `tests/unit/processingFee.test.ts`).

Referral commission base is **unaffected** — it derives from `centers.all_in_price` via `netReferralBaseFromAllInPrice`, never the invoice total (the fee is excluded, per brief Section 7).

### Redesigned customer invoice — subscription / pack types (Section 5)

Replaces the stamp-duty and service-fee lines for these invoice types. Order (Arabic, RTL):

```
قيمة الاشتراك                       999.00 EGP   (subscription, VAT-inclusive)
رسوم المعالجة (ⓘ)                    20.00 EGP   (processing fee; omitted when 0)
الإجمالي                          1,019.00 EGP   (total = subscription + fee)
ضريبة القيمة المضافة (مشمولة)        125.16 EGP   (VAT, LAST line — already inside the total, does NOT add)
```

VAT here is the simple VAT-inclusive 14% slice (`total × 0.14 / 1.14`); the legacy cascade (service 6% + stamp 0.5%) is **not** shown on these customer invoices. **Card-order (`setup_fee`) invoices keep the legacy cascade** in `buildLegalInvoiceLines` / `exclusiveTotalsStandard`.

The ⓘ on the processing-fee line opens an Arabic info sheet (`ProcessingFeeInfoButton`, `src/components/billing/ProcessingFeeInfo.tsx`) with a `تمام` dismiss; the PDF renders the same copy as a footnote.

## MRR computation (admin dashboards)

**Canonical API:** `getImpliedMonthlyMrr` in `src/lib/pricing.ts`.

- **Centre overload:** pass a `centers`-shaped object (`plan`, `all_in_price`, `billing_period`, `status`, `billing_type`, optional early-adopter fields). This is the single implementation used by **GET `/api/admin/billing`**, **GET `/api/admin/overview`**, and **GET `/api/admin/finance`** for subscription MRR.
- **Numeric overload:** `getImpliedMonthlyMrr(allInPerMonth, billingPeriod, planKey)` remains for callers that already resolved the quarterly monthly all-in rate.

**Fallback chain for the quarterly-plan monthly all-in rate** (`getQuarterlyAllInMonthlyRateFromCenter`):

1. Plan `top_centers`: `centers.all_in_price` required (invalid/missing → `0` in aggregates; strict paths may throw elsewhere).
2. Early adopter: `early_adopter_price` when `is_early_adopter`.
3. Else if `all_in_price > 0`: use it (same semantics as list **quarterly/mo** in the table above — not the monthly column).
4. Else: `PLANS[plan].quarterlyAllIn` for the resolved plan key (`planKeyOrStarter` maps unknown plans to `starter`).

**Billing period → implied monthly MRR:** `normalizeBillingPeriod`; semi-annual / half-yearly map to **quarterly** for MRR. **Quarterly** billing: implied MRR equals that monthly all-in rate. **Monthly** / **annual**: derived via `getChargeFromQuarterlyAllIn` / annual rounding ÷ 12 (see `computeImpliedMonthlyMrrFromBase`).

**Centres excluded from subscription MRR** (`isCenterEligibleForSubscriptionMrr`): **test centres** (`centers.is_test === true`) are always excluded (before status), regardless of account status. Additionally by status: `suspended`, `churned`, `deleted`, `cancelled`, `inactive`. **PAYG** (`billing_type === 'payg'`): subscription MRR `0`; PAYG estimate is added separately in billing/overview where applicable.

## Daily MRR snapshots (`mrr_snapshots`)

After applying the `mrr_snapshots` migration and **before** relying on the finance trend chart, trigger one snapshot so the table has at least one row:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://centerhq.app/api/cron/snapshot-mrr
```

Without this, the finance dashboard falls back to live subscription MRR for the trend (acceptable), but historical points stay flat until the nightly cron runs (`0 22 * * *` UTC — midnight Cairo).
## Subscription suspension grace period

- **`platform_config.subscription_grace_period_days`** — calendar days after `next_payment_due` before automatic suspension. Seeded default **7** (migration `20260510130000_subscription_grace_platform_config.sql`).
- **`centers.auto_suspend_at`** is computed when invoices/payments run using `autoSuspendAtFromDue(next_payment_due)` in `src/lib/billingSchedule.ts`, which defaults to **`SUBSCRIPTION_GRACE_CALENDAR_DAYS` (7)** unless callers pass a different grace length.
- **`process-renewals`** cron (`runSubscriptionBillingCron`) suspends centres when **`auto_suspend_at`** falls on the Cairo calendar **today** (not by recomputing grace inside the cron).

(End of spec doc.)
