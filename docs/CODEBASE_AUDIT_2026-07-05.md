# Codebase Audit — 2026-07-05

> Point-in-time snapshot as of 2026-07-05. Reviewed against the live database and code on 2026-07-18; preserved as a historical read-only cleanup proposal. Spot-checked 2026-07-18: the SAFE-delete candidates `src/lib/admin-check.ts` and `/financial-intelligence` still exist (proposals not yet executed), so the findings stand as written. Route/file counts here are point-in-time.

**Mode:** READ ONLY. This document changes zero application code. Every item below is a *proposal* with a risk level. Nothing here is done — each approved item becomes its own small, verified build later.

**Scope:** whole repo, area by area, using `docs/PAGE_INVENTORY.md` as the map (124 page routes, 322 API routes, 177 files in `src/lib`).

**Evidence base:** findings are backed by tooling run locally (read-only, no repo changes):
- `jscpd` (copy-paste detector) — 90 exact clones, 2,287 duplicated lines (2.31%).
- `knip` (dead-code / unused-export / unused-dependency scanner) — 45 unused files under `src/`, 405 unused exports, several unused dependencies.
- Import-graph greps for coupling (blast radius), pattern counts (fetch/auth/error shapes), and hardcoded-color counts.
- Spot-verification by grep of every high-value claim (nothing below is a guess; contradictions with `CLAUDE.md` are noted).

---

## A. Executive summary

1. **The code is in decent shape overall** — duplication is only ~2.3%, and the money-sensitive parts (billing, Paymob, WhatsApp, auth, summer) are well isolated. This is a cleanup, not a rescue.
2. **There is real dead weight to delete safely:** ~45 unused files, including a whole *old* dashboard-charts set and a whole *old* onboarding flow that were replaced but never removed, plus 4 unused dependencies. Removing these changes nothing a user sees.
3. **The three items flagged in the page inventory are confirmed exactly as described:** `/financial-intelligence` is a one-line copy of `/analytics`, `/admin/sales-pipeline` saves nothing (in-memory only), and `/sentry-test` throws an error on purpose.
4. **The same feature is written twice in a few places** — most glaringly the "group proposals" screen (≈490 identical lines living in two files, one for the center side and one for the teacher side). Fixing a bug in one today does not fix it in the other.
5. **A handful of files are doing too many jobs at once** — the center-management screen (3,845 lines) and the billing settings screen (3,128 lines) are the worst. These are where "a change over here breaks something over there" comes from. (Billing is an untouchable zone — described only.)
6. **The codebase does the same job several different ways.** Data loading is documented as "SWR" but is actually hand-rolled `fetch` in ~100 screens; admin permission checks go through six overlapping helpers; API error responses come back in three different shapes. Picking one standard for each is the highest-leverage structural work.
7. **The redesign is well set up but half-adopted:** the brand colors already exist as named tokens in one style file, yet those exact colors are re-typed by hand as raw hex in 67 files (417 times). The shared style file mostly exists — the work is making everything actually use it.
8. **Safest-first order:** delete confirmed dead code → extract the few obvious shared components → standardize fetch/auth/error patterns → (separately, with Eyad) tackle the god files and anything URL- or billing-adjacent.

---

## B. Findings table

Risk: **SAFE** (isolated, no route/behavior change) · **MEDIUM** (shared refactor, behavior identical, tests must stay green) · **CAREFUL** (URL-affecting, or in/near billing / consent / summer / Paymob / WhatsApp-send / auth).

