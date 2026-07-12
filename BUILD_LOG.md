# BUILD_LOG — Portal Rebuild (branch `claude/tutoring-portal-rebuild-2qfql1`)

Chronological log of every phase shipped and every routine default chosen. Money-track
items are cross-referenced in `MERGE_CHECKLIST.md` under REQUIRES SIGN-OFF.

**Model split (per build prompt):** product feature phases (2–6, W3/W4) authored by
Opus 4.8 subagents; the money track authored by Fable 5; foundational CI/infra/ledger
fixes, orchestration, and verification driven by the Fable 5 orchestrator.

---

## Pre-work (gate: CI must be green before any phase)

### CI trustworthiness
- **`server-only` under vitest** — added `resolve.alias` in `vitest.config.ts` mapping
  `server-only` → `tests/stubs/empty.ts` so server libs (`supabase-admin`, `centerNotify`)
  can be imported by unit tests. Root cause of the `signup-consent` suite failing to load
  after slice 1 imported `centerOwnerProvision`.
  - _Default chosen:_ global alias (fixes all suites) over per-test mocks.
- **`tests/unit/api/signup-consent.test.ts`** — rewritten for the trial-first route:
  mocks `@/lib/centerOwnerProvision` (no-op) and `@/lib/summer/config` (defaults),
  routes `trial_claims` vs `centers` inserts to separate builders, asserts 200 +
  `pinSetup` + billing-neutral trial center; added a one-per-phone (23505) case.
- **`tests/e2e/signup-happy.spec.ts`** — updated selectors to the new flow
  (consent-terms/consent-privacy, "Start free trial", redirect to `/set-pin`).
  _Not runnable in this environment (needs `tests/e2e/.env.local` + live);_ updated for
  correctness, flagged for a human e2e run in MERGE_CHECKLIST.

### Migration ledger reconciliation
- Renamed repo migration files to match the live ledger versions (git-only, **no DB
  write**), so a future `supabase db push` treats them as applied and does not re-run:
  - `20260710120000_phase1_staff_user_link_and_manager_role.sql` → `20260710194333_…`
  - `20260710130000_trial_claims.sql` → `20260711095712_trial_claims.sql`

