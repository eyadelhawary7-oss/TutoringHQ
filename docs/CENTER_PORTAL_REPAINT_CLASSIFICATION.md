# Center Portal Repaint — Phase 1 Classification

**Date:** 2026-07-07 · **Branch:** `claude/center-portal-repaint-xqyshm` · **Status:** Phase 1 deliverable — held for Eyad's confirmation before any code changes.

Every center-portal route was classified by reading its code (page.tsx plus the client component(s) that actually render the UI), not by crawling the live site. Pattern definitions are the 8 approved patterns from the build brief.

## Scope

**In scope (48 routes):** everything center-facing — the `(dashboard)` route group, the top-level center routes (`/dashboard`, `/students/*`, `/attendance`, `/settings/*`, …), and the center-facing account-state pages (`/suspended`, `/reactivate`, etc.).

**Out of scope:** `admin/*` + `(admin)/*` (super-admin), `teacher/*` (teacher portal), `/ceo*` (exec), public marketing/legal (`/`, `/pricing`, `/blog`, `/features/*`, `/compare/*`, `/legal/*`, `/terms`, `/privacy`, `/demo-request`, `/refer/*`), public auth (`/login`, `/signup`, `/forgot-password` — already repainted in the auth-pages-cream pass), public parent/student surfaces (`/join/*`, `/parent/[token]`, `/status`), and `/center` — despite its name it renders the **public marketing homepage** (`HomePageClient`), not a center screen.

## Summary

