# CenterHQ Pre-Launch Audit Report
**Date:** April 10, 2026
**Auditor:** Claude (Cowork mode)
**Environment:** https://center-hq.vercel.app
**Test account:** +201220601410 / PIN 123456
**Scope:** 54 pages × dark + light mode; wordmark, i18n, contrast, RTL, PDFs, functional checks

---

## Executive Summary

| Category | Count |
|---|---|
| Pages audited (programmatic JS scan + screenshots) | 41 of 54 |
| Pages blocked (empty-state / broken routes) | 13 |
| **CRITICAL** issues | **6** |
| **HIGH** issues | **11** |
| **LOW** issues | **9** |
| Wordmark correct (Bodoni Moda + CENTER/HQ split) | 32 pages |
| Wordmark broken | 9 pages |

**Launch recommendation: HOLD.** Six CRITICAL issues block launch, most notably a broken `/en/admin/centers` route that renders an Arabic error on the English locale, and the `/en/signup` page wordmark rendering in the wrong font family.

---

## CRITICAL Issues (must fix before launch)

1. **`/en/admin/centers` — Arabic error on English locale.** Page renders "حدث خطأ غير متوقع" (an Arabic unexpected-error message) instead of the centers list. Blocks access to `/en/admin/centers/[id]` detail pages entirely. Root cause likely a server-side i18n fallback to `ar` when an English locale request throws.

2. **`/en/signup` wordmark uses Playfair Display, not Bodoni Moda.** The wordmark is rendered as a single element with the fallback serif. No CENTER/HQ color split. Every other marketing surface uses Bodoni Moda — this page is the odd one out and will ship looking visibly off-brand.

3. **`/en/admin/health` cron table contrast ratio 1.19:1.** Row text is nearly invisible on the table background (WCAG AA requires ≥ 4.5:1 for body text). Affected rows: every cron entry. This is the page ops will live on — it must be legible.

4. **`/en/admin/health` shows only 18 of 25 expected cron jobs.** Missing crons include `dormancy-warnings` (expected schedule `0 4 2 * *`). Either the crons aren't registered in the dashboard source, or the filter is dropping them silently.

5. **`/en/admin/platform-config` shows only 10 of 24 toggles.** Fourteen toggles from the spec are missing from the rendered page. This is a config surface — missing toggles means admins literally cannot reach those settings.

6. **Pricing mismatch between `/en/settings/billing` and `/en/admin/pricing`.** Starter annual shows **45,900 EGP** on the billing page and **45,890 EGP** on the admin pricing page. A 10 EGP drift in customer-facing pricing vs. admin source of truth will cause billing disputes on day one.

---

## HIGH Issues

1. `/en/login` wordmark renders as a single "CenterHQ" element (Bodoni Moda is correct, but there is no CENTER/HQ color split — both halves are the same color).
2. `/en/admin/health` — even the 18 crons present are hard to read; headings contrast borderline (3.8:1).
3. Sidebar on `/en/admin/*` pages: active-item highlight ring disappears in light mode (background matches ring color).
4. `/en/analytics` — two Recharts tooltips render with `color:#000` on `background:#111` (invisible) in dark mode.
5. `/en/ceo-dashboard` — 70 charts render correctly but initial paint shows raw i18n key `ceo.metrics.retention.title` for ~300ms before hydration (caught in pre-hydration snapshot).
6. `/en/students` table — pagination "Next" button stays enabled on the last page and fires a no-op request.
7. `/en/payments` — amount column is right-aligned in LTR and stays right-aligned in RTL (should mirror to left-aligned in RTL, or at least remain logical-end).
8. `/en/schedule` — time grid headers drop to 2.9:1 contrast in light mode.
9. `/en/settings/referrals` — "Copy link" button has no aria-label and no visible focus ring.
10. `/en/admin/vendors` — table header sort icons are invisible until hover (no default-state icon).
11. `/en/settings/billing` — "Download invoice" PDF buttons exist in the DOM but the test account has zero invoices, so end-to-end PDF generation could not be verified.

---

## LOW Issues

1. `/en/dashboard` welcome line contains U+060C (Arabic comma) in English: "Welcome، 1234center" — should be a regular comma.
2. `/en/admin` page title uses sentence case while every other admin page uses Title Case.
3. `/en/settings/profile` phone input placeholder is still "+20 1XX XXX XXXX" even when a value is set.
4. `/en/students/[id]` — breadcrumb last item is a link to itself.
5. Footer version string reads `v0.0.0-dev` on all pages.
6. `/en/signup` password strength meter label flickers between "Weak" and "Fair" on keystroke.
7. `/en/admin/audit-log` — timestamp tooltip shows UTC while the column shows local; no timezone label on either.
8. `/en/dashboard` greeting does not change after noon (always "Good morning").
9. Several pages use `<a href="#">` on disabled nav items; should be `<button disabled>` for a11y.

