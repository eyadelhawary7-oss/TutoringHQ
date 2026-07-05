# TutoringHQ / CenterHQ — Full Page Inventory

A complete catalog of every page route in the Next.js App Router (`src/app/**/page.tsx`), grouped by product area with each page's purpose, content, features, and access level.

## At a glance

| Metric | Value |
|--------|-------|
| **Page routes** | **124** |
| **Localized URLs** (`/ar` + `/en`) | **~246** |
| **Product areas** | 13 (grouped into the sections below) |
| **Non-localized routes** | 1 (`/parent/[token]`) |

**Notes**

- All routes except the parent portal live under a `[locale]` segment, so each is served at both `/ar/…` (default, RTL) and `/en/…` (LTR).
- Route groups like `(dashboard)`, `(admin)` and `(portal)` are for layout sharing and do **not** appear in the URL.
- Routes below are shown **without** the `[locale]` prefix.

**Access legend** — `↪ redirect` · `🌐 public (no auth)` · `🔒 gated (permission/role)` · `⚑ super-admin` · `⚙ server component`

---

## Center · Dashboard & Operations (22)

The day-to-day workspace for a tutoring center — students, groups, attendance, scheduling and at-a-glance analytics.

### `/dashboard` — Center Dashboard (home)
Operational home screen after login with live KPIs.
- Live KPI cards (students, attendance, revenue) with sparklines & growth chips
- Realtime updates via Supabase subscriptions on scans/payments
- Excel export (plan-gated), daily-summary WhatsApp report
- Billing/overdue/suspended banners; revenue hidden without `can_view_revenue`

### `/students` — Student Roster
Full student management for the center.
- Add/edit/delete students, group membership, parent phone, consent
- Per-student QR generation, bulk "generate all", print/download cards
- Order printed cards (single/bulk) via cart
- WhatsApp announcement blasts to parents (owner/admin)

### `/students/[id]` — Student Detail
Individual student profile & history.
- Attendance scan history with paid/pending/unpaid badges
- Order a printed QR card for the student
- Recently-viewed tracking

### `/students/import` — Bulk Import Wizard
Import students from CSV/Excel.
- Drag-drop upload, downloadable template, auto column-mapping
- Group resolution + preview, guardian-consent required
- Batched insert (50/row) with per-student QR + audit log

### `/students/pending` — Pending Enrollments 🔒
Review queue for self-service registrations.
- Approve (assign group, edit parent phone, set price) or reject
- Optional parent-pack enrollment on approval
- Desktop table / mobile cards

### `/students/print` — QR Card Print Sheet ⚙
Server-rendered print sheet of all active students.
- Fetches active students + QR codes, computes academic year
- Renders `PrintClient` card layout
- Redirects if unauth / no center

### `/groups` — Class Groups
Manage the center's class groups.
- Create/delete groups (fee, center-cut, capacity, members)
- Detail slide-over: members, invite link, attendance heatmap
- Waitlist management with auto-notify on free slot

### `/attendance` — Attendance Capture
Unified scan + checklist surface.
- Two tabs: QR scan & Checklist, feeding one sync pipeline
- Deep-linkable `?group=&date=&tab=` from schedule
- Group-scoped context banner

### `/schedule` — Weekly Schedule
Class timetable across rooms.
- Weekly Cairo-time grid (8:00–22:00) + mobile day view
- Add sessions with room-conflict detection; delete (owner/admin)
- Tap session → deep-links to Attendance for that group/date
- "Now" indicator, auto-scroll, role gating

### `/rooms` — Rooms
Manage physical rooms for scheduling.
- Create rooms (name, capacity) with audit logging
- Tracks schedule-slot usage per room
- Auto-opens add modal on `?action=add`

### `/scan` — Scanner (legacy redirect) ↪
Old scanner bookmark.
- Redirects to `/attendance`

### `/scanner` — Scanner (legacy redirect) ↪
Duplicate legacy scanner path.
- Redirects to `/attendance`

### `/checklist` — Checklist (legacy redirect) ↪
Old checklist bookmark.
- Redirects to `/attendance?tab=checklist`

### `/teachers` — Teachers (alias) ↪
Plural alias route.
- Redirects to `/teacher` portal

### `/my-teachers` — My Teachers (center side)
Center's teacher-management hub.
- Tabs: My Teachers, Requests, Slots, Add Teacher
- Two-sided new-group / attach-existing negotiation
- Add teacher by dedicated code

