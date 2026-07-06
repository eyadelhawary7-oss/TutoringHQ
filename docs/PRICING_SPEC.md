# CenterHQ Pricing Spec
Last updated: 2026-05-09

## Tax formula (internal)
The only customer tax is **14% VAT** (plus the separate flat 20 EGP processing fee — see below). The former **6% service fee** and **0.5% stamp duty** were removed in the service-fee/stamp-duty build (`docs/SERVICE_FEE_REMOVAL_FINDINGS.md`) — they no longer exist in the math or anywhere in the UI. Inclusive → base strips only VAT: base = inclusive × 0.86. Going up: inclusive = base / 0.86.

## Worked examples
Inclusive 4,999 → base 4,299.14
Inclusive 4,499 → base 3,869.14
Inclusive 999 → base 859.14
Per QR card: 60 EGP inclusive → base 51.6 (60 × 0.86)

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
qr_card: 60 EGP per card (inclusive of VAT), **plus one flat 20 EGP processing fee per order** (not per card — so per-card all-in falls with quantity: 1 card = 80, 2 = 140, 3 = 200, 6 = 380). Bosta added on top, not taxed.
parent_pack: 12 EGP/active parent/month (inclusive).
blast: 9.80 EGP/blast (inclusive). (The parent-blast product keeps its own internal `BLAST_SERVICE_FEE_RATE` — a separate additive fee, unrelated to the removed plan-price service fee.)

## Internal admin breakdown view (descending from inclusive)
Total:                              60.00 EGP
incl. VAT (14%):                     8.40
your net (base):                    51.60
For accounting/admin tooling ONLY.

## Customer-facing invoice display order (LEGAL REQUIREMENT)
Egyptian tax law (فاتورة ضريبية) requires VAT as the LAST tax line on any invoice. PDF receipts and legal invoices MUST display:

Subtotal (base):              51.60 EGP
VAT (14%):                     8.40    ← LAST tax line
─────────────────────────────────────
Total:                        60.00 EGP

NEVER show a service-fee or stamp-duty line — they no longer exist.

Display Annual prices ROUNDED to whole EGP. "849.917 EGP/month" is a bug.

## Audit divergences (2026-05-09) — superseded
The 6% service fee and stamp duty (the source of these divergences) were removed;
the tax model is now VAT-only, so items 1–3 (service/stamp cascade drift, stamp
0.4% vs 0.5%) no longer apply. Card price is a flat 60 EGP/card. Item 4 (VAT as
the last tax line) remains a standing legal requirement.

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

**Every charge invoice carries the flat 20 EGP** (one per invoice, never per line): center subscription renewals, signup first payment, PAYG, parent-pack (`pack_billing`) + WhatsApp add-on (`whatsapp_addon`), teacher resubscribe / upgrade / switch-interval / overage, `plan_upgrade_difference`, summer first invoice, **reactivation** (`centers/reactivate`), **card-order `setup_fee`**, and **announcement `_cap` / `_settlement`** (added in the service-fee/stamp removal — the earlier "Deferred" list is cleared).
**Not charged the fee (not customer charges):** `referral_payout` (money paid *out* to the referrer) and `payment_proof` (mirrors a referenced invoice; not a new charge).

### Late-fee / reactivation invoices (combined, single invoice)

A late-fee invoice is **one combined invoice** (subscription + late fee on the same bill), so it carries exactly **one** 20 EGP fee. CRITICAL math rule:

```
late fee  = late_fee_rate × subscription      (percentage on the SUBSCRIPTION only)
total     = subscription + late fee + 20 flat (processing fee never inside the % base)
```

The processing fee is a separate flat line; the late-fee percentage is **never** applied to it. Redesigned line order (Arabic, RTL): `قيمة الاشتراك → غرامة التأخر في السداد → رسوم المعالجة (ⓘ) → الإجمالي → ضريبة القيمة المضافة (مشمولة)`. Reactivation invoices: `رسوم إعادة التفعيل → رسوم المعالجة (ⓘ) → الإجمالي → ضريبة (مشمولة)`. Both drop the old stamp-duty / service-fee lines. Built via `buildCombinedInvoiceLines` (covered by `tests/unit/processingFee.test.ts`).

Referral commission base derives from `centers.all_in_price` via `netReferralBaseFromAllInPrice`, never the invoice total (the processing fee is excluded, per brief Section 7). With the service-fee + stamp-duty removal it strips **only VAT (divisor `1.14`)**; both former slices are commissionable, so referrers earn ~6.4% more than the original (approved change; see `docs/SERVICE_FEE_REMOVAL_FINDINGS.md`).

### Redesigned customer invoice — subscription / pack types (Section 5)

Replaces the stamp-duty and service-fee lines for these invoice types. Order (Arabic, RTL):

```
قيمة الاشتراك                       999.00 EGP   (subscription, VAT-inclusive)
رسوم المعالجة (ⓘ)                    20.00 EGP   (processing fee; omitted when 0)
الإجمالي                          1,019.00 EGP   (total = subscription + fee)
ضريبة القيمة المضافة (مشمولة)        125.16 EGP   (VAT, LAST line — already inside the total, does NOT add)
```

VAT here is the simple VAT-inclusive 14% slice (`total × 0.14 / 1.14`); no service or stamp line is ever shown. **Card-order (`setup_fee`) and announcement invoices** render a base + VAT breakdown via `buildLegalInvoiceLines` / `exclusiveTotalsStandard` (VAT-only; the service/stamp lines were removed).

The ⓘ on the processing-fee line opens an Arabic info sheet (`ProcessingFeeInfoButton`, `src/components/billing/ProcessingFeeInfo.tsx`) with a `تمام` dismiss; the PDF renders the same copy as a footnote.