| Pattern | Pages |
|---|---|
| 1 — Dashboard | 2 |
| 2 — List | 12 |
| 3 — Form | 3 |
| 4 — Settings | 1 |
| 5 — Detail | 2 |
| 6 — Billing/Subscription | 5 |
| 7 — Scanner | 1 (multi-tab) |
| 8 — Teachers/Group Proposals | 1 |
| Needs its own look (don't force-fit) | 13 |
| Redirect stubs (no UI to repaint) | 8 |
| **Total** | **48** |

---

## Pattern 1 — Dashboard (2)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/dashboard` | `src/app/[locale]/dashboard/page.tsx` (+ `components/dashboard/PlanUsageCard`, `components/charts/*`, `components/shared/{KpiCard,SectionHeader}`) | The canonical dashboard: greeting, KPI cards w/ sparklines, charts, recent payments, at-risk list, export. Gets the full approved reorganization (quick actions to top, 2×2 stats, at-risk promoted, charts down + hide-when-empty, Export → ☰ menu). |
| `/referrals` | `src/app/[locale]/referrals/page.tsx` (+ `KpiCard`, `components/referrals/ReferralWithdrawalPanel`) | KPI card row + commission structure + withdrawal panel + referral/reward tables — overview shape, not a single list. Dashboard *treatment* (stat grid, section order), no quick-actions block invented. |

Note: assistant-role dashboard variant (stripped quick actions) exists in the same file; the reorganization must respect the role gate.

## Pattern 2 — List (12)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/students` | `src/app/[locale]/students/page.tsx` (~2,400-line self-contained client) | The canonical list: search, filter chips, paginated roster, Add modal. Header currently leads with 4 peers (Import, Pending Requests, Send Announcement, Add Student) — restructure to search + one primary Add, rest into "More actions". |
| `/students/pending` | `src/app/[locale]/students/pending/page.tsx` | Table (desktop) / cards (mobile) of pending enrollments with per-row Review modal. |
| `/groups` | `src/app/[locale]/groups/page.tsx` | Card grid of groups + Add-Group modal + detail slide-over (members/waitlist/heatmap). Card-grid variant of List. |
| `/rooms` | `src/app/[locale]/rooms/page.tsx` | "Add Room" button + grid of room cards + empty state. Carries legacy non-token colors (`bg-blue-100`, `text-blue-600`, `border-slate-300`) to normalize. |
| `/payments` | `src/app/[locale]/payments/page.tsx` | Payment rows + search + status/method/date filters + KPI strip + Collect Payment + CSV export. |
| `/orders` | `src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx` (+ `components/orders/CardOrderCart*`) | Hybrid: cart composer on top, searchable/sortable/paginated order history below — List is the dominant shape. |
| `/whatsapp` | `src/app/[locale]/whatsapp/WhatsAppTemplatesClient.tsx` | Read-only template gallery with status badges + preview modal. List (light: no add/search to invent). |
| `/settings/team` | `src/app/[locale]/settings/team/page.tsx` (+ `components/settings/StaffMemberCard`, `TeacherJoinRequests`) | Team roster with Invite button, per-row permission editing. |
| `/notifications` | `src/app/[locale]/(dashboard)/notifications/NotificationsPageClient.tsx` | Simple read-only notification feed with mark-all-read. List (light). |
| `/branches` | `src/app/[locale]/(dashboard)/branches/page.tsx` | Branches table + add-branch input; on `plan==='multi'` also 2 bar charts + 3 stat tiles (Dashboard elements stay, styled per token pass). |
| `/students/print` → see "Needs its own look" | | |
| `/attendance` (Checklist tab) | `src/components/attendance/ChecklistTab.tsx` | The brief explicitly names the Checklist tab as List-patterned; the page itself is classified under Scanner below. |
| `/my-teachers` (My Teachers / Slots tabs) | `src/components/teachers/{MyTeachersPanel,GroupSlotsTab}.tsx` | List-shaped tabs inside the Pattern-8 page; repainted with it. |

(Row count note: 12 = the 10 standalone routes plus the two tab-level surfaces counted with their parent pages.)

## Pattern 3 — Form (3)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/settings/reset-password` | `src/app/[locale]/settings/reset-password/page.tsx` | Single centered current/new/confirm PIN form. |
| `/orders/checkout` | `src/app/[locale]/(dashboard)/orders/checkout/page.tsx` | Zod-validated delivery form (governorate, address, phone) with live shipping preview. |
| `/orders/checkout/customize` | `.../checkout/customize/page.tsx` | Card-style picker + vendor notes + remember-style form. |

Plus the **modal forms** inside List pages (Add/Edit Student, Add Group, Add Room, Invite Member, add-session in Schedule) — they get the Form pattern treatment where they live. The approved **Add/Edit unification** applies here: Edit Student has `FamilyLinkingSection` with a working "Create New Family" quick-create (`students/page.tsx:2071`); Add Student's Group dropdown has no quick-create → add "+ New Group" using the same component pattern. Checked the other Add/Edit pairs (Groups, Rooms, Team): none has a related-entity dropdown mismatch like this — Add Student is the only instance.

## Pattern 4 — Settings (1)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/settings/general` | `src/app/[locale]/settings/general/page.tsx` | **This is the long single-scroll page** from the brief (`/settings` itself is already just a `?tab=` redirect stub). Renders in order: Center Information, Subjects, Team (link-out card), Scanner Settings, Daily WhatsApp Summary, Summer Mode, Financial/InstaPay, Card Ordering, Billing (link-out card), WhatsApp Support, Account (Change PIN / Reset Password / Logout). Becomes a category menu → focused sub-pages per the approved pattern. |

Proposed category split (same total content, nothing dropped): Center Information · Subjects · Team (existing `/settings/team`) · Scanner · Notifications (daily summary + summer mode) · Billing & Money (InstaPay + card ordering + link to `/settings/billing`) · Support · Account & Security.

No other center-side screen has the same long-multi-category-scroll shape (admin settings = separate portal, out of scope; teacher settings = teacher portal, out of scope).

## Pattern 5 — Detail (2)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/students/[id]` | `src/app/[locale]/students/[id]/page.tsx` | Thin profile: name, ID, order-card CTA, attendance history. **Repaint-only per the brief** — content enrichment (balance, family, quick actions) is NOT included pending Eyad's separate go-ahead. Doubled-`#` bug lives here (see Bugs). |
| `/orders/[orderId]` | `src/app/[locale]/(dashboard)/orders/[orderId]/OrderDetailClient.tsx` (+ `components/orders/CardOrderStatusTimeline`, `CancelOrderModal`) | Single-order profile: status timeline, line items, pricing, cancel/reorder. |

## Pattern 6 — Billing/Subscription (5)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/settings/billing` | `src/app/[locale]/settings/billing/page.tsx` (3,129 lines) | The plan-change hub: upgrade/downgrade/PAYG tabs, period selector, Paymob modal, invoices, cancellation. Both money bugs live here (see Bugs). |
| `/billing` | `src/app/[locale]/(dashboard)/billing/BillingPageClient.tsx` | Read-only current-plan tile + usage meter + next payment + invoice history. The mismatching "current price" side of bug #4. |
| `/pay` | `src/components/billing/CustomerInvoicesView.tsx` | Authenticated center-facing invoice pay view (not public) — Pay-now cards + paid history. Shared with `/teacher/pay`; repaint must not visually fork the shared component per-side without care. |
| `/reactivate` | `src/app/[locale]/reactivate/page.tsx` | Suspended-center plan picker + total + Pay-now (Paymob). |
| `/whatsapp-pack` | `src/app/[locale]/(dashboard)/whatsapp-pack/WhatsAppPackClient.tsx` | Parent-pack subscription management: pricing, balance/allowance meter, request/approve states (+ blast composer). |

## Pattern 7 — Scanner (1)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/attendance` | `src/app/[locale]/attendance/page.tsx` → `components/attendance/ScanTab.tsx` + `ChecklistTab.tsx` | Segmented two-tab surface: QR scan (Scanner pattern, light-touch recolor + move "Recommended Scanner Hardware" card below scan history) and Checklist (List pattern treatment). Deep-linked from Schedule. |

## Pattern 8 — Teachers / Group Proposals (1)

| Route | Main UI file(s) | Reason |
|---|---|---|
| `/my-teachers` | `src/app/[locale]/my-teachers/page.tsx` → `components/teachers/{MyTeachersPanel,AddTeacherPanel,GroupProposalsTab,GroupSlotsTab}.tsx` | The center-side teachers hub; Requests tab = the group-proposal negotiation flow. Recolor to standard cream/teal closes the documented token drift vs the teacher side (`docs/GROUP_PROPOSALS_MERGE_FINDINGS.md` §3: center side uses `--color-border-subtle`/`bg-teal-100`/raw `red-600` where teacher side uses `--color-border`/`--color-teal-soft`/`--color-danger`). Shared `src/components/group-proposals/` components take the token pass too. |

---

## Needs its own look (13) — flagged, NOT force-fit, NOT restyled in Phase 2

| Route | Shape | Why it doesn't fit |
|---|---|---|
| `/schedule` | Weekly day×hour timetable grid with "now" line + add-session modal | A calendar grid is none of the 8 patterns. Its add-session modal alone is Form-shaped. |
| `/analytics` | 4-KPI grid + chart cards + heatmap + P&L + aging report | Chart-heavy analytics; no greeting/quick-actions. *Recommendation:* its KPI/chart chrome is built from the same primitives as Dashboard — could take Dashboard card/chart styling without structural change, if Eyad wants it included. |
| `/benchmarks` | Metric cards + percentile bars, with locked/empty and sample-overlay states | Comparison analytics with gating states none of the patterns cover. |
| `/settings/referrals` | Referral summary + withdrawal panel + tier list + two tables | Multi-section reporting screen; closest is List but it isn't one. (Note: overlaps heavily with `/referrals` — both mount `ReferralWithdrawalPanel`.) |
| `/students/import` | 6-state wizard (upload → map → resolve groups → preview → importing → success) | Multi-step wizard, not a form. |
| `/students/print` | Server-rendered printable QR-card sheet | Print layout; physical-property CSS is RTL-EXEMPT here. Do not touch. |
| `/onboarding` | 4-step setup wizard with progress bar | Linear wizard, standalone (no portal shell). |
| `/accept-invite` | phone → OTP → reveal-PIN flow | Auth/OTP wizard, standalone. |
| `/set-pin` | PIN double-entry / finalizing-poll / fallback interstitial | Auth credential setup, not an entity form. |
| `/session-expired` | Static icon card + login link | Status interstitial. |
| `/suspended` | Lockout screen: warning, read-only stats, pay/reactivate CTAs | Account-lock interstitial (billing-adjacent but not plan management). |
| `/offline` | PWA offline fallback + retry | Error interstitial. |
| `/orders/checkout/review`, `/orders/checkout/payment`, `/orders/checkout/success/[orderId]` | Wizard review step / Paymob iframe + countdown / confirmation screen | Checkout wizard steps, not standalone patterns. (Counted as 3 routes; grouped in one row.) |

(13 = the 10 single rows above + the 3 checkout-step routes in the last row.)

## Redirect stubs (8) — no UI, nothing to repaint

`/scan` → `/attendance` · `/scanner` → `/attendance` · `/checklist` → `/attendance?tab=checklist` · `/teachers` → `/teacher` · `/settings` → `/settings/general|team|billing` · `/invoices` → `/settings/billing` · `/parent-whatsapp` → `/whatsapp-pack` · `/financial-intelligence` → `/analytics`.

Only cosmetic note: `/scan` and `/scanner` spinners still sit on `bg-black`; trivial token fix, will include in Phase 2.

---

## The 5 reported bugs — verification results

### 1. Duplicate "Change PIN" in Settings/Account — **REAL, but it's a label + redundancy bug, not a double render**
`settings/general/page.tsx:1059-1078` renders three adjacent controls: a Change PIN button (`t('changePin')`, opens `ChangePinModal`), a link labeled `t('resetPassword')` to `/settings/reset-password`, and Logout. The catch: in the `settings` i18n namespace, **`resetPassword` is translated "Change PIN"** (en) / "تغيير رقم التعريف الشخصي PIN" (ar) — and `/settings/reset-password` is itself a change-PIN page. So the user sees two side-by-side "Change PIN" buttons doing the same job via two different UIs. Fix in Phase 2: collapse to one entry point (proposal: keep the link to the dedicated page, drop the modal trigger — or vice versa, Eyad's preference; default = keep one, remove the other, no data change).

### 2. Doubled "##" on student ID — **CONFIRMED (latent)**
`src/app/[locale]/students/[id]/page.tsx:184-188` hardcodes `#{student.student_number}` instead of using `formatStudentNumberForDisplay` (`src/lib/studentNumberDisplay.ts`), which exists precisely because stored numbers may already start with `#`. The list, print, and groups pages all use the helper; the detail page is the only outlier found. Fix: route it through the helper.

### 3. Quarterly still selectable in Upgrade panel — **CONFIRMED, and worse than cosmetic** *(investigated before any fix, per the money rule)*
- **Live DB catalog verified** (project `lczmjpnbuhnsislcvzar`): `centers_billing_period_check` = `IN ('monthly','annual')`; `centers_subscription_billing_period_check` = `IN ('monthly','yearly')`. Quarterly is fully retired at the DB layer, exactly as the `BILLING_PERIOD_MONTHLY_DEFAULT_FINDINGS.md` pass left it.
- **Why the UI still shows it:** that pass fixed the quarterly *writers* (admin approve, PAYG cron, leave-PAYG selector) but missed the **Upgrade tab's period selector**: `settings/billing/page.tsx` renders a quarterly `PeriodCard` in two places (~lines 2014-2028 and 2244-2261), with badge `t('upgrade.quarterlyDefaultHint')` — the "Default billing" tag Eyad saw. Price feeds from `periodPrices.quarterly` (line 1131).
- **Actual hazard:** `/api/billing/upgrade` still accepts `quarterly` (`route.ts:62,180` — prices it at `all_in_price × 3`), and on successful payment `combinedPaymentFinalize.ts:261-262` writes `billing_period/subscription_billing_period = 'quarterly'` — **both writes now violate the live CHECKs**, so the center pays and then activation fails. This is a pay-then-fail path, not just a stale label.
- Proposed Phase 2 fix (pending confirmation): remove the quarterly `PeriodCard`s + related price plumbing from the selector UI; make the upgrade API reject/coerce `quarterly` the same way `switch-payg` already does (coerce → monthly rather than 400). Also flag: `normalizeBillingPeriod` (`pricing.ts:23`) still *defaults unknown values to `'quarterly'`* — reader-only today, but a stale default worth flipping to monthly in the same fix if Eyad agrees.

### 4. Price mismatch (tile 4,499 vs upgrade 5,199) — **CONFIRMED, root cause found; correct display needs Eyad's call** *(investigated before any fix)*
Two different price sources for the same "Monthly" label:
- **Current-plan tile** (`BillingPageClient.tsx:303-306`): shows the **stored** `center.billing_amount ?? all_in_price` — what the center is actually charged (e.g. starter `quarterlyAllIn` = 4,499, typical for centers activated at the all-in/early-adopter rate).
- **Upgrade panel "Monthly / Current"** (`settings/billing/page.tsx:1130` → `getChargeFromQuarterlyAllIn(allIn,'monthly',pk)` → `pricing.ts:135-137`): recomputes from **`monthlyListPrice`** — the +15% monthly list rate (starter 5,199). Per the billing-flip decision, new monthly activations do charge list price, so both numbers are "real": 4,499 = what this center pays today, 5,199 = what monthly starter costs at list.
- **The open question for Eyad (blocking this fix):** what should the upgrade panel's "Monthly / Current" card show for the center's *current* plan+period — the center's actual current charge (4,499, consistent with the tile) or the list price a new switch would cost (5,199, consistent with what they'd be charged on re-activation)? Display-only either way; no pricing logic will be touched.

### 5. Floating duplicate "Add Student" on Students list — **NOT REPRODUCED in current code**
`students/page.tsx` has exactly one Add Student trigger in the header (lines 1088-1094) plus the standard empty-state action (line 1332, only renders when the roster is empty). No floating/sticky FAB exists in the file or in the shell components (`BottomTabBar`, `MobileTopBar`). The `fixed` bottom bar at line 2324 is the bulk add-to-cart bar (only when rows are selected). Either it was fixed in an earlier pass or the observation predates current master. Will keep an eye out during Phase 2; nothing to fix today.

---

## Open questions for Eyad (answer before/with Phase 2 go-ahead)

1. **Bug #4:** which number should the Upgrade panel's "Monthly / Current" card show — the center's actual current charge (matches the tile) or the monthly list price? (Everything else about the fix is unambiguous.)
2. **Bug #3:** OK to also flip the `normalizeBillingPeriod` reader-default from `'quarterly'` to `'monthly'` while removing the quarterly cards, or keep the fix strictly to the selector + upgrade API?
3. **Bug #1:** keep the Change PIN **modal** or the dedicated **page** as the single entry point?
4. `/analytics`: apply the Dashboard pattern's card/chart *styling* (no structural change), or leave it untouched with the other "own look" pages?
5. Student detail enrichment remains **excluded** (repaint-only) per the brief unless you say otherwise — available as a follow-up.
