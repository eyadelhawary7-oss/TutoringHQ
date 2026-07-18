# Findings — Centers billed monthly or annual only (retire the quarterly clock)

> Dated record. Synced against the live database on 2026-07-18. This doc retired quarterly at the **application layer only** and deferred the schema change (see Decisions). That deferral is now **superseded**: the schema change was subsequently applied (migration `20260705050120_billing_period_monthly_default.sql`; see `docs/BILLING_PERIOD_MONTHLY_DEFAULT_FINDINGS.md`). Current live state — `centers.billing_period` CHECK `IN ('monthly','annual')` default `'monthly'`; `subscription_billing_period` CHECK `IN ('monthly','yearly')` default `'monthly'` (verified live 2026-07-18). The "as-is" schema and the deferral decision below are preserved as the point-in-time record; where they describe current state they are now false and annotated inline.

Step-0 introspection before any change. Money code; surgical.

## Current center billing model (as-is)

### Schema (as-is at time of writing — now superseded; see banner)
- `centers.billing_period` — `text`, ~~default `'quarterly'`, CHECK `IN ('monthly','quarterly','annual')`~~. **Now (verified live 2026-07-18): default `'monthly'`, CHECK `IN ('monthly','annual')`.**
- `centers.subscription_billing_period` — `text`, ~~default `'quarterly'`, CHECK `IN ('monthly','quarterly','biannual','yearly')`~~. **Now (verified live 2026-07-18): default `'monthly'`, CHECK `IN ('monthly','yearly')`.** The vocabulary quirk survives: annual is still spelled **`yearly`** on this column, and bare `'annual'` is NOT allowed here.
- `centers.billing_amount` — `numeric`, default `0`. **Overwritten by a BEFORE INSERT/UPDATE trigger** (`trigger_update_billing_amount` → `update_billing_amount()` → `calculate_billing_amount(plan, billing_period)`). That legacy DB function has stale hardcoded prices (starter=1000, pro=1800, enterprise=3500, else 1000; monthly = base×1.075, quarterly = base×3, yearly = base×12×0.90) and is **superseded** by the app, which explicitly re-writes `billing_amount` at activation. The trigger only fires on `UPDATE OF plan, billing_period, billing_cycle_start`, so an app UPDATE that touches only `billing_amount` is NOT clobbered.
- `all_in_price` — `numeric`, the per-month base rate (equals `PLANS[].quarterlyAllIn`).

### Two data paths for the period
The app resolves cadence as `subscription_billing_period ?? billing_period` (auto-approve, reactivation, upgrade, invoices, PDF). `billing_period` is what signup sets; `subscription_billing_period` is left at its DB default `'quarterly'` at signup — this is the crux of the monthly bug (below).

### Signup (`src/app/api/signup/route.ts`)
- Route default period when the field is absent: `'quarterly'`. The **signup UI only offers monthly + annual** (`SignupForm.tsx` tabs `['monthly','annual']`, form default `'monthly'`), so real signups send `monthly`/`annual`.
- Insert sets `billing_period = periodResolved` but does **not** set `subscription_billing_period` → it defaults to `'quarterly'`.
- Insert `billing_amount = allInPerMonth * 3` (moot — trigger overwrites).
- First (signup) invoice `billing_period_end = billingEndForPeriod(start, period)` — already period-aware (+1 month for monthly). ✅

### Activation / auto-approve (`src/lib/signupPaymobAutoApprove.ts`)
- Resolves `period = normalizeBillingPeriod(subscription_billing_period ?? billing_period)`. Because `subscription_billing_period` is the DB-default `'quarterly'`, **a monthly signup currently activates as QUARTERLY**: `billing_amount = allIn×3`, `next_payment_due = +90 days`. This is the ×3 / 3-month bug for monthly.
- `nextPaymentDueDaysForPeriod`: monthly 30, annual 365, else 90. Correct once `period` resolves right.
- One function also writes `subscription_billing_period: period` (line 494) where `period` can be `'annual'` — which would **violate** the `subscription_billing_period` CHECK (`annual` not allowed). Latent; only reached if the field ever resolves to annual. We do NOT enable that path (annual left untouched — see below).