### `/onboarding` — Setup Wizard
4-step guided setup for a new center.
- Steps: add student → create group → simulate scan → ROI summary
- Progress persisted server-side, resumes at saved step
- Summer first-invoice explainer; hours-saved ROI

### `/center` — Center Product Landing 🌐
Public marketing page for the center product.
- `HomePageClient` + SoftwareApplication/FAQ JSON-LD
- Localized SEO metadata
- Public front door — not an app page

### `/analytics` — Revenue & Operations Analytics 🔒 (`can_view_revenue`)
Revenue analytics dashboard.
- KPIs: MRR (MoM), collection rate, avg payment, total revenue
- Charts: revenue area, method donut, attendance heatmap, by-group
- P&L card + AR Aging Report; Export PDF

### `/benchmarks` — District Benchmarks
Compare center vs anonymized peers.
- Attendance, revenue/student, retention, utilization vs district avg
- Percentile bars + you-vs-district charts
- Locked state until 10 centers in district (Refer & Earn CTA)

### `/branches` — Multi-Branch Management
Manage multiple branches.
- Per-branch students, MRR, outstanding, staff counts
- Add branch (owner/super_admin)
- Consolidated totals + by-branch charts (2+ branches)
- Single-plan centers see upgrade prompt

### `/financial-intelligence` — Financial Intelligence (alias)
Alias of Analytics.
- Re-exports the `/analytics` page identically

### `/notifications` — Notifications Inbox
In-app notification list.
- Up to 50 notifications, unread highlighted
- Tap marks read + navigates to href
- Mark-all-read action

---

## Center · Billing, Payments & Orders (14)

How centers pay their subscription, collect from students, order ID cards, and reach parents on WhatsApp.

### `/billing` — Subscription Billing Dashboard 🔒 (Owner)
Owner-facing subscription management.
- Current-plan card with student-usage-vs-cap bar
- Next-payment + "Pay Now" via Paymob iframe (polled)
- Invoice history with PDF download; add-ons summary

### `/payments` — Payments Ledger 🔒
Student payment records.
- KPIs: collected today, pending, this month
- Filters: status, method (cash/InstaPay/wallets/Fawry), date, search
- Confirm pending / Collect Payment (server-gated) + receipt
- CSV export

### `/pay` — Center Invoices (pay)
Center views & pays its own invoices.
- Shared `CustomerInvoicesView` wired to center endpoints
- Pay invoice + download PDF

### `/invoices` — Invoices (legacy redirect) ↪
Old invoices bookmark.
- Redirects to `/settings/billing`

### `/orders` — Card Orders (list + cart) 🔒
ID-card ordering entry point.
- Layered gates: owner-only, card-ordering-enabled
- Loads Bosta shipping rates + initial quote by governorate
- Cart + existing orders with status badges

### `/orders/[orderId]` — Order Detail ⚙
Single card-order view.
- Loads order scoped to center (`notFound` if cross-center)
- Role-aware detail & actions

### `/orders/checkout` — Checkout · Delivery
Step 1 of card checkout.
- Zod-validated delivery form (governorate, address, phone)
- Live shipping-fee/zone preview (Bosta)
- Prefill from cart/center defaults

### `/orders/checkout/customize` — Checkout · Customize
Step 2 — card style.
- Dark vs light card picker with visual mock
- Optional vendor notes + "remember style"

### `/orders/checkout/review` — Checkout · Review
Step 3 — review & place.
- Item list, delivery, pricing breakdown with tax lines
- Terms/no-refund checkbox required
- Submits → stores Paymob session

### `/orders/checkout/payment` — Checkout · Payment
Step 4 — Paymob iframe.
- Embeds Paymob iframe, recovers/creates payment key
- 5-min countdown; polls order every 3s
- On paid → redirects to success

### `/orders/checkout/success/[orderId]` — Checkout Success ⚙
Order confirmation.
- Validates order id, authenticates user
- Fires one-time owner notification
- Renders `CheckoutSuccessClient`

### `/whatsapp-pack` — WhatsApp Parent Pack 🔒 (Owner)
Announcement blasts to parents.
- Composer (160-char) + WA preview → announcement API
- Pack request/approval status, pending balance
- Active-parent count + blast history

