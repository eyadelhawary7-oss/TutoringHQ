# Service-fee (6%) + stamp-duty removal — findings & proof

> Point-in-time build record. Re-synced against live code/DB on 2026-07-18: this
> work has **SHIPPED**. Current verified state — the 6% service fee and 0.5% stamp
> duty are **gone** from the code (no `SERVICE_RATE` / `STAMP_RATE` in
> `src/lib/pricing/taxMath.ts`; only `VAT_RATE = 0.14` remains) and from every
> customer surface. Only **VAT 14% (inclusive) + the flat 20 EGP processing fee**
> are customer-visible (verified live 2026-07-18). The end-state numbers are the
> **Phase 3 / Phase 5** figures below, NOT the intermediate Phase-1/Phase-2
> proposals: card = **flat 60 EGP/card** (`CARD_UNIT_BASE_EGP = 60 / 1.14`),
> referral commission divisor = **`1.14`** VAT-only (`REFERRAL_NET_REVENUE_DIVISOR
> = 1.14`), referral payout = **(gross − 20) × 0.95** with a **1,000 EGP** minimum
> (`REFERRAL_WITHDRAWAL_FEE_RATE = 0.05`, `REFERRAL_WITHDRAWAL_MIN_EGP = 1000`) —
> all verified in code 2026-07-18. The "HOLD before PR / no PR until Eyad approves"
> notes throughout are the historical record of when this was in flight; the branch
> has since merged. Intermediate figures (e.g. Phase-2 card base 51.6, divisor
> `1.14 × 1.004`) were **superseded within this same doc** by Phase 3/5 — preserved
> below for the record, not current.

**Original status line (historical):** BUILT on `claude/remove-service-fee-o65jvo`,
HOLD before any PR. The Phase-1 investigation (below) is unchanged for the record;
**Phase 2 (implemented)** at the end of this doc has the combined proof for the
locked decisions plus the stamp-duty removal.

**Phase 1** proved what removing the 6% service fee does, tier by tier, and
surfaced the two money side-effects. Decisions were then locked by Eyad and
folded in with stamp-duty removal — see **Phase 2**.

**Goal restated:** make the 6% "service fee" disappear from the math and the UI,
while **every price a center or teacher pays stays byte-identical**. The 6% was
never paid out to anyone — it was an internal slice of how the all-in price was
built. After removal that slice simply stays as retained margin.

---

## 1. Where the 6% lives (complete map)

The plan-price service fee is a **code constant only** — `SERVICE_RATE = 0.06`
in `src/lib/pricing/taxMath.ts`. **No `platform_config` row and no DB column
holds it**, so removing it needs **no migration** (guardrail 3 does not apply to
this fee).

### Computed (math)
| File | Symbol | Role |
|---|---|---|
| `src/lib/pricing/taxMath.ts` | `SERVICE_RATE = 0.06` | the constant |
| `src/lib/pricing/taxMath.ts` | `MARKUP_FACTOR` | `1/((1-VAT)(1-STAMP)(1-SERVICE))` — **unused by any price path** (dead-ish; only exported) |
| `src/lib/pricing/taxMath.ts` | `baseFromInclusive` / `inclusiveFromBase` | cascade strip / gross-up. **`inclusiveFromBase` sets the card-order charged price** (see §4a) |
| `src/lib/pricing/taxMath.ts` | `explodeInclusive` | decomposes an inclusive total into vat/stamp/**service**/base for display |
| `src/lib/referralNetBase.ts` | `REFERRAL_NET_REVENUE_DIVISOR = 1.14 * 1.06 * 1.004` | **strips the 6% to get the commission base** (see §4b) |

### Displayed (labels / rows)
| Location | What it shows |
|---|---|
| `src/app/[locale]/signup/SignupForm.tsx:658` | signup summary row `{ taxKey: 'service', label: t('serviceFee'), val: 'Included' }` |
| `messages/{ar,en}.json` → `signup.serviceFee` | "رسوم الخدمة 6٪" / "Service fee 6%" |
| `taxMath.ts` `LABELS` (`serviceFee`, `inclService`) | hardcoded AR/EN labels used by `buildLegalInvoiceLines` / `buildInternalBreakdown` |
| `src/lib/invoiceTemplates.ts` (lines ~346, 351, 941, 949) | card-order (`setup_fee`) legal invoice service line + tax-note footnote |
| `src/lib/generateInvoicePdf.ts:205` | card-order PDF tax-note footnote "رسوم الخدمة 6%" |
| `messages/{ar,en}.json` → `invoice.serviceFee`, `pricing.lines.serviceFee`, `pricing.lines.inclService` | **dormant keys** — no `t()` consumer reads them today |

