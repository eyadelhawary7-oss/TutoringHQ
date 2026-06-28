# Step 0 — Findings note: Summer 2026 promo & automatic free-period billing

Introspection of the live catalog (project `lczmjpnbuhnsislcvzar`) and the repo, before writing
any code. Conclusion up front: **most of the machinery already exists.** This build extends the
promo / trial / billing / banner / referral systems already in place; it does **not** stand up
parallel ones. The gaps are: (1) a platform-wide *automatic* summer mode + its config keys,
(2) the summer trial/first-invoice/lock date persistence and the two daily jobs that drive them,
(3) the held-vs-released first-charge gate, (4) two-phase banner/popup wiring on all three public
pages, (5) the onboarding explainer, (6) surfacing referrals in the summer flow with the
"pending-until-first-paid-invoice" rule, and (7) tests.

> Note on referenced files: `BUILD_BRIEF_summer_pricing_invoice.md` and `summer_promo_v2_inbrand.html`
> are **not** present in the repo or git history. The "existing summer pricing invoice work" they
> refer to is the recently-merged billing stack (PRs #98–#110): customer invoices + `/pay` page,
> the single-day lock model, teacher invoice parity, midnight billing engine, billing nudges, and
> billing reconciliation. This build sits on top of that stack.

---

## 1. Promo-code system (exists — leave as optional marketing)

- **RPC** `redeem_promo_code(p_code_id, p_user_id, p_center_id, p_paymob_order_id, p_original_amount_egp, p_discount_amount_egp)` — `SECURITY DEFINER`, grants to `authenticated` + `service_role`. Atomic check + `uses_count` increment; per-center idempotency via `UNIQUE(promo_code_id, center_id)`. (`baseline.sql`)
- **Tables** `promo_codes` (code, discount_pct, max_uses_total, uses_count, expires_at, is_active) and `promo_code_redemptions` (UNIQUE per center).
- **Super-admin page** `src/app/[locale]/admin/promo-codes/page.tsx` (+ `api/admin/promo-codes`). Create/list/activate/deactivate/delete.
- **`redeemPromoCodeForPaymobOrder`** in `src/lib/redeemPromoCode.ts`, called from `src/app/api/paymob/webhook/route.ts` on a paid `signup_first_payment` invoice that carries a `promo_code`.
- **Decision:** the shared promo code stays for optional marketing. **Summer mode is codeless** — no code chip on the public banner. We do not touch `redeem_promo_code`.

## 2. Trial concept (teachers only today)

- Trial lives **only on `teacher_subscriptions`**: `status` (default `trialing`), `trial_ends_at`, `current_period_start/end`, `free_months_credit`. Provisioned by trigger `provision_teacher_subscription_on_first_private_group()` on first private group → `status='trialing'`, `trial_ends_at = now() + trial_days` (from `platform_config.teacher_subscription_plan.trial_days`, default 14).
- **`centers` and `subscriptions` have NO trial columns.** Centers are billed on a billing-window anchor (`billing_cycle_start`, `next_billing_date`/`next_payment_due`, `billing_period`), not a trial.
- Read paths: `TeacherTrialBanner.tsx` (hardcoded `TRIAL_DAYS=14`), `api/teacher/subscription/status`.
- **Gap:** the summer trial is a *new, platform-wide* concept that must apply to **both** centers and teachers, with explicit `trial_start / first_invoice_at / lock_at` per the brief's formulas. These dates are not persisted anywhere today.

## 3. Billing / invoice flow (exists — reuse)

- **`invoices`** table (denormalized line items; no `invoice_items` table). Status `pending|paid|overdue|void`, `owner_type` `center|teacher`, `due_date`, `total_amount`, `metadata` jsonb, Paymob fields.
- **Finalize RPCs** (atomic, idempotent, `SECURITY DEFINER`): `finalize_subscription_invoice_paid(...)` and `finalize_teacher_invoice_paid(...)`. These flip the invoice to paid, advance the billing window, and reactivate a suspended account.
- **Single-day lock model** — `src/lib/billingLifecycle.ts`: billing fires 00:00 Cairo on the billing day; failed charge keeps full access that day (`failed_today` banner); next 00:00 Cairo → `locked`. `lockAtFromBillingDay(day)` = 00:00 Cairo of day+1, stored in `centers.auto_suspend_at`. Lock checked at request time by `billingAccessGate.centerIsLockedNow()` and by `src/proxy.ts`.
- **Read-only / locked screen** — `src/app/[locale]/suspended/page.tsx` (`?reason=payment_overdue|center_suspended`). Shows headline numbers + **"Pay Now" → `/pay`** (or `/reactivate`). This is the screen we reuse for summer locks; **already has a pay button.**
- **Customer pay page** — `src/app/[locale]/pay` (moved off `/billing` in PR #99).
- **Crons (daily/relevant):** `subscription-autocharge` (00:00 Cairo midnight billing; INERT without `PAYMOB_RECURRING_INTEGRATION_ID` → everyone lands on the manual pay surface, which is exactly what invoice-based summer billing wants), `process-renewals`, `payg-billing` (month-end), `parent-pack-billing`, `billing-nudges` (dunning), `billing-reconciliation`, `referral-automation`, `commission-t2-check`, `loyalty-bonus-check`. Cron auth = `Authorization: Bearer ${CRON_SECRET}`; all honor `platform_config.cron_paused`.
- **Cairo helpers** — `src/lib/cairo/day.ts`: `cairoDateKey`, `cairoYmdPlusDays/MinusDays`, `parseCairoYmd`, `startOfCairoDay`, `startOfUtcInstantForCairoCalendarDay`, `getCurrentCairoClock`, etc. All summer date math will use these.

## 4. Referral engine (exists in both portals — surface + gate, don't rebuild)

- **Centers:** `referrals` (status, `referred_first_paid_at`, `converted_at`), `referral_rewards` (cash, `first_month_fee`, `reward_amount`, `reward_status`), `referral_reward_records` (monthly cash ladder 25% M1 held 30d / 10% M2–12 / 5% M13+), `referral_commissions`. Monthly calc: `api/referrals/calculate-rewards`. UI: `src/app/[locale]/referrals/page.tsx`, `settings/referrals`. Cron `referral-automation`.
- **Teachers:** `src/lib/teacherReferral.ts` `grantReferralReward()` → +1 `free_months_credit` to both referee and referrer, idempotent via `teacher_subscriptions.referral_rewarded_at`. Called from `combinedPaymentFinalize` after referee's first cleared charge. UI: `teacher/ReferralCard.tsx`, `MyCodeCard.tsx`.
- **Cross-segment first-paid-month credit:** modeled by `referrals.referred_first_paid_at` + `centers.referral_reward_amount/status`.
- **Key alignment:** rewards are *already* keyed off "first paid" signals (`referred_first_paid_at`, the first cleared charge). The summer rule — **no reward during the free period; convert each pending referral only when the referred customer pays their first invoice** — fits the existing model. **Gap:** ensure referral recording during the free weeks stays `pending` and is converted precisely at first-invoice payment (Aug 30+), and surface a referral CTA in the summer flow on both portals.

## 5. Landing banner & popup config (exists — extend to two-phase + all three pages)

- **Config keys (in `platform_config`)**, defined in `src/lib/pricingConfig.ts`:
  - Banner: `pricing.banner.enabled|text_en|text_ar|subtext_en|subtext_ar|style|cta_text_en|cta_text_ar|cta_url`
  - Popup: `landing.popup.enabled|title_en|title_ar|body_en|body_ar|promo_code|cta_text_en|cta_text_ar|cta_url|delay_seconds`
- **Admin editor:** `src/app/[locale]/admin/pricing/page.tsx` (super-admin) with live preview. Read via `getBannerConfig()/getPopupConfig()`; public read via `api/pricing/public-config`.
- **Components:** `src/components/landing/PricingBannerClient.tsx` (`variant="strip"|"section"`), `src/components/landing/PromoPopup.tsx` (session-dismiss via `sessionStorage` 'promo_popup_dismissed', copy-to-clipboard code chip).
- **Where they render today:**
  - Combined/home `HomePageClient.tsx` → banner **and** popup. (`/[locale]`, and `/[locale]/center` reuses it.)
  - Unified pricing `PricingPageClient.tsx` → banner only.
  - Teacher landing `teacher/landing/TeacherLandingClient.tsx` → banner only (**no popup**).
- **Gaps vs brief:**
  - Two-phase, never-empty messaging (Phase 1 until Aug 16; Phase 2 evergreen trial after) — today the banner is single static config.
  - Per-portal accent (forest green `#2e5a4c` centers/combined; bronze gold `#8f7322` teachers) and the serif/display face (Playfair/Bodoni already wired via `next/font` in `layout.tsx`).
  - **Popup uses `sessionStorage`** — brief requires a **non-PII cookie** (once per visitor) and bans localStorage; must switch. Countdown "billing starts in" → `FIRST_CHARGE_FLOOR`. **No code chip** during summer.
  - Popup must be added to the **teachers** page (and confirmed on combined + centers).

## 6. Usage → tier (exists — reuse for projection)

- **Centers six-tier ladder** (`src/lib/pricing/plans.ts`): Solo 50 / Nano 120 / Starter 200 / Pro 500 / Business 1000 / Enterprise 2000 (+ Top Centers custom via `centers.all_in_price`). Quarterly all-in prices per tier; interval multipliers `pricing.interval.*`.
- **Teachers three tiers** (`src/lib/teacherPlans.ts` + `platform_config.teacher_subscription_plan[_pro|_scale]`): Standard 499 (cap 20) / Pro 999 (cap 50) / Scale 2499 (100 base + 20/student overage). `teacherStudentCap`, `teacherHasHardCap`, `teacherOverageAmount`.
- **Tax/fee** (`src/lib/pricing/taxMath.ts`): VAT 14% + stamp 0.5% + service 6% **cascading multiplication**; `explodeInclusive`, `buildLegalInvoiceLines`. Processing fee flat (`platform_config.processing_fee_amount`, default 20; `processing_fee_enabled`).
- **Gap:** a single "project my first invoice now" helper that, given a center/teacher's live usage, returns {tier, projected inclusive amount, fee + VAT lines, first_invoice_at} for display in dashboard + billing area + onboarding explainer.

## 7. `platform_config` keys today (relevant)

- Existing promo/pricing: `pricing.promo.enabled=true`, `pricing.promo.discount_pct=30`, `pricing.promo.end_date="2026-08-14"`, `pricing.promo.spots_total=100`, `pricing.banner.*`, `landing.popup.*`, `pricing.interval.*`, `processing_fee_enabled=true`, `processing_fee_amount=20`, `teacher_subscription_plan*` (with `trial_days=14`), `cron_paused`, `read_only_mode`, `maintenance_mode`, `subscription_grace_period_days=7`.
- **No summer keys yet.** **Gap — to add:** `summer.promo.enabled` (master switch), `summer.free_until` (Aug 16 2026), `summer.first_charge_floor` (Aug 30 2026), `summer.trial_days` (14), `summer.pay_window_days` (2), `summer.first_charge_release` (`HELD`|`RELEASED`, default `HELD`).

## 8. Pre-existing `centers.summer_mode` (do NOT repurpose)

- `centers.summer_mode` (boolean) already exists — a **per-center manual toggle** (admin center page + `settings/general`) that only appends a `SUMMER_NOTE` to WhatsApp renewal reminders (`whatsapp/flows/renewalReminders.ts`). It is **not** the platform-wide automatic summer mode this brief wants. We keep it untouched and drive automatic summer mode from the new `summer.promo.*` `platform_config` keys + new per-customer summer trial columns.

---

## The gaps this build will close

1. **Migration(s)** (text+CHECK, uuid PKs, numeric(10,2), end with `NOTIFY pgrst`):
   - Seed the six `summer.*` `platform_config` keys.
   - Add per-customer summer trial columns: on `centers` and `teacher_subscriptions` — `summer_trial_start date`, `summer_first_invoice_at date`, `summer_lock_at timestamptz`, `summer_enrolled_at timestamptz`, plus a `summer_first_invoice_id uuid` link. (text+CHECK only; no enums.)
   - Referral pending/convert: confirm `referrals.status` + `referred_first_paid_at` carry the pending→granted transition; add a guard so no reward is granted while the referred customer has not paid a first invoice.
2. **Lib** `src/lib/summer/` — date math (`trial_start/raw_trial_end/first_invoice_at/lock_at` per formulas, all Cairo), config loader, tier+amount projection (centers & teachers), held/released gate helper. Pure + unit-tested.
3. **Crons** — extend the daily flow: an Aug-16 enrollment pass (set summer trial dates for every signed-up customer; automatic, no gate) and an Aug-30+ first-invoice pass (issue first invoice → pay-window → lock; gated on `summer.first_charge_release = RELEASED`). Reuse `invoices` + the lock model + `billing-nudges` reminders.
4. **Admin** — surface the six `summer.*` controls (incl. master switch + HELD/RELEASED) in `admin/pricing`.
5. **Frontend** — two-phase ribbon + popup (cookie-based, countdown to floor, no code chip, per-portal accent + serif) on combined, centers, and teacher landing pages; live first-invoice projection in dashboard + billing area; onboarding Paymob-step explainer during summer; referral CTA in the summer flow on both portals.
6. **Tests** — trial-end/first-invoice/pay-window/lock formulas; held-vs-released gate; tier projection amount; referral pending→granted-on-first-paid; banner/popup phase + kill switch.
</content>
</invoke>