### `/whatsapp` — WhatsApp Templates 🔒 (Owner)
Browse approved message templates.
- Loads `wa_meta_templates` (status, variable count)
- Owner/admin/super_admin only

### `/parent-whatsapp` — Parent WhatsApp (redirect) ↪
Old bookmark.
- Redirects to `/whatsapp-pack`

---

## Center · Settings (6)

Center configuration, team, billing and account controls.

### `/settings` — Settings Index (redirect) ↪
Routes `?tab=` to a sub-page.
- Maps general/team/billing → dedicated routes
- Falls back to `/settings/general`

### `/settings/general` — General Settings
Core center configuration.
- Edit name, phone, district, governorate; upload logo
- Subjects: add/edit/delete (owner/super_admin)
- Toggles: daily summary, summer mode, card ordering, scanner mode
- InstaPay number, change PIN, reset password, logout

### `/settings/billing` — Billing & Subscription 🔒 (Owner)
Full plan-change & billing hub (~3.1k LOC).
- Upgrade / Downgrade / Pay-As-You-Go tabs with live prorated preview
- PAYG student-count slider with tier breakpoints & cap
- Paymob iframe payment; credit withdrawals; parent-pack
- Invoice history + PDF; cancellation modal with reason

### `/settings/team` — Team Members 🔒 (Owner/Admin)
Manage center staff.
- Invite assistant/teacher by phone; returns temp password
- Per-member permission toggles (11 basic + 6 sensitive)
- Password-confirm on changes; activate/deactivate; size limit

### `/settings/referrals` — Referral Program 🔒 (Owner)
Center's referral dashboard.
- Referral code + shareable link (copy)
- Referred-center count + total earned
- Withdrawal panel (InstaPay) + payout history PDF
- Tiers: 25% mo.1 / 10% mo.2–12 / 5% mo.13+

### `/settings/reset-password` — Change PIN
Change 6-digit PIN.
- Current / new / confirm masked inputs with validation
- Maps weak-pin, wrong-pin, rate-limit errors
- Success → redirect to `/settings`

---

## Teacher Portal (17)

The private-teacher product: income, groups, attendance sheets, subscription tiers (Standard/Pro) and public teacher onboarding.

### `/teacher` — Teacher Dashboard (home)
Portal home with tiered access.
- Tiles: Centers owed, Income, Groups, Subscription
- Free-zone teachers see banner, onboarding checklist, locked previews
- Start-trial modal; routes to upgrade/resubscribe by status

### `/teacher/analytics` — Pro Analytics
Pro-tier analytics.
- Unlocked → `AnalyticsView` (Standard gated behind Pro)
- Free-zone → blurred `LockedAnalyticsPreview` + trial CTA

### `/teacher/billing` — Billing & History
Attendance/billing history.
- `SummerFirstInvoiceCard` projection
- Unlocked → plan section + `BillingHistory`
- Free-zone → `PrivateUpsellCard`

### `/teacher/centers` — Centers (what they owe me)
Center relationships.
- Center cuts tracker + join-request statuses
- Earnings & attendance, join-center, my-code
- Group proposals & slots; bring-group-to-center (Pro)

### `/teacher/groups` — Private Groups
List of teacher's private groups.
- `PrivateGroupsSection` with add-group (→ start trial)
- Access views: records / resubscribe / trial upsell

### `/teacher/groups/[groupId]` — Group Detail
One private group's roster & tabs.
- Tabs: Overview, Students, Classes, Schedule (URL-synced)
- Approve/reject enrollments, add/remove students
- Per-student private notes gated behind Pro
- Edit group (rename, fee, archive/restore)

### `/teacher/groups/[groupId]/sessions/[sessionId]` — Attendance Sheet
Daily class attendance/billing.
- Tap-to-toggle present/absent (optimistic)
- Finish → N × fee creates pending charges (idempotent)
- Mark-paid with method picker (cash/instapay/wallet)

### `/teacher/income` — Private Income
Income analytics.
- Unlocked → `IncomeView`
- Free-zone → blurred `LockedIncomePreview` + trial CTA

### `/teacher/resubscribe` — Resubscribe
Restart a lapsed subscription.
- Fixed teacher_standard plan, price from API (never hardcoded)
- Monthly vs Annual (×10 → "2 months free")
- Paymob-gated; "coming soon" card when payments off