> Note: center **subscription** invoices already dropped the service/stamp lines
> in the processing-fee redesign (they show a simple VAT-inclusive slice). The
> legacy cascade with a service line now only renders on **card-order
> (`setup_fee`) invoices** and in the internal/admin breakdown + the signup
> summary "included" row.

---

## 2. Architecture: anchors decomposed, NOT net-grossed-up

This is the decisive finding.

- **Center plans** (`src/lib/pricing/plans.ts`) — every charged number
  (`quarterlyAllIn`, `monthlyListPrice`, `annualEffectiveMonthly`) is a
  **hardcoded anchor**. The gross-up **never sets these prices**; the cascade is
  only used to *decompose* the fixed inclusive total into display lines.
- **Teacher plans** (`src/lib/teacherPlans.ts`) — `priceGross` hardcoded; the
  only tax is **VAT 14% inclusive** (`net = gross/1.14`). **The service fee is
  not used anywhere in teacher pricing**, including the Scale 20-EGP/student
  overage.
- **Only exception — card orders** (`inclusiveFromBase(qty × 50)`): the charged
  price is genuinely **computed by grossing a 50-EGP base up through the full
  cascade** (VAT + stamp + service). This is the one place removing the 6% would
  move a charged price by itself.

**Conclusion:** for every plan price in the anchor list, removing the 6% changes
**nothing** — the fixed number is untouched, only its display decomposition
loses one row (the former service slice folds into the base line). The two
places where a charged/paid amount actually moves are **card orders** and the
**referral commission base** (§4).

---

## 3. Price-parity proof — every anchor identical

### 3a. Center plans (charged prices — all hardcoded anchors, unchanged)
| Tier | Quarterly/mo | Monthly list | Annual charge (×10) | Annual/mo |
|---|--:|--:|--:|--:|
| Solo | 999 | 1,149 | 9,990 | 833 |
| Nano | 1,999 | 2,499 | 19,990 | 1,666 |
| Starter | 4,499 | 5,199 | 44,990 | 3,749 |
| Pro | 7,999 | 9,199 | 79,990 | 6,666 |
| Business | 12,999 | 14,999 | 129,990 | 10,833 |
| Enterprise | 18,499 | 21,299 | 184,990 | 15,416 |

These live in `SUBSCRIPTION_PLAN_DEFINITIONS` and are **not derived from
`SERVICE_RATE`**. Removing the constant does not touch a single value. ✅

### 3b. Display decomposition of the monthly all-in (total stays identical)
Removing the service row folds its amount into the base line; the **total is
byte-identical** in every tier.

| Tier | Total | WITH 6% (base / svc / stamp / vat) | NO 6% (base / stamp / vat) | Total match |
|---|--:|---|---|:--:|
| Solo | 999 | 803.55 / 51.29 / 4.30 / 139.86 | 854.84 / 4.30 / 139.86 | ✅ |
| Nano | 1,999 | 1,607.91 / 102.63 / 8.60 / 279.86 | 1,710.54 / 8.60 / 279.86 | ✅ |
| Starter | 4,499 | 3,618.81 / 230.99 / 19.35 / 629.85 | 3,849.79 / 19.35 / 629.86 | ✅ |
| Pro | 7,999 | 6,434.06 / 410.68 / 34.40 / 1,119.86 | 6,844.74 / 34.40 / 1,119.86 | ✅ |
| Business | 12,999 | 10,455.85 / 667.39 / 55.90 / 1,819.86 | 11,123.24 / 55.90 / 1,819.86 | ✅ |
| Enterprise | 18,499 | 14,879.82 / 949.78 / 79.55 / 2,589.85 | 15,829.59 / 79.55 / 2,589.86 | ✅ |

(The VAT line is the drift-absorbing line, so it can wobble by ≤1 cent in the
*display* — e.g. Starter 629.85 → 629.86. This is a decomposition-display detail
on non-customer-facing breakdowns; **no charged total changes**. These breakdowns
mostly disappear anyway once the service line is removed.)

### 3c. Teacher plans (VAT-only — service fee absent, nothing to change)
| Tier | Gross (charged) | Net | VAT | Notes |
|---|--:|--:|--:|---|
| Standard | 499 | 437.72 | 61.28 | SERVICE_RATE not referenced |
| Pro | 999 | 876.32 | 122.68 | SERVICE_RATE not referenced |
| Scale | 2,499 | 2,192.11 | 306.89 | + 20 EGP/active student overage (flat, no service fee) |

✅ Identical — teacher pricing never touched the 6%.

---

## 4. Money side-effects (charged/paid amounts that DO move) — decision needed