## Billing lifecycle — single-day lock model ("Claude model")

Identical for centers and teachers. Source of truth: `src/lib/billingLifecycle.ts`
(pure + tested, `tests/unit/billingLifecycle.test.ts`).

1. Billing is anchored to **00:00 Africa/Cairo on the billing day** (calendar date
   only — never the signup hour).
2. If the charge fails / goes unpaid, the customer keeps **full access for the rest
   of that Cairo calendar day** (until 23:59:59), with a "pay today or lose access
   at midnight" banner.
3. At the **next 00:00 Cairo**, access **locks to the summary screen** (headline
   numbers — total students, total groups — plus a pay button). No individual
   records until paid.
4. **No late fee. No reactivation fee.** Coming back from a lock charges the
   **plain subscription price** only (`reactivationChargeAmount`). The flat 20 EGP
   processing fee remains on the normal subscription/renewal/pack/signup paths.
5. **Manual cancellation keeps full access until the end of the current paid
   cycle**, then lapses (no immediate lock). Centers already did this via
   `pending_cancellation`.
6. **No mechanism to move a billing date** — let the subscription lapse and
   resubscribe on the desired day.

**Enforcement (centers):** `centers.auto_suspend_at` is set to **00:00 Cairo on the
day after `next_payment_due`** (`autoSuspendAtFromDue` → `lockAtFromBillingDay`,
DST-safe); `src/proxy.ts` redirects to `/suspended` when `now >= auto_suspend_at`
and `billing_status != 'paid'`. The `/suspended` screen shows headline numbers
(total students, total groups) + a pay button.

**Enforcement (teachers) — deliberately DIFFERENT from centers:** the
`teacher_private_access` RPC gates the private engine. A **lapsed** teacher (had a
subscription, now locked) takes a **full drop to the free tier** — exactly like a
never-subscribed teacher — with NO summary screen and no headline-numbers view. Her
private surfaces show a "resubscribe to access your saved data" message + a
resubscribe action (`resolveTeacherPrivateView` → `records` / `resubscribe` /
`upsell`; the `resubscribe` and `upsell` views are both gated to the free tier, the
copy is the only difference). Private records stay gated by
`requireTeacherPrivateAccess`; **private data is preserved in the DB (never deleted
on lapse)** and resubscribing restores access exactly as it was. The **free zone
(center monitoring) is never locked**. Centers, by contrast, keep their `/suspended`
summary lock screen.

### Removed with this model (verify-then-delete)
- **5% late-payment fee + day-30 dormancy scan** — `runLateFeeAndDormancyScan`
  deleted from `renewalLateFeeDormancy.ts` and its `process-renewals` invocation
  removed (the file keeps only `incrementActiveMonthsOnFirstOfMonth`).
- **Reactivation fee (surcharge)** — `src/lib/reactivationFee.ts` deleted;
  `getReactivationAmount` (`billingEngine.ts`) zeroed to the plain next-period
  amount (covers `reactivate/start`, `billing/reactivate`); `centers/reactivate`
  now charges the plain subscription as a normal `subscription` invoice.
- **7-day grace** — `auto_suspend_at` retimed from `due + 7d` to the next Cairo
  midnight (`SUBSCRIPTION_GRACE_CALENDAR_DAYS = 1`).
- **`late_payment_fee` / `reactivation_fee` invoice template blocks** — removed;
  those types now render via the generic block (legacy invoices only).

### Pending / blocked (saved-card epic — Paymob Section 0)
- The **midnight auto-charge** itself needs the saved-card MIT ("no customer
  present") mechanism, which is unbuilt (no card token is stored). The lock model
  above is in place and activates once auto-charge lands.
- The **early card-expiry warning** needs the saved-card token's `expiry_month` /
  `expiry_year` stored (Paymob exposes them on the token, but we store no token
  today). **Paymob sends no documented pre-charge expiry signal** — the own-expiry
  check is the only path, and it depends on first storing the token.

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

## Saved-card auto-charge (Phase 1 — built, not yet wired)

- A card-on-file + auto-charge capability now exists: store a Paymob card
  **token** once (with explicit consent + a save-time validity check) and charge
  it later, idempotently, with no customer present. **Never stores the PAN.**
- It is **built and unit-tested but NOT wired to any cron** — Phase 2 calls
  `chargeSavedCard()` from the midnight billing run. Live charging also waits on a
  dedicated Paymob **recurring integration id**
  (`PAYMOB_RECURRING_INTEGRATION_ID`, not yet issued) and Paymob LIVE credentials.
- Full detail: `docs/SAVED_CARD_ENGINE.md`. Schema migration:
  `supabase/migrations/20260624120000_saved_card_engine.sql` (applied live).

## Midnight billing engine (Phase 2 — wired, inert pending recurring id)

- The midnight cron (`/api/cron/subscription-autocharge`, `0 22 * * *` =
  midnight Cairo) auto-charges due saved-card customers (centers + teachers),
  leaves wallet/no-card customers on an unpaid invoice + pay link, routes bank
  declines to the OTP fallback (no silent retry), and retries soft declines on a
  capped day 0/+3/+7 schedule. The single-day lock model now drives access
  enforcement (`resolveBillingAccess` via the proxy) and all side paths
  (signup/PAYG/admin) lock uniformly the next Cairo midnight.
- **Still inert**: with no `PAYMOB_RECURRING_INTEGRATION_ID` the engine charges
  nothing — every due customer is left on the manual surface. Phase 2 finishing
  does NOT make auto-charge live. Detail: `docs/SAVED_CARD_ENGINE.md`.

(End of spec doc.)
