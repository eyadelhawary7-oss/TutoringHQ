# Design inventory — how the 105 designs land on the live platform

**Produced 26 July 2026. Session 1 of `START-CLAUDE-CODE.md`. Nothing was built or changed.**
Model: `claude-opus-5`.

This maps the 26 `Merged-*.html` files onto the routes that exist in `src/app` today, so the
redesign can be applied without anyone guessing which screens already have a working data layer
and which do not.

## How this was produced

Every claim here comes from reading the two sides directly:

- **Design side** — the `mgd-num` / `mgd-name` / `mgd-src` section bars and the frame captions inside each `Merged-*.html`. Not `TutoringHQ-Screen-Tracker.md`, which is stale (see *Corrections* at the end).
- **Live side** — every `page.tsx` under `src/app`, plus `src/proxy.ts`, `src/components/Sidebar.tsx`, `src/components/AdminSidebar.tsx` and `public/sw.js`. Files were read, not inferred from names.

**No live database was queried.** Route existence and screen behaviour come from the filesystem;
that is enough for a route inventory. It is **not** enough to write a query — every column still has
to be checked against `information_schema.columns` when a screen is actually implemented.

## Totals

| | |
|---|---|
| Design screens | **105** in 26 merged files |
| Live page routes | **128** (`page.tsx` files, locale-collapsed) |
| **1.** Designs that replace a live route | **79** screens, covering **94** routes |
| **2.** Designs with no live route | **26** screens |
| **3.** Live routes with no design | **34** routes (22 real screens + 12 redirects) |

Scrutiny tags used in list 1: **`layout`** restyle only · **`money`** shows or moves amounts ·
**`auth`** credentials, PIN/OTP or permissions · **`state`** subscription, trial, verification or
suspension changes what renders.

---

## Read this before list 1: the verification product does not exist

