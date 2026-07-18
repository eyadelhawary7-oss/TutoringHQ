---
name: automated-billing-and-fees
description: Locked financial rules for TutoringHQ. Use whenever touching pricing, billing, invoices, fees, VAT, referrals, card orders, Paymob, renewal, reactivation, signup payment, or any code that computes, stores, or displays money.
---

# Money invariants (LOCKED)
Violating any rule here is a critical bug. These override any other doc except docs/PRICING_SPEC.md, which they must match.

1. Customer-visible charges are ONLY: product price + flat 20 EGP processing fee + 14% VAT. The former 6% service fee and 0.5% stamp duty were removed (PR #139) and must never reappear in code, UI, PDFs, emails, or docs.
2. VAT is inclusive. The only correct split: base = inclusive / 1.14, VAT = inclusive * 0.14 / 1.14 (src/lib/pricing/taxMath.ts). NEVER use base = inclusive * 0.86, that is the old non-compliant formula and any doc or comment still describing it is stale.
3. The flat 20 EGP processing fee applies to EVERY charge invoice: subscription, signup, PAYG, pack, teacher, upgrade, summer, reactivation, card setup_fee, announcement settlement. payment_proof mirror docs are fee-free. The fee is config-driven (platform_config) and snapshotted into invoices.metadata.processing_fee. Existing invoices always render from their snapshot, config changes never rewrite history.
4. Billing periods: monthly and annual only. Column vocabulary differs on purpose: centers.billing_period allows {monthly, annual}, centers.subscription_billing_period allows {monthly, yearly}. Always translate annual to yearly when writing the second column. Quarterly is DEAD: every reader defaults quarterly to monthly, every writer coerces it, no UI ever offers it.
5. QR cards: flat 60 EGP per card inclusive. CARD_UNIT_BASE_EGP = 60 / 1.14 kept unrounded so N cards gross to exactly N * 60. One shared 20 EGP fee per card-order invoice, split across cards for display.
6. Referral payouts: commission base uses divisor 1.14 only. Cash-out fee: 20 EGP flat deducted first, then 5% of the remainder. Minimum 1000 EGP on cash withdrawals. Net can never go negative. Server-authoritative in src/lib/referralPayout.ts.
7. Plan price anchors are hardcoded and byte-locked (Solo 999 up to Enterprise 18,499, annual = monthly * 10, Teacher 499/999/2,499). Never recompute, round, or "fix" them.
8. top_centers is custom-priced from centers.all_in_price. NULL or 0 must throw, warn Sentry, and enqueue a red CEO action. Never bill 0 EGP.
9. All billing windows use the Cairo time helpers (src/lib/cairo/). Never raw new Date() for anything user-visible or billing-related. Unit tests run TZ=UTC deliberately to expose violations.
10. Money rounds to 2 decimals. audit_log is append-only.
11. No refunds. Corrections become credit.
12. The summer engine is FROZEN. Never modify summer.* platform_config keys, the first-charge gate, or related cron logic without an explicit instruction from Eyad in the current brief.
13. The VAT base is the full VAT-inclusive total, for every invoice type and every line. There are no carve-outs. The flat 20 EGP processing fee IS subject to VAT. The card delivery fee (card_orders.delivery_fee) IS subject to VAT. Confirmed by Eyad 2026-07-15. Do not reintroduce a per-type or per-line exception.
14. Every invoice snapshots its own tax at insert time into invoices.vat_rate, invoices.vat_amount and invoices.processing_fee (live since PR #159, verified in the production catalog 2026-07-15). The per-invoice vat_rate is what makes an old invoice reprint at its original rate after a future VAT change. Never remove it, never recompute a stored invoice from current config. Legacy null rows recompute; new rows must always write the snapshot.
15. Late fees are DEAD. The five late_fee_* keys in platform_config and the late_fee_rate, late_fee_amount and days_overdue columns on invoices are legacy. They are unreachable under the billing lockout policy, which locks the account on day 1 while the first late fee triggers on day 4. Never reintroduce them.
16. Promotional discounts apply to the first bill only, never to a renewal. The second-half (T2) referral commission is deliberately promo-unaware, recomputed at the standing price, and is correct ONLY because of this rule. If promos are ever allowed to apply to renewals, the T2 commission base must be fixed first. Confirmed by Eyad 2026-07-16.
17. The flat 20 EGP processing fee is REVENUE, not a pass-through, and must never be booked as offsetting payment processing cost. It is VAT inclusive, so it nets 17.54. Paymob's cost is separate and scales with the invoice: their published example is 2.75% plus 3 EGP per successful transaction. That rate is NOT confirmed as EHG's negotiated rate and is an assumption until Paymob confirms it. At that rate the fee covers roughly 57% of Paymob's cost on a Solo monthly invoice, 6% on Solo annual, and 0.3% on Enterprise annual, because the fee is flat while their cost is a percentage. Eyad decided 2026-07-16 that the percentage comes out of margin and that no percentage-based customer fee will be added. Never net the two. 20 EGP in as revenue, Paymob's charge out as cost of sales, always two separate lines. Netting them hides a cost that scales with every pound billed and flatters every projection built on it.

# Verification duties
After ANY change in these areas: run the full unit suite. If the change involves database vocabulary or constraints, verify against the live catalog (information_schema, pg_constraint), never against schema_migrations, which is bookkeeping not proof.

Timezone, and this is not optional. All billing crons run on Vercel, which runs UTC only with no timezone setting. Egypt is UTC+3 during daylight saving and UTC+2 outside it. Under Law 34 of 2023, DST runs from the last Friday of April to the last Thursday of October, which for 2026 is 24 April to 29 October. Any Cairo local time in a billing rule needs the offset done by hand and must be DST aware. Two yearly edges: on spring forward day 12:00 AM does not exist, and on fall back day the 11 PM hour repeats. A job set to fire at exactly midnight can skip or fire twice. Twice means two invoices.

# Additional verified notes
Correct facts carried forward from the previous version of this skill, verified against the codebase 2026-07-16. None contradict the locked rules above.

- MRR has one canonical source: getImpliedMonthlyMrr (src/lib/pricing.ts), consumed by the admin and CEO finance routes. It excludes is_test = true rows and suspended/churned/deleted/cancelled/inactive centers; PAYG contributes 0 subscription MRR.
- Invoice display (فاتورة ضريبية legal requirement): on customer PDFs and receipts VAT is the LAST line and sits inside the total (it does not add on top). Never render a service-fee or stamp-duty line. This is the display side of rule 2.
- Single-day lock model source: src/lib/billingLifecycle.ts plus resolveBillingAccess (src/lib/billingAccessGate.ts), enforced by src/proxy.ts. centers.auto_suspend_at is the next Cairo midnight after next_payment_due, computed by autoSuspendAtFromDue (DST-safe). Reactivation charges the plain subscription price with the standard 20 EGP processing fee and no penalty surcharge.
- Processing-fee config helpers: getProcessingFeeConfig() in src/lib/pricingConfig.ts and the helpers in src/lib/processingFee.ts read platform_config.processing_fee_enabled / processing_fee_amount. Breakdowns render from the invoice snapshot, never live config (rule 3).
- Referral commission base helper: netReferralBaseFromAllInPrice (src/lib/referralNetBase.ts) computes centers.all_in_price / 1.14, never the invoice total. This is the base input; the payout math (cash-out fee, minimum, non-negative net) is server-authoritative in src/lib/referralPayout.ts (rule 6).
- A combined invoice carries exactly one 20 EGP processing fee, never one per line.