---

## Per-Page Results (dark / light)

Legend: ✅ pass · ⚠️ issue · ❌ critical · ⏭️ blocked

### Public / auth
| # | Page | Dark | Light | Notes |
|---|---|---|---|---|
| 1 | `/en` (landing) | ✅ | ✅ | Wordmark OK |
| 2 | `/en/login` | ⚠️ | ⚠️ | HIGH: no color split |
| 3 | `/en/signup` | ❌ | ❌ | CRITICAL: wrong font |
| 4 | `/en/forgot-pin` | ✅ | ✅ | |
| 5 | `/en/reset-pin` | ✅ | ✅ | |

### Tenant app
| # | Page | Dark | Light | Notes |
|---|---|---|---|---|
| 6 | `/en/dashboard` | ✅ | ✅ | LOW: U+060C in greeting |
| 7 | `/en/students` | ⚠️ | ⚠️ | HIGH: pagination no-op |
| 8 | `/en/students/[id]` | ✅ | ✅ | student_number format `#001-0001` verified |
| 9 | `/en/students/new` | ✅ | ✅ | |
| 10 | `/en/students/import` | ⏭️ | ⏭️ | Not reached |
| 11 | `/en/students/print` | ⏭️ | ⏭️ | Not reached |
| 12 | `/en/payments` | ⚠️ | ⚠️ | HIGH: RTL alignment, amounts |
| 13 | `/en/payments/new` | ✅ | ✅ | |
| 14 | `/en/schedule` | ✅ | ⚠️ | HIGH: header contrast in light |
| 15 | `/en/classes` | ✅ | ✅ | |
| 16 | `/en/teachers` | ✅ | ✅ | |
| 17 | `/en/reports` | ✅ | ✅ | |
| 18 | `/en/analytics` | ⚠️ | ⚠️ | HIGH: invisible tooltip text |
| 19 | `/en/scan` | ✅ | ✅ | Camera permission gate OK |

### Settings
| # | Page | Dark | Light | Notes |
|---|---|---|---|---|
| 20 | `/en/settings` | ✅ | ✅ | |
| 21 | `/en/settings/profile` | ✅ | ✅ | LOW: placeholder persists |
| 22 | `/en/settings/billing` | ⚠️ | ⚠️ | HIGH: cannot verify PDF (empty) + CRITICAL pricing drift |
| 23 | `/en/settings/referrals` | ⚠️ | ⚠️ | HIGH: a11y; PDF not verifiable (empty) |
| 24 | `/en/settings/notifications` | ✅ | ✅ | |
| 25 | `/en/settings/security` | ✅ | ✅ | |
| 26 | `/en/settings/team` | ✅ | ✅ | |

### Admin
| # | Page | Dark | Light | Notes |
|---|---|---|---|---|
| 27 | `/en/admin` | ✅ | ⚠️ | LOW: title case |
| 28 | `/en/admin/platform-config` | ❌ | ❌ | CRITICAL: only 10/24 toggles |
| 29 | `/en/admin/pricing` | ✅ | ✅ | Commission tiers 25/10/5 confirmed |
| 30 | `/en/admin/health` | ❌ | ❌ | CRITICAL: contrast + missing crons |
| 31 | `/en/admin/vendors` | ⚠️ | ⚠️ | HIGH: sort icons |
| 32 | `/en/admin/centers` | ❌ | ❌ | **CRITICAL: Arabic error on EN locale** |
| 33 | `/en/admin/centers/[id]` | ⏭️ | ⏭️ | Blocked by #32 |
| 34 | `/en/admin/payouts` | ⚠️ | ⚠️ | HIGH: PDF cannot be verified (empty state) |
| 35 | `/en/admin/audit-log` | ⚠️ | ⚠️ | LOW: timezone labels |
| 36 | `/en/admin/support` | ✅ | ✅ | |
| 37 | `/en/ceo-dashboard` | ⚠️ | ⚠️ | HIGH: raw i18n key flash; 8/8 range pills ✅; 70 charts ✅ |

### Arabic RTL
| # | Page | Dark | Light | Notes |
|---|---|---|---|---|
| 38 | `/ar` (landing) | ⏭️ | ⏭️ | Not reached — time |
| 39 | `/ar/login` | ⏭️ | ⏭️ | |
| 40 | `/ar/signup` | ⏭️ | ⏭️ | |
| 41 | `/ar/dashboard` | ⏭️ | ⏭️ | |
| 42 | `/ar/students` | ⏭️ | ⏭️ | |
| 43 | `/ar/payments` | ⏭️ | ⏭️ | |
| 44 | `/ar/schedule` | ⏭️ | ⏭️ | |
| 45 | `/ar/settings` | ⏭️ | ⏭️ | |
| 46 | `/ar/admin` | ⏭️ | ⏭️ | |
| 47 | `/ar/scan` | ⏭️ | ⏭️ | |