### 4a. Card orders (`inclusiveFromBase` from 50-EGP base) — CHARGED price
The QR-card price is grossed up through the cascade, so stripping the 6% **lowers
the charged card price ~6%**:

| Qty | WITH 6% (charged today) | NO 6% (naive removal) | Δ |
|---|--:|--:|--:|
| 1 card | 62.16 | 58.43 | −3.73 |
| 5 cards | 310.81 | 292.16 | −18.65 |
| 50 cards | 3,108.07 | 2,921.58 | −186.49 |

**To keep the card price byte-identical**, re-base the unit so the 6% slice folds
into the base: `CARD_UNIT_BASE_EGP` **50 → 53.19**
(`53.19 = 62.16 × 0.995 × 0.86`). Verified: with base 53.19 and no service,
`inclusiveFromBase` returns **62.16/card** and **3,108/50 cards** — same as today.

- **Recommended:** re-base to 53.19 → card price unchanged, 6% becomes margin.
- **Decision for Eyad:** is the QR card meant to hold at 62.16 (re-base), or is a
  ~6% card-price drop acceptable? *(Cards are not in the anchor list, so this is
  a genuine modeling call.)*

### 4b. Referral commission base (`REFERRAL_NET_REVENUE_DIVISOR`) — PAID amount
The commission base strips VAT × **service** × stamp from `all_in_price`. Drop
the ×1.06 and the base — and every referrer payout — rises ~6%:

| Tier | all_in | Base WITH 6% | Base NO 6% | Base Δ | Month-1 payout (25%) WITH | NO | Payout Δ |
|---|--:|--:|--:|--:|--:|--:|--:|
| Solo | 999 | 823.42 | 872.82 | +49.40 | 206 | 218 | +12 |
| Nano | 1,999 | 1,647.66 | 1,746.52 | +98.86 | 412 | 437 | +25 |
| Starter | 4,499 | 3,708.27 | 3,930.77 | +222.50 | 927 | 983 | +56 |
| Pro | 7,999 | 6,593.12 | 6,988.71 | +395.59 | 1,648 | 1,747 | +99 |
| Business | 12,999 | 10,714.34 | 11,357.20 | +642.86 | 2,679 | 2,839 | +160 |
| Enterprise | 18,499 | 15,247.68 | 16,162.54 | +914.86 | 3,812 | 4,041 | +229 |

(Rates: month 1 = 25%, months 2–12 = 10%, 13+ = 5%. Consumers:
`api/referrals/process-commission`, `api/cron/referral-automation`.)

- **Recommended:** **keep `REFERRAL_NET_REVENUE_DIVISOR = 1.14 * 1.06 * 1.004`
  exactly as-is** (the 6% stays excluded from commissionable revenue as retained
  margin). Payouts then stay byte-identical. The constant just stops being
  "the service fee" and becomes a fixed margin factor — I'd rename/re-comment it,
  not change its value.
- **Decision for Eyad:** does the now-retained 6% become commissionable (referrers
  earn ~6% more, per the table) or stay excluded (payouts unchanged)?

---

## 5. Separate 6% that is NOT this fee (flag only, do not touch)

`BLAST_SERVICE_FEE_RATE = 0.06` in `src/lib/parentPack.ts` (used by
`api/parent-pack/announcement`, columns `announcement_blasts.service_fee` /
`parent_pack_billing.service_fee`) is a **different product** — an **additive**
service fee on WhatsApp parent-announcement blasts, not the plan-price gross-up.
It is a real charged fee on a different bill. **Out of scope** for this build;
flagging so it isn't confused with the target. Leave untouched unless Eyad says
otherwise.

---

## 6. Proposed Phase-2 change set (pending approval)

If Eyad approves "keep card price + keep referral payouts identical":

1. `taxMath.ts` — delete `SERVICE_RATE`; `explodeInclusive` drops the service
   slice (base absorbs it); `inclusiveFromBase`/`baseFromInclusive` drop the
   `(1-SERVICE)` factor; **re-base `CARD_UNIT_BASE_EGP` 50 → 53.19** so card
   prices hold; remove `serviceFee`/`inclService` from `LABELS`; drop the service
   line from `buildLegalInvoiceLines`/`buildInternalBreakdown`; retire
   `MARKUP_FACTOR` (or drop its SERVICE factor if kept).
2. `referralNetBase.ts` — **keep the numeric divisor identical**; rename/re-comment
   so it no longer reads as "service fee" (value frozen → payouts unchanged).
3. `SignupForm.tsx` — remove the `taxKey: 'service'` row.
4. `invoiceTemplates.ts` / `generateInvoicePdf.ts` — remove the card-order service
   line + drop "رسوم الخدمة 6%" from the tax-note footnotes.