`Valify`, `national_id`, `identity_verif*` and any center- or teacher-held balance return **zero
matches** across `src/`. There is no verification flow, no collected-tuition balance, no
withdrawal of tuition, and no e-receipt surface. Online collection ("we collect from the parent and
pay the provider") is not built.

That is not a styling gap, and it changes how ~24 of the 105 designs should be scheduled:

- **7 screens in list 1** are the *verified variant* of a live route (Center Dashboard / Students / Groups / Attendance / Payments / Team, Teacher Class Session). The route is real, the data layer for the unverified half is real, the verified half is not.
- **3 more in list 1** (Teacher Home, Teacher Income, Teacher Settings) draw both states side by side; only the unverified frames match live behaviour.
- **14 screens in list 2** exist *only* because of it and have nowhere to land at all.

Anyone treating a "Verified" screen as a restyle will produce a screen that renders nothing.

---

# List 1 — Live routes that a design replaces

79 design screens, 94 routes. Data layer already works unless the row says otherwise.

## Public

| Design | Route | Serving file | Tags |
|---|---|---|---|
| `Merged-Public-Marketing` §01 Public Landing | `/{locale}` | `src/app/[locale]/page.tsx` → `SplashClient.tsx` | `layout` |
| `Merged-Public-Marketing` §02 Public Audience | `/{locale}/center` | `src/app/[locale]/center/page.tsx` → `[locale]/HomePageClient.tsx` | `layout` |
| ” | `/{locale}/teacher/landing` | `src/app/[locale]/teacher/landing/page.tsx` → `TeacherLandingClient.tsx` | `layout` |
| `Merged-Public-Marketing` §03 Public Pricing | `/{locale}/pricing` | `src/app/[locale]/pricing/page.tsx` → `PricingPageClient.tsx` | `money` |
| ” ⚠ | `/{locale}/teacher/pricing` | `src/app/[locale]/teacher/pricing/page.tsx` | `money` |
| `Merged-Public-App` §01 Public Auth | `/{locale}/signup` | `src/app/[locale]/signup/page.tsx` → `SignupForm.tsx` | `auth` `state` |
| ” | `/{locale}/teacher/signup` | `src/app/[locale]/teacher/signup/page.tsx` | `auth` `state` |
| ” | `/{locale}/login` | `src/app/[locale]/login/page.tsx` | `auth` |
| ” | `/{locale}/forgot-password` | `src/app/[locale]/forgot-password/page.tsx` | `auth` |
| `Merged-Public-App` §02 Public Join | `/{locale}/join/[center_code]/[group_id]` | `src/app/[locale]/join/[center_code]/[group_id]/page.tsx` | `state` |
| `Merged-Public-App` §03 Public Self Enrollment ⚠ | `/{locale}/join/g/[groupId]` | `src/app/[locale]/join/g/[groupId]/page.tsx` → `JoinFlowClient.tsx` | `auth` `state` |
| `Merged-Public-App` §05 Referral Landing ⚠ | `/{locale}/refer/[code]` | `src/app/[locale]/refer/[code]/page.tsx` | `money` |
| `Merged-Public-App` §06 Offline ⚠ | `/{locale}/offline` | `src/app/[locale]/offline/page.tsx` | `layout` |
| `Merged-Public-Legal` §01 Public Legal ⚠ | `/{locale}/legal` (index) · `/legal/privacy` · `/legal/terms` · `/legal/cookie` · `/legal/dpa` | `src/app/[locale]/legal/page.tsx` + `legal/*/page.tsx` → `legal/LegalDoc.tsx`, `legal/legalContent.ts`, `legal/layout.tsx` | `layout` |
| ” | `/{locale}/legal/privacy-request` | `src/app/[locale]/legal/privacy-request/page.tsx` → `POST /api/privacy-request` | `layout` |
| ” | `/{locale}/privacy` · `/terms` · `/cookies` | permanent redirects into the three `/legal/*` addresses above — old public URLs, kept alive, no content of their own | `layout` |

⚠ **Self enrollment, referral landing, offline and the legal surface are all live.**
`TutoringHQ-Screen-Tracker.md` lists them as "designed, not yet in the platform". They are restyles,
not new builds. Detail in *Corrections*.

⚠ `/teacher/pricing` — the design folds center and teacher plans into **one** `/pricing` page with a
toggle. Live has two routes. Consolidating them is a routing change, not a restyle; decide before building.

**Legal caveat — rewritten 5 August 2026; the previous wording was two PRs out of date.** It read:
*"the four documents render section headings with `[This section will be completed upon legal
review]` placeholders and a draft-notice banner. The chrome is real; the text is not."* That string
returns **zero** matches in `src/` today. Since **#311** (`81639a14`) the four documents carry the
design's real prose in both languages, and **13 of the 23** contents sections are drafted. The
remaining **10** keep their contents entry and their anchor and render one explicit "Pending Adsero
draft." line. So: the chrome is real, and so is most of the text — but **applying the design still
does not close the Adsero dependency**, which is the one sentence above that was always right. The
exact 10 are tabulated under **X4** in `BUILD-AFTER-REDESIGN.md` and locked by
`tests/unit/legalCorpusParity.test.ts`.

## Center

| Design | Route | Serving file | Tags |
|---|---|---|---|
| `Merged-Center-Home` §01 Center Dashboard Verified | `/{locale}/dashboard` | `src/app/[locale]/dashboard/page.tsx` | `money` `state` |
| `Merged-Center-Home` §02 Notifications | `/{locale}/notifications` | `src/app/[locale]/(dashboard)/notifications/page.tsx` → `NotificationsPageClient.tsx` | `layout` |
| `Merged-Center-Students` §01 Students (Roster) | `/{locale}/students` | `src/app/[locale]/students/page.tsx` | `money` |
| `Merged-Center-Students` §02 Student Detail | `/{locale}/students/[id]` | `src/app/[locale]/students/[id]/page.tsx` | `money` |
| `Merged-Center-Students` §03 Center Students Verified | `/{locale}/students` | same file, verified state | `money` `state` |
| `Merged-Center-Students` §04 Students Import Pending | `/{locale}/students/import` | `src/app/[locale]/students/import/page.tsx` | `layout` |
| ” | `/{locale}/students/pending` | `src/app/[locale]/students/pending/page.tsx` | `state` |
| `Merged-Center-Groups` §01 Groups | `/{locale}/groups` | `src/app/[locale]/groups/page.tsx` | `money` |
| `Merged-Center-Groups` §02 Center Groups Verified | `/{locale}/groups` | same file, verified state | `money` `state` |
| `Merged-Center-Groups` §03 Rooms | `/{locale}/rooms` | `src/app/[locale]/rooms/page.tsx` | `layout` |
| `Merged-Center-Groups` §04 Branches | `/{locale}/branches` | `src/app/[locale]/(dashboard)/branches/page.tsx` | `money` |
| `Merged-Center-Groups` §05 Schedule | `/{locale}/schedule` | `src/app/[locale]/schedule/page.tsx` | `layout` |
| `Merged-Center-Attendance` §01 Center Attendance Verified | `/{locale}/attendance` | `src/app/[locale]/attendance/page.tsx` | `money` `state` |
| `Merged-Center-Money` §01 Payments | `/{locale}/payments` | `src/app/[locale]/payments/page.tsx` | `money` |
| `Merged-Center-Money` §02 Center Payments Verified | `/{locale}/payments` | same file, verified state | `money` `state` |
| `Merged-Center-Money` §03 Billing | `/{locale}/billing` | `src/app/[locale]/(dashboard)/billing/page.tsx` → `BillingPageClient.tsx` | `money` `state` |
| `Merged-Center-Insight` §01 Analytics | `/{locale}/analytics` | `src/app/[locale]/(dashboard)/analytics/page.tsx` | `money` `state` |
| `Merged-Center-Insight` §02 Benchmarks | `/{locale}/benchmarks` | `src/app/[locale]/(dashboard)/benchmarks/page.tsx` | `money` `state` |
| `Merged-Center-Insight` §03 Referrals | `/{locale}/referrals` | `src/app/[locale]/referrals/page.tsx` → `components/referrals/ReferralWithdrawalPanel.tsx` | `money` |
| `Merged-Center-WhatsApp` §01 WhatsApp | `/{locale}/whatsapp` | `src/app/[locale]/whatsapp/page.tsx` → `WhatsAppTemplatesClient.tsx` | `layout` |
| `Merged-Center-WhatsApp` §02 WhatsApp Pack ⚠ | `/{locale}/whatsapp-pack` | `src/app/[locale]/(dashboard)/whatsapp-pack/page.tsx` → `WhatsAppPackClient.tsx` | `money` |
| `Merged-Center-WhatsApp` §03 WhatsApp Custom Flow ⚠ | `/{locale}/whatsapp-pack` | same file — custom-amount flow not built | `money` |
| `Merged-Center-Orders` §01 Orders | `/{locale}/orders` | `src/app/[locale]/(dashboard)/orders/page.tsx` | `money` |
| `Merged-Center-Orders` §02 Order Detail | `/{locale}/orders/[orderId]` | `src/app/[locale]/(dashboard)/orders/[orderId]/page.tsx` | `money` |
| `Merged-Center-Orders` §03 Order Checkout | `/{locale}/orders/checkout` `/customize` `/review` `/payment` `/success/[orderId]` | `src/app/[locale]/(dashboard)/orders/checkout/**` | `money` |
| `Merged-Center-Orders` §04 Card Orders Coming Soon ⚠ | `/{locale}/orders` | gate lives in `src/components/Sidebar.tsx:166` (`card_orders_enabled`) | `state` |
| `Merged-Center-Setup` §01 Onboarding | `/{locale}/onboarding` | `src/app/[locale]/onboarding/page.tsx` | `state` |
| `Merged-Center-Setup` §02 Settings | `/{locale}/settings` (hub redirect) · `/settings/general` · `/settings/account` | `src/app/[locale]/settings/{page,general/page,account/page}.tsx` | `auth` |
| `Merged-Center-Setup` §03 Settings Billing | `/{locale}/settings/billing` | `src/app/[locale]/settings/billing/page.tsx` (2,629 lines) | `money` `state` |
| `Merged-Center-Setup` §04 Settings Center | `/{locale}/settings/center` · `/settings/subjects` | `src/app/[locale]/settings/{center,subjects}/page.tsx` | `layout` |
| `Merged-Center-Setup` §05 Settings Notifications Support | `/{locale}/settings/notifications` · `/settings/support` | `src/app/[locale]/settings/{notifications,support}/page.tsx` | `layout` |
| `Merged-Center-Setup` §06 Settings Scanner | `/{locale}/settings/scanner` | `src/app/[locale]/settings/scanner/page.tsx` | `layout` |
| `Merged-Center-Setup` §07 Settings Team | `/{locale}/settings/team` | `src/app/[locale]/settings/team/page.tsx` | `auth` `money` |
| `Merged-Center-Setup` §08 Center Team Verified | `/{locale}/settings/team` | same file, verified state | `auth` `money` `state` |
| `Merged-Center-Setup` §09 My Teachers | `/{locale}/my-teachers` | `src/app/[locale]/my-teachers/page.tsx` → `components/teachers/{GroupProposalsTab,GroupSlotsTab}.tsx` | `money` |

⚠ **WhatsApp Pack is a different billing model, not a restyle.** Live `/whatsapp-pack` is a
*per-parent monthly* pack plus announcement blasts (`src/lib/parentPack.ts`: `PACK_PRICE_PER_PARENT`,
`ANNOUNCEMENT_CAPS`, `parent_pack_enabled`). The design is a *one-time top-up credit that never
expires*, split into two non-fungible credit types, with a custom-amount flow. Changing this changes
what centers are charged. Treat §02 and §03 as a money change with a product decision behind it.

⚠ **Card Orders Coming Soon** — live behaviour when `card_orders_enabled` is false is to *hide the
sidebar item*. There is no coming-soon screen. The design adds one.

## Teacher

| Design | Route | Serving file | Tags |
|---|---|---|---|
| `Merged-Teacher-Home` §01 Teacher Home | `/{locale}/teacher` | `src/app/[locale]/teacher/(portal)/page.tsx` | `money` `state` |
| `Merged-Teacher-Home` §02 Teacher Schedule | `/{locale}/teacher/schedule` | `src/app/[locale]/teacher/(portal)/schedule/page.tsx` | `layout` |
| `Merged-Teacher-Students` §01 Teacher Students | `/{locale}/teacher/students` | `src/app/[locale]/teacher/(portal)/students/page.tsx` → `teacher/AllStudentsList.tsx` | `state` |
| `Merged-Teacher-Students` §02 Teacher Student Detail ⚠ | `/{locale}/teacher/students` | `teacher/AllStudentsList.tsx` — modal (`openStudentId`), not a route | `money` |
| `Merged-Teacher-Groups` §01 Teacher Groups | `/{locale}/teacher/groups` | `src/app/[locale]/teacher/(portal)/groups/page.tsx` | `money` `state` |
| `Merged-Teacher-Groups` §02 Teacher Group Detail | `/{locale}/teacher/groups/[groupId]` | `src/app/[locale]/teacher/(portal)/groups/[groupId]/page.tsx` | `money` |
| `Merged-Teacher-Groups` §03 Teacher Group Invite Pending | `/{locale}/teacher/groups/[groupId]` | same file — pending roster section, line ~336 | `state` |
| `Merged-Teacher-Groups` §04 Teacher Class Session | `/{locale}/teacher/groups/[groupId]/sessions/[sessionId]` | `.../sessions/[sessionId]/page.tsx` (`finish_class_and_bill`) | `money` |
| `Merged-Teacher-Groups` §05 Teacher Class Session Verified | same route | same file, verified state | `money` `state` |
| `Merged-Teacher-Money` §01 Teacher Income | `/{locale}/teacher/income` | `src/app/[locale]/teacher/(portal)/income/page.tsx` → `teacher/IncomeView.tsx` | `money` `state` |
| `Merged-Teacher-Money` §02 Teacher Earnings Calculator ⚠ | `/{locale}/teacher` | `src/app/[locale]/teacher/IncomeCalculator.tsx` — component on home, not a route | `money` |
| `Merged-Teacher-Money` §03 Teacher Billing | `/{locale}/teacher/billing` | `src/app/[locale]/teacher/(portal)/billing/page.tsx` → `components/teacher/TeacherPlanSection.tsx` | `money` `state` |
| `Merged-Teacher-Insight` §01 Teacher Analytics | `/{locale}/teacher/analytics` | `src/app/[locale]/teacher/(portal)/analytics/page.tsx` | `state` |
| `Merged-Teacher-Setup` §01 Teacher Settings | `/{locale}/teacher/settings` | `src/app/[locale]/teacher/(portal)/settings/page.tsx` | `money` `state` |
| `Merged-Teacher-Setup` §02 Teacher Centers | `/{locale}/teacher/centers` | `src/app/[locale]/teacher/(portal)/centers/page.tsx` | `money` |

⚠ Two designs land on **states inside a route**, not on routes of their own: Teacher Student Detail
is a modal in `AllStudentsList`; Earnings Calculator is a card on the teacher home. The design draws
both as full screens. Whether they become routes is a decision, not a restyle.

## Admin and CEO

| Design | Route | Serving file | Tags |
|---|---|---|---|
| `Merged-Admin-Platform` §01 Admin Overview | `/{locale}/admin` · `/admin/centers` | `src/app/[locale]/admin/{page,centers/page}.tsx` | `money` |
| `Merged-Admin-Platform` §02 Admin Analytics | `/{locale}/admin/analytics` | `src/app/[locale]/admin/analytics/page.tsx` | `money` |
| `Merged-Admin-Platform` §03 Admin Platform | `/{locale}/admin/platform-config` · `/admin/vendors` | `src/app/[locale]/admin/{platform-config/page,vendors/page}.tsx` | `state` |
| `Merged-Admin-Platform` §04 Admin WhatsApp Pack | `/{locale}/admin/whatsapp-pack` | `src/app/[locale]/(admin)/admin/whatsapp-pack/page.tsx` | `money` |
| `Merged-Admin-Platform` §05 Admin Promo Codes | `/{locale}/admin/promo-codes` | `src/app/[locale]/admin/promo-codes/page.tsx` | `money` |
| `Merged-Admin-Platform` §06 Admin Privacy Requests | `/{locale}/admin/privacy-requests` | `src/app/[locale]/admin/privacy-requests/page.tsx` | `layout` |
| `Merged-Admin-Money` §03 Admin Finance Health | `/{locale}/admin/finance` · `/admin/health` | `src/app/[locale]/admin/{finance/page,health/page}.tsx` | `money` |
| `Merged-Admin-Money` §05 Admin Withdrawals Analytics | `/{locale}/admin/withdrawals` · `/admin/analytics` | `src/app/[locale]/admin/{withdrawals/page,analytics/page}.tsx` | `money` |
| `Merged-Admin-Money` §07 Admin Billing Pricing | `/{locale}/admin/billing` · `/admin/pricing` | `src/app/[locale]/admin/{billing/page,pricing/page}.tsx` | `money` |
| `Merged-Admin-Accounts` §01 Admin Account Detail ⚠ | `/{locale}/admin/centers/[id]` | `src/app/[locale]/admin/centers/[id]/page.tsx` → `centerManagementClient.tsx`, `SubscriptionOverridesPanel.tsx` | `money` `state` |
| `Merged-Admin-Accounts` §02 Admin Staff | `/{locale}/admin/staff` · `/admin/internal-team` | `src/app/[locale]/(admin)/admin/staff/page.tsx`, `src/app/[locale]/admin/internal-team/page.tsx` | `auth` |
| `Merged-Admin-Accounts` §03 Admin Center Assignments | `/{locale}/admin/center-assignments` | `src/app/[locale]/(admin)/admin/center-assignments/page.tsx` | `money` |
| `Merged-Admin-Accounts` §04 Admin Referrals | `/{locale}/admin/referrals` · `/admin/referral-rewards` | `src/app/[locale]/admin/referrals/page.tsx`, `src/app/[locale]/(admin)/admin/referral-rewards/page.tsx` | `money` |
| `Merged-CEO` §01 CEO Dashboard | `/{locale}/ceo` | `src/app/[locale]/ceo/page.tsx` (1,230 lines) | `money` |
| `Merged-CEO` §02 CEO Teachers | `/{locale}/ceo/teachers` | `src/app/[locale]/ceo/teachers/page.tsx` | `money` |

⚠ **Admin Account Detail and Admin Overview assume routes that do not exist.** Their frame captions
read `/admin/teachers` and `/admin/teachers/[id]`. Live admin has centers only —
`/admin/centers/page.tsx` has no `owner_type` filter, and there is no teacher list or teacher detail
under `/admin`. The teacher half of both designs is a new build, tracked in list 2.

**Admin information architecture differs.** The designs use a five-item bottom nav
(Overview · Money · Accounts · Platform · More). Live is a 17-item sidebar (`AdminSidebar.tsx`).
Applying the designs screen-by-screen without deciding the IA will produce screens whose nav
contradicts the shell they render inside.

## Shared

| Design | Route | Serving file | Tags |
|---|---|---|---|
| `Merged-Lifecycle` §01 Lifecycle Access | `/{locale}/set-pin` · `/accept-invite` | `src/app/[locale]/set-pin/page.tsx` → `SetPinClient.tsx`; `src/app/[locale]/accept-invite/page.tsx` | `auth` |
| `Merged-Lifecycle` §02 Lifecycle States | `/{locale}/suspended` · `/reactivate` · `/session-expired` | `src/app/[locale]/{suspended,reactivate,session-expired}/page.tsx` | `state` |
| `Merged-Lifecycle` §03 Lifecycle Status | `/{locale}/status` | `src/app/[locale]/status/page.tsx` | `layout` |
| `Merged-Lifecycle` §04 Center Resubscribe | `/{locale}/reactivate` | `src/app/[locale]/reactivate/page.tsx` | `money` `state` |
| `Merged-Lifecycle` §05 Teacher Resubscribe | `/{locale}/teacher/resubscribe` | `src/app/[locale]/teacher/(portal)/resubscribe/page.tsx` | `money` `state` |
| `Merged-Verification-Payouts` §04 Withdrawal Payout Details ⚠ | `/{locale}/admin/withdrawals` | `src/app/[locale]/admin/withdrawals/page.tsx` | `money` |

⚠ **Withdrawal Payout Details** is the only screen in `Merged-Verification-Payouts` with a live
route. The design stores **bank details**; live stores `instapay_number` on the withdrawal row. That
is a schema question, not a layout one — verify against the live catalog before touching it.

**`/reactivate` is drawn twice** — §02 as a lifecycle state, §04 as the full plan-selection
resubscribe. §04 is the deeper screen; do not build them separately.

---

# List 2 — Designs with no live route

26 screens. These are builds, not restyles. **14 of the 26 depend on the verification / online
collection product**, which does not exist at all (see the section before list 1).

## The five you already expected — status corrected

| Screen | Design | Status |
|---|---|---|
| Public Self Enrollment `/join/g/[groupId]` | `Merged-Public-App` §03 | **Already live.** Moved to list 1. |
| Referral Landing `/refer/[code]` | `Merged-Public-App` §05 | **Already live.** Moved to list 1. |
| Offline (PWA fallback) | `Merged-Public-App` §06 | **Already live** at `/{locale}/offline`, wired in `public/sw.js:89`. Moved to list 1. |
| Legal surface | `Merged-Public-Legal` §01 | **Already live** at `/{locale}/legal/*`. Moved to list 1. Document *text* is still placeholder. |
| Lead capture `/talk-to-us` | `Merged-Public-Marketing` §04 | **Genuinely new.** Confirmed below. |

Four of the five are already built. The one that is not is the one `IMPLEMENTATION-PLAN.md` calls
urgent — the inbound feed for the sales machine.

## Genuinely new — public and center

| # | Screen | Design | Intended route | Note |
|---|---|---|---|---|
| 1 | Lead Capture | `Merged-Public-Marketing` §04 | `/talk-to-us` | No route, no component. `/demo-request` is a 55-line WhatsApp-link stub; `POST /api/demo-request` and `/admin/demo-requests` exist, so the queue is already there. |
| 2 | Parent Payment | `Merged-Public-App` §04 | public pay-by-link | **No public payment page exists.** `src/lib/paymob.ts:187` returns the Paymob hosted iframe URL directly. `/parent/[token]` is read-only and has no pay action. |
| 3 | Center Collect ForMe | `Merged-Center-Attendance` §02 | — | Verification-dependent. |
| 4 | Center Withdrawal Verified | `Merged-Center-Money` §04 | — | Verification-dependent. No tuition-balance withdrawal exists; the only withdrawal in the product is referral credit. |
| 5 | Center Receipts Verified | `Merged-Center-Money` §05 | — | Verification-dependent. No receipts route; only `components/payments/ReceiptModal.tsx`. |

## Genuinely new — teacher

| # | Screen | Design | Note |
|---|---|---|---|
| 6 | Teacher Instant Payout | `Merged-Teacher-Money` §04 | Verification-dependent. |
| 7 | Teacher Collect Optin | `Merged-Teacher-Money` §05 | Verification-dependent. |
| 8 | Teacher Referrals | `Merged-Teacher-Insight` §02 | No `/teacher/referrals`. Live is a `ReferralCard` on the teacher home plus `MyCodeCard`. |
| 9 | Teacher WhatsApp | `Merged-Teacher-WhatsApp` §01 | No WhatsApp surface in the teacher portal at all — the design says so itself. |

## Genuinely new — verification and payouts

| # | Screen | Design | Note |
|---|---|---|---|
| 10 | Settings Verification | `Merged-Verification-Payouts` §01 | Valify appears nowhere in `src/`. |
| 11 | Verification In Context | `Merged-Verification-Payouts` §02 | Gate states across `/referrals` and teacher collection. The gate does not exist. |
| 12 | Payout Verification | `Merged-Verification-Payouts` §03 | Hosted Valify redirect. No route, no callback handler. |
| 13 | Center Teacher Payouts | `Merged-Verification-Payouts` §05 | `/my-teachers` tracks cuts and proposals but has no payout action. |
| 14 | Receipts (tax e-receipt) | `Merged-Verification-Payouts` §06 | PDF helpers exist (`generateInvoicePdf.ts`, `invoiceTemplates.ts`); the screen does not. |

## Genuinely new — admin and CEO

| # | Screen | Design | Intended route | Note |
|---|---|---|---|---|
| 15 | Admin Fee Collection | `Merged-Admin-Money` §01 | — | Platform-level collection from parents (collection fee, price markup, processing fee). Nothing live corresponds; `/admin/finance` is subscription MRR, a different ledger. |
| 16 | Admin Settlement | `Merged-Admin-Money` §02 | — | Biweekly provider payout run. `/admin/payouts` is **internal staff salaries** (`staff_id`, `base_salary`) — not this. |
| 17 | Admin Receipts | `Merged-Admin-Money` §04 | `/admin/receipts` | Route named in the frame caption. Does not exist. |
| 18 | Admin Unpaid Recovery | `Merged-Admin-Money` §06 | — | Parent-level stuck payments across providers. `/admin/renewals` is center subscription renewals — a different ledger. |
| 19 | CEO Centers Benchmark | `Merged-CEO` §03 | — | `/ceo` has no verified-vs-unverified benchmark (zero matches for "verified" in the file). |
| — | Admin teacher list + detail | `Merged-Admin-Platform` §01, `Merged-Admin-Accounts` §01 | `/admin/teachers`, `/admin/teachers/[id]` | Not counted as separate screens; they are the teacher half of two list-1 designs. Still new routes. |

## Not a route by design — patterns and shared states

These have no route and are not meant to. They belong in **Session 2 foundations**, not in a screen PR.

| # | Screen | Design |
|---|---|---|
| 20 | Coming Soon | `Merged-Lifecycle` §06 — pattern for any gated feature |
| 21 | Empty States | `Merged-Design-Patterns` §01 |
| 22 | Loading States | `Merged-Design-Patterns` §02 |
| 23 | Row action patterns | `Merged-Design-Patterns` §03 |
| 24 | Quick menu rows | `Merged-Design-Patterns` §04 |
| 25 | Group actions | `Merged-Design-Patterns` §05 |
| 26 | Expand sheet merge | `Merged-Design-Patterns` §06 |

---

# List 3 — Live routes with no design

**This is the decision list.** Each row either gets a design or gets deleted. Nothing here should be
resolved silently while screens are being built.

## 3a — Real screens with no design (22)

| Route | Serving file | What it does | Suggested reading |
|---|---|---|---|
| `/{locale}/pay` | `[locale]/pay/page.tsx` → `components/billing/CustomerInvoicesView.tsx` | The center's own invoice list, with pay and PDF. Shared template with `/teacher/pay`. | **Needs a design.** Money surface. Invoices appear *inside* `Merged-Center-Setup` §03, but that is a section of Settings Billing, not this route. Two places show the same invoices. |
| `/{locale}/teacher/pay` | `[locale]/teacher/pay/page.tsx` → same shared view | Teacher's own invoices. Deliberately reachable while locked, so a lapsed teacher can pay to restore access. | **Needs a design.** Money + account state. The "reachable while locked" rule is load-bearing and is not drawn anywhere. |
| `/{locale}/teacher/subscription/upgrade` | `teacher/(portal)/subscription/upgrade/page.tsx` → `components/teacher/PlanComparison.tsx` | Standard → Pro upgrade surface. | **Needs a design** or fold into `Merged-Teacher-Money` §03, which already carries an upgrade card. |
| `/{locale}/settings/money` | `[locale]/settings/money/page.tsx` | Center money settings: InstaPay number, card-order opt-in. | **Needs a design.** It is the only place the InstaPay destination is set, and no Setup section covers it. |
| `/{locale}/settings/referrals` | `[locale]/settings/referrals/page.tsx` | Second center referral surface. Uses the same `ReferralWithdrawalPanel` as `/referrals`. | **Probably delete.** Duplicate of `/referrals`, which has a design (`Merged-Center-Insight` §03). Pick one. |
| `/{locale}/privacy` | `[locale]/privacy/page.tsx` | ✅ **Resolved (#311).** Now a `permanentRedirect` into `/legal/privacy`. No content of its own. | **Done.** Redirect not delete — public legal URLs get pasted into contracts and store listings. Needs no design. |
| `/{locale}/terms` | `[locale]/terms/page.tsx` | ✅ **Resolved (#311).** Now a `permanentRedirect` into `/legal/terms`. The 20 EGP processing-fee disclosure **moved first**, into `legal/terms/page.tsx`, on the same `processing_fee_enabled` → `amount > 0` gate. | **Done.** The "do not delete blind" warning was honoured: the disclosure was ported before the route was retired. |
| `/{locale}/cookies` | `[locale]/cookies/page.tsx` | ✅ **Resolved (5 Aug).** Now a `permanentRedirect` into `/legal/cookie`. Previously it held the Cookie Policy's only definition, **outside `legal/layout.tsx`** — so the reader rendered there with no flex column. See `DUPLICATE-ROUTES.md` §4. | **Done.** This row did not exist before; the route was never listed as a duplicate because it re-exported rather than forked. |
| `/{locale}/students/print` | `[locale]/students/print/page.tsx` → `PrintClient.tsx` | Printable roster. Print CSS is an RTL exemption per `docs/RTL.md`. | **Needs a decision.** Print output is not in any merged file. |
| `/parent/[token]` | `src/app/parent/[token]/page.tsx` | Public parent portal by token: balance, scan history, next sessions, WhatsApp-the-center. Read-only, no pay action. Outside `[locale]`. | **Needs a design.** The only parent-facing authenticated-ish surface, and `Merged-Public-App` §04 (Parent Payment) is a different screen. |
| `/{locale}/admin/orders` | `[locale]/admin/orders/page.tsx` → `AdminOrdersClient.tsx` | Admin card-order queue. | **Needs a design.** No admin orders screen exists in any merged file. |
| `/{locale}/admin/card-orders/[orderId]` | `(admin)/admin/card-orders/[orderId]/page.tsx` | Admin card-order detail, gated against `internal_viewer`. | **Needs a design.** Same gap. |
| `/{locale}/admin/payouts` | `(admin)/admin/payouts/page.tsx` | **Internal staff salary payouts** (`staff_id`, `base_salary`, `period`). Not provider settlement. | **Needs a design.** Easy to confuse with `Merged-Admin-Money` §02; they are different things. |
| `/{locale}/admin/commissions` | `(admin)/admin/commissions/page.tsx` | Sales-rep commission ledger. T2 eligibility window = 180 days. | **Needs a design.** The 25 July commission decision lands here and the screen is undrawn. See `DECISION-house-accounts-2026-07-25.md`. |
| `/{locale}/admin/renewals` | `[locale]/admin/renewals/page.tsx` | Center subscription renewals, overdue filter, manual record-payment. | **Needs a design.** Money surface with a manual write. |
| `/{locale}/admin/plan-requests` | `[locale]/admin/plan-requests/page.tsx` | Queue of center plan-change requests. | **Needs a design or a merge** into Admin Billing Pricing. |
| `/{locale}/admin/demo-requests` | `[locale]/admin/demo-requests/page.tsx` | Inbound demo-request queue: pending / contacted / approved / rejected. | **Needs a design.** This is the receiving end of the lead capture form in list 2. Building one without the other leaves the funnel half-drawn. |
| `/{locale}/blog` | `[locale]/blog/page.tsx` | Marketing stub. | **Delete** — tracker already dropped it, nothing links to it. Verify before removing. |
| `/{locale}/compare/spreadsheets` | `[locale]/compare/spreadsheets/page.tsx` | Marketing comparison page. | **Delete** — same. |
| `/{locale}/features/qr-attendance` | `[locale]/features/qr-attendance/page.tsx` | Marketing feature page. | **Delete** — same. |
| `/{locale}/features/student-management` | `[locale]/features/student-management/page.tsx` | Marketing feature page. | **Delete** — same. |
| `/{locale}/features/whatsapp-notifications` | `[locale]/features/whatsapp-notifications/page.tsx` | Marketing feature page. | **Delete** — same. |
| `/{locale}/demo-request` | `[locale]/demo-request/page.tsx` | 55-line stub: logo, one line of copy, a hardcoded `wa.me/201001234567` link. | **Replace** with the lead capture form (list 2 #1), or delete and redirect to `/talk-to-us`. The hardcoded number should be checked either way. |

**The five marketing pages were already marked "Dropped" in `TutoringHQ-Screen-Tracker.md`, but all
five are still live and still in `sitemap.ts`'s reach.** A decision was recorded; the deletion never
happened.

## 3b — Redirects and aliases (12)

These render nothing but a spinner or a `redirect()`. No design needed; listed so they are not
mistaken for missing screens.

| Route | Target | Note |
|---|---|---|
| `/{locale}/scan` | `/attendance` | Legacy, kiosk shortcuts depend on it. Keep. |
| `/{locale}/scanner` | `/attendance` | Legacy. Keep. |
| `/{locale}/checklist` | `/attendance?tab=checklist` | Legacy. Keep. |
| `/{locale}/invoices` | `/settings/billing` | Legacy. Keep. |
| `/{locale}/financial-intelligence` | `/analytics` | Legacy alias. Keep. |
| `/{locale}/parent-whatsapp` | `/whatsapp-pack` | Legacy alias. Keep. |
| `/{locale}/teachers` | `/teacher` | Plural alias. Keep — but note the design captions call the teacher audience page `/teachers`. |
| `/{locale}/admin/dashboard` | `/admin` | Alias. Keep. |
| `/{locale}/admin/card-orders` | `/admin/orders` | Alias kept for detail back-links. Keep. |
| `/{locale}/admin/ceo-dashboard` | `/ceo-dashboard` → `/ceo` | Double hop. Could collapse to one. |
| `/{locale}/ceo-dashboard` | `/ceo` | Marked **RETIRED** in the file. Safe to delete once inbound links are checked. |
| `/{locale}/admin/pending-signups` | `/admin` | Marked **RETIRED** — signup is trial-first, there is no approval queue. Safe to delete once inbound links are checked. |

---

# Corrections to existing design documents

Recorded because these are load-bearing for scheduling, and rule 2 of `CLAUDE.md` says a summary is
not evidence.

**1. `TutoringHQ-Screen-Tracker.md` "Designed this session, not yet in the platform" is wrong in
four of five rows.** It lists self enrollment, legal, referral landing and offline as having "a
design and no code". All four have code:

| Claimed missing | Actually at |
|---|---|
| Public Self Enrollment | `src/app/[locale]/join/g/[groupId]/page.tsx` + `JoinFlowClient.tsx` |
| Public Legal | `src/app/[locale]/legal/{privacy,terms,cookie,dpa,privacy-request}/page.tsx` + `LegalDoc.tsx` + `layout.tsx` |
| Referral Landing | `src/app/[locale]/refer/[code]/page.tsx` |
| Offline | `src/app/[locale]/offline/page.tsx`, served by `public/sw.js:89` |

Only lead capture is genuinely absent. The tracker's own note that it "was wrong in roughly 26
places" applies to its current version too.

**2. The count is 105 screens, not 103.** `Merged-Design-Patterns` now holds six sections — Empty
States and Loading States were added and neither `MERGED-FILE-MAP.md` (which says 4) nor the tracker
(which lists 4) caught up.

**3. The tracker's "Deliberately not designed → Dropped" rows are decisions, not deletions.** All
five marketing pages are still live. See list 3a.

**4. The tracker says "Public routes with no destination: 0".** With `/talk-to-us` undesigned and
`/demo-request` a stub, the lead path still has no destination.

---

# Other things worth knowing before Session 2

Observations from reading the routes. Not part of the three lists, not acted on.

- **`/onboarding` is not in `AUTHENTICATED_ROUTE_PREFIXES`** (`src/proxy.ts:89-117`). The other absentees are explainable — `/status`, `/legal`, `/set-pin`, `/accept-invite` and `/join` are meant to be public, `/teacher/*` has its own rule, and `/students/*` is covered by the `/students` prefix. `/onboarding` is the one that stands out: a first-run wizard that writes center data. Worth a look, separately from the redesign.
- **Two live billing surfaces per role.** Center: `/billing` and `/settings/billing`. Teacher: `/teacher/billing` and `/teacher/pay`. The designs assume one each. Someone should decide which survives before the money PRs are cut, not during them.
- **Two live referral surfaces for centers** — `/referrals` and `/settings/referrals` — sharing one panel component. Only one has a design.
- **`Merged-*` frame captions name five routes that do not exist:** `/j/[code]`, `/parents`, `/centers`, `/admin/teachers`, `/admin/teachers/[id]`. Live equivalents where they exist: `/join/[center_code]/[group_id]`, none, `/center`, none, none.
- **The 7 money/auth files named in `START-CLAUDE-CODE.md` cover 38 screens.** By the tagging in list 1, **65 of the 79 mapped screens** carry a `money`, `auth` or `state` tag — only 14 are `layout` alone. The 7-file rule is a good floor, not a ceiling — `Merged-Center-Setup` (Settings Billing, Team, Team Verified), `Merged-Center-Orders` (checkout) and `Merged-Center-Insight` all touch money and are on the "layout only, move fast" list today.