### Stale teacher trial row
- Read-only check: the row is a **REAL account** (`teacher_profiles.is_test = false`,
  "Aly Shady"), NOT test data as the audit assumed. **Left untouched** (money-safety:
  never reset a real customer's subscription automatically). Flagged REQUIRES SIGN-OFF
  in MERGE_CHECKLIST as a business decision. No live-DB write performed.

### Dead pay-first machinery — DONE
- Removed the 3 callers (Paymob webhook, `invoicePaymobPayment` signup_first_payment
  branch + its import, `check-stuck-payments`) and the 3 `vi.mock` test stubs, then
  deleted `src/lib/signupPaymobAutoApprove.ts`. Verified no remaining code references
  (only stale comments in 4 files, harmless). Green: typecheck + 1181 unit tests.

### CI gate — GREEN
- `typecheck` clean; `test:unit` 145 files / 1181 tests pass (was 1 failing suite).

### Centers-route auth refactor — DONE
- `/api/admin/centers` GET refactored off its bespoke inline cookie/bearer +
  admin_users lookup onto the shared `getAdminContext(request)` resolver, exposing a
  `ctx: AdminContext` that Phase 4 will pass to `getInternalScope()` for center
  scoping. Access semantics preserved (super_admin OR canApproveSignups OR `centers`
  perm; `!ctx` → 403 to match the client's `/dashboard` redirect). Removed the now-dead
  `createServerClient`/`cookies`/`customPermissionsToKeys` imports.
  - _Scoped to GET (the list — the scoped read path). POST/DELETE mutations retain
    their own auth (not scoped reads); noted for a later cleanup._
  - _Model note: authored by the Fable orchestrator as foundational/pre-Phase-4
    refactor; product feature phases (2–6) will use Opus 4.8 subagents._

### Live-DB correction (authorized by Eyad — the single permitted write)
- Eyad confirmed the stale `trialing` teacher (`68718be7…`) is his own test account
  despite `is_test=false`. Applied: `teacher_profiles.is_test=true`; deleted the stale
  `teacher_subscriptions` row + its 1 unpaid invoice. Verified 0/0. (See MERGE_CHECKLIST.)

## PRE-WORK GATE COMPLETE ✅ (typecheck + 1181 unit tests + verify:stabilization green)

### Revised build order (per Eyad)
Phase 2 CEO home → Phase 3 combined screens → Phase 4 manager scope + two-level
assignment + promo request → Phase 5 rep scope → W3 saved-card sandbox → W4 export gate
→ **Money track (REQUIRES SIGN-OFF, Fable 5)** → **Phase 6 HR/commission views (Fable 5,
built on the finalized commission engine)**.

---

## Phase 2 — CEO home (Opus 4.8) — DONE ✅
- **Trials watch:** new `src/app/api/ceo/trials-watch/route.ts` (super_admin-only via
  requireSuperAdminApi) counting centers in trial (`summer_status='enrolled'`),
  teachers in trial (`teacher_subscriptions.status='trialing'`), converted
  (`summer_status='paid'`), and trials ending within 7 Cairo days
  (`summer_first_invoice_at`). Excludes test rows (`centers.is_test` — verified
  NOT NULL default false, so `.eq(is_test,false)` is complete; teacher test excluded
  via `teacher_profiles.is_test`). Widget rendered on `/ceo` in the existing 30s poll.
  Read-only-verified against live DB: 0/0/0/0 (greenfield). `CeoTrialsWatch` type added.
- **Removed the fakes:** deleted the hard-coded "Security alerts" tiles
  (`failedLogins24h`, `flaggedActivity`, always-0 `newRegistrations7d`, static
  systemStatus) and the dead Pending Signups KPI + its retired-page links from
  `admin/page.tsx` (grid tightened 5→4). Real revenue/health KPIs kept.
- **Dedup:** `/ceo-dashboard` now server-redirects to `/{locale}/ceo` (canonical CEO
  home). All platform controls preserved on `/ceo` (kill-switches, announcement editor,
  Section H emergency panel).
- i18n `ceo.trialsWatch.*` added (ar+en); SW_VERSION v9→v10.
- Verified by orchestrator: typecheck exit 0, 1181 unit tests, i18n/bidi/tolocale OK.
- _Human click-through needed (see MERGE_CHECKLIST): widget render on /ceo, /admin
  overview layout after removals, /ceo-dashboard redirect, RTL of new strings._

## Phase 3 — combined center+teacher screens (Opus 4.8) — DONE ✅
- **`src/lib/ownerNormalizer.ts`** (new, pure, 17 unit tests): `UnifiedAccount` +
  `normalizeCenter`/`normalizeTeacher`, `centerUnifiedStatus`/`teacherUnifiedStatus`
  (trial/active/overdue/suspended/churned/inactive), Cairo-day date normalization,
  and the canonical **`invoiceAmount()` = payment_amount ?? total_amount ?? 0** (0
  stays 0). Reuses existing MRR helpers (getImpliedMonthlyMrr / teacherMonthlyGross) —
  pricing ladders kept distinct. `parseOwnerFilter`/`ownerMatchesFilter`.
- **Centers/Teachers/All filter** (`?owner_type=center|teacher|all`, default `center`
  = regression-safe) wired into `/api/admin/{billing,renewals,finance}` GET + their
  pages (URL-synced control). Teacher subs folded into renewals/finance; teacher
  invoices resolved with names + canonical amount. Finance `center` path calls the
  original `getFinanceData` verbatim (byte-identical); canonical amount applied only to
  teacher rows so center numbers don't move.
- **No money-engine changes** — POST/PUT mutation handlers + auth gates untouched.
- Read-only DB check confirmed the bug class: an engine invoice with
  `payment_amount=NULL, total_amount=1020` reads 0 today vs 1020 canonical.
- i18n +5 admin keys (ar+en); SW_VERSION v10→v11.
- Verified by orchestrator: typecheck exit 0, 1198 unit tests, i18n/bidi/tolocale OK.

## Phase 4a — access scoping + salary privacy (Opus 4.8) — DONE ✅
- **base_salary is CEO-only** — stripped from GET responses for non-super_admin in
  `payouts/route.ts`, `payouts/[id]/route.ts`, `staff/route.ts`, `staff/[id]/route.ts`
  (conditional select on the joined embed + post-fetch delete of the row column).
- **getInternalScope wired (fail-closed)** into 4 GET routes; empty scope → sentinel
  uuid matching nothing:
  - `centers` GET — scope by `allowedCenterIds` (`.in('id', …)`), main + pending queries.
  - `card-orders` GET — gate relaxed to super_admin OR sales_manager/sales_rep; scope by
    `center_id`. PUT/PATCH **tightened to CEO-only** (was any-admin — a security fix).
  - `commissions` GET — gate relaxed to super_admin OR sales roles; scope by `staff_id`
    (an explicit `?staff_id=` param ANDs with the scope, so it can't widen). Unlock stays CEO.
  - `payouts` GET — scope by `staff_id`. Generate/mark-paid/adjust stay CEO-only.
- **Frontend gates relaxed in lockstep** (commissions/payouts/orders/staff pages) so
  sales roles render their scoped view; CEO-only write buttons hidden for non-CEO.
- New `tests/unit/api/phase4aScopeSalary.test.ts` (17 cases) proving per-role scope
  filters, the empty-scope sentinel, and base_salary stripping.
- Verified by orchestrator: typecheck exit 0, 1215 unit tests, stabilization OK; manual
  review of commissions + card-orders GET confirms fail-closed. SW_VERSION v11→v12.
- **Known follow-ups (flagged, see MERGE_CHECKLIST):** (1) a manager can still infer a
  rep's base_salary by subtracting commission tiles from the payout `total_amount` —
  the scoped manager payout VIEW should show status/commission only (refine in Phase 5);
  (2) Centers-page suspend/delete/blacklist buttons stay visible to sales roles though
  the API fails closed — hide-or-keep is a UI decision.

## Phase 4b — two-level CEO→Manager→Rep assignment (Opus 4.8) — DONE ✅
- **Migration (repo only)** `20260712120000_two_level_assignment.sql`: adds
  `center_assignments.manager_staff_id` (FK staff) + relaxes `sourced_by_eyad_no_staff`
  (a non-eyad row may carry manager_staff_id with staff_id NULL); new **`teacher_assignments`**
  table (service-role-only RLS, mirrors center concept). **NEW DATA — flagged.**
- **Scope extended (fail-closed)**: `allowedCenterIds` — a manager (`team`) unions
  `staff_id ∈ staffIds` + `manager_staff_id ∈ staffIds`; a rep (`own`) matches `staff_id`
  only (never manager_staff_id — proven by test). New `allowedTeacherIds` (same shape over
  `teacher_assignments`). 27 scope/assignment tests pass.
- **Two-level API**: CEO batch-assign centers/teachers to a manager (POST, super_admin,
  validates target is a staff `sm`, writes manager_staff_id + `pending_sm_approval`);
  manager sub-assign to rep (PATCH, gated: caller's `staff.id === row.manager_staff_id`
  AND rep's `reports_to === caller` — else 403; sets staff_id + `approved`); CEO override.
  New `/api/admin/teacher-assignments` + `[id]`. **Commission calc untouched** (money track).
- **UI**: center-assignments page gets Centers/Teachers tabs, CEO batch/override, manager
  sub-assign view; sidebar link now visible to `sales_manager`.
- Verified by orchestrator: typecheck exit 0, 1232 unit tests, stabilization OK; manual
  review of the manager sub-assign gate + migration confirms fail-closed. SW_VERSION v12→v13.

## Phase 4c — manager promo-code request flow (Opus 4.8) — DONE ✅ (Phase 4 complete)
- **Migration (repo only)** `20260712130000_promo_code_requests.sql`: new
  `promo_code_requests` table (service-role-only RLS). **NEW DATA — flagged.**
- Manager requests a code (discount/max-uses/expiry/target) → **pending**; CEO approves
  (creates the live `promo_codes` row, idempotent-safe) or rejects **with a reason**.
- Gates: POST `sales_manager` (or super_admin) + CSRF; GET managers see only their own
  (`.eq requested_by`), full-admin sees all; PATCH approve/reject **super_admin-only** + CSRF.
- **Caps** (no 100%-off unlimited): `DEFAULT_MAX_DISCOUNT_PCT=30`, `DEFAULT_MAX_USES=500`
  in `src/lib/promoCodeRequests.ts`, overridable via `platform_config`
  `promo_request.max_discount_pct` / `promo_request.max_uses`; an unbounded max-uses
  request is rejected 400. Reps get nothing (403; nav hidden).
- 16 new tests; verified by orchestrator: typecheck exit 0, 1248 unit tests, stabilization
  OK; approve/reject gate reviewed (CEO-only). SW_VERSION v13→v14.

## Phase 5 — rep card-order lockout + manager payout salary-privacy (Opus 4.8) — DONE ✅
- **Card-orders is Manager+ only.** `card-orders/route.ts` GET gate is now `isCEO ||
  isManager`; a `sales_rep` gets **403** (was allowed in 4a). Reps never see the fulfilment
  queue. `AdminOrdersClient.tsx` bounces a stray sales_rep client-side too.
- **Closes the 4a salary-inference leak.** The scoped (non-CEO) payout view no longer
  returns figures a manager could subtract to back out a rep's `base_salary`:
  - `payouts/route.ts` + `[id]/route.ts` — non-CEO branch builds a **NEW whitelisted
    object** with only `staff{id,name,role}` (no base_salary), `period`, `status`,
    the commission tiles (`t1/t2/loyalty/override`), `commission_count`, `paid_at`, and a
    derived `commission_total`. It **omits** `total_amount`, `base_salary`, `adjustment`,
    and `breakdown`. The CEO branch is unchanged (full `total_amount` + `base_salary`).
  - Verified by grep: `isCEO = ctx.internalRole === 'super_admin'`; staff embed select is
    `base_salary`-free for non-CEO; the whitelist object literal carries no salary/total.
- Frontend `payouts/page.tsx` + `commissions/page.tsx` render the commission-only view for
  managers (total-pay column hidden when the field is absent).
- i18n +5 admin keys (ar+en); SW_VERSION v14→v15.
- Verified by orchestrator: typecheck exit 0, **1250 unit tests pass**, i18n/bidi/tolocale
  OK. Manual review confirms the non-CEO payout object cannot leak base_salary.
- Resolves both Phase-4a follow-ups: (1) manager payout salary inference — CLOSED (view is
  commission-only); (2) card-order rep access — CLOSED (reps 403).

## W3 — saved-card auto-charge testable in Paymob sandbox (Opus 4.8) — DONE ✅
Fixed the three concrete gaps that made the (already-built) saved-card engine unreachable.
Orchestrator pre-verified all three against the code + live DB before dispatch.
- **Gap 1 — nothing ever set `requestToken: true`.** New `optInToCardTokenization(store, …)`
  in `savedCard/consent.ts`: returns false (records nothing) unless the customer ticked
  "save my card"; when ticked, records consent via the canonical `recordConsent` path and
  gates on `consentIsSufficient(getLatestConsent())`. Wired into BOTH first-invoice pay
  routes (`invoices/[id]/pay`, `teacher/invoices/[id]/pay`) — they set
  `request_token=true` + `token_agreement='recurring'` (same fields as `paymob.ts`
  `createPaymentKey`) ONLY when the gate returns true. Cached-iframe reuse guarded with
  `!saveCard` so an opt-in always mints a fresh tokenizing key. **Card-less stays the
  default** (product decision A) — a missing/false `saveCard` behaves exactly as before.
- **Gap 2 — token callback resolved centers only.** `resolveOwnerForOrder` now selects
  `owner_type, center_id, teacher_id` and returns a teacher owner ref for
  `owner_type='teacher'` invoices (teachers now share the `invoices` machinery), so a
  teacher's first-payment token is saved to her own owner. Center + combined-session paths
  preserved.
- **Gap 3 — autocharge `due_date` filter was exact `.eq`.** Widened the center
  "initial subscription due" query to `.lte('due_date', todayCairo)` so a summer-billing
  straggler (issued 23:00 UTC, after autocharge's old 22:00 UTC slot) is collected the
  next night. Idempotent: status stays `pending/overdue` (a `failed` invoice is the
  separate retry query), `applyCharged` guards `.neq('status','paid')`, finalize no-ops if
  paid. Also **reordered crons** in `vercel.json`: `subscription-autocharge` 22:00 →
  **23:30 UTC** so it runs AFTER `summer-billing` (23:00) — belt-and-suspenders with the
  `.lte`.
- **UI**: one opt-in checkbox on the shared `CustomerInvoicesView` (default OFF), reusing
  existing `savedCard.consent.title/body` i18n keys — **no new i18n keys**. SW_VERSION v15→v16.
- **INERT preserved**: requesting a token is benign; `saveCardFromFirstPayment` /
  `chargeSavedCard` still return `recurring_integration_not_configured` until
  `PAYMOB_RECURRING_INTEGRATION_ID` is set — no real customer saved/charged in prod.
- **No charge AMOUNT touched** — only whether/when a due invoice is collected and whether a
  card is saved. NOT a REQUIRES SIGN-OFF item.
- New tests: `savedCardOptIn.test.ts` (4), `tokenCallbackOwnerResolution.test.ts` (4),
  `autochargeDueWidening.test.ts` (2) + `lte` added to a stub in `teacherInvoiceParity.test.ts`.
- Verified by orchestrator (independent run): typecheck exit 0, **1260 unit tests pass**,
  i18n parity OK (3854 keys), bidi/tolocale OK. Reviewed line-by-line: consent gate,
  teacher owner resolution, `.lte` idempotency, Paymob field parity with `paymob.ts`.
