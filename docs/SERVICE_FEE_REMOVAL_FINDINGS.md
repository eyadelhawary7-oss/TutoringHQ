# Service-fee (6%) removal — Phase 1 findings & proof

**Status: HOLD for Eyad.** Nothing has been changed. This document proves what
removing the 6% service fee does, tier by tier, and surfaces the two money
side-effects that need a decision before any code moves.

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
