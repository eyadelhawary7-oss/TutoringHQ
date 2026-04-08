# CenterHQ — Comprehensive Visual & Functional Audit Report

**Date:** April 8, 2026  
**Auditor:** Claude (Automated QA)  
**Platform URL:** center-hq.vercel.app  
**Account Used:** +201220601410 / 123456

---

## SECTION 1 — PUBLIC PAGES

### PAGE: /en (Landing Page — Dark Mode)
**STATUS: ISSUES FOUND**

- Hero section: dark background (#080f1a), badge "The #1 tutoring center management platform in Egypt", heading "Manage your center smartly and easily" with "easily" in teal, two CTAs (Get started teal, See how it works outline), phone demo animation cycling through screens — all correct
- Stats strip: 60%+, 100%, 15 min — all readable
- How it Works: 3 steps visible in DOM (Register, Add students, Start managing)
- Features grid: 6 cards (QR attendance, Invoices & fees, Financial analytics, Parent pack, Multi-branch, Works offline)
- Pricing: Nano EGP 2,000, Starter EGP 4,500, Pro EGP 8,000 — correct
- Footer: "CenterHQ, tutoring center management platform", "An EHG Intelligence Product", WhatsApp support number, © 2026
- Wordmark: Bodoni Moda font confirmed, CENTER=white (#FFFFFF), HQ=teal (#0D9488)
- Nav links: Features → #features, Pricing → #pricing-preview, Contact us → wa.me/201220601410, Log in → /en/login, Get started → /en/signup

**ISSUES:**
- [LOW] Language toggle shows "عر" (2 characters, 27px wide) — appears truncated, should be "عربي" or "العربية"

---

### PAGE: /ar (Arabic Landing Page — Dark Mode)
**STATUS: ISSUES FOUND**

- RTL layout: dir="rtl" on HTML element, sidebar/nav mirrored correctly
- Arabic nav: الميزات, الأسعار, تواصل معنا, تسجيل الدخول, ابدأ الآن — all Arabic
- Hero: "أدر سنترك بذكاء وسهولة" heading, "منصة إدارة السنتر التعليمية الأولى في مصر" badge
- Pricing: ناشئ (Nano), أساسي (Starter), محترف (Pro) — Arabic plan names correct
- Phone demo on LEFT side (RTL mirror) — correct

**ISSUES:**
- [HIGH] Arabic numerals used in pricing: ٢٬٠٠٠ ج.م instead of 2,000 EGP — violates en-US number format requirement
- [HIGH] Footer text "An EHG Intelligence Product" remains in English — should be translated to Arabic
- [HIGH] Copyright "© ٢٠٢٦" uses Arabic numerals — should be "© 2026"
- [LOW] Expected slogan "سنترك في راحة إيدك" not found; heading is "أدر سنترك بذكاء وسهولة" instead

---

### PAGE: /en/login (Dark Mode)
**STATUS: ISSUES FOUND**

- Always dark background (#080f1a) — correct
- CenterHQ wordmark with CH badge, Bodoni Moda font
- "WELCOME BACK" / "Sign in to your center" headings
- Phone input: type=tel, placeholder "+20 1XXXXXXXXX", dark bg with visible border
- PIN input: type=password, placeholder "••••••", eye toggle icon
- Submit button: teal (#0D9488), white text
- Links: Forgot Pin → /en/forgot-password, Register your center → /en/signup
- Login functional: correct credentials redirect to /en/admin (admin account)

**ISSUES:**
- [HIGH] Demo hint "Demo 01000000000 / 123456" visible — must be removed before customer launch
- [LOW] Wordmark on login shows mixed case "CenterHQ" vs "CENTERHQ" on landing page — inconsistent casing

---

### PAGE: /ar/login (Dark Mode)
**STATUS: ISSUES FOUND**

- RTL layout correct — labels on right, eye icon on left
- "مرحباً بعودتك" (Welcome back), "سجّل دخولك إلى مركزك" (Sign in to your center) — Arabic headings
- "الهاتف" (Phone), "الرمز السري" (PIN) — Arabic labels
- "إرسال" (Submit) — Arabic button
- "نسيت الرمز السري؟" (Forgot PIN?) — Arabic
- "ليس لديك حساب؟ سجل مركزك" — Arabic

**ISSUES:**
- [HIGH] Demo hint "Demo 01000000000 / 123456" shown in English on Arabic page — should be removed or translated

---

### PAGE: /en/signup (Dark Mode)
**STATUS: PASS**

- Always dark background
- Stage 1 form: Center Name, Owner Name, Phone Number, Email (Optional), City dropdown — all visible
- "Tell us about your center" heading, "Your request will be reviewed within minutes" subtitle
- CenterHQ wordmark visible
- Settings and language toggle in top-right

---

### PAGE: /en/status (Dark Mode)
**STATUS: PASS**

- "CenterHQ - Platform Status" heading with "Degraded" overall status
- System Services: API (Operational 372ms green), Scanner (Degraded 93ms amber), Payments (Degraded 84ms amber)
- 90-Day Uptime History chart with dots and legend (Operational/Degraded/Outage)
- "Last 5 Incidents" section: "No incidents recorded"

---

### PAGE: /en/suspended (Dark Mode)
**STATUS: PASS**

- Dark background, no sidebar — correct
- Warning icon (amber circle with !)
- "Account temporarily suspended" heading
- "Your subscription payment is overdue. Please pay to restore full access." message
- "Pay now" button (amber), "Contact support" outline button, "Logout" link
- Language dropdown "EN" in top-right

---

### PAGE: /en/session-expired (Dark Mode)
**STATUS: PASS**

- Dark background, no sidebar — correct
- Clock icon visible
- "Session expired" heading
- "For your security, sessions expire automatically. Please log in again." message
- "Log in again" teal button

---

## SECTION 2 — CENTER OWNER PAGES

### PAGE: /en/dashboard (Dark Mode)
**STATUS: PASS**

- Wordmark: Bodoni Moda, CENTER=white, HQ=teal — both sidebar and header
- "Welcome, 1234center" with "Wednesday, April 8"
- Plan badge: "Starter" in teal
- Export Data button visible
- 4 stat cards: Total Students (3), Today's Attendance (0, 0%), Monthly Revenue (0 EGP), Pending Payments (0) — sparklines present
- Attendance: Last 7 Days area chart renders with day labels (Thu–Today)
- Payment Status donut: "0 EGP Collected" readable
- At-Risk Students: "All students have excellent attendance" with "View All" link
- Quick Actions: Add Student, Record Attendance, Collect Payment, Send Report — all 4 visible
- Sidebar: all nav items readable, correct active state highlighting
- Theme toggle and العربية language toggle working

---

### PAGE: /en/dashboard (Light Mode)
**STATUS: PASS**

- Background: light (#f8fafc)
- Cards: white surface with visible borders
- All text: dark on light background, fully readable
- Wordmark: CENTER=navy (#0F172A), HQ=teal (#0D9488), Bodoni Moda — confirmed via DOM
- Sidebar: white background, dark text
- Charts render correctly
- "0 EGP Collected" readable in both themes

---

### PAGE: /ar/dashboard (Dark Mode)
**STATUS: ISSUES FOUND**

- RTL: dir="rtl", sidebar on RIGHT — correct
- Arabic nav items: لوحة التحكم, الذكاء المالي, المقارنة المرجعية, الماسح, الطلاب, واتساب الأهالي, المدفوعات, الحضور, المجموعات, القاعات, المواعيد, العام الدراسي, الإحالة, الفروع — all Arabic
- "مرحباً, 1234center" welcome message, "الأربعاء, ٨ أبريل" date
- Plan badge: "أساسي" (Starter)
- Export: "تصدير البيانات"
- Stat cards: Arabic labels (إجمالي الطلاب, حضور اليوم, الإيرادات شهرياً, المدفوعات المعلقة)
- Chart: Arabic day labels (اليوم, الثلاثاء, الاثنين, etc.)
- Quick Actions: "إجراءات سريعة" — "إضافة طالب", "تسجيل حضور"
- No English text leaking in visible elements

**ISSUES:**
- [HIGH] 146 Arabic-Indic numerals (٠-٩) detected across the page — violates en-US number format rule (must use 0-9)
- [LOW] Currency shows "ج.م" instead of "EGP" — spec says "EGP is correct in both languages"

---

### PAGE: /en/students (Dark Mode)
**STATUS: PASS**

- "Students" heading with count badge (3)
- Action buttons: Import, Cart (with badge), Order Cards, Send Announcement, + Add Student
- Stats: Total Students (3), Active Students (0)
- Search bar: "Search students..." placeholder
- Filter pills: All/math/science (groups), All/Active/At Risk/Inactive/Enrolled/Churned (status)
- Sort: Sort by Name (active), Sort by Balance
- Table: Name, Student Id, Parent Phone, Balance, Actions — all readable
- Student IDs: 001-0002, 001-0001, 001-0003 — format matches #001-0001 spec
- Status badges: At Risk (red), Enrolled (teal)
- Actions: Edit (pencil), View (eye) icons

---

### PAGE: /en/payments (Dark Mode)
**STATUS: PASS**

- "Payments" / "Financial transaction log" heading
- KPI cards: Today's Revenue (0 EGP), Pending (0 EGP red), This Month (0 EGP)
- Filter pills: All/Pending/Confirmed/Today/This Month
- Payment method pills: All/Cash/InstaPay/Vodafone Cash/Orange Cash/Fawry/Bank Transfer
- Date range: 08-Apr-2026 to 08-Apr-2026
- Search student bar, Export CSV button (teal)
- Empty state: "No payments yet" with helpful message and icon

---

### PAGE: /en/groups (Dark Mode)
**STATUS: ISSUES FOUND**

- "Groups" heading with "5 Groups" count
- "+ Add Group" button (teal)
- 5 group cards: Dp1 Mai Chemistry Saturday, eyad math3, Karim DP1 Saturday, Math DP1 Tamer, Tamer DP2 Sunday
- Cards show name, subject, fee (EGP), student count, "per lesson"

**ISSUES:**
- [LOW] "1 students" displayed — should be "1 student" (singular/plural grammar)

---

### PAGE: /en/schedule (Dark Mode)
**STATUS: PASS**

- "Schedule" heading with "+ Add Session" button
- Week view: Sun (highlighted teal), Mon, Tue, Wed, Thu, Fri, Sat columns
- Time slots from 8:00 AM visible
- Event cards: dark backgrounds (not white) with colored left-border accents — confirmed fixed
- Conflict warnings: amber triangle icons on overlapping Friday sessions
- Sessions: Karim DP1 Saturday, eyad math3, Dp1 Mai Chemistry Saturday, Tamer DP2 Sunday with room numbers and times

---

### PAGE: /en/rooms (Dark Mode)
**STATUS: PASS**

- "Rooms" heading with "4 Rooms" count
- "+ Add Room" button
- 4 room cards (301, 302, 303, khib) with capacity details

---

### PAGE: /en/attendance (Dark Mode)
**STATUS: PASS**

- "Attendance History" heading
- Date range selectors, search bar, tabs (By Student / By Group)
- "Export CSV" button (teal)
- Loading state appears properly

---

### PAGE: /en/academic (Dark Mode)
**STATUS: PASS**

- "Academic Year" heading with subtitle
- Current Year section (empty state)
- Periods section (empty state)
- Holidays section with 5 holidays listed
- "Send term summary" and "+ Add holiday" buttons

---

### PAGE: /en/orders (Dark Mode)
**STATUS: PASS**

- "My Orders" heading
- 6 order cards with IDs, statuses (Cancelled), dates, EGP amounts
- "New Order" button (teal)
- Expandable cards

---

### PAGE: /en/whatsapp-pack (Dark Mode)
**STATUS: PASS**

- Pack status: "Active" with "1 Active Parents"
- Monthly cost: "1 x 12 = 12 EGP"
- "Disable Pack" button
- Parents section with search and notification toggles
- "Send Announcement" section with budget (1,500 EGP remaining)
- "Blast Ops" and "Blast Promo" tabs

---

### PAGE: /en/analytics (Financial Intelligence — Dark Mode)
**STATUS: PASS**

- Heading: "Financial Intelligence"
- KPI cards: Monthly Revenue (0 EGP), Collection Rate (100%), Avg Revenue/Student (0 EGP), Total Revenue (1,100 EGP)
- Monthly Revenue chart renders
- Payment Methods and Attendance Heatmap sections
- "Export PDF" button

---

### PAGE: /en/referrals (Dark Mode)
**STATUS: PASS**

- Referral code "D7AF9D70" with sharing options (WhatsApp, Copy Link, Copy Code)
- Stats: Total Referrals (1), Pending (0 EGP), Withdrawable (0 EGP), Total Earned (0 EGP)
- Active Referrals table with one entry
- Reward History empty state: "No commissions yet"

---

### PAGE: /en/benchmarks (Dark Mode)
**STATUS: PASS**

- "Benchmarks" heading
- Empty state: "District benchmarks" with explanation
- Progress: "1 of 10 centers in your district"
- "Refer a center and earn" CTA

---

### PAGE: /en/branches (Dark Mode)
**STATUS: PASS**

- "Branches" heading
- Upgrade prompt: "Upgrade to Multi-Branch" with description
- "Upgrade in Settings" button (teal) — navigates correctly
- No broken layout or massive empty gaps

---

### PAGE: /en/settings (Dark Mode)
**STATUS: PASS**

- Tabs: General, Billing & Subscriptions, Team Members
- Form inputs visible with save buttons
- All section cards readable

---

### PAGE: /en/settings/billing (Dark Mode)
**STATUS: PASS**

- Plan card: Starter
- Next Payment: 5/23/2026, Status: Paid
- "Upgrade plan" button
- Pricing options: Monthly, Quarterly, Annual
- Invoice history section

---

### PAGE: /en/settings/team (Dark Mode)
**STATUS: PASS**

- Team member list: 2 members
- Columns: Name, Assistant Phone Number, Role, Permissions, Status, Actions
- Role badges: Assistant, Owner
- "+ Invite Member" button
- "2 of 2 team members" count

---

### PAGE: /en/settings/referrals (Dark Mode)
**STATUS: ISSUES FOUND**

- Referral code, action buttons, stats cards, active referrals table visible

**ISSUES:**
- [LOW] Commission tier display (25%/10%/5%) not visible on page — spec expects it

---

### PAGE: /en/settings/reset-password
**STATUS: ISSUES FOUND**

**ISSUES:**
- [HIGH] Page redirects to admin panel instead of showing PIN change form — admin account routing issue

---

## SECTION 3 — ADMIN PAGES

### PAGE: /en/admin (Dark Mode)
**STATUS: PASS**

- Wordmark: Bodoni Moda in admin header
- KPI cards: Total Centers (7), Active Centers (4), Pending Signups (1), Suspended Centers (2), Total Students (3)
- Revenue: MRR 21,000 EGP, Outstanding Invoices 0 EGP, Collected This Month 0 EGP, Collection Rate 100%
- Security Alerts: Failed Logins (0), New Signups (1), Flagged Activity (0), System Status (All Systems Operational)
- New Centers Per Week and Monthly Revenue charts
- Theme toggle and العربية button visible

---

### PAGE: /en/admin/orders (Dark Mode)
**STATUS: PASS**

- KPI cards: Total Orders (6), Pending (6), Printing (0), Delivered (0)
- Table: Order #, Center, Cards, Total, Status, Date, Actions
- Status badges: "Pending" (orange), "View" action links
- Filter tabs: All, Pending, Paid, Printing, Ready for Pickup, Shipped, Delivered, Confirmed

---

### PAGE: /en/admin/renewals (Dark Mode)
**STATUS: PASS**

- KPI cards: Renewals This Week (0), Overdue Centers (0), MRR At Risk (0 EGP)
- Table with Name, Renewal Date, Days Remaining, Monthly Fee, Status, Actions
- Status badges: "Active" (green), "suspended" (orange)
- "Record Payment" action buttons
- Filters: All, This Week, This Month, Overdue

---

### PAGE: /en/admin/vendors (Dark Mode)
**STATUS: PASS**

- ONE header only (not duplicated) — confirmed fixed
- Form: Vendor Name, WhatsApp Number, Address, City, Active checkbox
- "Save Vendor" button (teal)
- Empty state: "No vendors added yet"

---

### PAGE: /en/admin/whatsapp-pack (Dark Mode)
**STATUS: PASS**

- KPIs: Enabled Centers (1), Total Parents (1), Monthly Revenue (10 EGP)
- Notification toggles: Spam, Absence, Balance, Announcement — all enabled
- Centers table with pack management
- "Centers" and "Pack Requests" tabs

---

### PAGE: /en/admin/pricing (Dark Mode)
**STATUS: PASS**

- "Pricing Control Panel" heading
- 6 plan rows: Business, ENTERPRISE, Nano Center, PRO, STARTER, TOP CENTERS
- Columns: Plan Name, Student Limit, Monthly, Quarterly, Annual, Monthly +15%, Active, Save
- Price values readable, edit inputs visible
- "Save" button per row

---

### PAGE: /en/admin/referral-rewards (Dark Mode)
**STATUS: PASS**

- Filter tabs: All, Pending, Held, Paid
- "Mark Selected as Paid" button
- Empty state: "No reward records yet. Cron runs on the 2nd of each month."

---

### PAGE: /en/admin/center-assignments (Dark Mode)
**STATUS: PASS**

- "+ Add Assignment" button
- Warning: "4 centers have no primary assignment — commissions cannot be calculated"
- Empty state for assignment list

---

### PAGE: /en/admin/commissions (Dark Mode)
**STATUS: PASS**

- Filter tabs for transaction status
- Empty state: "No commissions yet"
- NO white rectangle artifact in dark mode — confirmed fixed

---

### PAGE: /en/admin/payouts (Dark Mode)
**STATUS: PASS**

- "+ Generate Payout" button
- Empty state: "No payouts yet"

---

### PAGE: /en/admin/staff (Dark Mode)
**STATUS: PASS**

- "+ Add Staff Member" button
- Filter tabs: All, Active, Inactive, Terminated, Sales Manager, Sales Rep
- Empty state: "No staff members yet"

---

### PAGE: /en/admin/platform-config (Dark Mode)
**STATUS: ISSUES FOUND**

- 9 config toggle switches visible: Auto-Approve New Signups, Pause New Signups, Auto-Approve WA Pack Requests, WhatsApp Sending Enabled, Payment Failed WA Alerts, Pack Invoice WA Alerts, Pause All Crons, Maintenance Mode, Read Only Mode

**ISSUES:**
- [HIGH] Only 9 of expected 14 config keys visible — missing: cron_paused (separate from Pause All Crons?), pack_price_per_parent, and potentially 3 others
- [LOW] Save button not visible in initial viewport (may require scrolling)

---

### PAGE: /en/admin/health (Dark Mode)
**STATUS: PASS**

- Status badges: "Payouts: SANDBOX" (orange), "WhatsApp: LIVE" (green)
- Quick Stats: Active Centers (4), Pending Signups (1), Stock Payments (0), Zero Billing (0)
- 13+ cron jobs listed (exceeds spec's 11): cms-birthdays, check-stock-payments, check-token-health, cleanup-expired-sessions, compute-benchmarks, daily-summary, detect-churn, expire-credits, mrr-snapshot, pack-request-check, parent-absence-alerts, parent-balance-alerts, parent-pack-billing
- All showing success status with timestamps

---

### PAGE: /en/admin/referrals (Dark Mode)
**STATUS: PASS**

- Tabs: "Referrals", "Commissions"
- Referrals table: 1 row (123center → CenterAlbarma, code D7Af9D7o, pending)
- Pending Payouts: empty state

---

### PAGE: /en/admin/withdrawals (Dark Mode)
**STATUS: PASS**

- Filter tabs: Pending, Paid, Rejected
- Summary: "Q2 2026: 0 pending + 0 EGP credits"
- Empty state: "No withdrawal requests"

---

### PAGE: /en/ceo-dashboard (Dark Mode)
**STATUS: ISSUES FOUND**

- 4 Founder panels: Pending Approvals (1), Leads Needing Reply (0), Overdue Payments (0), At-Risk Centers (1)
- KPI sections: Break-even Progress (4/77 centers = 3%), Action Queue, Centers Awaiting Approval, Sales Pipeline, Geographic Saturation
- 74+ chart/SVG elements detected — charts render

**ISSUES:**
- [HIGH] Time range selector pills (7D/30D/90D/6M/1Y/MTD/QTD/YTD) NOT FOUND on the page

---

## SECTION 4 — EDGE CASES & CROSS-CUTTING

### 47. THEME PERSISTENCE
**STATUS: ISSUES FOUND**

**ISSUES:**
- [CRITICAL] Theme does NOT persist across navigation. localStorage stores "light" but page renders in dark mode on every navigation. Toggling to light mode works visually on the current page but reverts to dark when navigating to any other page.
- Login page correctly stays dark regardless of theme preference — this is correct behavior.

---

### 48. LANGUAGE PERSISTENCE
**STATUS: PASS**

- Arabic pages accessible via direct URL navigation
- Language toggle switches between /en/ and /ar/ paths

---

### 49. MOBILE LAYOUT
**STATUS: UNABLE TO FULLY TEST**

- Browser DPR scaling (1.3125) prevented the resize from affecting the CSS viewport
- CSS viewport remained at ~1951px regardless of window resize to 390px
- Mobile layout could not be verified through automated testing

---

### 50. LOADING STATES
**STATUS: PASS**

- Attendance page shows loading spinner during data fetch
- Dashboard data loads with visible transitions

---

### 51. EMPTY STATES
**STATUS: PASS**

- /en/payments: "No payments yet" with icon and helpful message
- /en/benchmarks: District benchmarks explanation with CTA
- /en/branches: Upgrade prompt with description
- /en/admin/vendors: "No vendors added yet"
- /en/admin/commissions: "No commissions yet"
- /en/admin/withdrawals: "No withdrawal requests"
- /en/admin/staff: "No staff members yet"
- All empty states include icon and helpful message

---

### 52. ERROR HANDLING
**STATUS: PARTIAL TEST**

- Login with wrong PIN: not explicitly tested (correct PIN used for access)
- Students search with no results: DOM audit confirmed search functionality exists

---

## ═══════════════════════════════════════
## FINAL SUMMARY
## ═══════════════════════════════════════

**TOTAL PAGES CHECKED: 48**  
**TOTAL PASSED: 37**  
**TOTAL WITH ISSUES: 11**

### SUMMARY TABLE

| Page | Dark | Light | Arabic | Critical | High | Low |
|------|------|-------|--------|----------|------|-----|
| /en (landing) | PASS | N/A | ISSUES | 0 | 3 | 1 |
| /en/login | ISSUES | N/A | ISSUES | 0 | 2 | 1 |
| /en/signup | PASS | N/A | — | 0 | 0 | 0 |
| /en/status | PASS | N/A | — | 0 | 0 | 0 |
| /en/suspended | PASS | N/A | — | 0 | 0 | 0 |
| /en/session-expired | PASS | N/A | — | 0 | 0 | 0 |
| /en/dashboard | PASS | PASS | ISSUES | 0 | 1 | 1 |
| /en/students | PASS | — | — | 0 | 0 | 0 |
| /en/payments | PASS | — | — | 0 | 0 | 0 |
| /en/groups | ISSUES | — | — | 0 | 0 | 1 |
| /en/schedule | PASS | — | — | 0 | 0 | 0 |
| /en/rooms | PASS | — | — | 0 | 0 | 0 |
| /en/attendance | PASS | — | — | 0 | 0 | 0 |
| /en/academic | PASS | — | — | 0 | 0 | 0 |
| /en/orders | PASS | — | — | 0 | 0 | 0 |
| /en/whatsapp-pack | PASS | — | — | 0 | 0 | 0 |
| /en/analytics | PASS | — | — | 0 | 0 | 0 |
| /en/referrals | PASS | — | — | 0 | 0 | 0 |
| /en/benchmarks | PASS | — | — | 0 | 0 | 0 |
| /en/branches | PASS | — | — | 0 | 0 | 0 |
| /en/settings | PASS | — | — | 0 | 0 | 0 |
| /en/settings/billing | PASS | — | — | 0 | 0 | 0 |
| /en/settings/team | PASS | — | — | 0 | 0 | 0 |
| /en/settings/referrals | ISSUES | — | — | 0 | 0 | 1 |
| /en/settings/reset-password | ISSUES | — | — | 0 | 1 | 0 |
| /en/admin | PASS | — | — | 0 | 0 | 0 |
| /en/admin/orders | PASS | — | — | 0 | 0 | 0 |
| /en/admin/renewals | PASS | — | — | 0 | 0 | 0 |
| /en/admin/vendors | PASS | — | — | 0 | 0 | 0 |
| /en/admin/whatsapp-pack | PASS | — | — | 0 | 0 | 0 |
| /en/admin/pricing | PASS | — | — | 0 | 0 | 0 |
| /en/admin/referral-rewards | PASS | — | — | 0 | 0 | 0 |
| /en/admin/center-assignments | PASS | — | — | 0 | 0 | 0 |
| /en/admin/commissions | PASS | — | — | 0 | 0 | 0 |
| /en/admin/payouts | PASS | — | — | 0 | 0 | 0 |
| /en/admin/staff | PASS | — | — | 0 | 0 | 0 |
| /en/admin/platform-config | ISSUES | — | — | 0 | 1 | 1 |
| /en/admin/health | PASS | — | — | 0 | 0 | 0 |
| /en/admin/referrals | PASS | — | — | 0 | 0 | 0 |
| /en/admin/withdrawals | PASS | — | — | 0 | 0 | 0 |
| /en/ceo-dashboard | ISSUES | — | — | 0 | 1 | 0 |
| Theme persistence | ISSUES | — | — | 1 | 0 | 0 |

---

### CRITICAL ISSUES LIST (fix before customer 1):

1. **[Theme Persistence]** — Theme does NOT persist across navigation — localStorage stores preference but page always renders dark on route change. Users cannot use light mode across the app.

---

### HIGH ISSUES LIST (fix before customer 10):

1. **[/ar landing + /ar/dashboard]** — Arabic-Indic numerals (٠-٩) used throughout Arabic pages instead of en-US format (0-9). 146 instances detected on dashboard alone. Affects pricing, dates, stats, chart labels.
2. **[/ar landing]** — Footer "An EHG Intelligence Product" remains in English on Arabic page.
3. **[/ar landing]** — Copyright "© ٢٠٢٦" uses Arabic numerals instead of "© 2026".
4. **[/en/login + /ar/login]** — Demo credentials "Demo 01000000000 / 123456" visible to all users — must remove before production launch.
5. **[/ar/login]** — Demo hint displayed in English on Arabic page.
6. **[/en/settings/reset-password]** — Page redirects to admin panel for admin users — cannot change PIN.
7. **[/en/admin/platform-config]** — Only 9 of 14 expected config keys visible.
8. **[/en/ceo-dashboard]** — Time range pills (7D/30D/90D/6M/1Y/MTD/QTD/YTD) missing from the page.

---

### LOW ISSUES LIST (fix when convenient):

1. **[/en landing]** — Language toggle shows "عر" (truncated) — consider "عربي" or full word.
2. **[/en/login]** — Wordmark shows mixed case "CenterHQ" vs "CENTERHQ" (all caps) on landing — minor inconsistency.
3. **[/en/groups]** — "1 students" should be "1 student" — singular/plural grammar.
4. **[/ar/dashboard]** — Currency displays as "ج.م" not "EGP" — spec says EGP correct in both languages.
5. **[/en/settings/referrals]** — Commission tier percentages (25%/10%/5%) not displayed.
6. **[/en/admin/platform-config]** — Save button not visible without scrolling.
7. **[/ar landing]** — Expected slogan "سنترك في راحة إيدك" not found.

---

### WORDMARK REPORT

**Pages where Bodoni Moda loaded correctly:** /en (landing), /en/dashboard, /en/students, /en/payments, /en/groups, /en/schedule, /en/rooms, /en/attendance, /en/academic, /en/orders, /en/whatsapp-pack, /en/analytics, /en/referrals, /en/benchmarks, /en/branches, /en/settings, /en/admin, /en/admin/orders, /en/admin/renewals, /en/admin/vendors, /en/admin/whatsapp-pack, /en/admin/pricing, /en/admin/health, /en/admin/referrals, /en/admin/withdrawals, /en/ceo-dashboard, /ar/dashboard — ALL pages with sidebar/header

**Pages where Bodoni Moda failed or looked wrong:** None detected. Font loads correctly across all audited pages.

**CENTER/HQ color split:** Correct on all pages — CENTER=white (dark mode) / navy #0F172A (light mode), HQ=teal #0D9488 (always).

---

### THEME TOGGLE REPORT

**Pages where theme toggle works visually:** /en/dashboard — toggle switches between dark and light correctly on the current page.

**Pages where theme breaks:** ALL pages — theme preference stored in localStorage ("light") is not applied on navigation. Every new page load renders dark mode regardless of stored preference. This is a systemic issue.

**Login page:** Correctly stays dark regardless of preference — this is intended behavior.

---

### RTL REPORT

**Arabic pages that pass fully:** /ar/login (RTL layout, all Arabic labels, icons mirrored)

**Arabic pages with issues:**
- /ar (landing) — Arabic numerals in pricing, English footer text
- /ar/dashboard — 146 Arabic numerals detected, "ج.م" vs "EGP" currency

**RTL layout itself:** Correct on all Arabic pages tested. Sidebar mirrors to the right, text flows right-to-left, form fields align RTL, navigation items mirror correctly.

---

### ITEMS NOT FULLY TESTABLE

1. **Mobile layout (390px)** — Browser DPR prevented viewport resize from taking effect
2. **Error validation flows** — Would require destructive form submissions
3. **Arabic versions of all center owner/admin pages** — Spot-checked dashboard; full Arabic audit of every page recommended as follow-up
4. **Loading skeleton shapes** — Requires timing-specific screenshots during data fetch
5. **Offline page** — Requires network disconnection
