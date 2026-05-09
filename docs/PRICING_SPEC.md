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
nano          2,499        1,999           1,699       75
starter       5,199        4,499           3,824      150
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

(End of spec doc.)
