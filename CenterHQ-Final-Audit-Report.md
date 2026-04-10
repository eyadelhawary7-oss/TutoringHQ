# CenterHQ Final Pre-Launch Audit Report
**Date:** April 10, 2026
**Environment:** https://center-hq.vercel.app
**Tenant:** 1234center (+201220601410)
**Scope:** 54+ pages, dark + light modes, 14 previously-fixed items, wordmark, Arabic RTL

---

## VERDICT: 🛑 NO GO

Three regressions from the "fixed" list are still live in production. Two of them are user-facing revenue or trust issues on the primary English experience. Launch must be held until these are reverted or re-fixed.

---

## Critical Regressions (launch blockers)

### 1. Fix #6 FAILED — Annual prices on /en/signup are all off by exactly 1 EGP

| Plan | Shown on Signup | Correct (Admin/Pricing) | Delta |
|---|---|---|---|
| Nano | 20,399 | 20,400 | −1 |
| Starter | 45,899 | 45,900 | −1 |
| Pro | 81,599 | 81,600 | −1 |
| Business | 132,599 | 132,600 | −1 |
| Enterprise | 188,699 | 188,700 | −1 |

**Root cause:** signup stage-2 card computes `monthly × 12` with floor rounding instead of reading the already-rounded annual value stored in admin/pricing. The admin side is correct; signup re-derives it wrong.

**Impact:** Every prospective customer seeing the signup page gets mis-stated pricing.

### 2. Fix #1 FAILED — Arabic contamination on /en/admin?tab=centers

- **Plan filter dropdown** (English mode): "كل الخطط", "ناشئ", "سنتر صغير", "سنتر متوسط", "سنتر كبير", "سنتر ضخم", "ميجا سنتر"
- **Sort dropdown:** "الأحدث أولاً", "الأقدم أولاً", "الخطة: الأعلى أولاً"
- **Plan badges:** "ستارتر نانو" on Nano plan rows
- **Inconsistent:** Business and Enterprise badges render the correct English labels, so this is a per-plan translation miss, not a locale bypass.

### 3. NEW — Change PIN sidebar modal is fully Arabic on English pages

- Triggered from the sidebar "Change PIN" button that appears on every authenticated page
- Modal title is English ("Change PIN"), every field label and button is Arabic:
  - "الرمز الحالي" (current PIN)
  - "الرمز الجديد" (new PIN)
  - "تأكيد الرمز الجديد" (confirm new PIN)
  - "تحديث الرمز" (update button)
  - "إلغاء" (cancel button)
- **Scope:** affects all ~40 authenticated /en/* routes because the sidebar is global. Confirmed on /en/analytics.

---

## Previously-fixed items that now PASS

| # | Check | Result |
|---|---|---|
| 4 | /en/admin/health — 25 cron rows, dormancy-warnings row `0 4 2 * *`, text rgb(248,250,252) readable | PASS |
| 5 | /en/admin/platform-config — "Late Fees & Dormancy" + "Platform settings" sections, 24 fields incl. `late_fee_grace_days` | PASS |
| 7 | /en/admin/pricing — all 5 plans show correct rounded annual prices | PASS |
| 8 | /en/analytics Recharts tooltip in dark mode — tooltip renders with dark bg and readable light text ("Jan 2026 / EGP 0") | PASS |
| 9 | /en/ceo-dashboard — no raw i18n keys, all 8 range pills (7D/30D/90D/6M/1Y/MTD/QTD/YTD) | PASS |
| 10 | /en/schedule light-mode time headers — rgb(71,85,105) slate-600 on rgb(248,250,252); readable contrast | PASS |
| 13 | /en/dashboard greeting "Good afternoon, 1234center" matches local hour 13 | PASS |
| 14 | /en/dashboard greeting uses English comma, not Arabic | PASS |
| 35 | /en/admin/vendors — 5 headers, no duplicate, sort icons default opacity 1 / 0.4 | PASS |
| 40 | /en/admin/commissions — empty state, no dark-mode white rectangle artifact | PASS |

---

## Wordmark Consistency — PASS everywhere checked

- CENTER: font-family `"Bodoni Moda", "Bodoni Moda Fallback"`
  - Landing: rgb(255, 255, 255) white on dark
  - Authenticated (/en/login, /en/signup, /en/analytics, /ar/dashboard): rgb(248, 250, 252) slate-50
- HQ: `lab(55.02 -41.08 -3.90)` ≈ `#0D9488` teal-600 on every surface
- Verified on: landing, /en/login, /en/signup, /en/analytics, /ar/dashboard

---

## Arabic RTL Spot-Check — /ar/dashboard

- `dir="rtl"`, `lang="ar"` — correct
- Greeting: "مساء الخير، 1234center" with Arabic comma — correct
- Wordmark: correct (Bodoni Moda, teal HQ)
- **Minor English leaks:** the word "Friday" appears on an Arabic page — day-of-week label is not being localized. Not a blocker but should be filed as a follow-up.

---

## Lower-Severity Findings (not blockers, file as follow-ups)

- **/en/analytics chart legend leak** — the group legend/x-axis renders `بدون مجموعة` ("No group"). Data-layer fallback for an un-named group is hardcoded Arabic and shows on the English Financial Intelligence page.
- **Dual sidebar on /en/students** — narrow peek edge visible beside the full sidebar.
- **Admin sub-route sidebar highlight** — "Billing" stays highlighted when navigating to /en/admin/commissions.

---

## Checks Blocked by Empty Data (could not verify)

These should be retested on a tenant with seeded data before launch:

- /en/admin/payouts "Download PDF" on approved rows — no approved rows on this tenant
- /en/students Next/Previous pagination disable states — only 3 students, no pagination rendered
- /en/payments amount column alignment + collect-payment modal — zero payments
- /en/admin/centers/[id] invoice Download PDF — not exercised

---

## Coverage Summary

Visually audited in both modes where relevant:
landing, login, signup (stages 1+2), /en/dashboard, /en/ceo-dashboard, /en/schedule (dark + light), /en/analytics, /en/students, /en/admin (tab=centers), /en/admin/pricing, /en/admin/health, /en/admin/platform-config, /en/admin/vendors, /en/admin/commissions, /ar/dashboard.

Server-side 200 confirmed on 25 additional EN routes; runtime verification of those is still outstanding and should be done once the three blockers above are resolved.

---

## Recommended Launch Path

1. Fix the signup annual-price derivation (one-line change: read stored annual value, don't recompute from monthly).
2. Add missing English translations for the /admin centers plan filter, sort dropdown, and Nano plan badge.
3. Translate the Change PIN modal fields to English (they are currently hardcoded Arabic).
4. Re-verify the three specific regressions above.
5. On a tenant with seeded data, run the four blocked checks (payouts PDF, students pagination, payments alignment, center invoices PDF).
6. Launch.

---

## Executive Summary

CenterHQ is **NO GO** for launch. Ten of the previously-called-out fixes verified cleanly, and the wordmark, theme toggle, CEO dashboard, admin platform config, cron health, pricing page, schedule, and analytics tooltips all look production-ready. But the signup page is still quoting annual prices that are 1 EGP lower than the admin-defined rounded values for every single plan; /en/admin?tab=centers still renders Arabic dropdown options and Nano plan badges in the English view; and a newly surfaced Change PIN modal is fully Arabic on every authenticated English page. These three issues are revenue-facing, trust-facing, and omnipresent respectively. Fix them, re-verify, complete the data-seeded checks for payouts PDF / payments / students pagination, and then launch.