### `/teacher/schedule` — Schedule
Recurring class schedule (Cairo TZ).
- Today & Week views (URL-synced)
- Per-occurrence states: recorded, live, unrecorded, cancelled
- `SlotActionSheet`: record / cancel / reschedule

### `/teacher/settings` — Teacher Settings
Profile & account.
- Profile (name, subject); parent-pays payment details
- My code; change PIN (weak-pin/rate-limit handling)
- Subscription status + cancel flow

### `/teacher/students` — All Students
Every student across groups.
- `AllStudentsList` aggregate
- Access-tiered: records / resubscribe / trial upsell

### `/teacher/subscription/upgrade` — Upgrade to Pro
Standard → Pro upgrade.
- `PlanComparison` (Std vs Pro), upgrade CTA
- Already-Pro → confirmation
- Payments-unavailable banner when Paymob off

### `/teacher/landing` — Teacher Marketing Landing 🌐
Public teacher landing page.
- Localized SEO metadata (free private-engine trial pitch)
- Renders `TeacherLandingClient`

### `/teacher/pay` — Teacher Invoices (pay)
Pay invoices to restore private engine.
- Shared `CustomerInvoicesView`, teacher-scoped endpoints
- Uses `requireTeacherAuth` (not private-access gate)

### `/teacher/pricing` — Teacher Pricing
Standalone Std-vs-Pro comparison.
- Fetches subscription, renders `PlanComparison`
- Upgrade CTA for Standard; unavailable banner when off

### `/teacher/signup` — Teacher Signup 🌐
Public signup for center-less teachers.
- Form → WhatsApp OTP → verify → auto sign-in
- Mandatory PDPL consent checkboxes; referral prefill
- `?plan=pro` steers post-signup to pricing

---

## Super-Admin / Platform (31)

Internal platform operations — centers, billing, finance, health, staff, pricing, and fulfillment. Phone-gated super-admin.

### `/admin` — Admin Overview ⚑
Admin landing dashboard.
- KPIs: platform health, revenue (MRR/collection), security alerts
- New-centers/week & monthly-revenue charts with trends
- Recent activity feed; legacy `?tab=` redirects

### `/admin/dashboard` — Admin Dashboard (redirect) ↪
Forwards to overview.
- Redirects `/admin/dashboard` → `/admin`

### `/admin/analytics` — Platform Analytics ⚑
Cross-center analytics.
- Avg students/center, revenue/center, zero-student, at-risk
- Donuts: centers by plan & status
- Top-5 by students & by revenue

### `/admin/billing` — Subscription Billing (admin) ⚑
Platform billing management.
- Centers billing table: Mark Paid, Send WhatsApp reminder
- Pending invoices: approve/reject proofs (>50k needs step-up)
- Payment history + Paymob proof lightbox

### `/admin/centers` — Center Directory ⚑
Full center management.
- URL-synced filters (status/plan/search/sort/page)
- Row actions: suspend, blacklist, reactivate, change plan, delete
- Bulk approve/suspend/reactivate/WhatsApp; CSV exports

### `/admin/centers/[id]` — Center Management (deep) ⚑ (Super-Admin)
Single-center deep management.
- Loads invoices, renewals, plan requests, referrals, payouts
- Editable governorate/district, subscription overrides
- CSRF-protected mutations, referral/commission/payout mgmt

### `/admin/ceo-dashboard` — CEO Dashboard (redirect) ↪
Old path.
- Redirects → `/ceo-dashboard`

### `/admin/demo-requests` — Demo Requests ⚑
Inbound sales/demo leads.
- Read-only table: name, phone, email, center, status
- Status pills; manual refresh

### `/admin/finance` — Finance Dashboard ⚑
Platform financial dashboard.
- MRR trend + growth %, revenue breakdowns, cohorts
- Outstanding invoices, at-risk centers
- Charts client-only (Recharts hydration-safe); refresh + timestamp

### `/admin/health` — System Health ⚑ (Super-Admin)
Platform health monitor.
- Mode badges (Paymob/WhatsApp live/test); polls every 60s
- Dead-letter queue with retry; cron status table + error modal
- Pending-actions links with counts

### `/admin/internal-team` — Internal Team ⚑
Manage internal staff.
- Invite member with role selector + custom permissions
- Edit role (password-confirm), deactivate
- super_admin/admin rows non-editable

### `/admin/orders` — Card Order Fulfillment ⚑
ID-card order pipeline.
- Status pipeline pending→…→delivered→confirmed
- Filter, KPIs, per-order slide-over + template preview
- WhatsApp contact; Bosta shipping zone

