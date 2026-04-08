# CenterHQ Visual Audit Report

**Date:** April 8, 2026  
**URL:** center-hq.vercel.app  
**Tested by:** Claude (automated visual audit)  
**Modes tested:** Dark mode, Light mode, Arabic RTL

---

## CRITICAL Issues (P0)

### 1. Landing Page (/en) — Massive Empty Gap
The landing page has an enormous empty dark area (thousands of pixels tall) between the hero section / "How it works" heading and the rest of the page content. The page appears to extend almost infinitely with blank space, and Ctrl+End caused the renderer to hang briefly. This makes the page appear broken to any visitor who scrolls past the fold.

**Affected:** `/en` (dark mode — landing page is always dark)

### 2. Vendors Page — Duplicate Navigation Header
The `/en/admin/vendors` page renders **two** stacked "CenterHQ" navigation bars, each with its own العربية button and green "+" icon. This occurs in both dark and light mode.

**Affected:** `/en/admin/vendors` (both themes)

### 3. Global Layout — Content Container Does Not Fill Viewport
Across virtually every page (both authenticated and public), the main content area is constrained inside a box that does not extend to the right edge or the bottom of the viewport. There is a visible ~350px dark gap on the right side and a ~200px gap at the bottom. This creates a "floating box" appearance rather than a full-width app layout. The container also has a faint orange/brown border visible in dark mode.

**Affected:** All pages globally (login, signup, dashboard, admin, etc.)

---

## HIGH Issues (P1)

### 4. Schedule Page — White Event Cards on Dark Background
In dark mode, the schedule event cards (e.g., "Karim DP1...", "eyad math3", "Tamer DP2...") have **white/light backgrounds** that starkly contrast against the dark schedule grid. These cards were clearly not updated for the dark theme. In light mode they look fine.

**Affected:** `/en/schedule` (dark mode only)

### 5. Signup Page — Colored Strip at Top
The `/en/signup` page has a visible **colored horizontal strip** (teal/gradient) at the very top of the page that appears to be a stray element or misaligned gradient.

**Affected:** `/en/signup` (dark mode)

### 6. Admin Panel — Theme Toggle Missing from Header
When viewing the admin panel (`/en/admin/*`), the sun/moon theme toggle button is **absent** from the header bar. Only العربية and the green "+" button appear. Users cannot toggle between dark and light mode from admin pages without navigating to an owner page first.

**Affected:** `/en/admin/*` (all admin pages)

---

## MEDIUM Issues (P2)

### 7. Vendors Page — Form Inputs Have Light Background in Dark Mode
On `/en/admin/vendors`, the form input fields (Vendor Name, WhatsApp Number, Address, City) have **gray/light backgrounds** that clash with the dark theme. They appear to be unstyled for dark mode.

**Affected:** `/en/admin/vendors` (dark mode)

### 8. Offline Page — Low-Contrast Banner Text
On `/en/offline`, the green informational banner ("QR scanner works offline. Attendance is saved automatically.") has **light text on a light green background**, making it difficult to read.

**Affected:** `/en/offline` (light mode)

### 9. Login Page — Low-Contrast Submit Button (Idle State)
When the login page (`/en/login`) first loads, the Submit button appears in a **muted dark green** that barely contrasts against the dark background. It becomes more visible once the fields are interacted with.

**Affected:** `/en/login` (dark mode, idle state)

### 10. Session-Expired Page — Shows Full Sidebar Navigation
The `/en/session-expired` page displays the complete sidebar navigation (Dashboard, Students, etc.) even though the session has expired. A user with an expired session shouldn't see the full app navigation — it should be a standalone page like `/en/suspended`.

**Affected:** `/en/session-expired`

### 11. Suspended Page — Not Dark
The `/en/suspended` page uses a **white/light background** regardless of theme setting. If this is a public-facing page, it may need to follow the "always dark" convention used by login/signup, or at least respect the user's theme preference.

**Affected:** `/en/suspended`

---

## LOW Issues (P3)

### 12. Arabic Login — Mixed Language Text
On `/ar/login`, two links contain untranslated English words:
- "الرمز السري **Forgot**" — "Forgot" should be "نسيت"
- "لا **Account** سجل مركزك" — "Account" should be "حساب"

**Affected:** `/ar/login`

### 13. Arabic Students — Mixed "Id" Label
On `/ar/students`, the table header shows "طالب **Id**" — the "Id" should be translated to "رقم" or "معرف".

**Affected:** `/ar/students`

### 14. Commissions Page — Small White Rectangle
On `/en/admin/commissions` in dark mode, there is a small **white/light rectangle** visible in the bottom-right corner of the page — appears to be a stray element or scrollbar artifact.

**Affected:** `/en/admin/commissions` (dark mode)

---

## Pages That Passed (No Issues Found)

The following pages looked correct in both dark and light mode with no visual regressions:

- `/en/dashboard` — Clean in both themes
- `/en/students` — Table, filters, badges all render correctly
- `/en/scan` — QR scanner UI works in both themes
- `/en/payments` — KPI cards, filters, table all correct
- `/en/groups` — Card grid renders well in both themes
- `/en/settings` — Form inputs properly themed
- `/en/analytics` (Financial Intelligence) — Charts render correctly
- `/en/admin` (Overview) — KPI cards, charts, activity log all correct
- `/en/admin/orders` (Card Orders) — Table renders well
- `/en/admin/renewals` — Table and status badges correct
- `/en/admin/pricing` — Pricing table, inputs all correct
- `/en/admin/platform-config` — Toggles render correctly
- `/en/admin/health` — Cron status table renders correctly
- `/en/admin/referrals` — Tables render correctly
- `/en/ceo-dashboard` — KPI cards, progress bar, tables all correct
- `/en/status` — Status indicators and uptime history correct
- `/ar/dashboard` — RTL layout correct, Arabic text rendering properly
- `/ar/students` — RTL table layout correct
- `/ar/scan` — RTL layout correct, scanner UI works

---

## RTL / Arabic Summary

Arabic (`/ar/`) pages have **correct RTL layout** overall:
- Sidebar is on the right
- Text flows right-to-left
- Navigation items are properly aligned
- Day labels in charts are translated
- Status badges are translated

Minor translation gaps exist (see items 12 and 13 above) but the structural RTL implementation is solid.

---

## Recommendations (Priority Order)

1. **Fix the landing page gap** — likely an element with extreme height or a missing `overflow: hidden`
2. **Fix the global container width** — the app shell should fill 100vw/100vh; remove or fix the constraining wrapper
3. **Remove the duplicate header** on the Vendors page
4. **Add dark-mode styles** to schedule event cards
5. **Add the theme toggle** to the admin panel header
6. **Fix the Vendors form inputs** for dark mode
7. **Translate remaining English fragments** in Arabic locale
8. **Consider making session-expired/suspended standalone pages** without the sidebar