5. `messages/{ar,en}.json` — remove `signup.serviceFee`, and the dormant
   `invoice.serviceFee`, `pricing.lines.serviceFee`, `pricing.lines.inclService`
   (from **both** locales to keep i18n parity).
6. `docs/PRICING_SPEC.md` — update the tax formula + breakdown sections.
7. Tests — update `taxMath.test.ts`, `cart-totals.test.ts` and any pricing tests
   that assert the 6% (base numbers change; **all totals/anchors stay**).

Keep unchanged: **VAT 14%**, **stamp 0.5%**, **flat 20 EGP processing fee**,
every plan anchor, and (recommended) every referral payout.

---

## 7. Bottom line for Eyad

- **All plan prices (center + teacher) are safe** — hardcoded anchors, the 6%
  never set them. Removal is display-only for plans. ✅
- **Two amounts move unless handled**, both fixable to byte-identical:
  1. **Card price** — re-base `CARD_UNIT_BASE_EGP` 50 → 53.19. *(Confirm.)*
  2. **Referral payouts** — keep the divisor's ×1.06 (freeze value). *(Confirm.)*
- **Decisions needed:** (a) card price hold vs ~6% drop; (b) referral payouts
  frozen vs ~6% uplift; (c) confirm the parent-blast `BLAST_SERVICE_FEE_RATE`
  stays untouched.

**No code will change until you approve the above.**

---

# PHASE 2 — service fee + stamp duty removed (BUILT, hold before PR)

Locked decisions applied: **card price → flat 60 EGP/card**, **referrers earn ~6%
more** (service slice now commissionable), **parent-blast `BLAST_SERVICE_FEE_RATE`
left untouched**. Standing rule enforced: customers see **only 14% VAT + the flat
20 EGP processing fee** — no service fee, no stamp duty, anywhere.

## A. Stamp-duty rate report (as mandated — every location + value)

| Location | Symbol / string | Value | Notes |
|---|---|---|---|
| `src/lib/pricing/taxMath.ts` | `STAMP_RATE` | **0.005 (0.5%)** | the only code constant; removed |
| `src/lib/referralNetBase.ts` | divisor factor | **1.004 (0.4%)** | **DISAGREES with taxMath's 0.5%** |
| i18n labels (`invoice/signup/pricing.lines/orderSummary` + tax notes) | "0.5٪" / "0.5%" | 0.5% | dormant; removed |
| invoice PDF/HTML templates | hardcoded "رسوم الدمغة (0.5%)" | 0.5% | removed |
| **DB / `platform_config`** | — | **none** | live catalog introspected: no stamp column, no config row |

**Disagreement stated plainly:** the cascade used **0.5%** (`taxMath`) while the
referral divisor used **0.4%** (`1.004`). Both are now moot for customer display
(stamp is gone). Per the locked "+6% only" referral decision, the referral
divisor keeps its `1.004` factor unchanged (so the stamp portion of payouts does
not move); only the service `1.06` was dropped. **Stamp is code-only → no
migration** (guardrail 3 does not apply).

## B. Combined price-parity proof — every anchor byte-identical

### Center plans (charged anchors — unchanged; hardcoded, never grossed up)
| Tier | Quarterly/mo | Monthly list | Annual (×10) | Annual/mo |
|---|--:|--:|--:|--:|
| Solo | 999 | 1,149 | 9,990 | 833 |
| Nano | 1,999 | 2,499 | 19,990 | 1,666 |
| Starter | 4,499 | 5,199 | 44,990 | 3,749 |
| Pro | 7,999 | 9,199 | 79,990 | 6,666 |
| Business | 12,999 | 14,999 | 129,990 | 10,833 |
| Enterprise | 18,499 | 21,299 | 184,990 | 15,416 |

Display decomposition is now **base + VAT only**, totals unchanged, e.g. Solo 999
→ base 859.14 + VAT 139.86; Enterprise 18,499 → base 15,909.14 + VAT 2,589.86. ✅

### Teacher plans (VAT-only — never touched service/stamp)
| Tier | Gross (charged) | Net | VAT | Overage |
|---|--:|--:|--:|---|
| Standard | 499 | 437.72 | 61.28 | — |
| Pro | 999 | 876.32 | 122.68 | — |
| Scale | 2,499 | 2,192.11 | 306.89 | 20 EGP/active student (flat) |
✅ Identical.

### Card orders (approved price change → flat 60)
`CARD_UNIT_BASE_EGP` 50 → **51.6**; `inclusiveFromBase` now VAT-only (`base/0.86`).

