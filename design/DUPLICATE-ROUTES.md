# Duplicate routes — side by side

**Written 26 July 2026. Facts for a decision, not a recommendation.**
**Nothing is merged or deleted. All eight routes stay live until you decide.**

Four pairs where two live routes cover the same ground. For each: what each renders, what one has that
the other does not, which the designs assume, and what would be lost by dropping either.

---

# 1 · `/{locale}/billing` vs `/{locale}/settings/billing`

| | `/billing` | `/settings/billing` |
|---|---|---|
| File | `(dashboard)/billing/page.tsx` → `BillingPageClient.tsx` | `settings/billing/page.tsx`, **2,629 lines** |
| Reached from | Sidebar, **Money** group, `ownerOnly` | Settings hub → Billing & plan |
| Renders | Current plan, billing period, next payment due, billing amount, `all_in_price`, early-adopter flag, grace-period days, past-due banner, Paymob invoice modal, summer first-invoice card | All of that **plus** upgrade costing, daily-rate proration, upgrade limits, reactivation tier and amount, the withdrawal window, invoice list with per-invoice processing-fee breakdown, quarterly billing dates, suggested resale price |

**What one has that the other does not**

`/settings/billing` is a superset in almost every respect. It uniquely carries:

- `getUpgradeCost` / `getDailyRate` / `getUpgradeLimit` — the proration maths for a mid-cycle plan change
- `getReactivationTier` / `getReactivationAmount`
- `isWithdrawalWindowOpen`, `nextQuarterFirstOnOrAfter`, `nextProcessingQuarterStart` from `cairoBillingCalendar`
- `ProcessingFeeInfoButton` and `invoiceProcessingFee()` — the per-invoice 20 EGP breakdown
- `SUGGESTED_RESALE_EGP`

`/billing` uniquely carries **nothing** I could find. Its past-due banner (`isSubscriptionPastDueBanner`) and summer card both also appear on the settings page.

**Which the designs assume:** **both, as two screens.** `Merged-Center-Money` §03 "Billing" is the
membership-management view — plan card, upgrade hero, add-ons, downgrade, switch-billing sheet.
`Merged-Center-Setup` §03 "Billing & plan" is the settings view — subscription, payment method,
add-ons, invoices as a card per period. **This is the one pair the designs do not resolve.** They
overlap heavily and are drawn as two separate screens in two separate files.

**What is lost by dropping either**

- **Drop `/billing`:** the sidebar's Money group loses its only billing entry. Settings is three taps deeper. Nothing functional is lost.
- **Drop `/settings/billing`:** proration, reactivation, the withdrawal window and the invoice breakdown all disappear unless ported. **That is a large port, not a redirect.**

---

# 2 · `/{locale}/teacher/billing` vs `/{locale}/teacher/pay`

| | `/teacher/billing` | `/teacher/pay` |
|---|---|---|
| File | `teacher/(portal)/billing/page.tsx` | `teacher/pay/page.tsx` |
| Renders | `TeacherPlanSection` + `BillingHistory` + summer first-invoice card | `CustomerInvoicesView` against teacher endpoints — invoice list, pay, PDF, Paymob status |
| **Access gate** | **`hasPrivateAccess`.** A free-zone or lapsed teacher sees a `PrivateUpsellCard`, not the billing content | **`requireTeacherAuth` only** |

**⚠ The difference is load-bearing and nothing in the designs records it.**

`teacher/pay/page.tsx` states the rule in its own header comment:

> *"Reachable while the teacher is in the locked / free-tier state (the underlying endpoints use
> `requireTeacherAuth`, NOT the private-access gate), so a lapsed teacher can still pay here to restore
> her private engine."*

**A lapsed teacher cannot reach `/teacher/billing` — that is the screen the gate blocks. `/teacher/pay`
is how she pays to become un-lapsed.**

**Which the designs assume:** **`/teacher/billing` only.** `Merged-Teacher-Money` §03 carries invoices
inside the billing screen. **`/teacher/pay` has no design at all** and appears in `NEEDS-DESIGN.md`.

**What is lost by dropping either**

- **Drop `/teacher/pay`:** ⚠ **a lapsed teacher loses the ability to pay.** Folding invoices into `/teacher/billing` as the design shows puts the payment route behind the very gate that lapsing closes. Locks a paying customer out of paying. **Do not do this without moving the gate first.**
- **Drop `/teacher/billing`:** the plan section and billing history go, and the teacher portal loses its subscription-management screen.

**This pair is not symmetric.** One is a convenience, the other is a recovery path.

---

# 3 · `/{locale}/referrals` vs `/{locale}/settings/referrals`