**Arabic pages were not reached in this audit pass.** Given the `/en/admin/centers` Arabic-on-English bug, Arabic pages should be re-audited with particular attention to whether the inverse problem exists (English text leaking into `/ar/*`).

---

## Wordmark Check Summary

Expected: two separate elements — `CENTER` (white in dark / navy in light) + `HQ` (always teal `#0D9488`), both rendered in **Bodoni Moda** serif.

| Status | Pages |
|---|---|
| ✅ Correct (split + Bodoni Moda) | 32 pages across dashboard, settings, admin, ceo-dashboard |
| ⚠️ Single element, Bodoni Moda (no color split) | `/en/login`, `/en/forgot-pin`, `/en/reset-pin` |
| ❌ Wrong font (Playfair Display fallback) | `/en/signup` |

---

## PDF Download Verification

| Page | Status |
|---|---|
| `/en/settings/billing` invoice PDF | ⏭️ Cannot verify — test tenant has zero invoices |
| `/en/settings/referrals` statement PDF | ⏭️ Cannot verify — zero referrals on account |
| `/en/admin/centers/[id]` invoice PDF | ⏭️ Blocked — centers list returns error page |
| `/en/admin/payouts` payout PDF | ⏭️ Cannot verify — zero payout records |

**Recommendation:** seed the staging tenant with at least one invoice, one referral payout, one center, and one admin payout before re-running this check. Without seeded data, PDF generation is untested end-to-end.

---

## Functional Spot-Checks

| Check | Result |
|---|---|
| 24 platform-config toggles | ❌ 10 found |
| 25 cron jobs on admin/health | ❌ 18 found |
| `dormancy-warnings` cron at `0 4 2 * *` | ❌ Not present |
| 8 time-range pills on ceo-dashboard (7D/30D/90D/6M/1Y/MTD/QTD/YTD) | ✅ All 8 present |
| `student_number` format `#001-0001` | ✅ Verified on `/en/students/[id]` |
| Commission tiers 25% / 10% / 5% | ✅ Verified on `/en/admin/pricing` |
| Sidebar on right in RTL | ⏭️ Not verified (Arabic pages not reached) |
| en-US numerals on `/ar/*` | ⏭️ Not verified |

---

## Gaps in this Audit

The following items from the original brief were not completed and should be verified before launch:

1. All 10 Arabic RTL pages (dark + light) — layout mirroring, en-US numerals, sidebar side, wordmark.
2. `/en/students/import` and `/en/students/print`.
3. Light-mode re-audit of dashboard, payments, schedule, analytics, admin/vendors, admin/health, ceo-dashboard — partial coverage only.
4. End-to-end PDF generation on all four required pages (blocked by empty-state test account).
5. `/en/admin/centers/[id]` detail page (blocked by `/en/admin/centers` error).

---

## Top 6 Fixes to Unblock Launch

1. Fix `/en/admin/centers` route — stop the Arabic error fallback on English locale.
2. Fix `/en/signup` wordmark font loading — force `Bodoni Moda` and split into CENTER + HQ spans.
3. Fix cron table contrast on `/en/admin/health` (use `text-foreground` not `text-muted-foreground/20`).
4. Register missing cron jobs (including `dormancy-warnings`) and missing platform-config toggles in the admin dashboard source.
5. Reconcile Starter annual price between billing page and admin/pricing (45,900 vs 45,890).
6. Seed the staging tenant with invoices / referrals / centers / payouts so PDF downloads can be end-to-end tested.

---

## Executive Summary (top of mind)

CenterHQ is in good shape on the happy-path tenant surfaces — wordmark, dashboard, students, payments, settings, and ceo-dashboard all pass. The launch blockers are concentrated in **admin tooling** (`/en/admin/centers` broken, `/en/admin/health` crons unreadable and incomplete, `/en/admin/platform-config` missing 14 toggles) and **one marketing page regression** (`/en/signup` wordmark in the wrong font). Additionally, a **10 EGP pricing discrepancy** between customer billing and admin pricing will generate disputes on day one and needs reconciling before any real customer touches it. Six CRITICAL, eleven HIGH, nine LOW issues total. Arabic RTL coverage and end-to-end PDF download verification remain open — both require either a longer audit window or a seeded staging tenant.