### `/admin/pending-signups` — Pending Signups ⚑
Centers awaiting approval.
- Table: center, owner, phone, plan, referred-by
- Approve (opens WhatsApp URL) / reject with reason
- WhatsApp onboarding contact

### `/admin/plan-requests` — Plan Change Requests ⚑
Review plan-change requests.
- Table: current→requested plan, price diff, status
- Approve/reject pending rows

### `/admin/platform-config` — Platform Config ⚑ (Super-Admin)
Global key/value settings editor.
- Grouped config (late-fee/dormancy + all)
- Boolean toggles auto-save; others per-row save
- super_admin only; CSRF writes

### `/admin/pricing` — Pricing Control Center ⚑ (Super-Admin)
Plans & landing pricing config.
- Per-plan limits/fees/prices; WhatsApp pack price
- Billing intervals, add-ons, landing banner/popup, summer promo
- super_admin edit; internal roles read-only; live previews

### `/admin/privacy-requests` — Privacy Requests ⚑
PDPL data-rights management.
- Table with overdue highlighting (due-date passed)
- Deletion: find student by phone → anonymize (confirm)
- CSRF-authenticated

### `/admin/promo-codes` — Promo Codes ⚑
Create/manage discount codes.
- Create (code, %, max uses, expiry)
- Activate/deactivate; delete restricted to super-admin
- Computed status: active/expired/exhausted/inactive

### `/admin/referrals` — Referrals & Commissions ⚑
Referral & commission admin.
- Referrals table + pending payouts (mark paid)
- Commissions (super-admin): by referrer, quarter filter
- Mark commission paid; CSV export

### `/admin/renewals` — Renewals ⚑
Upcoming/overdue renewals.
- KPIs: this week, overdue, MRR at risk
- Filter chips; record-payment modal (method, notes)
- Manual refresh

### `/admin/sales-pipeline` — Sales Pipeline (CRM) ⚑
Lightweight lead Kanban.
- KPIs + 4 stage columns (prospect→converted)
- Add-lead modal, lead detail panel, change stage
- **Note: in-memory prototype (no persistence)**

### `/admin/vendors` — Card Vendors ⚑ ⚙
Card-vendor management.
- Server-fetches current vendor → `AdminVendorsClient`
- Vendor: name, WhatsApp, pickup address, city, active

### `/admin/withdrawals` — Credit Withdrawals ⚑
Process center cash-out requests.
- Tabs: pending/paid/rejected; quarter summary
- Mark Paid / Reject with confirm
- Cairo-TZ quarter computation

### `/admin/card-orders` — Card Orders (redirect) ↪
Alias.
- Redirects → `/admin/orders`

### `/admin/card-orders/[orderId]` — Admin Card Order Detail ⚑ ⚙
Single order (admin view).
- Loads via `loadCardOrderDetailForAdmin`
- internal_viewer redirected; `?returnTo` back-nav

### `/admin/center-assignments` — Center Assignments ⚑ (Super-Admin)
Assign centers to sales staff.
- Assignments table + unassigned-centers warning
- Add/edit assignment (sourced_by, staff, territory)
- Flag/resolve territory disputes

### `/admin/commissions` — Staff Commissions ⚑ (Super-Admin)
Tiered sales-commission tracking.
- T1/T2 status filters; 180-day T2 clock with pauses
- Loyalty bonus, active-days indicators
- Unlock-T2 modal (reason ≥10 chars)

### `/admin/payouts` — Staff Payouts ⚑ (Super-Admin)
Monthly staff payouts.
- Per-staff payout cards: salary + T1/T2/loyalty/override
- Generate month; confirm / mark_paid / adjust state machine
- Adjustment modal; PDF download

### `/admin/referral-rewards` — Referral Rewards ⚑
Center-to-center reward payouts.
- Status chips (pending/held/paid) + per-referrer totals
- Records table (month, rate, amount, held-until)
- Super-admin: bulk mark-paid

### `/admin/whatsapp-pack` — WhatsApp Pack (admin) ⚑ ⚙
Manage parent pack across centers.
- Server-fetches centers, types, stats → `AdminWaPackClient`
- Total enabled, active parents, MRR, pending requests
- `?include_test=1` supported

---

## Executive / CEO (3)