| | `/referrals` | `/settings/referrals` |
|---|---|---|
| File | `[locale]/referrals/page.tsx`, 407 lines | `[locale]/settings/referrals/page.tsx`, 455 lines |
| Reached from | Sidebar, **Setup** group, `ownerOnly` | Settings hub |
| Shared | **Both render `components/referrals/ReferralWithdrawalPanel`** — the same withdrawal UI, the same 5% fee, the same balance | |
| Unique | `PageHeader` + `KpiCard` summary tiles; `maskCenterName()` — referred centers shown as `Al***` | **`Download` action** on commission rows; `PLAN_LABELS_AR` mapping plan keys to Arabic labels; a back-arrow header with `DirectionalIcon` |

**Which the designs assume:** **`/referrals` only.** `Merged-Center-Insight` §03 is the single
referrals design — recurring income, projection, rate-decay timeline, per-referral rate and
days-to-drop. **`/settings/referrals` has no design** and appears in `NEEDS-DESIGN.md`.

**What is lost by dropping either**

- **Drop `/settings/referrals`:** the **per-commission download** goes. That is the only way a center gets a record of a commission row today. Small, but it is a real loss and worth porting.
- **Drop `/referrals`:** the KPI tiles and the privacy-preserving `maskCenterName` go. The masking is a deliberate choice — a referrer sees `Al***`, not the full name of a center they referred.

**Both call the same withdrawal panel**, so the money path is identical either way. This is the
lowest-risk pair to consolidate.

---

# 4 · `/{locale}/terms` vs `/{locale}/legal/terms`

| | `/terms` | `/legal/terms` |
|---|---|---|
| File | `[locale]/terms/page.tsx`, 52 lines, server component | `[locale]/legal/terms/page.tsx`, 28 lines → `legal/LegalDoc.tsx` |
| Renders | Title, "Last updated: 9 May 2026", `legal.terms.placeholderBody` — three short interim paragraphs — **plus a processing-fee disclosure** | Draft-notice banner, title, "Last updated: [Pending]", "Effective: [Pending]", and **15 numbered section headings each showing** *"This section will be completed upon legal review."* |
| Chrome | None — bare `<main>` | Shared `legal/layout.tsx`, sits with privacy / cookie / dpa |
| Content | Interim text that reads as final-ish | Structure with **no content at all** |

**Which the designs assume:** **`/legal/terms` only.** `Merged-Public-Legal` §01 draws the
four-document reader with a contents list and version header per document — that is `LegalDoc`, not
the bare page.

## ⚠ The processing-fee disclosure, quoted

**`/terms` renders a section `/legal/terms` does not have.** From `src/app/[locale]/terms/page.tsx`,
gated on the live `processing_fee_enabled` config so it disappears when the fee is off:

> ### Processing fee
>
> *"A flat processing fee of **{amount}** is added to each Paymob-charged subscription invoice and
> shown at checkout and on every invoice. VAT is included in the displayed totals."*
>
> *[Placeholder — final processing-fee wording pending Adsero legal review.]*

The `{amount}` is interpolated live via `resolveProcessingFeeAmount(await getProcessingFeeConfig())`
and `formatCurrency` — so it renders the **real configured fee**, currently 20 EGP, not a hardcoded
string. The whole section is wrapped in `feeAmount > 0`, so turning the fee off removes the
disclosure automatically.

**This is the only place on the public site where the 20 EGP fee is disclosed in prose.** It is
rendered from live config, it tracks the real amount, and `/legal/terms` has no equivalent — its
"Subscription Plans and Fees" and "Payment Processing" sections are both placeholders.

**What is lost by dropping either**

- **Drop `/terms`:** ⚠ **the processing-fee disclosure disappears from the public site**, and with it the only prose statement of what the 20 EGP is and that VAT is included. Charging a fee disclosed nowhere is a consumer-protection problem, not a tidiness one. **Move the section into `LegalDoc` first**, keeping the live-config interpolation and the `feeAmount > 0` gate.
- **Drop `/legal/terms`:** loses the shared legal chrome, the draft-notice banner, the effective-date line, and the 15-section structure the design is built around. `/terms`'s three interim paragraphs would have to carry the whole document.

**Also note:** `/privacy` vs `/legal/privacy` is the same shape **without** the complication.
`/privacy` renders only `legal.privacy.placeholderBody` — three interim paragraphs, no unique
section. Nothing would be lost that is not already in `/legal/privacy`.

---

# Summary

| Pair | Designs assume | Risk in consolidating |
|---|---|---|
| `/billing` · `/settings/billing` | **Both** — unresolved | Low functionally, but the designs do not tell you which survives |
| `/teacher/billing` · `/teacher/pay` | `/teacher/billing` | ⚠ **High.** Dropping `/teacher/pay` locks a lapsed teacher out of paying |
| `/referrals` · `/settings/referrals` | `/referrals` | Low. Port the download |
| `/terms` · `/legal/terms` | `/legal/terms` | ⚠ **Medium.** Move the fee disclosure first |

**Two of the four carry something that must move before the duplicate goes** — the lapsed-teacher
payment path and the processing-fee disclosure. Neither is visible from the designs; both were found
in the code.