| Qty | Before (cascade) | After (locked) | per-card |
|---|--:|--:|--:|
| 1 | 62.16 | **60.00** | 60 |
| 5 | 310.81 | **300.00** | 60 |
| 50 | 3,108.07 | **3,000.00** | 60 |

### Referral commission base + payout (approved +6%)
Divisor `1.14 × 1.06 × 1.004` → **`1.14 × 1.004`** (drop service only).

| Tier | all_in | Base before | Base after | m1 payout (25%) before → after |
|---|--:|--:|--:|--:|
| Solo | 999 | 823.42 | 872.82 | 206 → **218** |
| Nano | 1,999 | 1,647.66 | 1,746.52 | 412 → **437** |
| Starter | 4,499 | 3,708.27 | 3,930.77 | 927 → **983** |
| Pro | 7,999 | 6,593.12 | 6,988.71 | 1,648 → **1,747** |
| Business | 12,999 | 10,714.34 | 11,357.20 | 2,679 → **2,839** |
| Enterprise | 18,499 | 15,247.68 | 16,162.54 | 3,812 → **4,041** |

## C. 20 EGP processing fee — coverage by invoice type (report, not auto-added)

**Carries the 20 EGP today** (via `applyProcessingFee` / `processing_fee` snapshot):
`subscription`, `base_subscription`, `signup_first_payment`, `plan_upgrade_difference`,
`pack_billing`, `whatsapp_addon`, `payg`, teacher `resubscribe` / `upgrade` /
`switch-interval` / `teacher_overage`, and the summer first invoice.

**Does NOT carry the 20 EGP** (unchanged — flagged, not auto-added per brief step 5):
- `setup_fee` (QR card orders) — total = product + shipping, no processing fee.
- `reactivation` (`centers/reactivate`) — explicitly sets `processing_fee: 0`.
- `announcement_settlement` / `announcement_cap` (parent-blast product).
- `referral_payout`, `payment_proof` (payouts / proofs, not charges).

This matches the documented "Deferred" list in `PRICING_SPEC.md`. **Decision for
Eyad:** should the fee be extended to any of these (esp. card orders), or stay as-is?

## D. Guard result

Rendered customer surfaces scanned for `رسوم الخدمة` / `رسوم خدمة` / `الدمغة` /
`دمغة` / "service fee" / "stamp" / `6٪` / `0.5%` / `(6%)`: **zero customer-visible
matches.** The only hits are code comments (describing the removal) and the
intentionally-untouched `BLAST_SERVICE_FEE_RATE` (separate blast product). VAT 14%
present and unchanged everywhere.

## E. Verification

- `next build` ✅ · unit **1147/1147** ✅ · typecheck ✅ · lint 0 errors ✅ ·
  i18n parity ✅ · bidi ✅ · tolocale ✅.
- Pricing tests updated to VAT-only + card 60 (`taxMath.test.ts`, `cart-totals.test.ts`).

## F. Open question for Eyad (one)

The referral divisor still carries the stamp `1.004` factor (kept so the stamp
portion of payouts is unchanged; net effect = exactly the approved +6%). If you'd
rather the now-abolished stamp slice also become commissionable, drop it too
(divisor → `1.14`), which lifts payouts ~6.4% total instead of ~6% (e.g. Solo
month-1 218 → 219, Enterprise 4,041 → 4,057). **Left at +6% as locked** unless you
say otherwise.

**No PR until Eyad approves.**

---

# PHASE 3 — correction round (BUILT, hold before PR)

Eyad's final rule: **every customer invoice shows only the line(s) sold, a flat
20 EGP processing fee, and 14% VAT.** Locked changes folded in:

## A. Flat 20 EGP processing fee now rides EVERY charge invoice
Previously three charge types lacked it; now added (charge + `metadata.processing_fee`
snapshot + invoice display):

| Invoice type | Carries 20 EGP | Where |
|---|:--:|---|
| subscription / base_subscription | ✅ (was) | `subscriptionBillingCron` |
| signup_first_payment | ✅ (was) | `api/signup` |
| plan_upgrade_difference | ✅ (was) | `api/billing/upgrade` |
| pack_billing / whatsapp_addon | ✅ (was) | `api/cron/parent-pack-billing`, `parent-pack/toggle` |
| payg | ✅ (was) | `api/cron/payg-billing` |
| teacher subscribe / resubscribe / upgrade / switch-interval / overage | ✅ (was) | `teacherBilling`, teacher routes |
| summer first invoice | ✅ (was) | `summerBillingCron` |
| **reactivation** (subscription + reactivation flag) | ✅ **NEW** | `api/centers/reactivate` (was hard-coded `processing_fee: 0`) |
| **setup_fee** (QR card orders) | ✅ **NEW** | `card-order-cart/checkout` + `cardOrderPayment` |
| **announcement_cap** | ✅ **NEW** | `parent-pack/announcement` |
| **announcement_settlement** | ✅ **NEW** | `api/cron/process-renewals` |