### Recurring engine (`src/lib/centerRenewal.ts`, `subscriptionBillingCron.ts`, `invoicePaymobPayment.ts`)
- `centerRenewalPeriodMonths(bp)`: annual→12, **everything else→3** (the quarterly clock). This is the three-month clock to remove for monthly.
- `centerRenewalBaseAmount`: annual→`all_in×annualMultiplier` (10); non-annual→stored `billing_amount`.
- Cron creates the renewal invoice `billing_period_end = npd + centerRenewalPeriodMonths` and amount `centerRenewalBaseAmount`. Paid handler advances `next_payment_due` by `centerRenewalPeriodMonths`.
- Paid-confirmation WhatsApp label: annual→`'سنوي'`; **non-annual→`'ربع سنوي'` (quarterly)**.

### Summer vs recurring — no interaction risk
`summerBillingCron.ts` issues its own first manual `subscription` invoice on the summer schedule (30-day window, its own base) and does **not** call `centerRenewalPeriodMonths` / `centerRenewalBaseAmount`. Only 5 files touch those helpers; summer is not one. First-charge gate, master switch, manual summer invoices, SUMMER26 code: untouched by this build.

### The two existing quarterly centers (live)
Both are **test rows** (`is_test = true`); there are no real customers.
| id | name | plan | billing_period | sub_billing_period | billing_amount | all_in_price |
|----|------|------|----------------|--------------------|----------------|--------------|
| fcd5c5ef… | Test Center 333 | starter | quarterly | quarterly | 3000 | NULL |
| f3826d18… | Test Owner Center | nano | quarterly | quarterly | 6000 | 2000 |
Plan: migrate both to monthly (billing_amount → monthly-equivalent = ÷3).

## What changes (monthly = the standard non-annual cadence)

1. **Signup** — default period `'monthly'`; set `subscription_billing_period='monthly'` for monthly signups so activation bills monthly (not the DB-default quarterly); `billing_amount` insert value made period-aware (cosmetic — trigger overwrites).
2. **Recurring** — `centerRenewalPeriodMonths`: monthly→**1** (annual 12; quarterly 3 kept as a defensive fallback only). Amount logic unchanged (monthly renews at the stored monthly `billing_amount`).
3. **Confirmation label** — non-annual → `'شهري'` (monthly); annual → `'سنوي'` unchanged.
4. **Test data** — the two quarterly test centers → monthly.

## Decisions & rationale (flagged for Eyad)
- **CHECK & column defaults kept unchanged (no schema migration) — DECISION SUPERSEDED.** At the time, quarterly was retired only at the application layer (UI = monthly/annual only; signup route + form default monthly; both cadence fields written explicitly), and the schema change was deferred because a PG17 snapshot regen could not be reproduced in that environment. **The recommended follow-up has since been done** (verified live 2026-07-18): `billing_period`/`subscription_billing_period` defaults flipped to `'monthly'` and the CHECKs tightened to `{monthly, annual}` / `{monthly, yearly}` via migration `20260705050120_billing_period_monthly_default.sql`. See `docs/BILLING_PERIOD_MONTHLY_DEFAULT_FINDINGS.md` for the applied change.
- **Annual left exactly as-is.** The annual recurring engine (+12 / ×10) is correct and untouched. `subscription_billing_period` is forced to monthly **only** for monthly signups; annual/quarterly keep their existing handling, so no annual code path (and no `subscription_billing_period` CHECK edge) is disturbed.
- **Legacy DB trigger `calculate_billing_amount` left in place** — it is superseded by the app's explicit `billing_amount` writes and does not emit a quarterly amount for a monthly insert. Out of scope.
- **Plan-upgrade confirmation label** (`handlePlanUpgradeInvoicePaid`) still hardcodes the quarterly Arabic label; that's a separate invoice flow (`plan_upgrade_difference`), not the everyday cadence. Left untouched; noted as a follow-up.