High-altitude command dashboards for the business, with kill-switches and teacher-business analytics.

### `/ceo-dashboard` — CEO Dashboard ⚑ (Exec) ⚙
Executive analytics over a time range.
- super_admin or internal_admin only
- `TimeRangeSelector` (`?range=`) → `CeoDashboardClient` widgets

### `/ceo` — CEO Command Center ⚑ (Exec)
Live ops dashboard (polls 30s).
- Hero KPIs, teacher+center MRR, center-health tiers
- Action queue, sales pipeline, activation table
- Ops toggles + password-gated kill-switches (maintenance/WA/cron)

### `/ceo/teachers` — CEO Teacher Analytics ⚑ (Exec)
Teacher-business deep view.
- Tabs: Subscriptions, Referrals, Teachers, Attachments, Credits
- Summary cards + filter bars + data tables
- Per-row test badges, plan-mix summary

---

## Public & Marketing (8)

The no-auth front door: home, pricing, feature and comparison landing pages.

### `/` (home) — Home / Splash 🌐
Persona-neutral marketing landing.
- Hero with "Start free" / "See how"; sample dashboard preview
- Co-equal persona cards → `/center` (teal) & `/teacher/landing` (brass)
- How-it-works, FAQ accordion, Organization JSON-LD
- `StartFreeChooser` modal (center vs teacher)

### `/pricing` — Pricing 🌐
Pricing for both audiences.
- `?for=center|teacher` toggle (URL-synced)
- Monthly/annual toggle (annual = 2 months free)
- Dynamic DB-driven prices (`usePublicPlanPrices`)
- Teacher `PlanComparisonTable`; contact-sales

### `/blog` — Blog 🌐
Placeholder "coming soon".
- BookOpen icon + heading
- Single CTA → `/signup`

### `/compare/spreadsheets` — vs Spreadsheets & Paper 🌐
SEO comparison landing.
- 6-row comparison table (attendance, notifications, payments…)
- Hero + repeated "Start free" CTAs

### `/features/qr-attendance` — Feature · QR Attendance 🌐
QR attendance marketing.
- 3-step how-it-works (card → scan → WhatsApp)
- Offline PWA / any-Android-tablet features