**Two invoice types intentionally do NOT carry it — flagged, not auto-added,
because they are not charges to the customer:**
- `referral_payout` — money paid **out** to a referrer; a 20 EGP fee would mean
  charging the referrer on their own payout.
- `payment_proof` — a proof-of-payment document that mirrors a referenced
  invoice's total; it is not a new charge.

*(These two were not in the locked "add it here" list, which named only
setup_fee / reactivation / announcement. Confirm if you want them included.)*

## B. Card orders — 60/card + one shared flat 20 (matches the brief exactly)
The single 20 is charged once per invoice, not per card, so per-card all-in falls
with quantity. `cards + 20 = total` (shipping added separately on top):

| Qty | Cards (60 each) | + flat fee | **Total** | Fee/card | All-in/card |
|---|--:|--:|--:|--:|--:|
| 1 | 60 | 20 | **80** | 20.00 | 80.00 |
| 2 | 120 | 20 | **140** | 10.00 | 70.00 |
| 3 | 180 | 20 | **200** | 6.67 | 66.67 |
| 6 | 360 | 20 | **380** | 3.33 | 63.33 |

Computed (not hardcoded): checkout charges `productInclusive + processingFee +
shipping`; the fee is derived flat and displayed on the invoice, receipt, cart
summary, review page, and order-detail views.

## C. Stamp fully erased — including the referral divisor
`REFERRAL_NET_REVENUE_DIVISOR` **1.14 × 1.06 × 1.004 → 1.14** (VAT only). No stamp
factor survives anywhere, even inside a formula. Payouts rise vs the original
(~+6.4%):

| Tier | all_in | Base (÷1.14) | Month-1 (25%) orig → now | Δ |
|---|--:|--:|--:|--:|
| Solo | 999 | 876.32 | 206 → **219** | +13 (+6.3%) |
| Nano | 1,999 | 1,753.51 | 412 → **438** | +26 (+6.3%) |
| Starter | 4,499 | 3,946.49 | 927 → **987** | +60 (+6.5%) |
| Pro | 7,999 | 7,016.67 | 1,648 → **1,754** | +106 (+6.4%) |
| Business | 12,999 | 11,402.63 | 2,679 → **2,851** | +172 (+6.4%) |
| Enterprise | 18,499 | 16,227.19 | 3,812 → **4,057** | +245 (+6.4%) |

## D. Plan-price parity — still byte-identical
No plan anchor changed (they are hardcoded, never grossed up): Solo 999 → Enterprise
18,499 (+×10 annual), Teacher 499/999/2,499 + Scale 20 EGP/student overage. VAT 14%
unchanged everywhere.

## E. Guard result
Rendered customer surfaces: **zero** matches for service fee / stamp / 6% / 0.5% /
0.4% (only a test `describe()` label and the untouched `BLAST_SERVICE_FEE_RATE`).
Every customer money line is now one of: the item sold, **رسوم المعالجة / Processing
fee (20 EGP)**, or **VAT 14%**.

## F. Verification
`next build` ✅ · unit **1147/1147** ✅ · typecheck ✅ · lint 0 errors ✅ ·
i18n parity ✅ (+`processingFee` keys in `checkout.summary`, `checkout.review`,
`cardOrders`) · bidi ✅ · tolocale ✅.

**No PR until Eyad approves.**

---

# PHASE 4 — referral-payout 20 EGP fee: STOP & REPORT (no code changed)

The locked decision was: add the flat 20 EGP to the referral payout as a
**deduction**, "separate from and on top of the existing **5% withdrawal fee**",
keeping the ordering that matches how the 5% works. Investigating the live code
first (as instructed) surfaced a blocker — **the 5% withdrawal fee is not applied
anywhere in the money path.** Reporting before touching anything.

## What the code actually does (referral commission payout)

1. `ReferralWithdrawalPanel.tsx` → POSTs `/api/referrals/payout` with
   `amount_requested: <full amount, up to available>` and
   `payment_details: { instapay_number }` — **no `withdrawal_fee`, no `gross_amount`.**
2. `api/referrals/payout/route.ts` stores `amount_requested` and `payment_details`
   **verbatim** into `payout_requests`. It applies **no fee** and creates **no invoice**.
3. The receipt PDF (`generatePayoutReceiptPdf`, from the `payout_requests` row):
   `fee = Number(details.withdrawal_fee ?? 0)` → **0**; `gross = gross_amount ?? amount_requested`
   → `amount_requested`; net paid = `amount_requested`. The "رسوم السحب (5%)" line renders **−0**.