| # | What it is | Where (file / area) | Why it matters | Proposed cleanup | Risk | URL-affecting | Untouchable zone |
|---|---|---|---|---|---|---|---|
| 1 | `/financial-intelligence` is a literal re-export alias | `src/app/[locale]/(dashboard)/financial-intelligence/page.tsx` (`export { default } from '../analytics/page'`) | Duplicate URL for one screen; confuses "where does this page live" | Keep the code as-is (removal changes a route) or, if the alias URL is unwanted, redirect it | CAREFUL | Yes | No |
| 2 | `/admin/sales-pipeline` is a non-persisted prototype | `src/app/[locale]/admin/sales-pipeline/page.tsx` (0 fetch/API calls; leads live in React state only) | Looks like a real CRM but saves nothing — a data-loss trap for staff | Decide: build persistence or remove the page | CAREFUL | Yes (if removed) | No |
| 3 | `/sentry-test` throws on purpose | `src/app/[locale]/sentry-test/page.tsx` | Diagnostic page shipped to prod; a button that crashes | Gate behind super-admin or remove | CAREFUL | Yes (if removed) | No |
| 4 | Old dashboard-charts component set, fully superseded | `src/components/dashboard/` — `AttendanceAreaChart`, `AttendanceCard`, `AttendanceRing`, `AttendanceTrend`, `PaymentBar`, `PaymentDonut`, `PaymentMethodsDonut`, `RevenueBar`, `RevenueSparkline`, `RevenueStackedChart`, `UnpaidList` | 11 unreferenced files; live analytics uses `src/components/analytics/*` instead | Delete (verified 0 imports outside the folder) | SAFE | No | No |
| 5 | Old onboarding flow, superseded | `src/components/onboarding/` — `AnimatedCounter`, `CompletionScreen`, `Confetti`, `WhatsAppConfirmation`, `steps/Step1Profile…Step4Scanner` | Entire earlier onboarding implementation left in tree; 0 external imports | Delete | SAFE | No | No |
| 6 | Dead `lib` modules | `src/lib/admin-check.ts`, `metricsAggregator.ts`, `number-utils.ts`, `plan-tiers.ts`, `analytics/healthScore.ts`, `savedCard/index.ts` | 0 references. **`admin-check.ts` is even named in `CLAUDE.md` as an auth gate but is dead** — the live gates are `admin-access.ts` / `admin-auth.ts` / `admin-roles.ts` | Delete files; fix the `CLAUDE.md` reference | SAFE | No | No (it's *near* auth but is dead code, not live auth — verify before delete) |
| 7 | Dead type modules | `src/types/billing.ts`, `src/types/invoice.ts` | 0 references; types superseded elsewhere | Delete | SAFE | No | No (types only, not billing logic) |
| 8 | Orphaned root components (some are name-duplicates of live ones) | `src/components/AddStudentModal.tsx`, `ColumnMapper.tsx`, `FileUploadZone.tsx`, `StepIndicator.tsx`, `SyncIndicator.tsx`, `ThemeToggle.tsx`, `shell/Sidebar.tsx`, `landing/PricingBanner.tsx`, `ui/FormField.tsx`, `ui/skeleton.tsx`, `billing/PastDueBanner.tsx`, `charts/MRRTrend.tsx`, `contexts/ThemeContext.tsx` | 0 references. `ThemeContext` is replaced by `components/ThemeProvider.tsx`; root `AddStudentModal`/`ThemeToggle` are stale duplicates of the live ones | Delete | SAFE | No | No |
| 9 | Unused skeleton components | `src/components/skeletons/` — `DashboardStatsSkeleton`, `PaymentRowSkeleton`, `ScannerSkeleton`, `StudentListSkeleton` | 0 references | Delete | SAFE | No | No |
| 10 | Unused dependencies | `package.json` — `@anthropic-ai/sdk` (0 refs), `jspdf` (0 refs), `canvas-confetti` (only used by dead onboarding), `@fontsource/cairo` + `@fontsource/jetbrains-mono` (0 code refs — **verify against `setup-fonts` build step first**) | Ships weight & audit surface for nothing | Remove after finding #5 lands; verify fonts aren't loaded by the font-setup script | SAFE | No | No |
| 11 | 405 unused exports, concentrated in barrel files | `components/charts/index.ts` (36), `lib/teacherAnalytics.ts` (20), `lib/validations.ts` (14), `lib/pricing/taxMath.ts` (8), `pricingConfig.ts` (8), `pricing.ts` (7), `parentPack.ts` (7), … | Dead API surface; makes modules look bigger/more coupled than they are | Trim exports module-by-module (leave pricing/billing exports to CAREFUL) | SAFE (mostly) / CAREFUL for pricing/billing exports | No | Mixed |
| 12 | "Group proposals" feature written twice | `src/components/teachers/GroupProposalsTab.tsx` (731) vs `src/app/[locale]/teacher/GroupProposalsSection.tsx` (786) — **491 identical lines** | Biggest single duplication; center-side and teacher-side copies drift independently → bugs fixed once, not twice | Extract one shared component, parameterize the two sides | MEDIUM | No | No |
| 13 | "Bring group to center" overlaps group-proposals | `src/app/[locale]/teacher/BringGroupToCenterSection.tsx` ↔ `GroupProposalsSection.tsx` — 147 dup lines | Same negotiation UI copied a third time | Fold into the shared component from #12 | MEDIUM | No | No |
| 14 | Pricing display duplicated | `HomePageClient.tsx` ↔ `pricing/PricingPageClient.tsx` (93 lines); `landing/PricingBanner.tsx` ↔ `landing/PricingBannerClient.tsx` (74 lines) | Price/plan rendering copied across marketing surfaces; a pricing/label change must be made in several places | Extract a shared pricing-display component | MEDIUM | No | No (display only — reads prices, doesn't compute tax/billing) |
| 15 | Marketing feature/compare pages share scaffolding | `features/qr-attendance`, `features/whatsapp-notifications`, `features/student-management`, `compare/spreadsheets` (each ~200 lines, ~55 dup lines pairwise) | Hero + how-it-works + repeated "Start free" CTA copy-pasted per page | Extract a `MarketingPageLayout` / shared hero+CTA blocks | MEDIUM | No | No |
| 16 | Admin list/table pages share filter+pagination+CSV scaffolding | many small clones (~30–43 lines each) across `admin/plan-requests`, `admin/pending-signups`, `admin/billing`, `admin/analytics`, `(admin)/admin/staff`, `commissions`, `center-assignments`, `payouts`, `promo-codes`, `withdrawals` | The same "filtered table with pagination + CSV export + status pills" is rebuilt per page | Extract a shared `AdminTable` / `AdminPageShell` (do incrementally, page by page) | MEDIUM | No | No |
| 17 | God file: center management | `src/app/[locale]/admin/centers/[id]/centerManagementClient.tsx` — **3,845 lines** | Loads invoices, renewals, plan requests, referrals, payouts, overrides in one client component; hardest file to change safely | Split into per-section child components (state stays in parent) | MEDIUM (borders admin billing) | No | Partly (touches subscription overrides — describe/scope carefully) |
| 18 | God file: billing settings | `src/app/[locale]/settings/billing/page.tsx` — **3,128 lines** | Upgrade/downgrade/PAYG/proration/Paymob/credit/parent-pack in one file | **Describe only.** Splitting is possible later but every change here is billing/Paymob | CAREFUL | No | Yes (billing + Paymob) |
| 19 | God file: student roster | `src/app/[locale]/students/page.tsx` — **2,400 lines** | Roster + add/edit/delete + QR + card-order + WhatsApp blast in one page | Split into sub-components; note consent flow lives here (careful) | MEDIUM | No | Partly (guardian consent) |
| 20 | God file: signup form | `src/app/[locale]/signup/SignupForm.tsx` — **1,763 lines** | Multi-stage phone→plan→payment in one file | **Describe only** — auth + Paymob path | CAREFUL | No | Yes (auth) |
| 21 | Other large files worth later splitting | `attendance/ScanTab.tsx` (1,674), `dashboard/page.tsx` (1,514), `admin/pricing/page.tsx` (1,455), `lib/centerNotify.ts` (1,382), `lib/generateInvoicePdf.ts` (1,251), `teacher/schedule/SlotActionSheet.tsx` (1,189) | Large multi-job files; `centerNotify.ts` is also widely imported (40 files) so it's both big and high-blast-radius | Split by concern where SAFE; `centerNotify` touches WhatsApp send → CAREFUL | MEDIUM / CAREFUL | No | Mixed (centerNotify → WhatsApp) |
| 22 | High blast-radius shared modules | import counts: `formatNumber` (186), `centerAuth` (137), `validations` (126), `supabase` (123), `supabase-admin` (95), `admin-auth` (79) | A change to any of these ripples across 80–186 files — this is the literal source of "changes affecting unrelated things" | No refactor needed; treat as "change with tests + care", document them as the stable core | (awareness) | No | `centerAuth`/`admin-auth` are auth → CAREFUL to modify |
| 23 | Data-fetching pattern is inconsistent with the documented standard | `CLAUDE.md` says "SWR for client"; reality: **`swr` is used in exactly 1 file** (`hooks/useCardOrderCart.tsx`); ~104 screens hand-roll `useEffect` + `fetch` | Two conventions; new code copies whichever it landed near; no shared caching/error/loading | Pick ONE (either adopt SWR broadly or bless a shared `useFetch` hook) and update `CLAUDE.md` | MEDIUM | No | No |
| 24 | Overlapping admin/auth gate helpers | `src/lib/` — `admin-access.ts`, `admin-auth.ts` (79), `admin-check.ts` (dead), `admin-roles.ts`, `adminAuth-client.ts`, `requireOwnerAdminCenter.ts` (11), `centerAuth.ts` (140), plus `requireAdmin` (29 routes) / `requireSuperAdmin` (30) / `admin-access` (13) | Six+ ways to answer "is this user allowed"; easy to pick the wrong/weaker one on a new route | Document the canonical gate per role; consolidate the rest — **auth zone, so plan with Eyad** | CAREFUL | No | Yes (auth) |
| 25 | API error-response shape is inconsistent | across `src/app/api` — `{ error }` (1,754), `{ success }` (190), `{ message }` (46); 68 of 322 routes have no `try/catch` | Clients must handle 3 envelopes; unguarded routes leak raw 500s | Adopt one error envelope + a shared handler wrapper | MEDIUM | No | No (avoid touching webhook/Paymob routes in first pass) |
| 26 | Shared feature code living under a route folder instead of `components/` | `src/app/[locale]/teacher/GroupProposalsSection.tsx`, `BringGroupToCenterSection.tsx`, `CenterCutsSection.tsx`, `CenterEarningsSection.tsx` | Reusable pieces buried in a page folder → hard to find, encourages copy-paste (see #12/#13) | Move shared sections to `src/components/teacher/` when extracting | MEDIUM | No | No |
| 27 | Name-duplicate components in different folders | `AddStudentModal` (root vs `teacher/(portal)/groups/[groupId]/`), `ThemeToggle` (root vs `ui/`), `Sidebar` (root vs `shell/`) | Ambiguous imports; the root copies are the dead ones (see #8) | Delete dead copies; keep one canonical each | SAFE | No | No |
| 28 | Inconsistent admin route grouping | some admin pages under `app/[locale]/admin/…`, others under `app/[locale]/(admin)/admin/…` | Two homes for "admin pages" makes layout/ownership unclear | Document why the split exists or converge — **route group changes are URL-neutral but risky**; treat as CAREFUL | CAREFUL | No (route groups don't change URLs) | No |
| 29 | 417 hardcoded hex colors re-typing existing tokens | 67 files under `src/app`, `src/components`; e.g. `#0D9488` (56×), `#080f1a` (23×), `#F59E0B` (18×), `#25D366` (8×) — while `globals.css` already defines `--color-brand-500: #0D9488`, `--color-navy-950: #080f1a`, `--color-gold-500: #F59E0B` | Redesign blocker: colors changed in the token file won't propagate to these 67 files | Replace raw hex with token classes/vars (redesign prep) | MEDIUM | No | No |
| 30 | 101 files use inline `style={{…}}` | across `src/app`, `src/components` | Styling scattered outside the class/token system; hard to theme consistently | Migrate to token classes during redesign | MEDIUM | No | No |

---

## C. Ranked cleanup plan (safest, highest-value first)

### Quick wins — SAFE (delete dead code, extract identical components; no route or behavior change)

Ordered:

1. **Delete the old dashboard-charts set** (finding #4) — 11 files, 0 references, superseded by `components/analytics/*`.
2. **Delete the old onboarding flow** (#5) — `components/onboarding/{AnimatedCounter,CompletionScreen,Confetti,WhatsAppConfirmation,steps/*}`.
3. **Delete dead `lib` + `types` modules** (#6, #7) — `admin-check.ts`, `metricsAggregator.ts`, `number-utils.ts`, `plan-tiers.ts`, `analytics/healthScore.ts`, `savedCard/index.ts`, `types/billing.ts`, `types/invoice.ts`. Fix the stale `admin-check.ts` mention in `CLAUDE.md`.
4. **Delete orphaned/duplicate components** (#8, #27) — including `contexts/ThemeContext.tsx` (replaced by `ThemeProvider`) and the root `AddStudentModal`/`ThemeToggle`/`Sidebar` duplicates.
5. **Delete unused skeletons** (#9).
6. **Remove now-unused dependencies** (#10) — `@anthropic-ai/sdk`, `jspdf`, `canvas-confetti` (after #5), and `@fontsource/*` *only if* verified unused by the font-setup build step.
7. **Trim unused exports** (#11) in non-pricing/non-billing modules — start with `components/charts/index.ts`, `teacherAnalytics.ts`, `validations.ts`.

> Safety net for all of the above: the 1,147-test suite + the `i18n` / `bidi` / `tolocale` build gates. Each deletion should be its own commit so a red test points at exactly one change. **Verified 0-reference** by grep for every file listed; the only knip false positive found was `lib/pricing/taxMath.test.ts` (it's a live test, *not* dead — leave it).

### Structural — MEDIUM (shared refactor across files; behavior must stay identical; tests must stay green)

Ordered by value ÷ risk:

1. **Extract the shared "group proposals" component** (#12, #13, #26) — collapses ~640 duplicated lines into one, fixes the drift risk, and moves shared code out of the route folder. Highest-value structural item.
2. **Standardize data fetching** (#23) — decide SWR vs a shared `useFetch` hook, document it in `CLAUDE.md`, then migrate incrementally. Biggest long-term consistency win.
3. **Standardize the API error envelope** (#25) — one response shape + a shared route wrapper; skip webhook/Paymob routes in the first pass.
4. **Extract shared pricing-display + marketing layout** (#14, #15) — one pricing-display component, one marketing hero/CTA layout.
5. **Extract a shared `AdminTable` / `AdminPageShell`** (#16) — do it one admin page at a time; each migration is independently testable.
6. **Split the non-billing god files** (#17, #19, #21 where SAFE) — center-management screen and student roster into per-section child components, state staying in the parent.

### Careful — flag only, do NOT plan in detail (URL-affecting, or in/near billing / consent / summer / Paymob / WhatsApp-send / auth)

- **#1 `/financial-intelligence`, #2 `/admin/sales-pipeline`, #3 `/sentry-test`** — each is URL-AFFECTING to remove; Eyad decides keep/redirect/build/remove.
- **The 9 legacy redirect stubs** (`/scan`, `/scanner`, `/checklist`, `/teachers`, `/invoices`, `/parent-whatsapp`, `/admin/dashboard`, `/admin/ceo-dashboard`, `/admin/card-orders`) — 10–23 lines each, harmless, but removing any is URL-AFFECTING. Recommend **leave as-is**.
- **#18 billing settings god file (3,128 lines)** and **#20 signup form (1,763 lines)** — describe only; billing/Paymob and auth zones.
- **#24 auth-gate consolidation** — auth zone; document the canonical gate before touching anything.
- **#21 `centerNotify.ts`** split — touches WhatsApp send logic.
- **#11 pricing/billing exports**, **#28 admin route-group convergence** — leave for Eyad.

---

## D. Redesign readiness note

**Good news: the shared style file already exists.** `src/app/globals.css` defines the brand palette as named tokens — `--color-brand-500: #0D9488` (teal), `--color-navy-950: #080f1a`, `--color-gold-500: #F59E0B` (brass) — plus semantic tokens (`--color-surface-*`, `--color-text-*`, `--color-warning`) and a dark-mode block. A redesign has a foundation to build on rather than a blank slate.

**The gap is adoption, not infrastructure:**

- **Colors are re-typed by hand in 67 files, 417 times** — the exact values that already have tokens. `#0D9488` appears 56×, `#080f1a` 23×, `#F59E0B` 18×, plus arbitrary Tailwind classes like `bg-[#080f1a]` (14×) and `text-[#0D9488]` (6×). Change the brand teal in the token file today and these 67 files won't move.
- **Only 19 files use the semantic token classes** (`bg-bg-*`, `text-text-*`, `border-border-*`) — so the token system is the minority pattern, not the default.
- **101 files use inline `style={{…}}`**, putting styling outside the class/token system entirely.
- **A few brand-relevant colors have no token at all** — notably WhatsApp green `#25D366` (hardcoded 8×). The shared style file should add tokens for these before the redesign.

**What the shared style file must standardize for the redesign:**
1. One source of truth for every brand color (add missing ones like WhatsApp green), then a sweep replacing raw hex + arbitrary `[#…]` classes with tokens.
2. Spacing/radius/shadow scale — audit inline `style={{…}}` for one-off spacing and fold into tokens.
3. A small set of shared primitives (buttons, cards, status pills, table shell) — the admin-table and pricing-display extractions (#16, #14) double as the first redesign components.

**Recommended sequence for redesign prep:** finish the SAFE deletions first (fewer files to restyle), then tokenize colors (#29) and de-inline styles (#30) file-group by file-group, using the shared-component extractions (#12, #14, #16) as the seeds of the new component library.

---

*Prepared read-only. No application code, routes, migrations, or dependencies were changed. Hold for Eyad's review — no PR. Each approved item ships later as its own small, verified build.*