### `/features/student-management` — Feature · Student Management 🌐
Student profiles marketing.
- 6 feature cards (history, payments, groups, contact, #, notes)
- Closing signup CTA

### `/features/whatsapp-notifications` — Feature · WhatsApp Notifications 🌐
Parent-notifications marketing.
- 3-step how-it-works
- Simulated WhatsApp chat-bubble preview

### `/demo-request` — Demo Request 🌐
Minimal demo-request stub.
- Logo + title + message card
- Opens WhatsApp (`wa.me`)

---

## Auth & Account State (11)

Login, signup, PIN flows, and the lock/notice screens for suspended, expired, offline and status states.

### `/login` — Login 🌐
Phone + 6-digit PIN login.
- Phone→email lookup → PIN verify → Supabase session
- Role-based routing (teacher/admin/dashboard)
- Account-locked (423) handling; resume abandoned signup

### `/signup` — Signup 🌐
Center-owner registration.
- Multi-stage: phone → plan → payment/info
- DB-driven plan prices, billing period, city selector
- Referral codes, pending-signup resume, TOP CENTERS path

### `/forgot-password` — Forgot PIN / Reset 🌐
2-step PIN reset via OTP.
- Phone → OTP send → 6-box OTP + new PIN
- Auto-advance/paste OTP; resend; rate-limit
- Success → `/login?message=password_reset_success`

### `/accept-invite` — Accept Team Invitation 🌐
Staff joining a center.
- 3 steps: phone → OTP → done (shows center name)
- On complete displays generated login PIN
- Resend OTP + rate-limit handling

### `/set-pin` — Set Initial PIN ⚙
Owner first-login PIN setup.
- Modes: form / finalizing (poll) / fallback (request link)
- Decides from `?t=` token, cookie, DB state
- Real boundary is `/api/auth/set-initial-pin`

### `/session-expired` — Session Expired
Session-expired notice.
- Clock icon + description
- "Log in again" → `/login`

### `/reactivate` — Reactivate Center
Suspended owner pays to reactivate.
- Plan radio list with reactivation total + fees
- "Pay now" → Paymob URL
- Redirects unauth/active users

### `/suspended` — Suspended
Lock screen for suspended centers.
- `?reason=` (suspended / overdue / default)
- Read-only student/group counts; Fawry ref code
- Pay-now → `/pay` or `/reactivate`; WhatsApp support

### `/offline` — Offline 🌐
PWA offline fallback.
- Wifi-off icon; notes scanner works offline
- Retry (reload) button

### `/status` — Platform Status 🌐
Public status dashboard.
- Polls `/api/status` every 60s
- Per-service uptime %, response time, 90-day heatmap
- Last-5-incidents list

### `/sentry-test` — Sentry Test
Error-reporting diagnostic.
- Button throws a test error to verify Sentry

---

## Referrals & Public Join (4)

Inbound referral links and public self-enrollment flows for center groups and private-teacher groups.

### `/refer/[code]` — Referral Landing 🌐
Inbound referral link capture.
- Stores code (cookie 7 days) + appends `?ref=`
- Validates code, shows referrer/center name
- CTA → `/signup?ref=code`

### `/referrals` — Referral Dashboard 🔒 (Owner)
Owner referral dashboard.
- KPIs: total/pending/withdrawable/earned + tier explainer
- `ReferralWithdrawalPanel` (InstaPay)
- Active referrals + reward-history tables; share code

### `/join/[center_code]/[group_id]` — Public Group Enrollment 🌐
Self-enroll into a center group.
- Fetches group info (center + group name)
- Form: student name/phone, parent phone, consent
- Submits to pending-enrollment API

### `/join/g/[groupId]` — Public Teacher Group Join 🌐 ⚙
Self-enroll into a private-teacher group.
- Server-fetches active group + teacher profile + fee
- Respects WhatsApp kill switch (coming-soon banner)
- Multi-step `JoinFlowClient` form

---

## Legal (7)

Terms, privacy, cookies, DPA and the PDPL data-rights request form. Two variants: `LegalDoc` section-lists and i18n-translated pages.

### `/legal/terms` — Terms & Conditions 🌐
`LegalDoc` terms.
- Bilingual title + ~14 section headings
- Egyptian governing law, subscription fees, IP, liability

### `/legal/privacy` — Privacy Policy 🌐
`LegalDoc` privacy (PDPL).
- Data controller, collection, legal basis, sub-processors
- PDPL rights, cross-border transfers, children's privacy

### `/legal/cookie` — Cookie Policy 🌐
`LegalDoc` cookies.
- 5 sections: what/used/third-party/managing/contact

### `/legal/dpa` — Data Processing Agreement 🌐
`LegalDoc` DPA.
- 14 formal sections: parties, sub-processors, breach, audit
- Return/deletion, governing law, signatures

### `/legal/privacy-request` — PDPL Data-Rights Request 🌐
Public data-rights form.
- Name, phone, email, request type, message
- Types: access/correction/deletion/portability/objection
- POST `/api/privacy-request`; confirmation on success

### `/terms` — Terms (i18n) 🌐
Translation-driven terms.
- `next-intl` `legal.terms` namespace
- Conditional processing-fee disclosure section

### `/privacy` — Privacy (i18n) 🌐
Translation-driven privacy.
- `next-intl` `legal.privacy` namespace
- Title + last-updated + body

---

## Parent Portal (1)

The one route outside the locale system — a token-based, read-only Arabic portal for parents.

### `/parent/[token]` — Parent Portal 🌐
Token-based read-only parent view (no locale segment, hardcoded Arabic RTL).
- Fetches `/api/parent/portal?token=`
- 30-day attendance heatmap, balance due, upcoming sessions
- Expired-link → center WhatsApp contact

---

## Things worth flagging

- **~246 rendered URLs** — 123 of 124 pages sit under `[locale]`, served in both `/ar` (default, RTL) and `/en`. Only `/parent/[token]` is outside the locale system (hardcoded Arabic).
- **9 pure redirects** (legacy bookmarks): `/scan`, `/scanner`, `/checklist`, `/teachers`, `/invoices`, `/parent-whatsapp`, `/admin/dashboard`, `/admin/ceo-dashboard`, `/admin/card-orders`.
- **`/financial-intelligence` is a literal alias** — it re-exports the `/analytics` page component.
- **`/admin/sales-pipeline` is a non-persisted prototype** — leads live only in React state, no API/DB behind it.
- **`/sentry-test`** deliberately throws an error; consider gating or removing it in production.