So a referrer who requests X **receives X**. The **5% exists only in copy** —
`withdrawalFeeNote` ("5% withdrawal fee applies to gross commissions",
`messages/*.json`) and the hardcoded template label — **never in the math.**

## Why this is a STOP (per the brief's own guardrail)

- The brief says apply the 20 "**on top of** the existing 5%" and "keep whatever
  ordering matches how the 5% already works." **There is no live 5% to order
  against.** Any "before/after the 5%" implementation would be inventing the 5%.
- The brief's **own worked example contradicts the "on top of 5%" text**:
  *"referrer owed 219 receives 199 (219 − 20)."* That is **−20 only, no 5%** — which
  matches the code (no 5% applied), not the "on top of 5%" description.
- The brief explicitly says: *"If the two fees interact in a way that looks wrong,
  STOP and report before applying"* and *"report how the code handles it — do not
  guess."* Both triggers are met.

## Floor / negative-payout behaviour today

`api/referrals/payout` only checks `amount_requested > 0` and `≤ available`. With
**no fee**, net can't go negative today. If a flat 20 deduction is added, a request
**below 20** would net ≤ 0 — and there is **no minimum-withdrawal rule** on this
path (unlike the separate credits system, which enforces a 2,000-credit minimum).
A floor/minimum must be decided, not guessed.

## Options for Eyad (pick one; I'll implement then re-prove)

1. **−20 only (matches your example 219 → 199).** Ignore the phantom 5%: deduct a
   flat 20 from `amount_requested`, snapshot it, show gross → −20 processing fee →
   net on the receipt, and block/adjust requests below the 20. Simplest; matches
   your numbers. Also update/remove the misleading "5%" copy. **(Recommended.)**
2. **Implement the 5% for real, then stack −20 on top.** Deduct 5% then 20 (or 20
   then 5%). This is a *new* real fee referrers don't pay today — payouts drop ~5%
   beyond the 20. Bigger money change; needs its own sign-off. (219 → −5% = 208.05
   → −20 = 188.05, or −20 first = 199 → −5% = 189.05.)
3. **Something else** (e.g. 20 flat + keep 5% as display-only) — tell me.

**No code changed for this piece. Holding for your decision. The rest of the
branch (Phases 2–3) stands as previously proven.**

---

# PHASE 4 (v2) — referral payout: flat 20 then 5%, made real (BUILT, hold before PR)

Locked: on the referral commission payout, deduct the **flat 20 EGP processing
fee first**, then **5% withdrawal fee** on the remainder. This turns the 5% into a
**real** deduction for the first time (it was previously copy-only).

## A. The money math (single source of truth)
`src/lib/referralPayout.ts` → `computeReferralPayout(gross, processingFee)`:
`net = (gross − 20) × (1 − 0.05)`. Used by the payout route, the receipt PDF, and
the withdrawal panel so the shown net equals the paid net.

**Worked example (Eyad's, exact):**

| Step | Amount |
|---|--:|
| Gross commission withdrawn | 1,020.00 |
| − Processing fee (flat) | −20.00 |
| Subtotal | 1,000.00 |
| − Withdrawal fee (5% of 1,000) | −50.00 |
| **Net paid to referrer** | **950.00** |

(Also verified 219 → −20 → −5% (9.95) → **189.05**.)

## B. Server is authoritative (never trusts a client fee)
`api/referrals/payout/route.ts`: reads the flat fee from `platform_config`
(`getProcessingFeeConfig`), computes gross → −20 → −5% → net **server-side**,
ignores any client-sent fee, and stores the full breakdown
(`gross_amount`, `processing_fee`, `withdrawal_fee`, `net_amount`) in
`payout_requests.payment_details`. Previously the client sent only the InstaPay
number and the receipt read `withdrawal_fee ?? 0` (→ net = gross); that is fixed.

## C. Floor / negative-payout guard
The route **rejects** any request whose gross ≤ the flat fee (`code:
below_fee_floor`) so **net is always > 0**. `computeReferralPayout` also floors
fees to a net of 0 (never negative) as a second guard. Unit test asserts net ≥ 0
across a range including 0/19.99/20/20.01.

## D. Minimum withdrawal — reported, NOT invented (STILL Eyad's to set)
Searched the whole repo:
- **Referral payout path** (`/api/referrals/payout`, `ReferralWithdrawalPanel`):
  **no minimum** — only `> 0` and `≤ available` (now plus the fee-floor reject).
- **Credits system** (a *different* product — `centers.credit_balance`):
  **minimum 2,000 credits = 1,000 EGP cash** (`api/billing/withdrawal/route.ts:58`,
  `settings/billing/page.tsx:1488/2565`). Credits convert **2:1** to cash there.

So the "1000/1500" belongs to the **credits** system, not referral payouts. **No
business minimum is enforced on referral payouts** — only the 20 EGP fee floor.
**Decision for Eyad:** set a referral-payout minimum (e.g. 1,000 or 1,500 EGP)?
I did **not** invent one — say the number and I'll add it.

## E. Receipt + UI now match reality
- Receipt PDF (`generatePayoutReceiptPdf`, the live `/api/payouts/[id]/pdf`): shows
  **Gross → −Processing fee → −Withdrawal fee (5%) → Net paid** (replaced the old
  single "−0" line; headline total = net).
- Withdrawal panel: shows the live breakdown (gross / −20 / −5% / you receive) and
  the corrected note. Copy `withdrawalFeeNote` fixed in both locales
  ("flat 20 EGP processing fee first, then 5% on the remainder").

## F. Verification
`next build` ✅ · unit **1152/1152** (added `referralPayout.test.ts`) ✅ · typecheck
✅ · lint 0 errors ✅ · i18n parity ✅ (new `referrals.*` payout keys) · bidi ✅ ·
tolocale ✅. Guard: zero stamp/service strings on customer surfaces.

## G. Whole-branch invoice-fee recap (unchanged from Phase 3)
Every charge invoice carries the flat 20 EGP: subscription, signup, PAYG, pack,
teacher (all), plan-upgrade, summer, reactivation, card `setup_fee`, announcement
cap + settlement — **and now referral payout** (as a deduction). Only
`payment_proof` is fee-free (it mirrors a referenced invoice; not a new charge).

**No PR until Eyad approves the whole branch. Open item: the referral-payout
minimum (E).**

---

# PHASE 5 — referral cash-withdrawal minimum + in-app-spend check (BUILT / reported)

## Part 1 — 1,000 EGP minimum on referral cash withdrawals (BUILT)

- Constant: `REFERRAL_WITHDRAWAL_MIN_EGP = 1000` in `src/lib/referralPayout.ts`
  (single source; used by the route and the panel).
- **Server enforcement** (`api/referrals/payout/route.ts`): checked on the **gross**
  `amount_requested`, **before** any fee, right after the `> 0` check and before the
  `≤ available` and fee-floor checks:
  ```
  if (amountRequested < REFERRAL_WITHDRAWAL_MIN_EGP)
      → 400 { code: 'below_minimum' }
  ```
  Reads naturally: minimum is on the gross, then `≤ available`, then compute
  gross → −20 → −5% → net (floor keeps net > 0).
- **UI** (`ReferralWithdrawalPanel`): blocks submit below 1,000 with a clear error
  and shows "Minimum withdrawal: 1,000 EGP" in the fee note (both locales).
- **Distinct** from the separate credits-system minimum (2,000 credits = 1,000 EGP,
  2:1) — that path (`api/billing/withdrawal`) is untouched.

### Worked proof
| Request (gross) | Result |
|---|---|
| **900** | **Rejected** — `below_minimum` (under 1,000). |
| **1,020** | Accepted → −20 → −5% (50) → **950 net**. |

## Part 2 — in-app spend of commission balance (CHECK ONLY — does NOT exist)

Searched the repo. **A referrer cannot spend their commission balance on an in-app
invoice today.** Evidence:
- Referral commission balance lives in **`referral_reward_records`** (created by
  `calculate-rewards`). Its **only** consumer is `payout_requests` (cash-out via
  `/api/referrals/payout`). Nothing applies it to an invoice.
- The invoice-payment code (`invoices/[id]/pay`, `invoicePaymobPayment.ts`) never
  references a referral or credit balance — invoices are paid in full via Paymob.
- The `centers.credit_balance` **credits** system is separate again and is only
  cashed out 2:1 (`api/billing/withdrawal`); it is **not** applied to invoices
  either, and it is **not** the referral commission balance.

**Conclusion:** the "spend commission on an in-app invoice at any amount, no
fees/minimum" flow **does not exist** — so nothing currently (wrongly) applies the
20 / 5% / minimum to it. If wanted, it is a **new, separately-scoped feature**
(not built here, per instruction). When built, it must bypass the payout fees and
the minimum, while the invoice it is spent on keeps its own normal 20 EGP + 14% VAT.

## Verification
`next build` ✅ · unit **1153/1153** (`referralPayout.test.ts` extended) ✅ ·
typecheck ✅ · lint 0 errors ✅ · i18n parity ✅ · bidi ✅ · tolocale ✅ · guard clean.

**No PR until Eyad approves the whole branch.**
